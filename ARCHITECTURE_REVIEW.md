# Review: Architektur

**Momentaufnahme vom 14. November 2026** (M0 abgeschlossen, M1 steht an), wird nicht
nachgeführt. Ergänzt das Code-Review in [REVIEW.md](REVIEW_M0.md); dort geht es um Fehler im
Bestehenden, hier um Entscheidungen und Entwürfe, die erst mit M1 bis M5 zum Tragen kommen.

**Weitergeführt** werden die Befunde in [docs/ROADMAP.md](docs/ROADMAP.md) (Punkte und Gates
in M1 bis M5, mit der ID) und in [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md), wo eine
Entscheidung fehlt: Frage 8 (A-04 bis A-08, am 14. November 2026 entschieden, jetzt in
`CLAUDE.md`), Frage 9 (A-02), Frage 10 (A-09), Frage 11 (A-01),
Frage 7 (A-11), „Ebenfalls offen“ (A-13, A-14). Hier bleibt der Befund als Beleg stehen.

**Maßstab** sind die Ziele aus `CLAUDE.md`: Ein Team von 10 bis 50 Personen importiert seinen
Confluence-Space und arbeitet danach ohne Rückfall weiter; regulierte Organisationen, SaaS
zuerst, On-Prem später, gemeinsame Plattform mit TalkFieber, Betrieb auf einem VPS.

**Grundlage:** `CLAUDE.md` (Abschnitte 3, 6, 8, 11, 12), `docs/CONCEPTS.md`, `docs/ROADMAP.md`,
`docs/OPEN_QUESTIONS.md`, der Code nach dem Code-Review und eine Messung des Rechtemodells
(A-01). Was in `docs/OPEN_QUESTIONS.md` schon steht, ist hier nur verwiesen, nicht wiederholt.

## Gesamteinschätzung

Die Architektur passt zum Ziel und zur Teamgröße. Ein modularer Monolith mit drei Prozessen
und einem Worker, PostgreSQL als einzige Quelle für Struktur, Rechte und Inhalt, Rechte und
Mandantentrennung in der Datenbank statt verstreut im Code, eine Outbox statt eines
Nachrichtensystems am Anfang, Yjs als maßgeblicher Inhalt mit BlockNote-JSON daneben, nur
generisches OIDC und S3. Das ist wenig Betrieb für viel Sicherheit und lässt sich später
erweitern (NATS, OpenSearch, Zellen), ohne die Grundlagen umzubauen. Für On-Prem ist wichtig,
dass Login und Dateien nur über Standards angebunden sind; Kunden können ihren eigenen
OIDC-Dienst und S3-Speicher mitbringen.

Die Risiken liegen nicht in der Grundform, sondern in drei Stellen, die das MVP direkt
treffen:

1. **Das Rechtemodell skaliert in seiner jetzigen Form nicht auf Confluence-Größen** (A-01,
   gemessen: Seitenbaum mit 10.000 Seiten in 4–5 s, direkt nach einem Massenimport 52 s).
2. **Der Import hat zwei Lücken im Entwurf**: Rechte für Personen, die noch kein Konto haben
   (A-02), und Versionen aus Confluence, die heute einen Yjs-Zustand brauchen (A-03).
3. **Der Speicherweg des Collab-Servers** ist teurer und schwerer als nötig (A-04, A-05).

Alle drei lassen sich vor dem jeweiligen Meilenstein lösen, wenn sie jetzt eingeplant werden.

## Befunde

