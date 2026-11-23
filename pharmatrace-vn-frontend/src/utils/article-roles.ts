const normalize = (role: unknown): string => String(role ?? '').toUpperCase().replace(/[\s_-]/g, '');

export const isArticleEditor = (role: unknown): boolean => ['SUPERADMIN', 'ADMIN'].includes(normalize(role));

export const hasArticleContent = (html: string): boolean =>
  /<img\b/i.test(html) || html.replace(/<[^>]*>/g, '').trim().length > 0;
