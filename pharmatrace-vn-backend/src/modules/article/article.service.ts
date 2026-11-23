import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { authActor } from '../../common/auth-identity';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ArticleQueryDto, ArticleStatus } from './dto/article-query.dto';
import { ReviewArticleDto, SaveArticleDto, SaveCategoryDto } from './dto/save-article.dto';
import { sanitizeArticleHtml, slugify } from './article-html';
import { authorName } from './author-name';

const listSelect = {
  id: true, title: true, slug: true, summary: true, cover_image_url: true, author_name: true,
  view_count: true, status: true, review_note: true, published_at: true, updated_at: true,
  category: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.articlesSelect;

const detailSelect = {
  ...listSelect, content: true, category_id: true, cover_image_public_id: true,
} satisfies Prisma.articlesSelect;

type ListRow = Prisma.articlesGetPayload<{ select: typeof listSelect }>;
type DetailRow = Prisma.articlesGetPayload<{ select: typeof detailSelect }>;

const AUTHOR_STATUSES: ArticleStatus[] = ['DRAFT', 'PENDING'];

function toListItem(a: ListRow) {
  return {
    id: a.id,
    title: a.title,
    slug: a.slug,
    summary: a.summary,
    coverImageUrl: a.cover_image_url,
    authorName: a.author_name,
    viewCount: a.view_count ?? 0,
    status: a.status as ArticleStatus,
    reviewNote: a.review_note,
    publishedAt: a.published_at,
    updatedAt: a.updated_at,
    category: a.category,
  };
}

function toDetail(a: DetailRow) {
  return { ...toListItem(a), content: a.content, categoryId: a.category_id, coverImagePublicId: a.cover_image_public_id };
}

function pagination(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) || 1 };
}