| ID | Schwere | Thema | Kurz | Wann |
|---|---|---|---|---|
| A-01 | Hoch | Leistung | Rechte pro Zeile: Seitenbaum mit 10.000 Seiten braucht 4–5 s, nach Massenimport 52 s | Teil 1 erledigt (0011), Rest M2–M4 |
| A-02 | Hoch | Import | Rechte für Personen ohne Konto lassen sich nicht vergeben | Entwurf vor M4 |
| A-03 | Mittel | Import | Importierte Versionen brauchen einen Yjs-Zustand | vor M4 |
| A-04 | Mittel | Collab | Alle ~2 s alles speichern: Schreiblast, WAL, Ereignisflut | M1 |
| A-05 | Mittel | Collab | BlockNote-JSON auf dem Server braucht das Editor-Schema dort | M1 |
| A-06 | Mittel | Collab | Anmeldung am Collab-Server: einfacher über das Sitzungs-Cookie | M1 |
| A-07 | Mittel | Collab | Ein Weg für Änderungen am Yjs-Dokument von der Serverseite fehlt | M1/M2 |
| A-08 | Mittel | Ereignisse | Outbox zum Collab-Server: konkret `LISTEN/NOTIFY` | M1 |
| A-09 | Mittel | Login | Mandant per Kurzname eintippen: Adressen vor dem Pilot festlegen | vor M5 |
| A-10 | Mittel | Suche | Feste Sprache `german`, Trefferfilter mit demselben Leistungsproblem | M3 |
| A-11 | Mittel | Betrieb | ClamAV und große Import-Archive fehlen in der Kapazitätsplanung | vor M3/M4 |
| A-12 | Niedrig | Betrieb | Kein Plan für Logs, Metriken und Nachverfolgung | vor M5 |
| A-13 | Niedrig | Entscheidungen | Drizzle ist entschieden, wird aber nicht genutzt | jederzeit |
| A-14 | Hinweis | Frontend | Next.js ohne Server-Logik könnte eine statische Oberfläche sein | später |

### A-01 · Hoch · Rechte pro Zeile skalieren nicht

**Befund:** Die Leseregel auf `pages` ruft `app.page_rank(id)` für jede Zeile auf, die API ruft
für den Seitenbaum zusätzlich `app.page_role(id)` pro Seite auf. `page_rank` macht dabei
jedes Mal mehrere Abfragen (Seite, Workspace-Rolle, Rechtequelle über den Pfad, Grants,
Archiv). `CLAUDE.md` nennt das als „später“-Thema. Die Messung zeigt, dass es schon bei der
Größe eines gewöhnlichen Confluence-Spaces nicht reicht.

**Messung** (Wegwerf-Datenbank mit `postgres:18.6`, Testdaten, ein Space mit Unterbereichen,
jeder 50. Bereich mit eigenen Rechten; die Abfrage der API für `GET /spaces/:key/pages`, als
Organisations-Admin; nach `ANALYZE`, alte und neue Fassung abwechselnd im selben Bestand):

| Seiten im Space | bis Migration 0010 | ab Migration 0011 (Rechtequelle über die IDs im Pfad) |
|---|---|---|
| 1.000 | 0,17 s | 0,19–0,21 s |
| 5.000 | 1,5–1,7 s | 1,2–1,3 s |
| 10.000 | 3,9–5,1 s | 2,2–2,6 s |
| 10.000, direkt nach dem Anlegen (ohne aktuelle Statistik) | 52 s | 28 s |

Eine einzelne Seite öffnen bleibt schnell (unter 1 ms). Ein einfacher Versuch, die Ränge des
ganzen Baums in einer Abfrage zu berechnen, brauchte 2,9 s; seine Ränge stimmten für alle
10.000 Seiten mit `page_rank` überein.

**Zwei Folgerungen:** Erstens bleibt auch nach dem Umbau ein Seitenbaum mit 10.000 Seiten bei
über 2 s, weil pro Seite mehrere Abfragen laufen; das ist für einen Baum, der beim Öffnen
eines Spaces lädt, zu langsam. Zweitens bricht die Leistung ohne aktuelle Statistik um eine
Größenordnung ein. Genau das passiert direkt nach einem Confluence-Import, bis Autovacuum
`ANALYZE` nachholt.

**Vorschlag:**
1. **Erledigt (Migration 0011):** Rechtequelle in `page_rank`, `perm_source` und `view_as`
   über die IDs im Pfad (Primärschlüssel statt `path @>`). Gleiche Ergebnisse, gegen die alte
   Fassung über 40.128 Kombinationen aus Seite und Person geprüft, etwa doppelt so schnell.
