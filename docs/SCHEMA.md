# Datenmodell: Referenz

Dieses Dokument beschreibt jede Tabelle der Datenbank `wiki` und ihre wichtigen Spalten: was sie bedeuten, welche Regeln die Datenbank selbst durchsetzt, wer sie schreibt und wer sie lesen darf. Es ist ein Nachschlagewerk. Warum das Modell so aussieht, erklärt [CONCEPTS.md](CONCEPTS.md) (Abschnitte 11 und 12), die Entscheidungen stehen in der `CLAUDE.md` (Abschnitt 8). Maßgeblich ist immer das Schema in [`database/scripts/schema/`](../database/scripts/schema/). Weicht dieses Dokument davon ab, gilt das Schema, und dieses Dokument wird angepasst.

**Wo steht was?** [`schema.sql`](../database/scripts/schema/schema.sql) ist der Einstieg und bindet die Teile in dieser Reihenfolge in einer Transaktion ein:

| Datei | Inhalt | Hier im Dokument |
|---|---|---|
| [`00_setup.sql`](../database/scripts/schema/00_setup.sql) | Erweiterungen, Schema `app`, Prüfung der Rollen | Abschnitt 9 |
| [`10_tables.sql`](../database/scripts/schema/10_tables.sql) | alle Tabellen und Indexe | Abschnitte 3–8 |
| [`20_functions_base.sql`](../database/scripts/schema/20_functions_base.sql) | Kontext, Rechte auflösen, Prüfungen, Ereignisse, Audit, Sperren | 12.1–12.4 |
| [`30_triggers.sql`](../database/scripts/schema/30_triggers.sql) | Trigger | Abschnitt 13 |
| [`40_functions_tenants.sql`](../database/scripts/schema/40_functions_tenants.sql) | vor dem Login, Mandanten, Personen, Workspaces, Gruppen | 12.5, 12.6 |
| [`50_functions_spaces.sql`](../database/scripts/schema/50_functions_spaces.sql) | Spaces, Rechte, Vererbung | 12.7 |
| [`60_functions_pages.sql`](../database/scripts/schema/60_functions_pages.sql) | Seitenbaum, Papierkorb | 12.8 |
| [`70_functions_content.sql`](../database/scripts/schema/70_functions_content.sql) | Inhalt, Versionen, Verlinkungen | 12.9 |
| [`72_functions_comments.sql`](../database/scripts/schema/72_functions_comments.sql) | Kommentare | 12.10 |
| [`74_functions_import.sql`](../database/scripts/schema/74_functions_import.sql) | Import | 12.11 |
| [`80_rls.sql`](../database/scripts/schema/80_rls.sql) | Row Level Security | Abschnitt 10 |
| [`90_privileges.sql`](../database/scripts/schema/90_privileges.sql) | Rechte an Schemas, Funktionen und Tabellen | Abschnitte 9 und 11 |

Die Rollen und die Datenbank legt [`roles_database.sql`](../database/scripts/roles_database.sql) an. Die Tests liegen in [`database/scripts/schema_test/`](../database/scripts/schema_test/).

## Inhalt

