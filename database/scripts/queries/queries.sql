-- Abfragen zum Nachsehen in den Testdaten aus seed/seed.sql.
-- Als wiki_owner ausführen: der umgeht RLS und sieht alles. Wie eine Person die Daten sieht,
-- zeigt queries_as_app.sql.
-- Gesucht wird über feste Schlüssel statt über IDs, weil die UUIDs bei jeder Einrichtung neu
-- entstehen: Mandant und Workspace über slug, Space über key, Seite über den Titel im Space,
-- Gruppe über den Namen. Seitentitel und Gruppennamen sind nicht eindeutig erzwungen
-- (CLAUDE.md, Abschnitt 4, Punkt 6), in den Testdaten aber eindeutig.

-- Tenants / Mandanten

select t.slug, t.name, t.region, t.plan, t.idp_org_id
from tenants t
order by t.id;

-- Workspaces

select w.slug, w.name, w.tenant_id
from workspaces w
    join tenants t on t.id = w.tenant_id
where t.slug = 'alpenwerk'
order by w.id;

-- Workspace Members / Workspace Mitglieder

select w.name, u.email, u.display_name, wm.role
from workspace_members wm
         join workspaces w on w.id = wm.workspace_id
         join tenants t on t.id = w.tenant_id
         join users u on u.id = wm.user_id
where t.slug = 'alpenwerk' and w.slug = 'alpenwerk'
order by u.email;

-- Users / Benutzer

select u.idp_subject, u.email, u.display_name, u.role, u.is_external, u.locale, u.time_zone,
       u.avatar_file_id
from users u
         join tenants t on t.id = u.tenant_id
where t.slug = 'alpenwerk'
order by u.email;

-- Groups / Gruppen

select g.name, g.source, g.external_id
from groups g
         join tenants t on t.id = g.tenant_id
where t.slug = 'alpenwerk'
order by g.name;

-- Group Members / Gruppenmitglieder

select g.name, u.email
from group_members gm
         join groups g on g.id = gm.group_id
         join tenants t on t.id = g.tenant_id
         join users u on u.id = gm.user_id
where t.slug = 'alpenwerk' and g.name = 'Entwicklung'
order by u.email;


-- Spaces

select s.key, s.name, s.description, s.home_page_id, s.workspace_id
from spaces s
    join workspaces w on w.id = s.workspace_id
    join tenants t on t.id = s.tenant_id
where t.slug = 'alpenwerk' and w.slug = 'alpenwerk'
order by s.id;

-- Pages

select p.parent_id, p.space_id, p.path, p.position, p.title, p.inherit_perms
from pages p
    join spaces s on s.id = p.space_id
    join tenants t on t.id = p.tenant_id
where t.slug = 'alpenwerk' and s.key = 'ENTW'
order by p.id;

-- Page Contents

select pc.page_id, pc.ydoc, pc.content_json, pc.plain_text, pc.editors_since_version
from page_contents pc
    join pages p on p.id = pc.page_id
    join spaces s on s.id = p.space_id
    join tenants t on t.id = p.tenant_id
where t.slug = 'alpenwerk' and s.key = 'ENTW' and p.title = 'Datenmodell'
order by p.id;

-- Page Versions

select pv.page_id, pv.version, pv.kind, pv.restored_from,
       pv.title, pv.ydoc, pv.content_json, pv.plain_text, pv.author_ids
from page_versions pv
    join pages p on p.id = pv.page_id
    join spaces s on s.id = p.space_id
    join tenants t on t.id = p.tenant_id
where t.slug = 'alpenwerk' and s.key = 'ENTW' and p.title = 'Datenmodell'
order by pv.version;

-- Verlinkungen mit Titeln statt IDs
select s.key, von.title as von, nach.title as nach, l.*
from page_links l
    join pages von on von.id = l.from_page_id
    join pages nach on nach.id = l.to_page_id
    join spaces s on s.id = von.space_id
order by s.key, von.title, nach.title;

select ps.page_id, ps.tsv
from page_search ps
    join pages p on p.id = ps.page_id
    join spaces s on s.id = p.space_id
    join tenants t on t.id = p.tenant_id
where t.slug = 'alpenwerk' and s.key = 'ENTW' and p.title = 'Entwicklung';


