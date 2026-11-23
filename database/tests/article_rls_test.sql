\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.customers (full_name, email) VALUES ('Article A', format('article-a-%s@example.test', txid_current())) RETURNING id AS a \gset art_
INSERT INTO public.customers (full_name, email) VALUES ('Article B', format('article-b-%s@example.test', txid_current())) RETURNING id AS b \gset art_
INSERT INTO public.employees (full_name, email, role) VALUES ('Admin', format('art-admin-%s@example.test', txid_current()), 'ADMIN') RETURNING id AS admin \gset art_
INSERT INTO public.employees (full_name, email, role) VALUES ('Pharmacist 1', format('art-ph1-%s@example.test', txid_current()), 'PHARMACIST') RETURNING id AS ph1 \gset art_
INSERT INTO public.employees (full_name, email, role) VALUES ('Pharmacist 2', format('art-ph2-%s@example.test', txid_current()), 'PHARMACIST') RETURNING id AS ph2 \gset art_
INSERT INTO public.articles (title, slug, content, status, author_id) VALUES ('Published', 'art-test-published', '<p>x</p>', 'PUBLISHED', :art_ph1) RETURNING id AS pub \gset art_
INSERT INTO public.articles (title, slug, content, status, author_id) VALUES ('Draft 1', 'art-test-draft-1', '<p>x</p>', 'DRAFT', :art_ph1) RETURNING id AS draft1 \gset art_
INSERT INTO public.articles (title, slug, content, status, author_id) VALUES ('Draft 2', 'art-test-draft-2', '<p>x</p>', 'DRAFT', :art_ph2) RETURNING id AS draft2 \gset art_
INSERT INTO public.article_comments (article_id, customer_id, author_name, content) VALUES (:art_pub, :art_a, 'n', 'Own') RETURNING id AS own \gset art_
INSERT INTO public.article_comments (article_id, customer_id, author_name, content) VALUES (:art_pub, :art_b, 'n', 'Foreign') RETURNING id AS foreign \gset art_
SELECT set_config('test.pub', :'art_pub', true), set_config('test.draft1', :'art_draft1', true), set_config('test.draft2', :'art_draft2', true),
       set_config('test.own', :'art_own', true), set_config('test.foreign', :'art_foreign', true);
SET LOCAL ROLE app_user;

SELECT set_config('app.current_user_id', '', true), set_config('app.current_user_type', '', true), set_config('app.current_user_role', '', true);
DO $$ BEGIN
    IF EXISTS (SELECT FROM public.articles WHERE status <> 'PUBLISHED') THEN RAISE EXCEPTION 'Public sees unpublished articles'; END IF;
    IF (SELECT count(*) FROM public.article_comments WHERE article_id = current_setting('test.pub')::integer) <> 2 THEN
        RAISE EXCEPTION 'Public cannot see visible comments';
    END IF;
    BEGIN
        INSERT INTO public.articles (title, slug, content, status) VALUES ('X', 'art-test-x', 'x', 'PUBLISHED');
        RAISE EXCEPTION 'Anonymous article insert allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        INSERT INTO public.article_comments (article_id, author_name, content) VALUES (current_setting('test.pub')::integer, 'n', 'Anonymous');
        RAISE EXCEPTION 'Anonymous comment allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RAISE NOTICE 'PASS public reads published content only and cannot write';
END $$;

SELECT set_config('app.current_user_id', :'art_a', true), set_config('app.current_user_type', 'customer', true), set_config('app.current_user_role', 'CUSTOMER', true);
DO $$ DECLARE affected integer; BEGIN
    INSERT INTO public.article_comments (article_id, customer_id, author_name, content)
    VALUES (current_setting('test.pub')::integer, current_setting('app.current_user_id')::integer, 'n', 'New comment');
    BEGIN
        INSERT INTO public.article_comments (article_id, customer_id, author_name, content)
        VALUES (current_setting('test.draft1')::integer, current_setting('app.current_user_id')::integer, 'n', 'On draft');
        RAISE EXCEPTION 'Comment on unpublished article allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        INSERT INTO public.article_comments (article_id, customer_id, author_name, content)
        VALUES (current_setting('test.pub')::integer, current_setting('app.current_user_id')::integer + 1, 'n', 'Impersonation');
        RAISE EXCEPTION 'Impersonated comment allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    UPDATE public.article_comments SET content = 'Edited' WHERE id = current_setting('test.own')::integer;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Own comment edit denied'; END IF;
    UPDATE public.article_comments SET content = 'Hijack' WHERE id = current_setting('test.foreign')::integer;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Foreign comment edit allowed'; END IF;
    DELETE FROM public.article_comments WHERE id = current_setting('test.foreign')::integer;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Foreign comment delete allowed'; END IF;
    BEGIN
        UPDATE public.article_comments SET status = 'HIDDEN' WHERE id = current_setting('test.own')::integer;
        RAISE EXCEPTION 'Customer changed visibility';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    UPDATE public.articles SET title = 'Hijack' WHERE id = current_setting('test.pub')::integer;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Customer article update allowed'; END IF;
    RAISE NOTICE 'PASS customer comments on published articles and manages only own comments';
