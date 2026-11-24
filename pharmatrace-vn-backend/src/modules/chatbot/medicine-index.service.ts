import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { GeminiClient } from './gemini.client';
import { buildMedicineDoc, MedicineDoc } from './medicine-knowledge';
import { VectorIndex } from './vector-index';

const EMBED_CHUNK = 50;

interface CacheFile {
  model: string;
  dimensions: number;
  entries: Record<string, { hash: string; vector: number[] }>;
}

export interface RetrievedMedicine {
  doc: MedicineDoc;
  score: number;
}

/**
 * In-memory vector index over the ACTIVE catalogue. Postgres here has no pgvector and the catalogue is a few
 * hundred rows, so vectors live in memory and are cached on disk keyed by a content hash: a restart only
 * re-embeds products whose text changed.
 */
@Injectable()
export class MedicineIndexService implements OnModuleInit {
  private readonly logger = new Logger(MedicineIndexService.name);
  private readonly index = new VectorIndex();
  private readonly docs = new Map<number, MedicineDoc>();
  private building: Promise<void> | null = null;
  private lastSuccess = 0;
  private lastAttempt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiClient,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.gemini.isConfigured()) {
      this.logger.warn('API_GEMINI is not set: the medicine assistant is disabled');
      return;
    }
    void this.refresh().catch((err) => this.logger.error(`Initial medicine index build failed: ${(err as Error).message}`));
  }

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledRefresh(): Promise<void> {
    if (!this.gemini.isConfigured()) return;
    await this.refresh().catch((err) => this.logger.error(`Medicine index refresh failed: ${(err as Error).message}`));
  }

  get size(): number {
    return this.index.size;
  }

  /** Waits for a build in progress, or starts one when the index is empty (e.g. the first build failed). */
  async ensureReady(): Promise<void> {
    if (this.building) await this.building.catch(() => undefined);
    // Retry an empty index at most once a minute so a quota outage is not hammered by every request.
    if (this.index.size === 0 && Date.now() - this.lastAttempt > 60_000) await this.refresh();
    if (this.index.size === 0) throw new ServiceUnavailableException('The medicine assistant is still starting up');
  }

  search(queryVector: number[], k: number, minScore: number): RetrievedMedicine[] {
    return this.index
      .search(queryVector, k, minScore)
      .map((hit) => ({ doc: this.docs.get(hit.id)!, score: hit.score }))
      .filter((r) => r.doc);
  }

  refresh(): Promise<void> {
    if (!this.building) {
      this.building = this.rebuild().finally(() => {
        this.building = null;
      });
    }
    return this.building;
  }

  private cachePath(): string {
    return join(this.config.get<string>('CHATBOT_CACHE_DIR') || join(process.cwd(), '.cache'), 'medicine-embeddings.json');
  }

  private hashOf(doc: MedicineDoc): string {
    return createHash('sha256').update(`${this.gemini.embedModel}|${this.gemini.embedDimensions}|${doc.embedText}`).digest('hex');
  }

  private async loadCache(): Promise<CacheFile['entries']> {
    try {
      const file = JSON.parse(await readFile(this.cachePath(), 'utf8')) as CacheFile;
      if (file.model === this.gemini.embedModel && file.dimensions === this.gemini.embedDimensions) return file.entries;
    } catch {
      /* no usable cache */
    }
    return {};
  }

  private async saveCache(entries: CacheFile['entries']): Promise<void> {
    const path = this.cachePath();
    try {
      await mkdir(join(path, '..'), { recursive: true });
      const body: CacheFile = { model: this.gemini.embedModel, dimensions: this.gemini.embedDimensions, entries };
      await writeFile(`${path}.tmp`, JSON.stringify(body));
      await rename(`${path}.tmp`, path);
    } catch (err) {
      this.logger.warn(`Could not write the embedding cache: ${(err as Error).message}`);
    }
  }

  private async loadDocs(): Promise<MedicineDoc[]> {
    const rows = await this.prisma.medicines.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        medicine_name: true,
        slug: true,
        image_url: true,
        effective_price: true,
        unit_price: true,
        is_prescription: true,
        active_ingredients: true,
        short_description: true,
        details: true,
        medicine_categories: { select: { category: { select: { category_name: true } } } },
      },
    });
    return rows.map((r) =>
      buildMedicineDoc({
        ...r,
        categories: r.medicine_categories.map((mc) => mc.category.category_name),
      }),
    );
  }

  private async rebuild(): Promise<void> {
    const started = Date.now();
    this.lastAttempt = started;
    const docs = await this.loadDocs();
    const cached = await this.loadCache();
    const entries: CacheFile['entries'] = {};
    const stale: MedicineDoc[] = [];

    for (const doc of docs) {
      const hash = this.hashOf(doc);
      const hit = cached[doc.id];
      if (hit && hit.hash === hash) entries[doc.id] = hit;
      else stale.push(doc);
    }

    // Embed in chunks and save the cache after each one: free-tier quotas are small, so a failure halfway
    // must not throw away the vectors that were already paid for.
    let failure: Error | undefined;
    let embedded = 0;
    for (let i = 0; i < stale.length && !failure; i += EMBED_CHUNK) {
      const chunk = stale.slice(i, i + EMBED_CHUNK);
      try {
        const vectors = await this.gemini.embed(
          chunk.map((d) => d.embedText),
          'RETRIEVAL_DOCUMENT',
          true,
        );
        chunk.forEach((doc, j) => {
          entries[doc.id] = { hash: this.hashOf(doc), vector: vectors[j] };
        });
        embedded += chunk.length;
        await this.saveCache(entries);
      } catch (err) {
        failure = err instanceof Error ? err : new Error(String(err));
      }
    }

    // Serve whatever has a vector; products still waiting for one are picked up by the next refresh.
    const liveIds = new Set(docs.map((d) => d.id));
    for (const id of this.index.ids()) if (!liveIds.has(id)) this.index.delete(id);
    this.docs.clear();
    let indexed = 0;
    for (const doc of docs) {
      const entry = entries[doc.id];
      if (!entry) continue;
      this.docs.set(doc.id, doc);
      this.index.set(doc.id, entry.vector);
      indexed++;
    }

    if (failure) {
      this.logger.warn(`Medicine index is partial: ${indexed}/${docs.length} products (${embedded} embedded this run)`);
      throw failure;
    }
    this.lastSuccess = Date.now();
    this.logger.log(`Medicine index ready: ${docs.length} products (${embedded} embedded, ${docs.length - embedded} from cache) in ${Date.now() - started}ms`);
  }

  get lastBuiltAt(): number {
    return this.lastSuccess;
  }
}
