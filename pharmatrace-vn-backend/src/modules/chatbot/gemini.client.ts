import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type EmbedTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

export interface GeminiTurn {
  role: 'user' | 'model';
  text: string;
}

export interface GeminiGenerateOptions {
  systemInstruction: string;
  turns: GeminiTurn[];
  responseSchema: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
}

const DEFAULT_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const EMBED_BATCH_SIZE = 50;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function l2Normalize(values: number[]): number[] {
  let sum = 0;
  for (const v of values) sum += v * v;
  const norm = Math.sqrt(sum) || 1;
  return values.map((v) => v / norm);
}

/** Thin REST wrapper around the Gemini API. The key goes in a header, never in a URL or a log line. */
@Injectable()
export class GeminiClient {
  private readonly logger = new Logger(GeminiClient.name);

  constructor(private readonly config: ConfigService) {}

  get embedModel(): string {
    return this.config.get<string>('GEMINI_EMBED_MODEL') || 'gemini-embedding-001';
  }

  get chatModel(): string {
    return this.config.get<string>('GEMINI_CHAT_MODEL') || 'gemini-2.5-flash';
  }

  /** Tried when the main chat model is overloaded or down. Unset means no fallback. */
  get fallbackChatModel(): string | undefined {
    const model = this.config.get<string>('GEMINI_CHAT_FALLBACK_MODEL')?.trim();
    return model && model !== this.chatModel ? model : undefined;
  }

  get embedDimensions(): number {
    const parsed = Number(this.config.get<string>('GEMINI_EMBED_DIMENSIONS'));
    return Number.isInteger(parsed) && parsed >= 128 && parsed <= 3072 ? parsed : 768;
  }

  /** Overridable so tests and local runs can point at a stub server. */
  private get apiBase(): string {
    return this.config.get<string>('GEMINI_API_BASE')?.replace(/\/+$/, '') || DEFAULT_API_BASE;
  }

  private get apiKey(): string | undefined {
    const key = this.config.get<string>('API_GEMINI')?.trim();
    return key && !key.startsWith('your_') ? key : undefined;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /** Returns L2-normalised vectors in the same order as `texts`. `bulk` lets a background build wait out quota resets. */
  async embed(texts: string[], taskType: EmbedTaskType, bulk = false): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
      const model = this.embedModel;
      const json = await this.post<{ embeddings?: { values: number[] }[] }>(
        `${this.apiBase}/models/${model}:batchEmbedContents`,
        {
          requests: batch.map((text) => ({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            taskType,
            outputDimensionality: this.embedDimensions,
          })),
        },
        bulk ? BULK_RETRY : INTERACTIVE_RETRY,
      );
      if (!json.embeddings || json.embeddings.length !== batch.length) {
        throw new ServiceUnavailableException('Gemini returned an unexpected embedding response');
      }
      // Truncated (non-3072) embeddings are not unit length, so normalise before cosine search.
      for (const e of json.embeddings) out.push(l2Normalize(e.values));
    }
    return out;
  }

  /** Calls generateContent with a JSON response schema and returns the parsed object. */
  async generateJson<T>(options: GeminiGenerateOptions): Promise<T> {
    const body = {
      systemInstruction: { parts: [{ text: options.systemInstruction }] },
      contents: options.turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      generationConfig: {
        temperature: options.temperature ?? 0.2,
        maxOutputTokens: options.maxOutputTokens ?? 4096,
        responseMimeType: 'application/json',
        responseSchema: options.responseSchema,
      },
    };
    const urlFor = (model: string) => `${this.apiBase}/models/${model}:generateContent`;
    const fallback = this.fallbackChatModel;

    let json: GenerateResponse;
    try {
      // With a fallback available, fail over quickly instead of retrying an overloaded model.
      json = await this.post<GenerateResponse>(urlFor(this.chatModel), body, fallback ? FAILOVER_RETRY : INTERACTIVE_RETRY);
    } catch (err) {
      if (!fallback) throw err;
      this.logger.warn(`${this.chatModel} failed; falling back to ${fallback}`);
      json = await this.post<GenerateResponse>(urlFor(fallback), body);
    }

    if (json.promptFeedback?.blockReason) {
      throw new ServiceUnavailableException('The request was blocked by the AI safety filter');
    }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text.trim()) throw new ServiceUnavailableException('Gemini returned an empty answer');
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ServiceUnavailableException('Gemini returned an answer that is not valid JSON');
    }
  }

  private async post<T>(url: string, body: unknown, retry: RetryPolicy = INTERACTIVE_RETRY): Promise<T> {
    const key = this.apiKey;
    if (!key) throw new ServiceUnavailableException('The medicine assistant is not configured yet');

    let lastStatus = 0;
    for (let attempt = 0; attempt < retry.attempts; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(retry.timeoutMs),
        });
      } catch (err) {
        this.logger.warn(`Gemini request failed: ${(err as Error).name}`);
        lastStatus = 0;
        await sleep(Math.min(500 * 2 ** attempt, retry.maxWaitMs));
        continue;
      }
      if (res.ok) return (await res.json()) as T;

      lastStatus = res.status;
      const detail = await res.text().catch(() => '');
      this.logger.warn(`Gemini returned ${res.status}: ${errorMessage(detail)}`);
      if (!RETRYABLE_STATUS.has(res.status)) break;
      const wait = parseRetryDelayMs(detail, res.headers.get('retry-after')) ?? 500 * 2 ** attempt;
      // A quota reset further away than this caller is willing to wait is not worth retrying.
      if (wait > retry.maxWaitMs || attempt === retry.attempts - 1) break;
      await sleep(wait);
    }
    this.logger.error(`Gemini request failed with status ${lastStatus}`);
    throw new ServiceUnavailableException('The medicine assistant is temporarily unavailable');
  }
}

interface RetryPolicy {
  attempts: number;
  maxWaitMs: number;
  timeoutMs: number;
}

/** A user is waiting: retry briefly, give up fast. */
const INTERACTIVE_RETRY: RetryPolicy = { attempts: 3, maxWaitMs: 4_000, timeoutMs: 25_000 };
/** One try only, so a fallback model can take over without the user waiting through retries. */
const FAILOVER_RETRY: RetryPolicy = { attempts: 1, maxWaitMs: 0, timeoutMs: 10_000 };
/** Index builds run in the background and can ride out a per-minute quota reset. */
const BULK_RETRY: RetryPolicy = { attempts: 8, maxWaitMs: 70_000, timeoutMs: 60_000 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorMessage(body: string): string {
  try {
    const message = (JSON.parse(body) as { error?: { message?: unknown } }).error?.message;
    if (typeof message === 'string') return message.slice(0, 300);
  } catch {
    /* not JSON */
  }
  return body.slice(0, 200);
}

/** Reads how long Gemini asks us to wait: a Retry-After header, RetryInfo.retryDelay, or "retry in 21.5s". */
export function parseRetryDelayMs(body: string, retryAfterHeader?: string | null): number | undefined {
  const header = Number(retryAfterHeader);
  if (retryAfterHeader && Number.isFinite(header)) return Math.ceil(header * 1000);
  const match = /"retryDelay"\s*:\s*"([\d.]+)s"/.exec(body) ?? /retry in ([\d.]+)\s*s/i.exec(body);
  return match ? Math.ceil(Number(match[1]) * 1000) + 500 : undefined;
}

interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
}