END $$;

SELECT set_config('app.current_user_id', :'art_ph1', true), set_config('app.current_user_type', 'employee', true), set_config('app.current_user_role', 'PHARMACIST', true);
DO $$ DECLARE affected integer; BEGIN
    IF EXISTS (SELECT FROM public.articles WHERE id = current_setting('test.draft2')::integer) THEN
        RAISE EXCEPTION 'Pharmacist sees another author draft';
    END IF;
    INSERT INTO public.articles (title, slug, content, status, author_id)
    VALUES ('Mine', 'art-test-mine', 'x', 'PENDING', current_setting('app.current_user_id')::integer);
    BEGIN
        INSERT INTO public.articles (title, slug, content, status, author_id)
        VALUES ('Self publish', 'art-test-self', 'x', 'PUBLISHED', current_setting('app.current_user_id')::integer);
        RAISE EXCEPTION 'Pharmacist published directly';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        UPDATE public.articles SET status = 'PUBLISHED' WHERE id = current_setting('test.draft1')::integer;
        RAISE EXCEPTION 'Pharmacist self-approval allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    UPDATE public.articles SET title = 'Edited draft' WHERE id = current_setting('test.draft1')::integer;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Own draft edit denied'; END IF;
    UPDATE public.articles SET title = 'Edit published' WHERE id = current_setting('test.pub')::integer;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Published article editable by pharmacist'; END IF;
    INSERT INTO public.article_comments (article_id, parent_id, employee_id, author_name, content)
    VALUES (current_setting('test.pub')::integer, current_setting('test.own')::integer, current_setting('app.current_user_id')::integer, 'n', 'Reply');
    BEGIN
        INSERT INTO public.article_comments (article_id, employee_id, author_name, content)
        VALUES (current_setting('test.pub')::integer, current_setting('app.current_user_id')::integer, 'n', 'Top level');
        RAISE EXCEPTION 'Staff top-level comment allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RAISE NOTICE 'PASS pharmacist drafts and submits own articles, cannot publish, and can reply';
END $$;

SELECT set_config('app.current_user_id', :'art_admin', true), set_config('app.current_user_role', 'ADMIN', true);
DO $$ DECLARE affected integer; BEGIN
    UPDATE public.articles SET status = 'PUBLISHED', published_at = now() WHERE id = current_setting('test.draft1')::integer;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Admin approval denied'; END IF;
    UPDATE public.article_comments SET status = 'HIDDEN' WHERE id = current_setting('test.foreign')::integer;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Admin hide denied'; END IF;
    INSERT INTO public.article_categories (name, slug) VALUES ('Category', 'art-test-category');
    IF public.increment_article_views('art-test-published') <> 1 THEN RAISE EXCEPTION 'View counter failed'; END IF;
    RAISE NOTICE 'PASS admin approves articles, hides comments and manages categories';
END $$;

SELECT set_config('app.current_user_id', '', true), set_config('app.current_user_type', '', true), set_config('app.current_user_role', '', true);
DO $$ BEGIN
    IF EXISTS (SELECT FROM public.article_comments WHERE id = current_setting('test.foreign')::integer) THEN
        RAISE EXCEPTION 'Hidden comment still public';
    END IF;
    BEGIN
        INSERT INTO public.article_categories (name, slug) VALUES ('Nope', 'art-test-nope');
        RAISE EXCEPTION 'Anonymous category insert allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RAISE NOTICE 'PASS hidden comments disappear from public view';
END $$;
ROLLBACK;
