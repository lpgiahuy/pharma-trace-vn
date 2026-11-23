\set ON_ERROR_STOP on
BEGIN;
REVOKE ALL ON public.articles, public.article_categories, public.article_comments FROM PUBLIC, app_user;
GRANT SELECT, DELETE ON public.articles, public.article_categories, public.article_comments TO app_user;
GRANT INSERT (title, slug, summary, content, cover_image_url, cover_image_public_id, category_id, author_id, author_name, status, review_note, published_at, created_at, updated_at)
    ON public.articles TO app_user;
GRANT UPDATE (title, slug, summary, content, cover_image_url, cover_image_public_id, category_id, status, review_note, published_at, updated_at)
    ON public.articles TO app_user;
GRANT INSERT (name, slug), UPDATE (name, slug) ON public.article_categories TO app_user;
GRANT INSERT (article_id, parent_id, customer_id, employee_id, author_name, content, status, created_at, updated_at) ON public.article_comments TO app_user;
GRANT UPDATE (content, status, updated_at) ON public.article_comments TO app_user;
REVOKE ALL ON SEQUENCE public.articles_id_seq, public.article_categories_id_seq, public.article_comments_id_seq FROM PUBLIC, app_user;
GRANT USAGE ON SEQUENCE public.articles_id_seq, public.article_categories_id_seq, public.article_comments_id_seq TO app_user;

CREATE OR REPLACE FUNCTION public.article_actor() RETURNS integer
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::integer
$$;

CREATE OR REPLACE FUNCTION public.article_is(actor_type text, VARIADIC actor_roles text[]) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT public.article_actor() IS NOT NULL
      AND current_setting('app.current_user_type', true) = actor_type
      AND current_setting('app.current_user_role', true) = ANY (actor_roles)
$$;

