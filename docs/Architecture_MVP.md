# Europäische Wiki-Plattform – Architektur & MVP

Nov 2, 2026 · @Peter Forster

## Ziel & Leitplanken

Das MVP soll in rund 6 Monaten beweisen, dass ein Team von 10 bis 50 Personen seinen Confluence-Bereich importieren und danach im Alltag ohne Rückfall weiterarbeiten kann. Alles, was diesem Beweis nicht dient, kommt später.

Zielgruppe: Organisationen auf Confluence Data Center, das am 28. März 2029 schreibgeschützt wird, und die nicht in eine US-Cloud wechseln wollen oder dürfen.

Leitplanken, die jede Technikentscheidung prüfen muss:

- **Selbst hostbar**: ein Helm-Chart für K3s/Kubernetes, das ein Admin an einem Nachmittag installiert.
- **Keine US-Abhängigkeit zur Laufzeit**: kein Pflicht-Dienst von AWS, Google, Auth0, Algolia o. ä.; alles läuft auf eigener oder EU-Infrastruktur.
- **Offene Lizenzen ohne Falle**: jede Bibliothek muss kommerziellen Einsatz in einem Produkt erlauben, das du ggf. nicht vollständig offenlegst.
- **Daten gehören dem Kunden**: vollständiger Export (Markdown + Anhänge + JSON) jederzeit, ohne Support-Ticket.
- **Langweilige Technik, wo es geht**: Innovation nur im Editor-Erlebnis und im Import, nicht in der Infrastruktur.

## Tech-Stack

Empfehlung: TypeScript durchgängig – Next.js im Frontend, Express als API, BlockNote als Editor, Yjs + Hocuspocus für Echtzeit, PostgreSQL über CloudNativePG und Zitadel für den Login. Bewusst bewährte statt neuester Technik: eine Sprache, bekannte Werkzeuge, wenig Überraschungen.