2. **M2/M3:** Für Listen (Seitenbaum, Suche, „Ansehen als …“, Rückverweise) eine
   mengenbasierte Funktion pro Space und Person: Workspace-Rolle, Space-Rang und den Rang
   jeder Seite mit eigenen Rechten einmal berechnen, dann jede Seite ihrer nächsten Quelle
   zuordnen. Dieselbe Logik wie `page_rank`, durch einen Test gegen `page_rank` abgesichert.
   Ziel: unter 100 ms für 10.000 Seiten.
3. **M4:** Der Import ruft nach dem Einspielen `ANALYZE` auf `pages`, `grants` und
   `page_contents` auf (als Teil des Imports im Worker).
4. **Vor M4:** entscheiden, ob dafür die schon angedachte Tabelle mit effektiven Rechten
   (vom Worker über die Ereignisse gepflegt) nötig ist.
5. **Gate:** In M2 oder M3 eine Lastprüfung „Space mit 10.000 Seiten“ neben die schon geplante
   mit 50 Bearbeitenden. Dazu im Frontend den Baum ebenenweise laden statt alles auf einmal.

### A-02 · Hoch · Import: Rechte für Personen ohne Konto

**Befund:** Der Import soll die Rechte vorher berechnen („nach dem Import sieht niemand mehr
als vorher“). Rechte an einzelne Personen setzt `app.set_grant` aber nur für aktive
Mitglieder des Workspaces, und Personen entstehen nur über eine Einladung, die erst beim
Login angenommen wird. Nach dem Import sind die meisten Personen eines Confluence-Spaces noch
gar nicht im Wiki. Ihre persönlichen Rechte, ihre Gruppenmitgliedschaften und die Autoren der
Versionen hätten keinen Halt.

**Vorschlag:** Für den Import einen zweiten, ausdrücklichen Weg für Personen vorsehen: Der
Import (bzw. später SCIM) legt Personen **ohne Login** an, mit E-Mail, Mitgliedschaft und
Rechten. Beim ersten Login verknüpft `app.accept_invite` sie schon heute über die E-Mail.
Dazu eine Sammeleinladung („alle importierten Personen einladen“). Das ändert die
Entscheidung „neue Personen nur über eine Einladung“ in „nur über eine Einladung, den Import
oder SCIM“ und gehört in E13 und `CLAUDE.md`, Abschnitt 3. Bis dahin auch klären, was mit
Confluence-Personen passiert, die es beim Kunden nicht mehr gibt (Autor ohne Konto).

### A-03 · Mittel · Import: Versionen ohne Yjs

**Befund:** `page_versions.ydoc` ist `NOT NULL`. Für jede importierte Version aus Confluence
müsste der Import also einen Yjs-Zustand erzeugen, oft Dutzende bis Hunderte pro Seite, mit
der Umwandlung aus A-05 für jede einzelne. Das macht den Import langsam und den Speicher groß,
obwohl alte Versionen fast nur angesehen werden.

**Vorschlag:** `ydoc` für Versionen der Art `import` erlauben, leer zu sein; maßgeblich ist
dann `content_json`. Erst beim Wiederherstellen einer solchen Version entsteht aus dem JSON
ein Yjs-Update. Vor M4 als Migration, mit Test.

### A-04 · Mittel · Schreiblast beim Speichern

**Befund:** `onStoreDocument` soll etwa alle 2 s pro aktiv bearbeiteter Seite den ganzen
Yjs-Zustand, das BlockNote-JSON, den Klartext und den Titel schreiben und ein `page.updated`
in die Outbox legen. Große Werte schreibt PostgreSQL dabei jedes Mal vollständig neu
(TOAST), das erzeugt viel WAL. WAL geht laufend ins externe Backup (Pflichtpunkt in
`CLAUDE.md`, Abschnitt 11). Der Worker baut für jedes Ereignis den Suchindex neu.

**Vorschlag:** In M1 trennen, was sofort gespeichert werden muss (Yjs-Zustand, mit
Hocuspocus `debounce` und `maxDebounce`), und was später reicht (JSON, Klartext, Suchindex:
der Worker, wenn sich die Seite eine Weile nicht geändert hat). `page.updated` pro Seite
zusammenfassen. Beim Lasttest in M1 die WAL-Menge pro Minute messen.

### A-05 · Mittel · BlockNote-JSON auf dem Server