REVOKE ALL ON FUNCTION public.article_actor() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.article_is(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.article_actor() TO app_user;
GRANT EXECUTE ON FUNCTION public.article_is(text, text[]) TO app_user;

CREATE OR REPLACE FUNCTION public.is_root_article_comment(comment_id integer, on_article_id integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT EXISTS (SELECT FROM public.article_comments
        WHERE id = comment_id AND article_id = on_article_id AND parent_id IS NULL)
$$;
REVOKE ALL ON FUNCTION public.is_root_article_comment(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_root_article_comment(integer, integer) TO app_user;

CREATE OR REPLACE FUNCTION public.increment_article_views(article_slug text) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    UPDATE public.articles SET view_count = coalesce(view_count, 0) + 1
    WHERE slug = article_slug AND status = 'PUBLISHED' RETURNING view_count
$$;
REVOKE ALL ON FUNCTION public.increment_article_views(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_article_views(text) TO app_user;

CREATE OR REPLACE FUNCTION public.guard_article_comment_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN RETURN NEW; END IF;
    IF public.article_is('customer', 'CUSTOMER') AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Only staff can change comment visibility' USING ERRCODE = '42501';
    END IF;
    IF public.article_is('employee', 'SUPER_ADMIN', 'ADMIN', 'PHARMACIST')
        AND NEW.content IS DISTINCT FROM OLD.content AND OLD.employee_id IS DISTINCT FROM public.article_actor() THEN
        RAISE EXCEPTION 'Staff can only edit their own replies' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_article_comment_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_article_comment_update() TO app_user;
DROP TRIGGER IF EXISTS article_comment_update_columns ON public.article_comments;
CREATE TRIGGER article_comment_update_columns BEFORE UPDATE ON public.article_comments
    FOR EACH ROW EXECUTE FUNCTION public.guard_article_comment_update();

DROP POLICY IF EXISTS article_read ON public.articles;
CREATE POLICY article_read ON public.articles FOR SELECT TO app_user USING (
    status = 'PUBLISHED' OR public.article_is('employee', 'SUPER_ADMIN', 'ADMIN')
    OR (public.article_is('employee', 'PHARMACIST') AND author_id = public.article_actor()));
DROP POLICY IF EXISTS article_insert ON public.articles;
CREATE POLICY article_insert ON public.articles FOR INSERT TO app_user WITH CHECK (
    author_id = public.article_actor() AND (public.article_is('employee', 'SUPER_ADMIN', 'ADMIN')
    OR (public.article_is('employee', 'PHARMACIST') AND status IN ('DRAFT', 'PENDING'))));
DROP POLICY IF EXISTS article_update ON public.articles;
CREATE POLICY article_update ON public.articles FOR UPDATE TO app_user
USING (public.article_is('employee', 'SUPER_ADMIN', 'ADMIN')
    OR (public.article_is('employee', 'PHARMACIST') AND author_id = public.article_actor() AND status IN ('DRAFT', 'PENDING')))
WITH CHECK (public.article_is('employee', 'SUPER_ADMIN', 'ADMIN')
    OR (public.article_is('employee', 'PHARMACIST') AND author_id = public.article_actor() AND status IN ('DRAFT', 'PENDING')));
DROP POLICY IF EXISTS article_delete ON public.articles;
CREATE POLICY article_delete ON public.articles FOR DELETE TO app_user USING (
    public.article_is('employee', 'SUPER_ADMIN', 'ADMIN')
    OR (public.article_is('employee', 'PHARMACIST') AND author_id = public.article_actor() AND status = 'DRAFT'));

DROP POLICY IF EXISTS article_category_read ON public.article_categories;
CREATE POLICY article_category_read ON public.article_categories FOR SELECT TO app_user USING (true);
DROP POLICY IF EXISTS article_category_insert ON public.article_categories;
CREATE POLICY article_category_insert ON public.article_categories FOR INSERT TO app_user
WITH CHECK (public.article_is('employee', 'SUPER_ADMIN', 'ADMIN'));
DROP POLICY IF EXISTS article_category_update ON public.article_categories;
CREATE POLICY article_category_update ON public.article_categories FOR UPDATE TO app_user
USING (public.article_is('employee', 'SUPER_ADMIN', 'ADMIN')) WITH CHECK (public.article_is('employee', 'SUPER_ADMIN', 'ADMIN'));
DROP POLICY IF EXISTS article_category_delete ON public.article_categories;
CREATE POLICY article_category_delete ON public.article_categories FOR DELETE TO app_user
USING (public.article_is('employee', 'SUPER_ADMIN', 'ADMIN'));

DROP POLICY IF EXISTS article_comment_read ON public.article_comments;
CREATE POLICY article_comment_read ON public.article_comments FOR SELECT TO app_user USING (
    EXISTS (SELECT FROM public.articles a WHERE a.id = article_id)
    AND (status = 'VISIBLE' OR public.article_is('employee', 'SUPER_ADMIN', 'ADMIN', 'PHARMACIST')
        OR (public.article_is('customer', 'CUSTOMER') AND customer_id = public.article_actor())));
DROP POLICY IF EXISTS article_comment_insert ON public.article_comments;
CREATE POLICY article_comment_insert ON public.article_comments FOR INSERT TO app_user WITH CHECK (
    status = 'VISIBLE' AND EXISTS (SELECT FROM public.articles a WHERE a.id = article_id AND a.status = 'PUBLISHED')
    AND ((public.article_is('customer', 'CUSTOMER') AND customer_id = public.article_actor()
            AND employee_id IS NULL AND parent_id IS NULL)
        OR (public.article_is('employee', 'SUPER_ADMIN', 'ADMIN', 'PHARMACIST') AND employee_id = public.article_actor()
            AND customer_id IS NULL
            AND public.is_root_article_comment(parent_id, article_id))));
DROP POLICY IF EXISTS article_comment_update ON public.article_comments;
CREATE POLICY article_comment_update ON public.article_comments FOR UPDATE TO app_user
USING (public.article_is('employee', 'SUPER_ADMIN', 'ADMIN', 'PHARMACIST')
    OR (public.article_is('customer', 'CUSTOMER') AND customer_id = public.article_actor()))
WITH CHECK (public.article_is('employee', 'SUPER_ADMIN', 'ADMIN', 'PHARMACIST')
    OR (public.article_is('customer', 'CUSTOMER') AND customer_id = public.article_actor()));
DROP POLICY IF EXISTS article_comment_delete ON public.article_comments;
CREATE POLICY article_comment_delete ON public.article_comments FOR DELETE TO app_user USING (
    public.article_is('employee', 'SUPER_ADMIN', 'ADMIN')
    OR (public.article_is('employee', 'PHARMACIST') AND employee_id = public.article_actor())
    OR (public.article_is('customer', 'CUSTOMER') AND customer_id = public.article_actor()));

ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.articles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.article_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE public.article_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_comments FORCE ROW LEVEL SECURITY;
COMMIT;
