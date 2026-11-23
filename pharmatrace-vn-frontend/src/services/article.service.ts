import { apiClient } from './api.client';
import {
  Article,
  ArticleCategory,
  ArticleComment,
  ArticleCommentThread,
  ArticleInput,
  ArticleListItem,
  ArticleQuery,
  Paged,
  StaffArticleComment,
} from '@/types/article.types';

interface Data<T> {
  data: T;
}

export const articleService = {
  list: (params?: ArticleQuery): Promise<Paged<ArticleListItem>> => apiClient.get('/articles', { params }),

  getBySlug: (slug: string): Promise<Data<Article>> => apiClient.get(`/articles/${slug}`),

  categories: (): Promise<Data<ArticleCategory[]>> => apiClient.get('/articles/categories'),

  comments: (slug: string, params?: { page?: number; limit?: number }): Promise<Paged<ArticleCommentThread>> =>
    apiClient.get(`/articles/${slug}/comments`, { params }),

  addComment: (slug: string, content: string): Promise<Data<ArticleComment>> =>
    apiClient.post(`/articles/${slug}/comments`, { content }),

  editComment: (id: number, content: string): Promise<Data<ArticleComment>> =>
    apiClient.patch(`/customer/article-comments/${id}`, { content }),

  deleteComment: (id: number): Promise<Data<{ id: number }>> => apiClient.delete(`/customer/article-comments/${id}`),

  adminList: (params?: ArticleQuery): Promise<Paged<ArticleListItem>> => apiClient.get('/admin/articles', { params }),

  adminGet: (id: number): Promise<Data<Article>> => apiClient.get(`/admin/articles/${id}`),

  create: (input: ArticleInput): Promise<Data<Article>> => apiClient.post('/admin/articles', input),

  update: (id: number, input: ArticleInput): Promise<Data<Article>> => apiClient.put(`/admin/articles/${id}`, input),

  review: (id: number, status: 'PUBLISHED' | 'HIDDEN' | 'DRAFT', reviewNote?: string): Promise<Data<Article>> =>
    apiClient.patch(`/admin/articles/${id}/review`, { status, reviewNote }),

  remove: (id: number): Promise<Data<{ id: number }>> => apiClient.delete(`/admin/articles/${id}`),

  uploadImage: (file: File): Promise<Data<{ imageUrl: string; publicId: string }>> => {
    const body = new FormData();
    body.append('file', file);
    return apiClient.post('/admin/articles/upload-image', body, { headers: { 'Content-Type': 'multipart/form-data' } });
  },

  createCategory: (name: string): Promise<Data<ArticleCategory>> => apiClient.post('/admin/article-categories', { name }),

  renameCategory: (id: number, name: string): Promise<Data<ArticleCategory>> =>
    apiClient.put(`/admin/article-categories/${id}`, { name }),

  deleteCategory: (id: number): Promise<Data<{ id: number }>> => apiClient.delete(`/admin/article-categories/${id}`),

  adminComments: (params?: { page?: number; limit?: number; articleId?: number }): Promise<Paged<StaffArticleComment>> =>
    apiClient.get('/admin/article-comments', { params }),

  reply: (id: number, content: string): Promise<Data<ArticleComment>> =>
    apiClient.post(`/admin/article-comments/${id}/reply`, { content }),

  setCommentStatus: (id: number, status: 'VISIBLE' | 'HIDDEN'): Promise<Data<ArticleComment>> =>
    apiClient.patch(`/admin/article-comments/${id}/status`, { status }),

  adminDeleteComment: (id: number): Promise<Data<{ id: number }>> => apiClient.delete(`/admin/article-comments/${id}`),
};