1. [Überblick](#1-überblick)
2. [Konventionen für alle Tabellen](#2-konventionen-für-alle-tabellen)
3. [Mandanten und Personen](#3-mandanten-und-personen): `tenants`, `users`, `workspaces`, `workspace_members`, `groups`, `group_members`, `invites`
4. [Spaces und Seiten](#4-spaces-und-seiten): `spaces`, `pages`, `page_contents`, `page_versions`, `page_search`, `page_links`
5. [Rechte](#5-rechte): `grants`
6. [Zusammenarbeit](#6-zusammenarbeit): `comments`, `files`
7. [Import](#7-import): `imports`, `import_items`
8. [Infrastruktur](#8-infrastruktur): `outbox`, `audit_log`
9. [Datenbank, Rollen und Schemas](#9-datenbank-rollen-und-schemas): Locale, Erweiterungen, Rollen, Kontext, `SECURITY DEFINER`
10. [Regeln (Row Level Security)](#10-regeln-row-level-security)
11. [Wer darf was: Tabellenrechte](#11-wer-darf-was-tabellenrechte)
12. [Funktionen](#12-funktionen): jede Funktion einzeln
13. [Trigger](#13-trigger)

---

## 1. Überblick

| Tabelle | Zweck | Schreibt | Lesbar für Personen (`wiki_app`) |
|---|---|---|---|
| `tenants` | Mandant (Kunde), eine Zitadel-Organisation | `create_tenant` | nur der eigene |
| `users` | Personen eines Mandanten | Login, eigenes Profil, Funktionen | alle im Mandanten |
| `workspaces` | Bereich innerhalb eines Mandanten | Organisations- und Workspace-Admins | alle im Mandanten |
| `workspace_members` | Wer gehört mit welcher Rolle zu einem Workspace | Funktionen | alle im Mandanten |
| `groups`, `group_members` | Gruppen aus Zitadel | `sync_user_groups` beim Login | alle im Mandanten |
| `invites` | Einladungen per Link | Workspace-Admins | Workspace-Admins |
| `spaces` | Confluence-Bereich, Einheit für Rechte und Import | Funktionen | mit Rolle im Space oder einer lesbaren Seite darin |
| `pages` | Seitenbaum | Funktionen | mit Leserecht auf der Seite |
| `page_contents` | Aktueller Inhalt (Yjs) | Collab-Server | mit der Seite |
| `page_versions` | Versionshistorie | Worker, `save_version` | mit der Seite |
| `page_search` | Volltextindex | Worker | mit der Seite |
| `page_links` | Verlinkungen zwischen Seiten | Worker | wenn beide Seiten lesbar sind |
| `grants` | Rechte auf Spaces und Seiten | Funktionen | wer das Objekt lesen darf |
| `comments` | Kommentare | Funktionen | mit der Seite |
| `files` | Anhänge, Profilbilder, Import-Archive | Upload, Worker | an lesbaren Seiten, eigene, Profilbilder |
| `imports`, `import_items` | Confluence-Importläufe | `start_import`, Worker | eigene oder als Space-Admin |
| `outbox` | Ereignisse für Worker und später TalkFieber | Funktionen | nur Worker |
| `audit_log` | Wer hat was getan | Funktionen | nur Organisations-Admins |

```mermaid
erDiagram
  tenants ||--o{ users : ""
  tenants ||--o{ workspaces : ""
  tenants ||--o{ groups : ""
  workspaces ||--o{ workspace_members : ""
  users ||--o{ workspace_members : ""
  groups ||--o{ group_members : ""
  users ||--o{ group_members : ""
  workspaces ||--o{ invites : ""
  workspaces ||--o{ spaces : ""
  spaces ||--o{ pages : ""
  pages ||--o{ pages : "Elternseite"
  spaces |o--|| pages : "Startseite"
  pages ||--|| page_contents : ""
  pages ||--o{ page_versions : ""
  pages ||--o| page_search : ""
  pages ||--o{ page_links : "von / nach"
  spaces ||--o{ grants : ""
  pages ||--o{ grants : "gekappte Vererbung"
  users ||--o{ grants : ""
  groups ||--o{ grants : ""
  pages ||--o{ comments : ""
  comments ||--o{ comments : "Antwort"
  pages ||--o{ files : "Anhang"
  users |o--o| files : "Profilbild"
  spaces ||--o{ imports : ""
  files ||--o{ imports : "Export-Archiv"
  imports ||--o{ import_items : ""
  import_items }o--o| pages : ""
  tenants ||--o{ outbox : ""
  tenants ||--o{ audit_log : ""
```

## 2. Konventionen für alle Tabellen

- **IDs** sind UUIDv7 (`uuidv7()`, in PostgreSQL 18 eingebaut). Sie sind zeitlich sortierbar; die Outbox wird nach `id` abgearbeitet. Bei Tabellen mit Leseregeln erzeugt die Funktion die ID vorher, statt `INSERT … RETURNING` zu nutzen (die neue Zeile ist für die Person oft noch nicht lesbar).
- **`tenant_id`** steht auf jeder Tabelle (außer `tenants` selbst) und ist dieselbe UUID wie in TalkFieber. Jede Tabelle hat die Regel `tenant_isolation`: Sichtbar und schreibbar ist nur, was zu `app.tenant_id` passt.
- **Zusammengesetzte Fremdschlüssel** wie `(page_id, tenant_id) → pages (id, tenant_id)` verhindern Verweise über Mandanten hinweg, auch für Rollen, die RLS umgehen. Nach demselben Muster erzwingt `(parent_id, space_id)`, dass Elternseiten im selben Space liegen.
- **Text** ist `text` mit `CHECK`-Grenzen statt `varchar(n)`. Die Grenzen stehen bei den Spalten.
- **Zeitstempel** sind `timestamptz`. Statt zu löschen markieren Spalten den Zustand: `deleted_at` (Papierkorb, gelöschte Kommentare und Dateien), `archived_at` (nur lesbar), `deactivated_at` (Person gesperrt), `revoked_at` und `accepted_at` (Einladungen).
- **Rollen der Datenbank:** `wiki_app` ist die API, im Auftrag der angemeldeten Person. Sie unterliegt Mandantentrennung und Leserechten und schreibt fast nur über die Funktionen im Schema `app`. `wiki_worker` sind Collab-Server und Hintergrundjobs; sie unterliegen nur der Mandantentrennung. `wiki_owner` besitzt alles und führt nur Migrationen aus. Details in [Abschnitt 9](#9-datenbank-rollen-und-schemas) bis [11](#11-wer-darf-was-tabellenrechte).
- **Kontext pro Transaktion:** Die App setzt `app.tenant_id` und bei `wiki_app` zusätzlich `app.user_id` (`set_config(…, true)`). Ohne Mandant ist nichts sichtbar.

In den Tabellen unten heißt **„Schreiben“**, welcher Weg Zeilen anlegt oder ändert, und **„Lesen“**, was die Leseregel für `wiki_app` zusätzlich zur Mandantentrennung verlangt. `wiki_worker` sieht immer alle Zeilen des Mandanten.

---

## 3. Mandanten und Personen

Diese Tabellen sind mit TalkFieber abgestimmt (gleiche Namen, gleiche Bedeutung, gleiche `tenant_id`).

### `tenants`

Ein Mandant ist ein Kunde. Er entspricht genau einer Organisation in Zitadel.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `id` | uuid | Mandanten-ID. Existiert der Kunde schon in TalkFieber, übernimmt `create_tenant(…, p_tenant_id)` dessen ID. |
| `slug` | text | Kurzname für URLs und den Login (`a-z`, `0-9`, `-`, 2–63 Zeichen), global eindeutig. `app.resolve_tenant(slug)` findet darüber den Mandanten, bevor jemand angemeldet ist. |
| `name` | text | Anzeigename, 1–100 Zeichen. |
| `region` | text | Datenstandort, Standard `eu-central`. Vorbereitet für spätere Zellen. |
| `plan` | text | Tarif, Standard `pilot`. Noch ohne festen Wertebereich. |
| `idp_org_id` | text | ID der Organisation in Zitadel, global eindeutig. Verbindet Login und Mandant. |
| `deleted_at` | timestamptz | Mandant gekündigt. `resolve_tenant` findet ihn dann nicht mehr. |

- **Schreiben:** nur `app.create_tenant` (legt auch den ersten Workspace und die erste Person als Organisations-Admin und Owner an). `wiki_app` darf Mandanten nicht ändern.
- **Lesen:** nur der eigene Mandant (`id = app.tenant_id`).

### `users`

Personen eines Mandanten. Dieselbe Person kann in mehreren Mandanten je ein eigenes Konto haben.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `id` | uuid | Personen-ID innerhalb des Mandanten. |
| `idp_subject` | text | `sub` aus dem Zitadel-Token. **Pro Mandant** eindeutig (`tenant_id, idp_subject`), damit Gäste und Dienstleister in mehreren Mandanten vorkommen können. Die API sucht beim Login nach Mandant und `idp_subject`. Kann fehlen, solange sich die Person noch nie angemeldet hat. |
| `email` | text | 3–320 Zeichen, pro Mandant eindeutig ohne Beachtung der Groß- und Kleinschreibung. Darüber findet `accept_invite` bestehende Personen. |
| `display_name` | text | Anzeigename, 1–100 Zeichen. |
| `role` | text | `org_admin` oder `member`. Organisations-Admins verwalten Personen und Workspaces, lesen das Audit-Log und können auf jedem Space und jeder eingeschränkten Seite Rechte setzen (Wiederherstellung, im Audit-Log vermerkt). **Inhalte sehen sie nicht automatisch.** |
| `is_external` | boolean | Person von außerhalb der Organisation. `accept_invite` setzt es bei Einladungen als Gast. Nur zur Anzeige; ob jemand Gast ist, entscheidet `workspace_members.role`. |
| `locale`, `time_zone` | text | Sprache (Standard `de`) und Zeitzone (Standard `Europe/Vienna`). |
| `avatar_file_id` | uuid | Profilbild, verweist auf `files`. Nur eine eigene Datei ohne Seite, sonst könnte jemand einen fremden Anhang als Profilbild eintragen und für alle sichtbar machen. |
| `deactivated_at` | timestamptz | Person gesperrt (`app.set_user_active`). Danach hat sie überall den Rang 0 und zählt nicht mehr als Admin. Ihre Grants bleiben bestehen. |

- **Regeln:** Jeder Mandant behält mindestens einen aktiven Organisations-Admin (Trigger `protect_last_org_admin`).
- **Schreiben:** `wiki_app` darf neue Personen direkt anlegen, aber nur als aktives Mitglied ohne Profilbild (erster Login). Ändern darf jede Person ihr eigenes Profil (`display_name`, `locale`, `time_zone`, `avatar_file_id`), Organisations-Admins auch fremde. Rolle und Sperre nur über `app.set_user_role` und `app.set_user_active`. Löschen nur der Worker.
- **Lesen:** alle Personen des Mandanten.

### `workspaces`

Ein Workspace gliedert einen Mandanten, z. B. nach Firma oder Bereich. Spaces gehören zu genau einem Workspace.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `slug` | text | Kurzname, pro Mandant eindeutig. |
| `name` | text | Anzeigename, 1–100 Zeichen. |
| `archived_at` | timestamptz | Workspace archiviert. Wirkt sich noch nicht auf Rechte aus. |

- **Schreiben:** anlegen nur Organisations-Admins, ändern (`slug`, `name`, `archived_at`) auch Owner und Admins des Workspaces. Nicht löschbar für die App.
- **Lesen:** alle im Mandanten.

### `workspace_members`

Wer zu einem Workspace gehört. Mitgliedschaft ist Voraussetzung für jedes Recht auf einem Space dieses Workspaces.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `workspace_id`, `user_id` | uuid | Primärschlüssel. |
| `role` | text | `owner`, `admin`, `member` oder `guest`. Owner und Admins verwalten Mitglieder und Einladungen; Owner vergeben nur Owner. **Gäste** erhalten keine Rechte über „alle im Workspace“, nur über ausdrückliche Grants für sie selbst oder ihre Gruppen. |
| `joined_at` | timestamptz | Beitritt. |

- **Regeln:** Jeder Workspace behält mindestens einen aktiven Owner (Trigger `protect_last_owner`).
- **Schreiben:** nur über `app.add_workspace_member`, `app.set_workspace_member_role`, `app.remove_workspace_member`, `app.accept_invite` und `app.create_tenant`. Beim Entfernen fallen die persönlichen Grants auf Spaces und Seiten des Workspaces weg; abgelehnt, wenn die Person dadurch irgendwo letzter Admin wäre.
- **Lesen:** alle im Mandanten.

### `groups` und `group_members`

Gruppen aus Zitadel. Sie werden nicht im Wiki gepflegt, sondern bei jedem Login aus dem Token übernommen.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `groups.idp_group_id` | text | ID der Gruppe (oder Rolle) in Zitadel, pro Mandant eindeutig. |
| `groups.name` | text | Anzeigename aus Zitadel, beim Login aktualisiert. |
| `group_members.group_id`, `user_id` | uuid | Mitgliedschaft, Primärschlüssel. |

- **Schreiben:** nur `app.sync_user_groups(person, ids, namen)`, aufgerufen beim Login. Neue Gruppen werden angelegt, Mitgliedschaften der Person ergänzt und entfernt. Gruppen selbst werden nie automatisch gelöscht.
- **Hinweis:** Verlässt jemand in Zitadel eine Gruppe, wirkt das erst beim nächsten Login. Zählt eine Gruppe als einziger Admin eines Spaces und hat kein aktives Mitglied mehr, muss ein Organisations-Admin einen neuen Admin setzen.
- **Lesen:** alle im Mandanten.

### `invites`

Einladungen per Link in einen Workspace.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `email` | text | Eingeladene Adresse. |
| `role` | text | Rolle nach dem Annehmen: `admin`, `member` oder `guest` (nicht `owner`). |
| `token_hash` | text | Nur der Hash des Tokens aus dem Link, global eindeutig. Das Token selbst steht nirgends in der Datenbank. |
| `invited_by` | uuid | Wer eingeladen hat, immer die angemeldete Person. |
| `expires_at` | timestamptz | Ablauf. |
| `accepted_at`, `revoked_at` | timestamptz | Angenommen bzw. zurückgezogen. Gültig ist eine Einladung, solange beides leer und `expires_at` nicht erreicht ist. |

- **Schreiben:** direkt durch Organisations-Admins sowie Owner und Admins des Workspaces. Annehmen über `app.accept_invite` (legt die Person bei Bedarf an).
- **Lesen:** nur wer den Workspace verwaltet. Vor dem Login liefert `app.find_invite(token_hash)` die nötigen Angaben.

---

## 4. Spaces und Seiten

### `spaces`

Ein Space entspricht einem Confluence-Bereich. Er ist die Einheit für Rechte, Import und Archivierung.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `workspace_id` | uuid | Workspace, zu dem der Space gehört. Wer nicht Mitglied dieses Workspaces ist, hat keinen Zugriff. |
| `key` | text | Kurzschlüssel wie in Confluence, z. B. `ENTW`: Großbuchstabe am Anfang, dann `A-Z0-9`, 2–32 Zeichen, pro Mandant eindeutig. `create_space` wandelt in Großbuchstaben um. |
| `name`, `description` | text | Anzeigename (1–200) und Beschreibung (bis 2.000 Zeichen). |
| `home_page_id` | uuid | Startseite. Der Fremdschlüssel `(home_page_id, id) → pages (id, space_id)` stellt sicher, dass sie im selben Space liegt. Die Startseite lässt sich nicht in den Papierkorb legen. |
| `created_by` | uuid | Ersteller, wird beim Anlegen erster Admin. |
| `archived_at` | timestamptz | Archiviert: Für alle gilt höchstens viewer. Nur Space-Admins (über ihre Grants) und Organisations-Admins können archivieren und zurückholen. |

- **Schreiben:** `app.create_space` (mit Startseite, Ersteller als Admin, optional einem Recht für alle im Workspace), `app.update_space`, `app.archive_space`.
- **Lesen:** mit einer Rolle im Space (`space_rank ≥ 1`) oder wenn mindestens eine Seite darin lesbar ist (damit Gäste mit nur einer freigegebenen Seite die Brotkrume sehen).

### `pages`

Der Seitenbaum. Inhalt und Versionen liegen in eigenen Tabellen.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `space_id` | uuid | Space der Seite. Ändert sich nie (Verschieben nur innerhalb eines Spaces). |
| `parent_id` | uuid | Elternseite oder `NULL` für Seiten auf oberster Ebene. Muss im selben Space liegen (Fremdschlüssel `(parent_id, space_id)`), keine Zyklen. |
| `path` | ltree | Pfad von der obersten Seite bis zu dieser, aus den IDs ohne Bindestriche. Setzt der Trigger beim Anlegen und `move_page` beim Verschieben. Grundlage für Teilbäume (`path <@ …`) und für die Rechte. |
| `position` | text | Reihenfolge unter Geschwistern als Fractional Index im Format des npm-Pakets `fractional-indexing` (Ziffern `0-9A-Za-z`, byteweise sortiert). Das Kopfzeichen bestimmt die Länge des ganzzahligen Teils (`a` = 2 … `z` = 27, `Z` = 2 … `A` = 27); ein `CHECK` lässt nur gültige Schlüssel zu. Ohne Angabe hängt `create_page` die Seite hinter alle Geschwister (`app.next_position`). **Nicht eindeutig**, weil die App eingeschränkte Geschwister nicht sieht: immer `ORDER BY position, id`. |
| `title` | text | Titel, bis 255 Zeichen, leer erlaubt. Kopie aus dem Yjs-Dokument (`Y.Text` „title“), geschrieben von `store_content`. Die API ändert ihn nie direkt. |
| `inherit_perms` | boolean | `true`: Rechte kommen von oben (nächste Seite mit eigenen Rechten oder der Space). `false`: Vererbung gekappt, es gelten die Grants dieser Seite. Nur über `app.set_page_inheritance`. |
| `created_by`, `created_at` | | Anlage. |
| `updated_by`, `updated_at` | | Letzte Änderung; `store_content` setzt die zuletzt bearbeitende Person. |
| `deleted_at`, `deleted_by` | | Im Papierkorb seit / durch. |
| `trash_root_id` | uuid | Die Seite, die jemand in den Papierkorb gelegt hat. Alle Seiten ihres Teilbaums, die dabei mitgingen, tragen dieselbe ID; `restore_page` holt genau diese zurück. Gesetzt genau dann, wenn `deleted_at` gesetzt ist. |

- **Regeln:** Eltern im selben Space, keine Seite ist ihre eigene Elternseite, keine Zyklen. Änderungen am Baum sperren den Space (`app.lock_tree`), damit gleichzeitiges Verschieben, Anlegen und Löschen keine Zyklen oder veralteten Pfade erzeugt.
- **Schreiben:** `app.create_page`, `app.move_page` (auch zum Umsortieren unter derselben Elternseite; aus einem Bereich mit eigenen Rechten heraus nur als dessen Admin), `app.trash_page`, `app.restore_page`, `app.set_page_inheritance`, `app.store_content` (Titel). `wiki_app` darf Seiten weder direkt anlegen noch ändern. Der Worker legt beim Import direkt an und löscht Seiten endgültig aus dem Papierkorb.
- **Lesen:** mit Leserecht (`app.page_rank(id) ≥ 1`). Seiten im Papierkorb bleiben lesbar (für die Papierkorb-Ansicht); Seitenbaum, Suche und Verlinkungen filtern `deleted_at IS NULL`.
- **Indexe:** GiST auf `path` (Teilbäume), `(space_id, parent_id, position)` (Kinder einer Seite), Trigramm auf `title` (Titelsuche), `trash_root_id`.

### `page_contents`

Der aktuelle Inhalt einer Seite, eine Zeile pro Seite.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `page_id` | uuid | Primärschlüssel, 1 : 1 zu `pages`. |
| `ydoc` | bytea | Zustand des Yjs-Dokuments (`Y.encodeStateAsUpdate`), der maßgebliche Inhalt. Neue Seiten bekommen den leeren Zustand `\x0000`; der Collab-Server schreibt dann zuerst `pages.title` in `Y.Text` „title“ und baut, falls `content_json` gefüllt ist (Testdaten, Import), das Dokument daraus. Höchstens 50 MB. |
| `content_json` | jsonb | Derselbe Inhalt als BlockNote-Dokument (Array von Blöcken), vom Collab-Server bei jedem Speichern mitgeschrieben. Grundlage für Export, Import und einen späteren Editorwechsel, ohne Yjs lesen zu müssen. Neue Seiten: `[]`. `NULL` heißt „nicht vorhanden“: Ist das JSON größer als 20 MB oder kein Array, speichert `store_content` `NULL` statt abzulehnen, und Export bzw. Import müssen auf `ydoc` zurückgreifen. Ein `CHECK` lässt nur Arrays bis 20 MB zu. |
| `plain_text` | text | Klartext aus dem Dokument, für Suche und später KI. `store_content` kürzt auf 2 Mio. Zeichen, statt das Speichern abzulehnen. |
| `editors_since_version` | uuid[] | Wer seit der letzten Version bearbeitet hat. Wird zur Autorenliste der nächsten Version und danach geleert. |
| `updated_at` | timestamptz | Letztes Speichern. |

- **Schreiben:** angelegt von `create_page` und `create_space`, danach nur `app.store_content` (Collab-Server, entprellt etwa alle 2 s). Export und Import arbeiten mit `content_json` bzw. Markdown, nie direkt mit `ydoc`, außer `content_json` fehlt.
- **Lesen:** wenn die Seite lesbar ist.

### `page_versions`

Versionshistorie. Zeilen werden nie geändert.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `version` | integer | Fortlaufend pro Seite ab 1, eindeutig mit `page_id`. Die Funktion sperrt die Seite, damit keine Nummer doppelt vergeben wird. |
| `kind` | text | `auto` (Worker nach 10 Minuten Ruhe), `manual` (Person speichert ausdrücklich, `app.save_version`), `restore` (Collab-Server nach dem Wiederherstellen) oder `import`. |
| `restored_from` | integer | Bei `restore`: aus welcher Version. Muss eine vorhandene, ältere Version derselben Seite sein (Fremdschlüssel, `CHECK`). Gesetzt genau dann, wenn `kind = restore`. |
| `title`, `ydoc`, `content_json`, `plain_text` | | Momentaufnahme von Titel und Inhalt. `content_json` wie in `page_contents` (`NULL`, wenn es dort fehlte), damit sich auch alte Versionen ohne Yjs exportieren lassen. |
| `author_ids` | uuid[] | Wer seit der vorigen Version bearbeitet hat (aus `editors_since_version`). |
| `created_by` | uuid | Wer manuell gespeichert oder wiederhergestellt hat, bei `auto` leer. |

- **Schreiben:** `app.create_version` (Worker: `auto`, `restore`, `import`; `manual` leitet an `save_version` weiter) und `app.save_version` (editor). Wiederherstellen rechnet der Collab-Server in Yjs: alten Stand als neues Update anwenden, speichern, dann `create_version(…, 'restore', …, restored_from)`. Die Historie bleibt linear.
- **Lesen:** wenn die Seite lesbar ist.

### `page_search`

Volltextindex, gepflegt vom Worker.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `page_id` | uuid | Primärschlüssel. |
| `space_id` | uuid | Zum Filtern nach Space. |
| `tsv` | tsvector | Titel (stärker gewichtet) und Klartext. GIN-Index. |

- **Schreiben:** nur der Worker, nach `page.updated`. Bei `page.trashed` entfernt er die Seiten.
- **Lesen:** wenn die Seite lesbar ist. Treffer auf eingeschränkte Seiten sind damit unsichtbar, ohne dass die Suche selbst Rechte prüfen muss.

### `page_links`

Welche Seite auf welche verlinkt, für Rückverweise und kaputte Links.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `from_page_id`, `to_page_id` | uuid | Primärschlüssel. Ziel im selben Mandanten. |

- **Schreiben:** `app.replace_page_links` (Worker, nach dem Speichern) ersetzt alle Links einer Seite.
- **Lesen:** nur wenn **beide** Seiten lesbar sind; sonst würde ein Rückverweis den Titel einer eingeschränkten Seite verraten.

---

## 5. Rechte

### `grants`

Ein Recht gibt einem Subjekt eine Rolle auf einem Space **oder** einer Seite. Wie daraus der Rang einer Person entsteht, beschreibt `app.page_rank` (CLAUDE.md Abschnitt 8, CONCEPTS.md Abschnitt 4).

| Spalte | Typ | Bedeutung |
|---|---|---|
| `space_id` / `page_id` | uuid | Genau eines von beiden. Auf Seiten nur, wenn deren Vererbung gekappt ist (`inherit_perms = false`). |
| `subject_type` | text | `user` (eine Person), `group` (eine Gruppe aus Zitadel) oder `workspace` (alle Mitglieder des Workspaces ohne Gäste). |
| `user_id` / `group_id` | uuid | Gesetzt passend zu `subject_type`, bei `workspace` beide leer. |
| `role` | text | `viewer` (lesen), `commenter` (lesen und kommentieren), `editor` (bearbeiten, Seiten anlegen, verschieben, löschen) oder `admin` (zusätzlich Rechte und Vererbung ändern). „Alle im Workspace“ kann nicht `admin` sein. |
| `created_by`, `created_at` | | Wer das Recht vergeben hat. |

- **Regeln:**
  - Höchstens ein Recht pro Objekt und Subjekt (eindeutiger Index).
  - Jeder Space und jede Seite mit gekappter Vererbung behält mindestens einen **wirksamen** Admin: eine aktive Person oder eine Gruppe mit aktivem Mitglied (`app.has_admin`). `set_grant` und `remove_workspace_member` prüfen das sofort, der Trigger `admin_remains` beim Commit noch einmal.
  - Persönliche Rechte nur für aktive Mitglieder des Workspaces.
- **Schreiben:** `app.create_space`, `app.set_grant` (setzen oder mit Rolle `NULL` entfernen; erlaubt für Admins des Objekts, Space-Admins und Organisations-Admins), `app.set_page_inheritance` (kopiert beim Kappen die bisher geltenden Rechte und macht die handelnde Person zum Admin der Seite), `app.remove_workspace_member`.
- **Lesen:** wer den Space bzw. die Seite lesen darf.

---

## 6. Zusammenarbeit

### `comments`

Kommentare zur ganzen Seite oder zu einer Textstelle, mit Antworten eine Ebene tief.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `page_id` | uuid | Kommentierte Seite. |
| `parent_id` | uuid | Bei Antworten der Thread-Anfang. Muss auf derselben Seite liegen (Fremdschlüssel `(parent_id, page_id)`) und selbst ein Thread-Anfang sein. |
| `author_id` | uuid | Verfasser. |
| `body` | text | Inhalt, 1–10.000 Zeichen. Bei gelöschten Kommentaren leer (`CHECK`, DSGVO). |
| `anchor` | jsonb | Bei Kommentaren an einer Textstelle die relative Yjs-Position (bleibt beim Bearbeiten an der Stelle), sonst leer. Antworten haben keinen eigenen Anker. Höchstens 2.000 Byte. |
| `resolved_at`, `resolved_by` | | Thread erledigt. Nur Thread-Anfänge; eine neue Antwort öffnet den Thread wieder. |
| `edited_at` | timestamptz | Zuletzt bearbeitet. |
| `deleted_at` | timestamptz | Gelöscht; `body` ist dann leer, die Zeile bleibt für den Thread stehen. |

- **Schreiben:** `app.add_comment` (commenter, nicht auf Seiten im Papierkorb), `app.edit_comment` (nur eigene), `app.set_comment_resolved` (commenter), `app.delete_comment` (eigene; fremde nur Admins der Seite, im Audit-Log).
- **Lesen:** wenn die Seite lesbar ist.

### `files`

Metadaten zu Dateien. Der Inhalt liegt in Garage (S3), Bucket `wiki`.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `page_id` | uuid | Seite, an der die Datei hängt. Leer bei Profilbildern und Import-Archiven. |
| `uploaded_by` | uuid | Wer hochgeladen hat, immer die angemeldete Person. |
| `storage_key` | text | Schlüssel des Objekts in Garage, global eindeutig. |
| `file_name`, `mime`, `size_bytes` | | Originalname (1–255 Zeichen), MIME-Typ und Größe. |
| `scan_status` | text | Virenprüfung: `pending` beim Hochladen, danach `clean`, `infected` oder `error`. Setzt nur der Worker. Importe akzeptieren nur `clean`. |
| `deleted_at` | timestamptz | Gelöscht (die Zeile bleibt). |

- **Schreiben:** `wiki_app` legt beim Hochladen an: im eigenen Namen, mit `scan_status = pending`, an einer Seite nur als editor. Löschen (`deleted_at`) dürfen Hochladende und Editoren der Seite. Alles andere der Worker.
- **Lesen:** Anhänge lesbarer Seiten, eigene Uploads und Profilbilder (nur Dateien ohne Seite, die jemand als Profilbild eingetragen hat).

---

## 7. Import

### `imports`

Ein Importlauf pro hochgeladenem Confluence-Export.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `space_id` | uuid | Ziel-Space. |
| `source` | text | Herkunft, bisher nur `confluence`. |
| `file_id` | uuid | Hochgeladenes Export-Archiv in `files`: eigener Upload, geprüft (`clean`), nicht gelöscht. |
| `status` | text | `pending`, `running`, `done`, `failed` oder `rolled_back`. |
| `dry_run` | boolean | Probelauf (Standard): Der Worker erstellt nur den Bericht und ändert nichts. |
| `report` | jsonb | Bericht für den Import-Assistenten: übernommen, Platzhalter, übersprungen. Höchstens 10 MB. |
| `created_by`, `created_at`, `started_at`, `finished_at` | | Wer den Lauf gestartet hat und wann er lief. |

- **Schreiben:** `app.start_import` (Space-Admins) legt den Lauf an und sendet `import.requested`. Status, Bericht und Zeiten setzt der Worker.
- **Lesen:** eigene Läufe und als Space-Admin.

### `import_items`

Zuordnung Confluence-Seite → neue Seite. Macht Importe wiederholbar und Links umschreibbar.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `import_id`, `source_id` | | Primärschlüssel; `source_id` ist die Confluence-ID. Jede Confluence-Seite kommt pro Lauf nur einmal vor. |
| `page_id` | uuid | Neu angelegte Seite. Wird leer, wenn die Seite endgültig gelöscht wird. |
| `status` | text | `done`, `skipped`, `placeholder` (Makro nicht übernommen, sichtbarer Platzhalter) oder `failed`. |
| `note` | text | Hinweis für den Bericht, bis 2.000 Zeichen. |

- **Schreiben:** nur der Worker.
- **Lesen:** wenn der zugehörige Lauf lesbar ist.

---

## 8. Infrastruktur

### `outbox`

Ereignisse nach dem Outbox-Muster: in derselben Transaktion geschrieben wie die Änderung, danach vom Worker veröffentlicht (später über NATS, auch für TalkFieber).

| Spalte | Typ | Bedeutung |
|---|---|---|
| `id` | uuid | UUIDv7; der Worker veröffentlicht in dieser Reihenfolge (nicht nach `created_at`). |
| `subject` | text | `t.<tenant>.wiki.s.<space>`. Ereignisse zu Personen gehen an jeden betroffenen Space. |
| `event_type` | text | z. B. `page.updated`, `grant.changed`, `member.removed`. Die vollständige Liste steht in der CLAUDE.md, Abschnitt 7. |
| `payload` | jsonb | Daten zum Ereignis, meist IDs. |
| `published_at` | timestamptz | Vom Worker gesetzt, sobald veröffentlicht. Index auf noch offene Ereignisse. |

- **Schreiben:** nur Funktionen (intern `app.emit`, `app.emit_user_spaces`); der Worker setzt `published_at`.
- **Lesen:** nur der Worker. `wiki_app` hat keinen Zugriff.

### `audit_log`

Wer hat was getan. Nur Anfügen, nie ändern oder löschen.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `actor_id` | uuid | Handelnde Person. |
| `action` | text | z. B. `grant.changed`, `page.trashed`, `member.removed`, `space.archived`, `user.deactivated`. |
| `target_type`, `target_id` | | Betroffenes Objekt (`space`, `page`, `workspace`, `user`, `comment` …). |
| `details` | jsonb | Zusätzliche Angaben, z. B. alte und neue Rolle. |
| `created_at` | timestamptz | Zeitpunkt. Index auf `(tenant_id, created_at)`. |

- **Schreiben:** die Funktionen selbst; Einträge aus der API (z. B. `export.created`) über `app.audit_event`, immer im Namen der angemeldeten Person. Kein `UPDATE` und kein `DELETE`, auch nicht für den Worker.
- **Lesen:** nur Organisations-Admins.

---

## 9. Datenbank, Rollen und Schemas

### Datenbank

Die Datenbank `wiki` liegt im selben CloudNativePG-Cluster wie TalkFieber (`chat`) und Zitadel. Angelegt wird sie von [`roles_database.sql`](../database/scripts/roles_database.sql):

| Einstellung | Wert | Warum |
|---|---|---|
| Eigentümer | `wiki_owner` | Besitzt Tabellen und Funktionen, führt nur Migrationen aus. |
| Encoding | `UTF8` | |
| Locale | Provider `builtin`, `C.UTF-8` (LC_COLLATE/LC_CTYPE `C`) | Texte sortieren byteweise, so wie die Fractional-Index-Positionen es brauchen. Groß- und Kleinschreibung (`lower`) funktioniert trotzdem für Unicode. Unabhängig von der Betriebssystem-Locale, also gleich lokal, im Cluster und bei On-Prem-Kunden. |
| Erweiterungen | `ltree`, `pg_trgm` | `ltree` für Seitenpfade, `pg_trgm` für die unscharfe Suche in Titeln und Dateinamen. Beide sind „trusted“, der Eigentümer darf sie ohne Superuser anlegen. |

### Schemas

| Schema | Inhalt | Zugriff |
|---|---|---|
| `public` | alle Tabellen, dazu die Objekte von `ltree` und `pg_trgm` | `USAGE` für alle (`PUBLIC`), anlegen darf nur der Eigentümer der Datenbank (`wiki_owner`) |
| `app` | alle Funktionen und Trigger-Funktionen | gehört `wiki_owner`; `USAGE` für `wiki_app` und `wiki_worker`, für `PUBLIC` gesperrt |

**Wem gehört `public`?** In der IDE oder in `\dn` steht als Eigentümer `pg_database_owner`, nicht `wiki_owner`. Das ist seit PostgreSQL 15 so gewollt: `pg_database_owner` ist eine eingebaute Rolle, deren einziges Mitglied immer der Eigentümer der jeweiligen Datenbank ist, hier also `wiki_owner` (aus `roles_database.sql`). `wiki_owner` hat damit alle Rechte eines Eigentümers an `public`, `wiki_app` und `wiki_worker` dürfen dort nichts anlegen. Ändern muss man daran nichts.

### Rollen

| Rolle | Art | Wer verbindet sich so | Darf |
|---|---|---|---|
| `wiki_owner` | Login, kein Superuser, kein `BYPASSRLS` | nur Migrationen (in CloudNativePG der Datenbank-Eigentümer) | besitzt alles und umgeht damit RLS. **Die App verbindet sich nie so.** Das Schema spielt immer `wiki_owner` ein, nie `postgres`, sonst liefen alle `SECURITY DEFINER`-Funktionen als Superuser. |
| `wiki_app` | Gruppe (`NOLOGIN`) | die API über eine eigene Login-Rolle, z. B. `wiki_api` | liest unter Mandantentrennung und Leserechten, schreibt fast nur über Funktionen (Abschnitt 11). |
| `wiki_worker` | Gruppe (`NOLOGIN`) | Collab-Server und Jobs über eigene Login-Rollen, z. B. `wiki_collab`, `wiki_jobs` | liest und schreibt alles im eigenen Mandanten (nur Mandantentrennung), ruft die Worker-Funktionen auf. |

```sql
-- Login-Rollen (Passwörter aus Secrets, nicht aus dem Repository)
CREATE ROLE wiki_api    LOGIN PASSWORD '…' IN ROLE wiki_app;
CREATE ROLE wiki_collab LOGIN PASSWORD '…' IN ROLE wiki_worker;
CREATE ROLE wiki_jobs   LOGIN PASSWORD '…' IN ROLE wiki_worker;
```

- **Nie beides:** Eine Login-Rolle gehört entweder zu `wiki_app` oder zu `wiki_worker`. `app.is_worker()` verlangt Mitgliedschaft in `wiki_worker` **und** keine in `wiki_app`. Wer versehentlich beides ist, gilt als App, das ist der sichere Fall.
- **Für die Tests** ist `wiki_owner` Mitglied von `wiki_app` und `wiki_worker` (`GRANT wiki_app, wiki_worker TO wiki_owner`), damit `schema_test.sql` mit `SET ROLE` wechseln kann. Für den Eigentümer selbst ändert das nichts, er umgeht RLS ohnehin.

### Kontext pro Transaktion

Die App setzt zu Beginn jeder Transaktion:

```sql
SELECT set_config('app.tenant_id', '<uuid>', true);
SELECT set_config('app.user_id',   '<uuid>', true);   -- nur wiki_app
```

`true` heißt „nur für diese Transaktion“. Das ist wichtig bei Verbindungspools: Eine Verbindung bedient nacheinander verschiedene Personen und Mandanten, und ein vergessener Kontext darf nicht in die nächste Anfrage hinüberwirken. Ohne `app.tenant_id` ist nichts sichtbar, ohne `app.user_id` hat `wiki_app` nirgends Rechte. Der Worker setzt nur den Mandanten.

### `SECURITY DEFINER`

Fast alle schreibenden Funktionen laufen als `SECURITY DEFINER`, also mit den Rechten von `wiki_owner` und **ohne RLS**. Das ist nötig, weil sie Zeilen anfassen müssen, die die Person nicht sieht (eingeschränkte Seiten im verschobenen Teilbaum, Rechte anderer, Outbox). Deshalb gilt für jede solche Funktion:

- Sie prüft zuerst, wer handelt (`require_actor`) und was die Person darf (`require_page`, `require_space`, eigene Prüfungen).
- Sie filtert in jeder Abfrage ausdrücklich nach `tenant_id = app.current_tenant()`, weil RLS das hier nicht übernimmt.
- `search_path` ist fest auf `pg_catalog, public, pg_temp` gesetzt, damit niemand eigene Objekte unterschieben kann.
- Sie ruft nie `require_worker` auf: Innerhalb der Funktion ist `current_user` der Eigentümer, nicht der Aufrufer.

### Rechte an Funktionen

Alle Funktionen in `app` sind für `PUBLIC` gesperrt und für `wiki_app` und `wiki_worker` freigegeben, mit Ausnahme der internen Bausteine (Abschnitt 12), die `wiki_app` nicht aufrufen darf. Die globalen Default Privileges von `wiki_owner` nehmen `PUBLIC` auch das Ausführungsrecht an **künftigen** Funktionen. Eine Migration muss neue Funktionen deshalb ausdrücklich freigeben (`GRANT EXECUTE … TO wiki_app` bzw. `wiki_worker`).

## 10. Regeln (Row Level Security)

Jede Tabelle hat RLS. Es gibt drei Arten von Regeln:

1. **`tenant_isolation`** (permissiv, alle Befehle, alle Rollen) auf jeder Tabelle: `tenant_id = app.current_tenant()`, bei `tenants` `id = app.current_tenant()`. Gilt für `wiki_app` und `wiki_worker`.
2. **`read_access`** (restriktiv, nur `SELECT`, nur `wiki_app`): zusätzliche Leserechte.
3. **`write_…`** (restriktiv, nur `wiki_app`): Bedingungen für die wenigen direkten Schreibzugriffe.

Restriktive Regeln werden mit `UND` an die permissiven gehängt; eine Zeile muss also alle erfüllen. Unterabfragen in einer Regel unterliegen selbst RLS. Darauf beruht „sichtbar mit der Seite“: `EXISTS (SELECT 1 FROM pages p WHERE p.id = page_id)` findet nur Seiten, die die Person lesen darf. Die Rangfunktionen in den Regeln laufen als `SECURITY DEFINER`, sonst riefe die Regel auf `pages` sich über `page_rank` endlos selbst auf. Verstöße gegen eine Regel beim Schreiben melden den Fehlercode `42501` (`insufficient_privilege`).

| Tabelle | Regel | Bedingung |
|---|---|---|
| `pages` | `read_access` | `app.page_rank(id) >= 1` |
| `spaces` | `read_access` | `app.space_rank(id) >= 1` oder eine lesbare Seite im Space |
| `page_contents`, `page_versions`, `page_search`, `comments` | `read_access` | die Seite ist lesbar |
| `page_links` | `read_access` | beide Seiten sind lesbar |
| `grants` | `read_access` | der Space (`space_rank >= 1`) bzw. die Seite (`page_rank >= 1`) ist lesbar |
| `files` | `read_access` | eigener Upload, oder Anhang einer lesbaren Seite, oder Profilbild (Datei ohne Seite, als `avatar_file_id` eingetragen) |
| `imports` | `read_access` | selbst gestartet oder Space-Admin |
| `import_items` | `read_access` | der Import ist lesbar |
| `audit_log` | `read_access` | Organisations-Admin |
| `users` | `write_insert` | `role = 'member'`, aktiv, ohne Profilbild |
| `users` | `write_update` | eigene Zeile oder Organisations-Admin; Profilbild nur eigene Datei ohne Seite |
| `workspaces` | `write_insert` | Organisations-Admin |
| `workspaces` | `write_update` | Workspace-Admin (`is_workspace_admin`) |
| `invites` | `write_access` (alle Befehle, auch Lesen) | Workspace-Admin |
| `invites` | `write_insert` | `invited_by` ist die angemeldete Person |
| `files` | `write_insert` | eigener Upload, `scan_status = 'pending'`, an einer Seite nur als editor |
| `files` | `write_update` | eigener Upload oder editor der Seite |

## 11. Wer darf was: Tabellenrechte

Die Tabelle zeigt die Tabellenrechte. Dazu kommen immer die Regeln aus Abschnitt 10. `wiki_owner` umgeht RLS und verbindet sich deshalb nie als App.

| Tabelle | `wiki_app` lesen | `wiki_app` direkt schreiben | `wiki_worker` |
|---|---|---|---|
| `tenants` | ja | – | alles |
| `users` | ja | `INSERT` (Mitglied, aktiv), `UPDATE` eigenes Profil | alles |
| `workspaces` | ja | `INSERT`, `UPDATE (slug, name, archived_at)` | alles |
| `workspace_members` | ja | – | alles |
| `groups`, `group_members` | ja | – | alles |
| `invites` | ja (nur Admins) | `INSERT`, `UPDATE`, `DELETE` (nur Admins) | alles |
| `spaces` | ja | – | alles |
| `pages` | ja | – | `SELECT`, `INSERT`, `UPDATE (title, position, inherit_perms, updated_*)`, `DELETE` |
| `page_contents`, `page_versions`, `page_search`, `page_links` | ja | – | alles |
| `grants` | ja | – | alles |
| `comments` | ja | – | alles |
| `files` | ja | `INSERT`, `UPDATE (deleted_at)` | alles |
| `imports`, `import_items` | ja | – | alles |
| `outbox` | – | – | `SELECT`, `INSERT`, `UPDATE` |
| `audit_log` | ja (nur Organisations-Admins) | – | `SELECT`, `INSERT` |

„–“ heißt: nur über die Funktionen in Abschnitt 12.

## 12. Funktionen

Alle Funktionen liegen im Schema `app`. Zu jeder Funktion: wer sie aufruft, was sie prüft, was sie tut und welche Ereignisse (`outbox`) und Audit-Einträge sie schreibt.

**Lesehilfe**

- **DEFINER / INVOKER:** läuft als `wiki_owner` ohne RLS bzw. mit den Rechten des Aufrufers.
- **Aufruf:** `App` = `wiki_app` (API im Auftrag einer Person), `Worker` = `wiki_worker`, `intern` = nur aus anderen Funktionen.
- **`p_actor_id`:** Wer handelt. Muss die angemeldete Person (`app.user_id`) sein, sonst `insufficient_privilege` (`require_actor`). So kann die API nie im Namen anderer handeln, auch nicht durch einen Fehler.
- **Fehler:** Fehlende Rechte melden `insufficient_privilege` (`42501`), verletzte Invarianten wie „letzter Admin“ `restrict_violation` (`23001`), fachliche Fehler (z. B. „Seite liegt im Papierkorb“) `raise_exception` (`P0001`) mit deutscher Meldung, verletzte Grenzen `check_violation` (`23514`).
- **Rang:** 0 kein Zugriff, 1 viewer, 2 commenter, 3 editor, 4 admin.

### 12.1 Kontext und Hilfen

| Funktion | Art | Erklärung |
|---|---|---|
| `current_tenant() → uuid` | INVOKER, App/Worker | Mandant der Transaktion aus `app.tenant_id`, `NULL` wenn nicht gesetzt. Grundlage von `tenant_isolation`. |
| `current_user_id() → uuid` | INVOKER, App/Worker | Angemeldete Person aus `app.user_id`, beim Worker `NULL`. |
| `role_rank(rolle) → integer` | INVOKER, App/Worker | Rollenname in Rang: `viewer` 1 … `admin` 4, sonst 0. |
| `rank_role(rang) → text` | INVOKER, App/Worker | Umkehrung von `role_rank`, 0 ergibt `NULL`. |
| `page_label(id) → ltree` | INVOKER, App/Worker | Macht aus einer Seiten-ID ein `ltree`-Label (UUID ohne Bindestriche). Baustein von `pages.path`. |
| `next_position(nach) → text` | INVOKER, App/Worker | Nächster Fractional Index hinter `nach`, wie `generateKeyBetween(nach, null)` aus dem npm-Paket `fractional-indexing` (gegen das Paket geprüft). Zählt den ganzzahligen Teil hoch (`a0`, `a1` … `az`, `b00`), damit Schlüssel kurz bleiben; `NULL` ergibt `a0`. Lehnt ungültige Schlüssel ab. |
| `is_worker() → boolean` | INVOKER | Ist der Aufrufer ein Hintergrunddienst? Mitglied in `wiki_worker` und nicht in `wiki_app`. |

### 12.2 Rechte auflösen

| Funktion | Art | Erklärung |
|---|---|---|
| `page_rank(seite) → integer` | DEFINER, App/Worker | Rang der **angemeldeten** Person auf der Seite. Ruft `page_rank(seite, current_user_id())` auf. Die Leseregeln und `require_page` nutzen diese Variante. |
| `space_rank(space) → integer` | DEFINER, App/Worker | Dasselbe für einen Space. |
| `page_rank(seite, person) → integer` | DEFINER, intern/Worker | Rang einer beliebigen Person: (1) Seite im eigenen Mandanten, Person aktives Mitglied des Workspaces, sonst 0. (2) Rechtequelle suchen: die nächste Seite auf dem `path` nach oben (oder die Seite selbst) mit `inherit_perms = false`, sonst der Space. (3) Höchste Rolle aus den Grants dieser Quelle für die Person, ihre Gruppen und, außer bei Gästen, „alle im Workspace“. (4) In archivierten Spaces höchstens 1. Für `wiki_app` gesperrt, damit die API nicht die Rechte anderer abfragen kann; „Ansehen als …“ geht nur über `view_as` (12.7). |
| `space_rank(space, person) → integer` | DEFINER, intern/Worker | Wie oben, nur mit den Grants des Spaces. |
| `page_role(seite) → text`, `space_role(space) → text` | INVOKER, App | Rang der angemeldeten Person als Rollenname (`viewer` … `admin`, `NULL` ohne Zugriff). Für die API, z. B. für `onAuthenticate` des Collab-Servers und für Schaltflächen in der Oberfläche. |
| `grant_rank(space, seite, person, ws_rolle) → integer` | DEFINER, intern | Höchster Rang aus den Grants **eines** Objekts für eine Person. `ws_rolle` ist ihre Workspace-Rolle; bei `guest` zählen Grants für „alle im Workspace“ nicht. |
| `space_ws_role(space, person) → text` | DEFINER, intern | Rolle der Person im Workspace des Spaces, `NULL` wenn sie kein Mitglied oder deaktiviert ist. Erste Prüfung jeder Rangberechnung. |
| `perm_source(seite) → uuid` | DEFINER, intern | Woher die Seite ihre Rechte hat: ID der nächsten Seite oberhalb (oder der Seite selbst) mit gekappter Vererbung, `NULL` = vom Space. Nutzt `move_page`. |
| `has_admin(objekt) → boolean` | DEFINER, intern | Hat ein Space bzw. eine Seite mit gekappter Vererbung noch einen wirksamen Admin? Zählt nur Admin-Grants für aktive Personen oder Gruppen mit mindestens einem aktiven Mitglied. Ohne Mandantenfilter, damit der Trigger `admin_remains` beim Commit unabhängig vom Kontext prüfen kann. |
| `is_org_admin(person) → boolean` | DEFINER, App/Worker | Ist die Person aktiver Organisations-Admin im eigenen Mandanten? |
| `is_workspace_admin(workspace, person) → boolean` | DEFINER, App/Worker | Organisations-Admin oder aktiver Owner bzw. Admin des Workspaces. Wer das ist, darf Mitglieder und Einladungen verwalten. |

### 12.3 Prüfungen

Bausteine am Anfang anderer Funktionen. Sie werfen einen Fehler oder tun nichts.

| Funktion | Art | Erklärung |
|---|---|---|
| `require_actor(person)` | INVOKER | `insufficient_privilege`, wenn `person` nicht die angemeldete ist. |
| `require_page(seite, person, mindestrolle)` | INVOKER | `require_actor`, dann `page_rank(seite) >= mindestrolle`. |
| `require_space(space, person, mindestrolle)` | INVOKER | Dasselbe für einen Space. |
| `require_worker()` | INVOKER | `insufficient_privilege`, wenn der Aufrufer kein Hintergrunddienst ist. Nur in INVOKER-Funktionen sinnvoll. |
| `require_member_admin(workspace, person, rolle)` | DEFINER, intern | Darf die Person einer anderen diese Workspace-Rolle geben? Verlangt Workspace-Admin; `owner` vergeben nur Owner und Organisations-Admins. |

### 12.4 Ereignisse, Audit, Sperren (intern)

| Funktion | Art | Erklärung |
|---|---|---|
| `emit(mandant, space, typ, daten)` | INVOKER, intern/Worker | Schreibt ein Ereignis in die Outbox mit Subject `t.<mandant>.wiki.s.<space>`. Für `wiki_app` gesperrt, sonst ließen sich Ereignisse fälschen (z. B. `import.requested`). |
| `emit_user_spaces(person, workspace, typ, daten)` | INVOKER, intern/Worker | Dasselbe Ereignis an jeden Space eines Workspaces bzw. (bei `workspace = NULL`) aller Workspaces, in denen die Person Mitglied ist. Für Ereignisse, nach denen der Collab-Server die Verbindungen einer Person trennen muss. |
| `audit(person, aktion, objektart, objekt, details = '{}')` | INVOKER, intern/Worker | Schreibt einen Eintrag ins Audit-Log. Für `wiki_app` gesperrt. |
| `audit_event(person, aktion, objektart, objekt, details = '{}')` | DEFINER, App | Audit-Eintrag aus der API, z. B. `export.created`. `person` muss die angemeldete sein, Einträge im Namen anderer sind so unmöglich. |
| `lock_tree(space, exklusiv)` | DEFINER, intern | Sperrt den Seitenbaum eines Spaces über dessen Zeile in `spaces`: exklusiv (`FOR NO KEY UPDATE`) für Verschieben, Papierkorb und Vererbung, geteilt (`FOR SHARE`) für neue Seiten. Änderungen am Baum laufen so pro Space nacheinander; Zyklen, veraltete Pfade und neue Seiten unter gerade gelöschten Seiten sind ausgeschlossen. |

### 12.5 Vor dem Login

Diese Funktionen laufen, bevor der Mandant bekannt ist, und geben nur das Nötigste preis.

#### `resolve_tenant(slug) → (tenant_id, name, idp_org_id)`
DEFINER, App. Findet den Mandanten zum Kurznamen aus der URL, damit die API die richtige Zitadel-Organisation für den Login wählen kann. Gekündigte Mandanten (`deleted_at`) findet sie nicht.

#### `find_invite(token_hash) → (tenant_id, tenant_name, workspace_name, email, role, invited_by_name)`
DEFINER, App. Liefert die Angaben zu einer **gültigen** Einladung (nicht angenommen, nicht zurückgezogen, nicht abgelaufen) für die Seite „Einladung annehmen“. Die API übergibt den Hash des Tokens aus dem Link, nie das Token selbst.

#### `accept_invite(token_hash, anzeigename, idp_subject = NULL) → uuid`
DEFINER, App, mit gesetztem Mandanten. Nimmt eine gültige Einladung an: findet die Person über die E-Mail (ohne Beachtung der Groß- und Kleinschreibung) oder legt sie an (bei Gast-Einladungen mit `is_external`), fügt sie mit der Rolle aus der Einladung in den Workspace ein (bestehende Mitgliedschaft bleibt) und markiert die Einladung als angenommen. Lehnt ab, wenn die Person deaktiviert ist. Gibt die Personen-ID zurück. **Die API prüft vorher, dass die angemeldete E-Mail zur Einladung passt.**
Audit: `invite.accepted`.

### 12.6 Mandanten, Personen, Workspaces

#### `create_tenant(slug, name, region, admin_email, admin_name, admin_idp_subject = NULL, workspace_slug = 'main', workspace_name = NULL, idp_org_id = NULL, tenant_id = NULL) → uuid`
DEFINER, App (Registrierung). Legt Mandant, ersten Workspace und erste Person an; diese wird Organisations-Admin und Owner des Workspaces. Mit `tenant_id` übernimmt sie die ID eines Kunden, den es in TalkFieber schon gibt. Setzt `app.tenant_id` für den Rest der Transaktion. Gibt die Mandanten-ID zurück.
Audit: `tenant.created`.

#### `sync_user_groups(person, gruppen_ids, namen)`
DEFINER, App, beim Login. Übernimmt die Gruppen aus dem Zitadel-Token: legt unbekannte Gruppen an, aktualisiert Namen, fügt fehlende Mitgliedschaften der Person hinzu und entfernt solche, die nicht mehr im Token stehen. Nur für die angemeldete Person selbst. Gleichzeitige Logins kollidieren nicht (`ON CONFLICT DO NOTHING`).

#### `add_workspace_member(workspace, person, rolle, actor)`
DEFINER, App. Nimmt eine bestehende Person des Mandanten in einen Workspace auf, ohne Einladung. Erlaubt für Workspace-Admins, `owner` nur durch Owner und Organisations-Admins (`require_member_admin`). Fehler, wenn die Person schon Mitglied ist.
Audit: `member.added`.

#### `set_workspace_member_role(workspace, person, rolle, actor)`
DEFINER, App. Ändert die Rolle im Workspace. Wer einen Owner herabstuft oder jemanden zum Owner macht, muss selbst Owner oder Organisations-Admin sein; der letzte Owner bleibt (Trigger). Ein Wechsel zu `guest` beendet den Zugriff über „alle im Workspace“, deshalb das Ereignis.
Ereignis: `member.changed` an jeden Space des Workspaces. Audit: `member.role_changed` mit alter und neuer Rolle.

#### `remove_workspace_member(workspace, person, actor)`
DEFINER, App. Entfernt eine Person aus dem Workspace, erlaubt für die Person selbst und für Workspace-Admins. Ihre persönlichen Grants auf Spaces und Seiten des Workspaces fallen weg, auch auf Seiten, die die handelnde Person nicht sieht. Lehnt ab (`restrict_violation`), wenn die Person dadurch irgendwo letzter wirksamer Admin war, oder wenn sie der letzte Owner ist (Trigger). Ist die Person kein Mitglied, passiert nichts.
Ereignis: `member.removed` an jeden Space des Workspaces (der Collab-Server trennt ihre Verbindungen). Audit: `member.removed`.

#### `set_user_role(person, rolle, actor)`
DEFINER, App. Setzt die Organisations-Rolle (`org_admin` oder `member`). Nur für Organisations-Admins; der letzte bleibt (Trigger).
Audit: `user.role_changed`.

#### `set_user_active(person, aktiv, actor)`
DEFINER, App. Sperrt eine Person (`aktiv = false`) oder entsperrt sie. Nur für Organisations-Admins; der letzte Organisations-Admin lässt sich nicht sperren (Trigger). Gesperrte Personen haben überall den Rang 0 und zählen nicht als Admin; ihre Grants bleiben für eine spätere Entsperrung erhalten. Ändert sich nichts, passiert nichts.
Ereignis: beim Sperren `user.deactivated` an jeden Space ihrer Workspaces. Audit: `user.deactivated` bzw. `user.reactivated`.

### 12.7 Spaces und Rechte

#### `create_space(workspace, key, name, actor, workspace_access = 'viewer', description = NULL) → uuid`
DEFINER, App. Legt einen Space an, erlaubt für Mitglieder des Workspaces außer Gästen. Normalisiert den Key in Großbuchstaben. Die handelnde Person wird Admin des Spaces; `workspace_access` gibt allen im Workspace die Rolle `viewer`, `commenter` oder `editor`, `NULL` legt einen privaten Space an. Legt die Startseite mit dem Namen des Spaces und leerem Inhalt an.
Ereignis: `space.created`. Audit: `space.created`.

#### `update_space(space, name, description, actor)`
DEFINER, App. Ändert Name und Beschreibung, nur für Space-Admins.
Ereignis: `space.updated`. Audit: `space.updated`.

#### `archive_space(space, archiviert, actor)`
DEFINER, App. Archiviert einen Space (danach für alle höchstens viewer) oder holt ihn zurück. Erlaubt für Space-Admins über ihre Grants (auch im archivierten Space, wo ihr Rang sonst auf 1 begrenzt ist) und für Organisations-Admins. Ändert sich nichts, passiert nichts.
Ereignis: `space.archived` mit `archived: true/false` (der Collab-Server baut schreibende Verbindungen schreibgeschützt neu auf). Audit: `space.archived` bzw. `space.unarchived`.

#### `set_grant(space, seite, subjekt_typ, person, gruppe, rolle, actor)`
DEFINER, App. Setzt ein Recht oder entfernt es (`rolle = NULL`). Genau eines von `space` und `seite`; auf einer Seite nur, wenn ihre Vererbung gekappt ist. Erlaubt für Admins des Objekts, Admins des Spaces und Organisations-Admins (Wiederherstellung, wenn kein Admin mehr erreichbar ist). Prüft:
- gültige Rolle; „alle im Workspace“ nicht als Admin;
- beim **Vergeben** an eine Person: aktives Mitglied des Workspaces (Entfernen geht auch bei gesperrten oder ausgetretenen Personen);
- danach noch ein wirksamer Admin (`has_admin`), sonst `restrict_violation`.

Sperrt das Objekt, damit zwei Admins, die sich gleichzeitig gegenseitig entfernen, nacheinander laufen.
Ereignis: `grant.changed` (der Collab-Server prüft betroffene Verbindungen neu). Audit: `grant.changed` mit Subjekt und Rolle.

#### `set_page_inheritance(seite, erben, actor)`
DEFINER, App. Kappt die Vererbung (`erben = false`) oder stellt sie wieder her. Erlaubt für Admins der Seite, des Spaces und Organisations-Admins. Beim **Kappen** kopiert sie die bisher geltenden Grants (der nächsten eingeschränkten Seite oberhalb oder des Spaces) auf die Seite und macht die handelnde Person zum Admin der Seite; danach lassen sich die Rechte mit `set_grant` einschränken, ohne dass sich jemand aussperrt. Beim **Wiederherstellen** löscht sie die Grants der Seite. Sperrt den Baum exklusiv. Ändert sich nichts, passiert nichts.
Ereignis: `page.permissions_changed`. Audit: `page.inheritance_cut` bzw. `page.inheritance_restored`.

#### `view_as(space, person, actor) → (page_id, parent_id, path, position, title, inherit_perms, role)`
DEFINER, App. „Ansehen als …“: zeigt, wie eine Person einen Space sieht, z. B. um nach einem Import zu prüfen, dass niemand mehr sieht als in Confluence. Die API darf `page_rank(seite, person)` nicht aufrufen; diese Funktion gibt dieselbe Rolle heraus, aber nur so:
- **Wer:** Admins des Spaces über ihre Grants (auch im archivierten Space) und Organisations-Admins, sonst `insufficient_privilege`.
- **Was:** nur Struktur und Rolle, keine Inhalte. Seiten, die die Person nicht lesen darf, stehen mit `role = NULL` drin; genau die sucht man beim Prüfen.
- **Was nicht:** Seiten mit eigenen Rechten, auf denen die handelnde Person nicht Admin ist, fehlen samt ihren erbenden Unterseiten. Wer eine Seite nicht verwaltet, erfährt auch hier nichts über sie. Seiten im Papierkorb fehlen.
- Sortiert nach `position, page_id`; den Baum baut die App über `parent_id`. Für „Suche als …“ filtert die API ihre eigenen Treffer auf die Seiten, für die hier eine Rolle steht.

Audit: `space.viewed_as` mit der angesehenen Person, bei jedem Aufruf.

### 12.8 Seitenbaum

#### `create_page(space, eltern, titel, actor, position = NULL) → uuid`
DEFINER, App. Legt eine Seite an: unter einer Elternseite (editor auf der Elternseite) oder auf oberster Ebene (editor im Space). Die Elternseite muss im selben Space liegen und darf nicht im Papierkorb sein; das prüft sie erst nach der geteilten Sperre des Baums, damit ein gleichzeitiges Löschen nicht durchrutscht. Ohne `position` kommt die Seite hinter alle Geschwister (`next_position`, über alle Geschwister, auch unsichtbare). Legt leeren Inhalt (`\x0000`) an. Abgelehnt in archivierten Spaces (dort fehlt das Recht ohnehin).
Ereignis: `page.created`.

#### `move_page(seite, neue_eltern, position, actor)`
DEFINER, App. Verschiebt eine Seite mit ihrem ganzen Teilbaum innerhalb des Spaces oder sortiert sie unter derselben Elternseite um. Sperrt den Baum exklusiv und prüft danach:
- editor auf der Seite und am Ziel (Elternseite oder Space);
- Seite und Ziel nicht im Papierkorb, Ziel im selben Space, Ziel nicht unterhalb der Seite (keine Zyklen);
- gültige Position;
- **ändert sich die Rechtequelle** (`perm_source`) und kommt die Seite aus einem Bereich mit eigenen Rechten, muss die Person dort Admin sein. Sonst könnte ein Editor eingeschränkte Inhalte für den ganzen Space freigeben. Hinein in einen eingeschränkten Bereich genügt editor am Ziel. Seiten mit eigenen Rechten nehmen diese mit.

Aktualisiert `path` für den ganzen Teilbaum, auch für Seiten, die die Person nicht sieht.
Ereignis: `page.moved`; bei geänderter Rechtequelle zusätzlich `page.permissions_changed`. Audit: `page.moved` mit alter und neuer Elternseite und Rechtequelle.

#### `trash_page(seite, actor) → integer`
DEFINER, App. Legt eine Seite mit ihrem Teilbaum in den Papierkorb und gibt die Zahl der Seiten zurück. Verlangt editor auf **jeder** betroffenen Seite, auch auf solchen, die die Person nicht sieht; sonst `insufficient_privilege`. Die Startseite eines Spaces lässt sich nicht löschen. Alle Seiten bekommen dieselbe `trash_root_id`; Seiten, die schon vorher im Papierkorb lagen, behalten ihre. Liegt die Seite schon im Papierkorb, gibt sie 0 zurück. Sperrt den Baum exklusiv.
Ereignis: `page.trashed`. Audit: `page.trashed` mit Anzahl.

#### `restore_page(seite, actor) → integer`
DEFINER, App. Holt genau die Seiten zurück, die gemeinsam mit dieser Seite gelöscht wurden, und gibt ihre Zahl zurück. Nur für die Seite, die damals gelöscht wurde (nicht für mitgelöschte Unterseiten), editor vorausgesetzt. Liegt die Elternseite noch im Papierkorb, muss zuerst sie zurück. Sperrt den Baum exklusiv.
Ereignis: `page.restored`. Audit: `page.restored` mit Anzahl.

### 12.9 Inhalt und Versionen

#### `store_content(seite, ydoc, blocknote_json, klartext, titel, bearbeitende)`
INVOKER, Worker (Collab-Server, `onStoreDocument`). Speichert den Yjs-Zustand, das BlockNote-Dokument (`editor.document`), den Klartext und den Titel aus `Y.Text` „title“ und ergänzt `editors_since_version`. Prüft keine Rechte; das hat die API beim Verbindungsaufbau getan. Nichts davon führt zur Ablehnung, sonst ließe sich die Seite gar nicht mehr speichern: zu lange Titel (255) und Texte (2 Mio. Zeichen) werden gekürzt, ein JSON über 20 MB oder ohne Array wird als `NULL` gespeichert. `titel = NULL` lässt den Titel unverändert. Abgelehnt für Seiten im Papierkorb.
Ereignis: `page.updated` (der Worker aktualisiert danach Suche und Verlinkungen).

#### `create_version(seite, art, actor = NULL, restored_from = NULL) → integer`
INVOKER, Worker (für `manual` auch App). Legt eine Version an und gibt ihre Nummer zurück. `manual` leitet an `save_version` weiter. `auto` (nach 10 Minuten Ruhe), `restore` (nach dem Wiederherstellen, mit `restored_from`) und `import` sind nur für Hintergrunddienste.

#### `save_version(seite, actor) → integer`
DEFINER, App. Manuelle Version durch eine Person mit editor-Recht. Getrennt von `create_version`, weil eine `SECURITY DEFINER`-Funktion nicht erkennen kann, ob ein Worker sie aufruft.

#### `insert_version(seite, art, actor, restored_from) → integer`
INVOKER, intern/Worker. Der gemeinsame Kern: sperrt die Seite (damit Versionsnummern nicht doppelt vergeben werden), kopiert Titel, `ydoc`, `content_json` und Klartext in die nächste Version, übernimmt `editors_since_version` als Autoren und leert die Liste. Für `wiki_app` gesperrt, sonst ließen sich Versionen ohne Prüfung anlegen.

#### `replace_page_links(seite, ziele)`
INVOKER, Worker. Ersetzt alle ausgehenden Verlinkungen einer Seite durch `ziele`. Doppelte Ziele, Links auf sich selbst und Ziele, die es im Mandanten nicht gibt, werden übergangen.

### 12.10 Kommentare

#### `add_comment(seite, text, actor, anker = NULL, eltern = NULL) → uuid`
DEFINER, App. Legt einen Kommentar an, commenter vorausgesetzt, nicht auf Seiten im Papierkorb. Mit `anker` hängt er an einer Textstelle, mit `eltern` ist er eine Antwort: nur auf einen Thread-Anfang derselben Seite (eine Ebene tief), ohne eigenen Anker. Eine Antwort öffnet einen erledigten Thread wieder.
Ereignis: `comment.created`.

#### `edit_comment(kommentar, text, actor)`
DEFINER, App. Ändert den Text eines eigenen, nicht gelöschten Kommentars (commenter auf der Seite vorausgesetzt) und setzt `edited_at`.

#### `set_comment_resolved(kommentar, actor, erledigt)`
DEFINER, App. Markiert einen Thread als erledigt oder offen, commenter vorausgesetzt. Nur Thread-Anfänge.

#### `delete_comment(kommentar, actor)`
DEFINER, App. Löscht einen Kommentar: `body` wird geleert, die Zeile bleibt für den Thread. Eigene Kommentare mit Leserecht auf der Seite, fremde nur als Admin der Seite. Schon gelöschte oder unbekannte Kommentare: nichts passiert.
Audit: `comment.deleted`, nur beim Löschen fremder Kommentare.

### 12.11 Import

#### `start_import(space, datei, actor, probelauf = true) → uuid`
DEFINER, App. Legt einen Importlauf an, nur für Space-Admins. Die Datei muss ein eigener, geprüfter (`clean`), nicht gelöschter Upload sein. Standard ist der Probelauf. Den Import selbst führt der Worker aus.
Ereignis: `import.requested`. Audit: `import.started`.

## 13. Trigger

| Trigger | Tabelle, Zeitpunkt | Funktion | Wirkung |
|---|---|---|---|
| `set_page_path` | `pages`, vor `INSERT` | `app.set_page_path()` (DEFINER) | Setzt `path` aus dem Pfad der Elternseite (die nicht sichtbar sein muss, z. B. beim Import) und sperrt den Baum geteilt. Fehler, wenn die Elternseite nicht im selben Space und Mandanten liegt. |
| `protect_last_owner` | `workspace_members`, vor `UPDATE OF role` und `DELETE` | `app.protect_last_owner()` | Jeder Workspace behält mindestens einen aktiven Owner (`restrict_violation`). Sperrt den Workspace, damit zwei gleichzeitige Änderungen nicht beide durchkommen. |
| `protect_last_org_admin` | `users`, vor `UPDATE OF role, deactivated_at` und `DELETE` | `app.protect_last_org_admin()` | Jeder Mandant behält mindestens einen aktiven Organisations-Admin (`restrict_violation`). Sperrt den Mandanten. |
| `admin_remains` | `grants`, nach `DELETE` und `UPDATE OF role`, **beim Commit** (`DEFERRABLE INITIALLY DEFERRED`) | `app.check_admin_remains()` (DEFINER) | Rückfallebene für alle Wege an `set_grant` vorbei (Worker, gelöschte Personen): Jeder Space und jede Seite mit gekappter Vererbung behält einen wirksamen Admin. Prüft erst beim Commit, damit „löschen und neu anlegen“ in einer Transaktion geht; ausgenommen sind gelöschte Objekte und Seiten, die wieder erben. Sperren und Gruppenaustritte ändern keine Grants und lösen ihn deshalb nicht aus. |
