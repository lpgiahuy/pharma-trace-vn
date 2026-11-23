import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { authActor, requireCustomer } from '../../common/auth-identity';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ArticleQueryDto, CommentQueryDto } from './dto/article-query.dto';
import { CommentDto, CommentStatusDto } from './dto/comment.dto';
import { authorName } from './author-name';

type CommentRow = Prisma.article_commentsGetPayload<object>;

function toComment(c: CommentRow) {
  return {
    id: c.id,
    articleId: c.article_id,
    parentId: c.parent_id,
    authorName: c.author_name,
    isStaff: c.employee_id !== null,
    content: c.content,
    status: c.status,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

function pagination(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) || 1 };
}

@Injectable()
export class ArticleCommentService {
  constructor(private readonly prisma: PrismaService) {}

  async listByArticle(slug: string, query: ArticleQueryDto) {
    return this.prisma.withArticle(async (tx) => {
      const article = await tx.articles.findFirst({ where: { slug, status: 'PUBLISHED' }, select: { id: true } });
      if (!article) throw new NotFoundException('Article not found');
      const where = { article_id: article.id, parent_id: null };
      const [roots, total] = await Promise.all([
        tx.article_comments.findMany({
          where, orderBy: { created_at: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit,
          include: { replies: { orderBy: { created_at: 'asc' } } },
        }),
        tx.article_comments.count({ where }),
      ]);
      return {
        items: roots.map(({ replies, ...root }) => ({ ...toComment(root), replies: replies.map(toComment) })),
        pagination: pagination(query.page, query.limit, total),
      };
    });
  }

  async create(slug: string, dto: CommentDto, user: CurrentUserPayload) {
    const customerId = requireCustomer(user);
    return this.prisma.withArticle(async (tx) => {
      const article = await tx.articles.findFirst({ where: { slug, status: 'PUBLISHED' }, select: { id: true } });
      if (!article) throw new NotFoundException('Article not found');
      const created = await tx.article_comments.create({
        data: {
          article_id: article.id, customer_id: customerId,
          author_name: authorName(user), content: dto.content.trim(),
        },
      });
      return toComment(created);
    }, authActor(user));
  }

  async updateOwn(id: number, dto: CommentDto, user: CurrentUserPayload) {
    const customerId = requireCustomer(user);
    return this.prisma.withArticle(async (tx) => {
      const { count } = await tx.article_comments.updateMany({
        where: { id, customer_id: customerId },
        data: { content: dto.content.trim(), updated_at: new Date() },
      });
      if (!count) throw new NotFoundException('Comment not found');
      return toComment(await tx.article_comments.findUniqueOrThrow({ where: { id } }));
    }, authActor(user));
  }

  async listForStaff(query: CommentQueryDto, user: CurrentUserPayload) {
    return this.prisma.withArticle(async (tx) => {
      const where: Prisma.article_commentsWhereInput = query.articleId ? { article_id: query.articleId } : {};
      const [items, total] = await Promise.all([
        tx.article_comments.findMany({
          where, orderBy: { created_at: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit,
          include: { article: { select: { id: true, title: true, slug: true } } },
        }),
        tx.article_comments.count({ where }),
      ]);
      return {
        items: items.map(({ article, ...comment }) => ({ ...toComment(comment), article })),
        pagination: pagination(query.page, query.limit, total),
      };
    }, authActor(user));
  }

  async reply(id: number, dto: CommentDto, user: CurrentUserPayload) {
    return this.prisma.withArticle(async (tx) => {
      const parent = await tx.article_comments.findFirst({ where: { id, parent_id: null }, select: { article_id: true } });
      if (!parent) throw new NotFoundException('Comment not found');
      const created = await tx.article_comments.create({
        data: {
          article_id: parent.article_id, parent_id: id, employee_id: user.id,
          author_name: authorName(user), content: dto.content.trim(),
        },
      });
      return toComment(created);
    }, authActor(user));
  }

  async setStatus(id: number, dto: CommentStatusDto, user: CurrentUserPayload) {
    return this.prisma.withArticle(async (tx) => {
      const { count } = await tx.article_comments.updateMany({
        where: { id }, data: { status: dto.status, updated_at: new Date() },
      });
      if (!count) throw new NotFoundException('Comment not found');
      return toComment(await tx.article_comments.findUniqueOrThrow({ where: { id } }));
    }, authActor(user));
  }

  async remove(id: number, user: CurrentUserPayload) {
    return this.prisma.withArticle(async (tx) => {
      const { count } = await tx.article_comments.deleteMany({ where: { id } });
      if (!count) throw new ForbiddenException('You cannot delete this comment');
      return { id };
    }, authActor(user));
  }
}
