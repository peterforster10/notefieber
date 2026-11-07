BEGIN;

-- Kontext der Person setzen (noch als wiki_owner, der darf users lesen)
SELECT set_config('app.tenant_id', tenant_id::text, true),
       set_config('app.user_id',   id::text,        true)
FROM users WHERE email = 'max.mustermann@alpenwerk.example';
SET LOCAL ROLE wiki_app;

-- Seitenbaum, wie Max ihn sieht
SELECT s.key, s.name, p.title
FROM pages p
    JOIN spaces s ON s.id = p.space_id
WHERE p.deleted_at IS NULL
ORDER BY s.key, p.path;

-- Volltextsuche als Max
SELECT p.title
FROM page_search ps
    JOIN pages p ON p.id = ps.page_id
WHERE ps.tsv @@ websearch_to_tsquery('german', 'Rechte') AND p.deleted_at IS NULL;

ROLLBACK;