@Injectable()
export class ArticleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  private async uniqueSlug(tx: Prisma.TransactionClient, title: string): Promise<string> {
    const base = slugify(title) || 'bai-viet';
    const taken = await tx.articles.findUnique({ where: { slug: base }, select: { id: true } });
    return taken ? `${base}-${Date.now().toString(36)}` : base;
  }

  private assertCanSetStatus(user: CurrentUserPayload, status: ArticleStatus) {
    if (authActor(user).role === 'PHARMACIST' && !AUTHOR_STATUSES.includes(status)) {
      throw new ForbiddenException('Pharmacists can only save drafts or submit articles for review');
    }
  }

  private filters(query: ArticleQueryDto): Prisma.articlesWhereInput {
    return {
      ...(query.categoryId ? { category_id: query.categoryId } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };
  }

  async listPublished(query: ArticleQueryDto) {
    return this.prisma.withArticle(async (tx) => {
      const where: Prisma.articlesWhereInput = { ...this.filters(query), status: 'PUBLISHED' };
      const [items, total] = await Promise.all([
        tx.articles.findMany({
          where, select: listSelect, orderBy: { published_at: 'desc' },
          skip: (query.page - 1) * query.limit, take: query.limit,
        }),
        tx.articles.count({ where }),
      ]);
      return { items: items.map(toListItem), pagination: pagination(query.page, query.limit, total) };
    });
  }

  async getPublishedBySlug(slug: string) {
    return this.prisma.withArticle(async (tx) => {
      await tx.$queryRaw`SELECT public.increment_article_views(${slug})`;
      const article = await tx.articles.findFirst({ where: { slug, status: 'PUBLISHED' }, select: detailSelect });
      if (!article) throw new NotFoundException('Article not found');
      return toDetail(article);
    });
  }

  async listForStaff(query: ArticleQueryDto, user: CurrentUserPayload) {
    return this.prisma.withArticle(async (tx) => {
      const where: Prisma.articlesWhereInput = { ...this.filters(query), ...(query.status ? { status: query.status } : {}) };
      const [items, total] = await Promise.all([
        tx.articles.findMany({
          where, select: listSelect, orderBy: { updated_at: 'desc' },
          skip: (query.page - 1) * query.limit, take: query.limit,
        }),
        tx.articles.count({ where }),
      ]);
      return { items: items.map(toListItem), pagination: pagination(query.page, query.limit, total) };
    }, authActor(user));
  }

  async getForStaff(id: number, user: CurrentUserPayload) {
    return this.prisma.withArticle(async (tx) => {
      const article = await tx.articles.findUnique({ where: { id }, select: detailSelect });
      if (!article) throw new NotFoundException('Article not found');
      return toDetail(article);
    }, authActor(user));
  }

  async create(dto: SaveArticleDto, user: CurrentUserPayload) {
    const status = dto.status ?? 'DRAFT';
    this.assertCanSetStatus(user, status);
    return this.prisma.withArticle(async (tx) => {
      const created = await tx.articles.create({
        select: detailSelect,
        data: {
          title: dto.title.trim(),
          slug: await this.uniqueSlug(tx, dto.title),
          summary: dto.summary?.trim() || null,
          content: sanitizeArticleHtml(dto.content),
          category_id: dto.categoryId ?? null,
          cover_image_url: dto.coverImageUrl ?? null,
          cover_image_public_id: dto.coverImagePublicId ?? null,
          author_id: user.id,
          author_name: authorName(user),
          status,
          published_at: status === 'PUBLISHED' ? new Date() : null,
        },
      });
      return toDetail(created);
    }, authActor(user));
  }

  async update(id: number, dto: SaveArticleDto, user: CurrentUserPayload) {
    if (dto.status) this.assertCanSetStatus(user, dto.status);
    const { article, replacedImage } = await this.prisma.withArticle(async (tx) => {
      const current = await tx.articles.findUnique({
        where: { id },
        select: { status: true, published_at: true, cover_image_public_id: true },
      });
      if (!current) throw new NotFoundException('Article not found');
      const status = dto.status ?? (current.status as ArticleStatus);
      const coverImagePublicId = dto.coverImagePublicId ?? null;
      const updated = await tx.articles.update({
        where: { id },
        select: detailSelect,
        data: {
          title: dto.title.trim(),
          summary: dto.summary?.trim() || null,
          content: sanitizeArticleHtml(dto.content),
          category_id: dto.categoryId ?? null,
          cover_image_url: dto.coverImageUrl ?? null,
          cover_image_public_id: coverImagePublicId,
          status,
          published_at: status === 'PUBLISHED' ? (current.published_at ?? new Date()) : current.published_at,
          updated_at: new Date(),
        },
      });
      const replaced = current.cover_image_public_id !== null && current.cover_image_public_id !== coverImagePublicId;
      return { article: updated, replacedImage: replaced ? current.cover_image_public_id : null };
    }, authActor(user));
    if (replacedImage) await this.cloudinary.deleteImage(replacedImage);
    return toDetail(article);
  }

  async review(id: number, dto: ReviewArticleDto, user: CurrentUserPayload) {
    return this.prisma.withArticle(async (tx) => {
      const current = await tx.articles.findUnique({ where: { id }, select: { published_at: true } });
      if (!current) throw new NotFoundException('Article not found');
      const updated = await tx.articles.update({
        where: { id },
        select: detailSelect,
        data: {
          status: dto.status,
          review_note: dto.status === 'DRAFT' ? dto.reviewNote?.trim() || null : null,
          published_at: dto.status === 'PUBLISHED' ? (current.published_at ?? new Date()) : current.published_at,
          updated_at: new Date(),
        },
      });
      return toDetail(updated);
    }, authActor(user));
  }

  async remove(id: number, user: CurrentUserPayload) {
    const publicId = await this.prisma.withArticle(async (tx) => {
      const article = await tx.articles.findUnique({ where: { id }, select: { cover_image_public_id: true } });
      if (!article) throw new NotFoundException('Article not found');
      const { count } = await tx.articles.deleteMany({ where: { id } });
      if (!count) throw new ForbiddenException('You cannot delete this article');
      return article.cover_image_public_id;
    }, authActor(user));
    if (publicId) await this.cloudinary.deleteImage(publicId);
    return { id };
  }

  async listCategories() {
    return this.prisma.withArticle((tx) => tx.article_categories.findMany({ orderBy: { name: 'asc' } }));
  }

  async createCategory(dto: SaveCategoryDto, user: CurrentUserPayload) {
    return this.saveCategory(dto, user, (tx, data) => tx.article_categories.create({ data }));
  }

  async updateCategory(id: number, dto: SaveCategoryDto, user: CurrentUserPayload) {
    return this.saveCategory(dto, user, (tx, data) => tx.article_categories.update({ where: { id }, data }));
  }

  async removeCategory(id: number, user: CurrentUserPayload) {
    return this.prisma.withArticle(async (tx) => {
      const { count } = await tx.article_categories.deleteMany({ where: { id } });
      if (!count) throw new NotFoundException('Category not found');
      return { id };
    }, authActor(user));
  }

  private async saveCategory<T>(
    dto: SaveCategoryDto,
    user: CurrentUserPayload,
    write: (tx: Prisma.TransactionClient, data: { name: string; slug: string }) => Promise<T>,
  ) {
    const name = dto.name.trim();
    const slug = slugify(name);
    if (!slug) throw new BadRequestException('Category name is invalid');
    try {
      return await this.prisma.withArticle((tx) => write(tx, { name, slug }), authActor(user));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Category already exists');
      }
      throw error;
    }
  }
}
