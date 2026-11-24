\set ON_ERROR_STOP on
CREATE TABLE IF NOT EXISTS public.article_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(120) NOT NULL UNIQUE
);

ALTER TABLE public.articles
    ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES public.article_categories(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS cover_image_public_id TEXT,
    ADD COLUMN IF NOT EXISTS author_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS review_note TEXT,
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.articles ALTER COLUMN status SET DEFAULT 'DRAFT';
ALTER TABLE public.articles ALTER COLUMN status SET NOT NULL;
ALTER TABLE public.articles DROP CONSTRAINT IF EXISTS articles_status_check;
ALTER TABLE public.articles ADD CONSTRAINT articles_status_check
    CHECK (status IN ('DRAFT', 'PENDING', 'PUBLISHED', 'HIDDEN'));
UPDATE public.articles a SET author_name = e.full_name FROM public.employees e WHERE e.id = a.author_id AND a.author_name IS NULL;
UPDATE public.articles SET published_at = created_at WHERE status = 'PUBLISHED' AND published_at IS NULL;

CREATE TABLE IF NOT EXISTS public.article_comments (
    id SERIAL PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES public.article_comments(id) ON DELETE CASCADE,
    customer_id INTEGER REFERENCES public.customers(id) ON DELETE CASCADE,
    employee_id INTEGER REFERENCES public.employees(id) ON DELETE SET NULL,
    author_name VARCHAR(255) NOT NULL,
    content TEXT NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000),
    status VARCHAR(20) NOT NULL DEFAULT 'VISIBLE' CHECK (status IN ('VISIBLE', 'HIDDEN')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (customer_id IS NULL OR employee_id IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_articles_status_published ON public.articles(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category ON public.articles(category_id);
CREATE INDEX IF NOT EXISTS idx_article_comments_article ON public.article_comments(article_id, created_at);
CREATE INDEX IF NOT EXISTS idx_article_comments_parent ON public.article_comments(parent_id);
