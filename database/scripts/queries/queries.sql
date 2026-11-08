-- Abfragen zum Nachsehen in den Testdaten aus seed/seed.sql.
-- Als wiki_owner ausführen: der umgeht RLS und sieht alles. Wie eine Person die Daten sieht,
-- zeigt queries_as_app.sql.
-- Gesucht wird über feste Schlüssel statt über IDs, weil die UUIDs bei jeder Einrichtung neu
-- entstehen: Mandant und Workspace über slug, Space über key, Seite über den Titel im Space,
-- Gruppe über den Namen. Seitentitel und Gruppennamen sind nicht eindeutig erzwungen
-- (CLAUDE.md, Abschnitt 4, Punkt 6), in den Testdaten aber eindeutig.

select * from tenants order by slug;

select w.*
from workspaces w
    join tenants t on t.id = w.tenant_id
where t.slug = 'alpenwerk'
order by w.slug;

select s.*
from spaces s
    join workspaces w on w.id = s.workspace_id
    join tenants t on t.id = s.tenant_id
where t.slug = 'alpenwerk' and w.slug = 'alpenwerk'
order by s.key;

select p.*
from pages p
    join spaces s on s.id = p.space_id
    join tenants t on t.id = p.tenant_id
where t.slug = 'alpenwerk' and s.key = 'ENTW'
order by p.path;

select c.*
from page_contents c
    join pages p on p.id = c.page_id
    join spaces s on s.id = p.space_id
    join tenants t on t.id = p.tenant_id
where t.slug = 'alpenwerk' and s.key = 'ENTW' and p.title = 'Datenmodell';

select v.*
from page_versions v
    join pages p on p.id = v.page_id
    join spaces s on s.id = p.space_id
    join tenants t on t.id = p.tenant_id
where t.slug = 'alpenwerk' and s.key = 'ENTW' and p.title = 'Datenmodell'
order by v.version;

-- Verlinkungen mit Titeln statt IDs
select s.key, von.title as von, nach.title as nach, l.*
from page_links l
    join pages von on von.id = l.from_page_id
    join pages nach on nach.id = l.to_page_id
    join spaces s on s.id = von.space_id
order by s.key, von.title, nach.title;

select ps.*
from page_search ps
    join pages p on p.id = ps.page_id
    join spaces s on s.id = p.space_id
    join tenants t on t.id = p.tenant_id
where t.slug = 'alpenwerk' and s.key = 'ENTW' and p.title = 'Entwicklung';


select u.*
from users u
    join tenants t on t.id = u.tenant_id
where t.slug = 'alpenwerk'
order by u.email;

select u.email, u.display_name, m.*
from workspace_members m
    join workspaces w on w.id = m.workspace_id
    join tenants t on t.id = w.tenant_id
    join users u on u.id = m.user_id
where t.slug = 'alpenwerk' and w.slug = 'alpenwerk'
order by u.email;

select g.*
from groups g
    join tenants t on t.id = g.tenant_id
where t.slug = 'alpenwerk'
order by g.name;

select g.name, u.email, gm.*
from group_members gm
    join groups g on g.id = gm.group_id
    join tenants t on t.id = g.tenant_id
    join users u on u.id = gm.user_id
where t.slug = 'alpenwerk' and g.name = 'Entwicklung'
order by u.email;