**Befund:** Das BlockNote-JSON soll der Collab-Server beim Speichern schreiben, und beim
ersten Laden aus `content_json` das Yjs-Dokument bauen. Beides heißt: BlockNote mit genau dem
Schema des Browsers läuft auf dem Server (z. B. `@blocknote/server-util`), auch mit eigenen
Blöcken wie den Platzhaltern für Confluence-Makros. Weicht das Schema zwischen Browser und
Server ab, gehen Inhalte beim Umwandeln verloren.

**Vorschlag:** Das Editor-Schema als gemeinsames Paket (z. B. `packages/editor-schema`), das
Browser, Worker und Import benutzen. Die Umwandlung in den Worker legen, nicht in den
Collab-Server (passt zu A-04). Lizenz des Server-Pakets vor M1 prüfen (`check-licenses.mjs`).

### A-06 · Mittel · Anmeldung am Collab-Server

**Befund:** Geplant ist: Der Browser holt per REST ein kurzlebiges Token, `onAuthenticate`
fragt die API nach der Rolle. Das sind ein eigener Token-Endpunkt und eine API-Abfrage bei
jedem Verbindungsaufbau, wenn `grant.changed` und Co. viele Verbindungen zugleich neu
anmelden lassen.

**Vorschlag:** Der Collab-Server liegt unter derselben Adresse (`/collab`). Der Browser schickt
das Sitzungs-Cookie beim WebSocket-Handshake also ohnehin mit. Der Collab-Server prüft den
`Origin`, findet die Sitzung über `app.resolve_session` und berechnet die Rolle mit
`app.page_rank(seite, person)`; beides darf `wiki_worker` schon. Damit entfallen Token und
API-Rückfrage, und die Rechte kommen aus derselben Funktion wie überall.

### A-07 · Mittel · Änderungen am Yjs-Dokument von der Serverseite

**Befund:** Mehrere Abläufe müssen das Yjs-Dokument ändern, ohne dass ein Browser es offen
hat: eine Version wiederherstellen, Nacharbeiten nach dem Import, Titel aus der Seitenleiste
umbenennen (die API ändert Titel bewusst nie), später Vorlagen. Heute ist dafür kein Weg
beschrieben; ohne ihn lassen sich Seiten nur im Editor umbenennen.

**Vorschlag:** Einen Weg in E04 festlegen: ein interner Aufruf an den Collab-Server (nur im
Cluster erreichbar), der über Hocuspocus `openDirectConnection` ändert, sodass offene Browser
die Änderung sofort sehen. Einmal bauen, für alle Abläufe nutzen.

### A-08 · Mittel · Ereignisse zum Collab-Server

**Befund:** Siehe `docs/OPEN_QUESTIONS.md`, Frage 2. Der Collab-Server muss bei
Rechteänderungen Verbindungen trennen, NATS kommt erst mit TalkFieber.

**Vorschlag:** Ein Trigger auf `outbox` ruft `pg_notify` mit Mandant, Space und Art des
Ereignisses auf; der Collab-Server hört als `wiki_worker` mit `LISTEN` zu und prüft die
Verbindungen in diesem Space neu. Er muss dafür zu jedem offenen Dokument den Space kennen
(beim Laden mitlesen). Später ersetzt NATS nur den Transport. Den Weg der Outbox über alle
Mandanten (dort `app.claim_outbox`) braucht dann nur noch der Worker.

### A-09 · Mittel · Mandant und Adressen

**Befund:** Wer sich anmeldet, tippt heute den Kurznamen des Mandanten ein. Das ist für
Endnutzer ungewohnt, verrät, welche Kurznamen es gibt, und betrifft Adressen, Cookies, TLS
und Ingress. Später schwer zu ändern.

**Vorschlag:** Vor dem Pilot entscheiden: eine Adresse pro Mandant (`alpenwerk.wiki.<domain>`,
Wildcard-Zertifikat, Cookie pro Unterdomain) oder Erkennung über die E-Mail-Domain bzw. die
Organisationssuche von Zitadel. Gehört in E02 und M5.

### A-10 · Mittel · Suche

