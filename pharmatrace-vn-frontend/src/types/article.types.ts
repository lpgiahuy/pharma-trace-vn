export type ArticleStatus = 'DRAFT' | 'PENDING' | 'PUBLISHED' | 'HIDDEN';

export interface ArticleCategory {
  id: number;
  name: string;
  slug: string;
}

export interface ArticleListItem {
  id: number;
  title: string;
  slug: string;
  summary: string | null;
  coverImageUrl: string | null;
  authorName: string | null;
  viewCount: number;
  status: ArticleStatus;
  reviewNote: string | null;
  publishedAt: string | null;
  updatedAt: string;
  category: ArticleCategory | null;
}

export interface Article extends ArticleListItem {
  content: string;
  categoryId: number | null;
  coverImagePublicId: string | null;
}

export interface ArticleInput {
  title: string;
  summary?: string;
  content: string;
  categoryId?: number;
  coverImageUrl?: string;
  coverImagePublicId?: string;
  status?: ArticleStatus;
}

export interface ArticleComment {
  id: number;
  articleId: number;
  parentId: number | null;
  customerId: number | null;
  authorName: string;
  isStaff: boolean;
  content: string;
  status: 'VISIBLE' | 'HIDDEN';
  createdAt: string;
  updatedAt: string;
}

export interface ArticleCommentThread extends ArticleComment {
  replies: ArticleComment[];
}

export interface StaffArticleComment extends ArticleComment {
  article: { id: number; title: string; slug: string };
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paged<T> {
  data: T[];
  pagination: Pagination;
}

export interface ArticleQuery {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: number;
  status?: ArticleStatus;
}