| Baustein | Wahl im MVP | Lizenz | Warum |
| --- | --- | --- | --- |
| Editor | [BlockNote](https://github.com/opf/BlockNote) (auf Tiptap/ProseMirror) | MPL-2.0 (Core) | Notion-artige Blöcke, Slash-Menü, Drag & Drop und Yjs-Anbindung fertig; La Suite Docs nutzt ihn ebenfalls |
| Echtzeit | [Yjs](https://github.com/yjs/yjs) + [Hocuspocus](https://github.com/ueberdosis/hocuspocus) | MIT | Bewährter CRDT plus fertiger WebSocket-Server mit Auth- und Persistenz-Hooks |
| Frontend | Next.js (App Router) als Standalone-Container | MIT | Bekanntes Werkzeug; reines Frontend, alle Daten über die API; Editor als Client-Komponente ohne SSR |
| API | Node.js mit Express 5, Zod für Validierung, Drizzle ORM | MIT | Verbreitet und stabil; Zod ergänzt die Validierung, die Express nicht mitbringt |
| Datenbank | PostgreSQL 18 über CloudNativePG, gemeinsamer Cluster mit TalkFieber | PostgreSQL / Apache-2.0 | Seitenbaum, Rechte, Versionen, Suche und Jobs in einem System; der Operator übernimmt Backups mit Point-in-Time-Recovery nach S3 |
| Suche | Postgres-Volltext (`tsvector`, deutsch/englisch) | – | Reicht bis ca. 100k Seiten; später OpenSearch oder Meilisearch |
| Dateien | Garage (S3-kompatibel) im Cluster, gemeinsam mit TalkFieber | – | Eigener Bucket pro Produkt; Datenbank- und Datei-Backups gehen zu externem EU-S3 (z. B. Hetzner Object Storage) |
| Auth | [Zitadel](https://zitadel.com/blog/zitadel-v3-announcement), selbst gehostet; die App spricht nur generisches OIDC | AGPL-3.0 (unverändert genutzt) | Mitgelieferter Identity Provider; Kunden können stattdessen Entra ID, Keycloak o. ä. anschließen |
| Hintergrundjobs | pg-boss (Queue in Postgres) | MIT | Import, Indexierung, Exporte ohne zusätzlichen Redis |
| Betrieb | K3s mit Traefik-Ingress und cert-manager | Apache-2.0 | Leichtes Kubernetes auf einem VPS; dieselben Manifeste werden später das Helm-Chart für Kunden |

**Lizenzfalle Editor:** Der Großteil von BlockNote steht unter MPL-2.0 und darf in kommerziellen, auch geschlossenen Produkten genutzt werden ([Quelle](https://socket.dev/npm/package/@blocknote/core/overview/0.50.0)). Die XL-Pakete (u. a. KI, PDF/Word/ODT-Export, mehrspaltige Layouts) stehen dagegen unter GPL-3.0 und brauchen sonst eine kommerzielle Lizenz ([Quelle](https://github.com/opf/BlockNote)). Für das MVP: XL-Pakete weglassen, Export selbst bauen (Markdown/HTML), Entscheidung später treffen.

**Regel für Next.js:** Next ist nur die Oberfläche. Keine Geschäftslogik in Server Actions oder Route Handlern, sonst entstehen zwei Backends. WebSockets laufen ohnehin nicht in Next, daher bleibt Hocuspocus ein eigener Dienst.

**Lizenz Zitadel:** Seit Version 3 steht Zitadel unter AGPL-3.0; die Nutzung der APIs ohne Änderung am Code löst laut Zitadel keine Pflichten aus ([Quelle](https://zitadel.com/blog/apache-to-agpl)). Solange du Zitadel nur per OIDC anbindest und nicht veränderst, bleibt dein eigener Code davon unberührt. Seit v3 läuft Zitadel nur noch auf PostgreSQL und kann deshalb den CloudNativePG-Cluster mitnutzen (eigene Datenbank).

## Systemarchitektur

Das MVP besteht aus drei eigenen Diensten (Next.js-Frontend, Express-API, Collab-Server) plus PostgreSQL über CloudNativePG und S3; als Identity Provider läuft Zitadel mit, austauschbar über OIDC.

&#91;embedded content: Systemarchitektur · 4 Dienste, 2 Speicher\]

Der Browser holt Struktur, Rechte und Suche über die API und bearbeitet Text über eine WebSocket-Verbindung zum Collab-Server. Beide schreiben in dieselbe Datenbank, sodass es nur eine Wahrheit gibt.

## Datenmodell

Der Seiteninhalt lebt als Yjs-Binärdokument; alles, was gesucht, sortiert oder berechtigt wird, steht zusätzlich in normalen Spalten. So bleibt Postgres die Wahrheit für Struktur und Rechte, Yjs nur für den Text.

Kernentitäten:

- **Tenant** – ein Kunde, entspricht einer Zitadel-Organisation; dieselbe `tenant_id` wie in TalkFieber. Jede Tabelle trägt `tenant_id`, Row-Level-Security trennt die Mandanten in der Datenbank selbst.
- **Workspace** – Arbeitsbereich innerhalb eines Tenants, wie in TalkFieber.
- **Space** – entspricht einem Confluence-Bereich; Einheit für Rechte und Import.
- **Page** – Knoten im Seitenbaum, mit Titel, Position und Elternseite.
- **PageContent** – aktueller Yjs-Zustand plus abgeleiteter Klartext für die Suche.
- **PageVersion** – benannte Snapshots für die Versionshistorie.
- **Grant** – wer auf Space oder Page welche Rolle hat.
- **Attachment**, **Comment**, **AuditEvent**, **Outbox** – Audit von Tag 1, Outbox für spätere Events an TalkFieber.

```sql
create table pages (
  id            uuid primary key default uuidv7(),
  tenant_id     uuid not null,
  workspace_id  uuid not null references workspaces(id),
  space_id      uuid not null references spaces(id),
  parent_id     uuid references pages(id) on delete cascade,
  path          ltree not null,            -- schnelle Teilbaum-Abfragen
  position      text  not null,            -- fractional index für Sortierung
  title         text  not null default '',
  inherit_perms boolean not null default true,
  created_by    uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz                -- Papierkorb statt hartem Löschen
);

create table page_contents (
  page_id     uuid primary key references pages(id) on delete cascade,
  tenant_id   uuid not null,
  ydoc        bytea not null,              -- Yjs-Update (state as update)
  plain_text  text  not null default '',
  search      tsvector generated always as
                (to_tsvector('simple', plain_text)) stored,
  updated_at  timestamptz not null default now()
);

create table page_versions (
  id          uuid primary key default uuidv7(),
  tenant_id   uuid not null,
  page_id     uuid not null references pages(id) on delete cascade,
  ydoc        bytea not null,
  title       text  not null,
  author_ids  uuid[] not null,
  created_at  timestamptz not null default now()
);

create table grants (
  id           uuid primary key default uuidv7(),
  tenant_id    uuid not null,
  subject_type text not null check (subject_type in ('user','group')),
  subject_id   uuid not null,
  object_type  text not null check (object_type in ('space','page')),
  object_id    uuid not null,
  role         text not null check (role in ('viewer','commenter','editor','admin'))
);

-- Mandantentrennung, gleiches Muster für jede Tabelle
alter table pages enable row level security;
alter table pages force row level security;
create policy tenant_isolation on pages
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

Zwei Entscheidungen dahinter: `ltree` plus `parent_id` macht Verschieben teurer, aber Lesen von Teilbäumen und Rechtevererbung billig – ein Wiki wird viel öfter gelesen als umgebaut. Fractional Indexing (`position`) erlaubt Umsortieren ohne alle Geschwister neu zu nummerieren.

**Gleiche Konventionen wie TalkFieber:** Mandanten als `tenant` → `workspace`, `tenant_id` auf jeder Tabelle und Row-Level-Security ab Tag 1 statt erst später. Zwei Datenbankrollen nach demselben Muster (`wiki_app` für Anfragen von Personen, `wiki_worker` für Hintergrundjobs), IDs per `uuidv7()` aus PostgreSQL 18. Die `tenant_id` entspricht in beiden Produkten derselben Zitadel-Organisation, damit ein Kunde überall derselbe Mandant ist. Die RLS-Falle aus dem TalkFieber-Schematest gilt auch hier: `INSERT … ON CONFLICT` prüft auch die Leseregel für die neue Zeile.

## Echtzeit-Kollaboration

Jede geöffnete Seite ist ein Yjs-Dokument, das Hocuspocus im Speicher hält und gebündelt nach Postgres schreibt. Konflikte gibt es dadurch nicht; die eigentliche Arbeit liegt in Auth, Persistenz und Versionen.

Ablauf einer Sitzung:

1. Der Browser öffnet eine WebSocket-Verbindung zu Hocuspocus, Dokumentname = `page:<id>`, mit einem kurzlebigen Token der API.
2. `onAuthenticate` prüft das Token und fragt die API nach der Rolle. Viewer bekommen eine schreibgeschützte Verbindung, Editoren eine schreibende.
3. `onLoadDocument` lädt `page_contents.ydoc` aus Postgres.
4. Änderungen laufen als kleine Yjs-Updates zwischen allen Clients; Cursor und Anwesenheit über Yjs Awareness.
5. `onStoreDocument` (entprellt, z. B. alle 2 s) schreibt den Zustand zurück, extrahiert Klartext und Titel für Suche und Seitenbaum.

Versionen: Ein Job legt einen Snapshot an, wenn eine Seite 10 Minuten unberührt war oder jemand aktiv "Version speichern" klickt. Wiederherstellen = Snapshot als neues Update anwenden, nicht überschreiben – so bleibt die Historie linear.

Skalierung: Im MVP reicht eine Hocuspocus-Instanz (Hunderte gleichzeitige Dokumente). Für mehrere Instanzen später entweder Sticky Routing nach Dokument-ID oder die Redis-Erweiterung (mit Valkey) für Pub/Sub.

Offline: Yjs kann lokal über IndexedDB puffern. Fürs MVP nur "kurz Netz weg überleben", kein echter Offline-Modus – der bringt Rechte- und Konfliktfragen, die du jetzt nicht willst.

## Berechtigungen & Sicherheit

Rechte werden am Space vergeben und an Seiten vererbt; eine Seite kann die Vererbung kappen und eigene Grants setzen. Das ist das Confluence-Modell, und der Import muss es 1:1 abbilden können.

| Rolle | Darf |
| --- | --- |
| Viewer | lesen, exportieren |
| Commenter | zusätzlich kommentieren |
| Editor | zusätzlich bearbeiten, Seiten anlegen und verschieben |
| Admin | zusätzlich Rechte vergeben, Space-Einstellungen, löschen |

Auflösung einer Berechtigung: von der Seite den `path` hinauf bis zur ersten Seite mit `inherit_perms = false` oder bis zum Space, dort die Grants von Nutzer und seinen Gruppen sammeln, höchste Rolle gewinnt. Ergebnis pro Nutzer und Seite kurz cachen und bei jeder Rechteänderung invalidieren.

Die eine Regel, die nie gebrochen wird: Suche, Seitenbaum, Verlinkungsvorschau, Benachrichtigungen und Export gehen alle durch dieselbe Rechte-Funktion. Die meisten Datenlecks in Wikis entstehen über Nebenwege, nicht über die Seite selbst.

Sicherheit im MVP:

- Login nur über OIDC (Zitadel mitgeliefert; alternativ Entra ID, Keycloak, Okta …); Gruppen aus dem Token übernehmen.
- Audit-Log für Anmelden, Rechteänderungen, Löschen, Export – unveränderbar, exportierbar.
- Verschlüsselung: TLS überall, Datenträger- und Backup-Verschlüsselung; keine Ende-zu-Ende-Verschlüsselung (bricht Suche und Server-Import).
- Anhänge nur über kurzlebige, signierte URLs ausliefern; Upload-Größen und Dateitypen begrenzen.
- Später: SCIM für Nutzer-Provisionierung, Aufbewahrungsrichtlinien, IP-Beschränkungen.

## MVP-Umfang

Das MVP ist ein Wiki, kein Notion: Seiten im Baum, gemeinsam bearbeitet, gut durchsuchbar, aus Confluence importierbar. Datenbanken, Boards und KI kommen erst, wenn echte Nutzer danach fragen.

**Drin:**

- [ ] Workspaces, Spaces, Seitenbaum mit Drag & Drop
- [ ] Block-Editor: Überschriften, Listen, Tabellen, Code, Bilder, Callouts, Seitenlinks
- [ ] Echtzeit-Bearbeitung mit Cursorn und Anwesenheit
- [ ] Kommentare an Textstellen
- [ ] Versionshistorie mit Wiederherstellen
- [ ] Rechte auf Space- und Seitenebene mit Vererbung
- [ ] Volltextsuche über Titel und Inhalt
- [ ] Login über OIDC, Gruppen aus dem IdP
- [ ] Confluence-Import (Space-Export als HTML/XML): Hierarchie, Inhalte, Anhänge, häufige Makros
- [ ] Export: Markdown + Anhänge als ZIP
- [ ] Audit-Log
- [ ] Installation per Manifesten auf K3s, daraus später ein Helm-Chart

**Bewusst nicht drin:**

- Datenbanken/Tabellen-Ansichten à la Notion
- KI-Funktionen
- Mobile Apps (responsive Web reicht)
- Echter Offline-Modus
- Öffentliche Seiten und Gast-Zugänge
- Integrationen außer einem einfachen Webhook
- Jira-Anbindung (wichtig, aber eigenes Projekt)

## Fahrplan

Fünf Phasen in rund 26 Wochen für eine Person in Vollzeit; jede endet mit einem Gate, das sich vorführen lässt.

&#91;embedded content: Fahrplan · 5 Phasen, 26 Wochen, je ein Gate\]

Rechte kommen vor dem Import, weil der Import Confluence-Rechte abbilden muss. Erst wenn ein Gate erreicht ist, beginnt die nächste Phase; bei Verzug wird Umfang gestrichen, nicht das Gate.

## Deployment & Betrieb

Start auf einem einzelnen VPS mit K3s (4 vCPU, 8 GB RAM, 80 GB SSD als Faustwert). Dieselben Manifeste werden später das Helm-Chart für Kunden-Installationen und die eigene EU-Cloud – so gibt es nur einen Codepfad.

**Ein Cluster für beide Produkte:** Wiki und TalkFieber laufen auf demselben K3s auf deinem Hostinger-VPS und teilen sich CloudNativePG (getrennte Datenbanken), Zitadel, Garage, Valkey und cert-manager. NATS JetStream kommt mit TalkFieber dazu. Für beide zusammen eher 8 vCPU und 16 GB RAM einplanen; solange nur das Wiki läuft, reicht die kleinere Größe.

Aufbau in dieser Reihenfolge:

1. **K3s installieren und absichern:** nach außen nur Port 22, 80 und 443; die Kubernetes-API (6443) per Firewall auf die eigene IP beschränken oder nur über SSH-Tunnel nutzen.
2. **cert-manager** mit Let's-Encrypt-Issuer; Traefik (in K3s enthalten) übernimmt Ingress und WebSockets.
3. **CloudNativePG-Operator**, dann ein Postgres-Cluster mit einer Instanz und zwei Datenbanken (App, Zitadel). Backups und WAL-Archiv zu externem EU-S3.
4. **Zitadel** per Helm-Chart auf eigener Subdomain, angebunden an den CNPG-Cluster.
5. **Objektspeicher** für Anhänge: Garage im Cluster, gemeinsam mit TalkFieber; Sicherung zu externem EU-S3.
6. **App als drei Deployments:** `web` (Next.js standalone), `api` (Express), `collab` (Hocuspocus, genau eine Replik, Update-Strategie Recreate). Ein Ingress verteilt `/`, `/api` und `/collab`.

Betrieb:

- **Entwicklung lokal:** Node direkt auf dem Rechner, Postgres und Zitadel per Docker Compose. Der VPS ist die Staging-Umgebung, auf die jeder fertige Stand wandert.
- **Ausliefern:** Container-Images per CI bauen und in eine Registry pushen; anfangs `kubectl apply` mit Kustomize, GitOps (Argo CD oder Flux) erst ab mehreren Umgebungen.
- **Secrets:** zuerst Kubernetes-Secrets, verschlüsselt im Repo mit SOPS, sobald es ernst wird.
- **Backups:** CloudNativePG sichert kontinuierlich nach S3 mit Point-in-Time-Recovery; der S3-Bucket ist versioniert. Wiederherstellung einmal pro Quartal tatsächlich üben.
- **Updates:** Datenbank-Migrationen laufen beim Start automatisch und sind eine Version rückwärtskompatibel.
- **Beobachtbarkeit:** OpenTelemetry für Traces und Metriken, strukturierte Logs; keine Telemetrie nach Hause ohne Zustimmung.
- **Grenze:** Ein Knoten heißt keine Hochverfügbarkeit, jedes K3s- oder OS-Update kostet ein paar Minuten Ausfall. Für Entwicklung und Piloten in Ordnung, für zahlende Kunden später nicht – dann mehrere Knoten oder ein verwaltetes Kubernetes bei einem EU-Anbieter.
- **Docker Compose** bleibt eine mögliche einfache Variante für sehr kleine Kunden, ist aber nicht Teil des MVP.

Für die Vermarktung später relevant: ein Hosting-Partner mit ISO 27001 bzw. BSI-C5-Testat, und ein Auftragsverarbeitungsvertrag nach DSGVO als Standard-Download.

## Zusammenspiel mit TalkFieber

Wiki und TalkFieber werden zwei Produkte auf einer gemeinsamen Plattform: ein Login, ein Mandantenmodell, ein Cluster. Das Wiki kommt zuerst und legt diese Plattform an; TalkFieber setzt später darauf auf, statt sie ein zweites Mal zu bauen. Zusammen sind beide auch das stärkere Angebot, denn Teams lässt sich realistisch nur als Teil eines größeren Pakets ersetzen.

| Baustein | Gemeinsam | Pro Produkt getrennt |
| --- | --- | --- |
| Login | Eine Zitadel-Instanz, eine Organisation pro Kunde, Single Sign-on über beide Produkte | Eigene OIDC-Clients und Rollen |
| Mandanten | Gleiche `tenant_id` und `workspace_id`, gleiche RLS-Konvention (App- und Worker-Rolle) | Eigene Datenbank im selben CloudNativePG-Cluster |
| Dateien | Eine Garage-Instanz | Eigener Bucket |
| Flüchtige Daten | Eine Valkey-Instanz | Eigenes Schlüssel-Präfix |
| Events | NATS JetStream (kommt mit TalkFieber) | Eigene Subjects, z. B. `t.{tenant}.wiki.*` |
| Oberfläche | Gemeinsames Designsystem und Nutzer-Avatare | Eigene Apps und Domains |

Integrationen nach dem Wiki-MVP, sobald TalkFieber läuft:

- **Wiki-Links im Chat** mit Vorschau, vorher gegen die Wiki-Rechte des Lesers geprüft.
- **Benachrichtigungen aus dem Wiki** (Erwähnung, Kommentar, Seite geändert) als Nachricht in TalkFieber statt per E-Mail.
- **Seite und Topic verknüpfen:** "Über diese Seite sprechen" öffnet ein Topic, das mit der Seite verbunden bleibt; die Topics von TalkFieber passen dafür besser als Slack-Threads.
- **Topic als Seite sichern:** eine erledigte Diskussion mit einem Klick als Entscheidungsprotokoll ins Wiki übernehmen.
- **Gemeinsame Suche** über Seiten und Nachrichten, wenn beide Produkte stabil sind.

Was du dafür jetzt schon im Wiki beachten solltest: `tenant_id` von Anfang an, Zitadel-Organisationen als Mandanten, und Events (Seite erstellt, geändert, kommentiert) bereits in einer `outbox`-Tabelle festhalten, auch wenn sie anfangs niemand abholt.

**Offene Entscheidung Sprache:** Für TalkFieber war Go oder Elixir angedacht, alternativ TypeScript. Das Wiki ist wegen Hocuspocus TypeScript. Wenn du beides allein baust, spart TypeScript für beide den Kontextwechsel und erlaubt geteilte Pakete (Tenant-Kontext, Zitadel-Anbindung, UI-Komponenten); für die Pilotphase reicht Node auch für die WebSocket-Last des Chats. Ein Go-Gateway bleibt später als gezielter Austausch möglich.

## Risiken & offene Entscheidungen

Das größte Risiko ist nicht die Technik, sondern der Import: Wenn die erste Confluence-Migration hässlich aussieht, ist der Kunde weg. Deshalb hat er mit Phase 3 eine eigene Phase vor dem Pilotbetrieb, und echte Exporte von Pilotkunden sollten schon ab Phase 1 als Testdaten vorliegen.

| Risiko | Gegenmaßnahme |
| --- | --- |
| Confluence-Makros (Jira-Tabellen, Seiteneigenschaften, Plugins) lassen sich nicht abbilden | Top-20-Makros aus echten Exporten zählen; Rest als sichtbarer Platzhalter-Block mit Originalinhalt |
| Editor-Abhängigkeit von einem kleinen Projekt | Inhalte zusätzlich als eigenes JSON speichern; Editor austauschbar halten |
| Rechte-Lecks über Suche oder Export | Eine zentrale Rechte-Funktion + automatisierte Tests pro Lesepfad |
| Yjs-Dokumente wachsen unbegrenzt | Regelmäßige Kompaktierung beim Speichern; Größe pro Seite überwachen |
| Einzelkämpfer-Tempo | MVP-Umfang strikt halten; früh 2–3 Pilotkunden mit echtem Confluence-Export suchen |

Offene Entscheidungen, die du treffen solltest:

- [ ] Lizenzmodell des eigenen Codes: Open Core (AGPL + Enterprise-Lizenz) oder proprietär mit Quelltext für Kunden?
- [ ] XL-Pakete von BlockNote nutzen (GPL-3.0 oder kommerzielle Lizenz) oder Export selbst bauen?
- [ ] Ab wann bekommen große Kunden eine eigene Zelle (komplett getrennte Instanz des ganzen Stacks, wie für TalkFieber geplant)? Mandantenfähig mit RLS ist das Wiki trotzdem von Anfang an.
- [ ] Name und Rechtsform – für die Souveränitäts-Botschaft zählt ein EU-Sitz ohne US-Mutter.

## Quellen

- [Atlassian: Data Center End of Life](https://www.atlassian.com/migration)
- [BlockNote auf GitHub (Lizenz der XL-Pakete)](https://github.com/opf/BlockNote)
- [@blocknote/core auf Socket (MPL-2.0)](https://socket.dev/npm/package/@blocknote/core/overview/0.50.0)
- [Hocuspocus auf GitHub (MIT)](https://github.com/ueberdosis/hocuspocus)
- [La Suite Docs auf AlternativeTo](https://alternativeto.net/software/docs/about)
- [Zitadel: Wechsel zu AGPL 3.0](https://zitadel.com/blog/apache-to-agpl)
- [Zitadel v3: Lizenz und PostgreSQL-only](https://zitadel.com/blog/zitadel-v3-announcement)