**Befund:** Der Suchindex nutzt fest `german` (CONCEPTS, Abschnitt 9: „Backup“ findet
„Backups“ nicht). Regulierte Organisationen schreiben oft Deutsch und Englisch gemischt.
Außerdem filtert die Leseregel jeden Treffer einzeln über `page_rank`, mit dem Problem aus
A-01.

**Vorschlag:** Zwei Vektoren (`german` und `english`) oder `simple` plus Trigramme, gewichtet
kombiniert; die Sprache pro Mandant bleibt optional. Treffer über die mengenbasierte
Sichtbarkeit aus A-01 filtern. In M3.

### A-11 · Mittel · Kapazität für Dateien und Import

**Befund:** CONCEPTS sieht einen Virenscan mit ClamAV vor; ClamAV braucht etwa 1 bis 1,5 GB
RAM und fehlt in der RAM-Tabelle in `CLAUDE.md`, Abschnitt 11. Confluence-Exporte mit
Anhängen sind oft mehrere GB groß; der Worker muss sie gestreamt entpacken und braucht
Platz auf der Platte.

**Vorschlag:** ClamAV und den Plattenplatz für Import-Archive in die Kapazitätsplanung des
VPS aufnehmen, Größengrenzen für Uploads und Importe festlegen (passt zu Frage 7 in
`docs/OPEN_QUESTIONS.md`).

### A-12 · Niedrig · Logs, Metriken, Nachverfolgung

**Befund:** M5 plant Alarme, aber kein Konzept für strukturierte Logs (heute `console.log`),
Metriken (offene Verbindungen, Dokumente im Speicher, Dauer von `store_content`, Größe der
Outbox) und eine Kennung pro Anfrage über API, Collab-Server und Worker.

**Vorschlag:** Vor M5 eine kleine Grundlage: JSON-Logs mit Anfrage-ID, ein Metrik-Endpunkt pro
Prozess, im Cluster nur intern erreichbar.

### A-13 · Niedrig · Drizzle

**Befund:** `CLAUDE.md` und CONCEPTS nennen Drizzle ORM für die API. Die API nutzt `pg` mit SQL
und ruft vor allem Funktionen im Schema `app` auf; Drizzle ist nicht installiert.

**Vorschlag:** Entscheiden und die Doku angleichen: Drizzle streichen (das Schema ist reines SQL
mit viel Logik in Funktionen, ein ORM bringt wenig) oder nur für typisierte Abfragen einführen.

### A-14 · Hinweis · Statische Oberfläche

Next.js ist bewusst nur Oberfläche, alle Seiten holen ihre Daten im Browser. Ein statischer
Export, der von Traefik ausgeliefert wird, spart den Node-Prozess (0,2–0,4 GB) und eine
Angriffsfläche. Nicht dringend; wenn später Server-Rendering für Link-Vorschauen oder
öffentliche Seiten kommt, passt Next.js als Server wieder.

## Was gut ist und bleiben sollte

- **Rechte in der Datenbank:** alle Lesepfade über dieselben Funktionen, `SECURITY DEFINER` mit
  festem `search_path`, Tests als `wiki_app`. Das ist der stärkste Teil des Entwurfs und genau
  das Verkaufsargument für regulierte Kunden.
- **Yjs maßgeblich, BlockNote-JSON daneben:** Export, Import und ein späterer Editorwechsel
  hängen nicht an Binärdaten.
- **Outbox statt Nachrichtensystem:** jetzt einfach, später NATS ohne Umbau.
- **Generisches OIDC, Sitzung in der Datenbank, keine Tokens im Browser:** gut für SSO beim
  Kunden und für On-Prem.
- **Migrationen als reines SQL mit Gleichheitsprüfung gegen `schema/`:** wenig Werkzeug, viel
  Sicherheit.
- **Mandantenmodell gleich wie TalkFieber:** die Integration (E26) ist vorbereitet.

## Nicht betrachtet

- Kosten und Preise, Rechtliches (AV-Vertrag usw., siehe `docs/OPEN_QUESTIONS.md`).
- TalkFieber selbst; nur die Schnittstellen dahin.
- Der Prototyp unter `prototype/`.
