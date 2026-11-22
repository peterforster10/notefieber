# Review M1: Code des Editors und der Echtzeit

**Momentaufnahme vom 22. November 2026** (Stand `e7a0b67`, M1 lokal abgeschlossen), wird nicht
nachgeführt. Die umsetzbaren Punkte stehen in [TODOS.md](../TODOS.md); dort abhaken und
löschen, hier bleibt der Befund als Beleg stehen. Die IDs setzen die Zählung aus
[REVIEW_M0.md](REVIEW_M0.md) fort (`R-19` …), damit sie im ganzen Projekt eindeutig bleiben.

**Umfang:** alle Commits für M1, `5fa742b..e7a0b67` (11 Commits, 64 Dateien Code und Schema,
rund 3.600 Zeilen ohne Lock-Datei und Doku):

| Bereich | Dateien |
|---|---|
| Datenbank | Migrationen `0012_split_store_content.sql`, `0013_notify_collab.sql`, die passenden Teile in `schema/`, Tests `20_content_split.sql`, `schema_concurrency_test.sh` |
| Collab-Server | `apps/collab/src/` (`server.ts`, `auth.ts`, `access.ts`, `store.ts`, `events.ts`, `internal.ts`, `db.ts`, `config.ts`, `load-test.ts`, Tests) |
| Worker | `apps/api/src/jobs/derive.ts`, `apps/api/src/worker.ts` |
| API | `POST /pages/:id/title` (`routes/spaces.ts`), `collab-client.ts`, Sitzungs-Cookie nach `packages/shared` |
| Frontend | `page-editor.tsx`, `space-view.tsx`, `page-tree.tsx` (Umbenennen), `lib/local-copies.ts`, Abmelden |
| Pakete | `packages/editor-schema` (Schema, Titel, Klartext, `/server`), `packages/shared` (`session.ts`, `internal.ts`, `events.ts`) |

Die Doku ist nicht Gegenstand dieses Reviews; die Verweise auf sie sind nur gelesen, wo der Code
sich darauf beruft. Prüfmaßstab sind die Regeln aus `CLAUDE.md` (Abschnitte 3, 6, 7 und 8).

**Vorgehen:** den Diff Datei für Datei gelesen, dazu die ganzen Funktionen, die er berührt, und
ihre Aufrufer. R-19 ist zusätzlich im Quelltext von Hocuspocus 4.8.0 nachgeprüft (Entladen ohne
Speichern, `hocuspocus-server.esm.js`, `shouldUnloadDocument`). Die übrigen Befunde stammen aus
dem Lesen des Codes und sind **nicht** mit einem Test oder im Browser belegt; vor dem Beheben
zuerst einen Test schreiben, der den Fehler zeigt.

## Gesamteinschätzung

M1 setzt die Entscheidungen aus `ARCHITECTURE_REVIEW.md` (A-04 bis A-08) sauber um. Der heiße
Pfad ist wirklich klein (`app.store_ydoc` ohne Umwandlung und ohne Ereignis), der Worker leitet
mit optimistischer Prüfung über `updated_at` ab und übergibt den Zeitstempel als Text, damit die
Mikrosekunden nicht verloren gehen. Der erste Yjs-Zustand aus BlockNote-JSON ist zwischen Worker
und Collab-Server über `store_initial_ydoc` („wer zuerst kommt, gewinnt“) entschieden. Anmeldung
und Neu-Prüfen nutzen dieselbe Regel (`access.ts`), Origin und internes Geheimnis werden
zeitkonstant bzw. exakt verglichen, alle neuen Abhängigkeiten sind fest versioniert.

Ein kritischer Befund (Datenleck, Mandantenumgehung) ist nicht dabei. Die wichtigsten Punkte:

- **R-19:** Der Titel neuer Seiten steht nur im Speicher des Collab-Servers und kann sich beim
  Wiederöffnen verdoppeln. Tritt im normalen Gebrauch auf, besonders mit den lokalen Kopien in
  IndexedDB. Vor jedem Pilot beheben.
- **R-20:** Ein kurzes Zeitfenster, in dem eine Rechteänderung offene Verbindungen nicht erreicht.
- **R-21:** Das Neu-Prüfen nach Ereignissen belastet den kleinen Pool, den auch das Speichern braucht.

Am besten R-19 sofort, R-20 und R-21 mit M2 (vor dem Pilot), den Rest bei Gelegenheit.

## Automatische Prüfungen

| Prüfung | Ergebnis |
|---|---|
| `pnpm lint`, `pnpm typecheck` | bestanden |
| `pnpm test` (ohne Datenbank) | bestanden: 16 Tests in `apps/api`, 7 in `packages/editor-schema`, 5 in `packages/shared` |
| `pnpm test:db`, `database/scripts/schema_test/ci.sh` | für dieses Review nicht ausgeführt (laufen in der CI, Jobs `api` und `database`) |
| `pnpm format:check`, `licenses:check`, `build` | für dieses Review nicht ausgeführt |
| Browser, Lasttest | nicht wiederholt; Stand aus `docs/LOCAL_SETUP.md`, Abschnitt 7 (19. November 2026) |

## Befunde

| ID | Schwere | Kategorie | Kurz |
|---|---|---|---|
| R-19 | Hoch | Korrektheit | Titel neuer Seiten nur im Speicher, verdoppelt sich beim Wiederöffnen |
| R-20 | Mittel | Sicherheit | Rechteänderung zwischen Anmelden und Laden erreicht die Verbindung nicht |
| R-21 | Mittel | Leistung | Neu-Prüfen: eine Transaktion pro Verbindung auf einem Pool mit 5 Verbindungen |
| R-22 | Niedrig | Korrektheit | Umbenennen meldet 204, obwohl nichts gespeichert wurde (Papierkorb dazwischen) |
| R-23 | Niedrig | Betrieb | Start hängt ohne Datenbank; Signal-Handler erst danach |
| R-24 | Niedrig | Korrektheit | Umbenennen erlaubt einen leeren Titel, Anlegen nicht |
| R-25 | Niedrig | Leistung | Worker wandelt bei offener Transaktion um, Seiten nacheinander |
| R-26 | Niedrig | Wartbarkeit | `withTenant` im Collab-Server dupliziert `withContext` der API |

### R-19 · Hoch · Titel neuer Seiten verdoppelt sich

**Fundstelle:** [store.ts:60](../../apps/collab/src/store.ts:60) (`loadDocument`, Zweig „Neue,
leere Seite“)

**Befund:** Hat eine Seite noch den leeren Anfangszustand (`\x0000`) und kein BlockNote-JSON,
schreibt der Collab-Server `pages.title` in `Y.Text` „title“, aber nur im Speicher. Der Kommentar
sagt es selbst: Die Änderung „speichert erst das nächste Speichern mit“. Tippt niemand, gibt es
kein nächstes Speichern: Hocuspocus 4.8 entlädt ein Dokument ohne `onStoreDocument`, wenn kein
entprelltes Speichern ansteht (`shouldUnloadDocument`). Beim nächsten Laden fügt der Server den
Titel erneut ein, als neue Einfügung mit einer anderen Client-ID. Ein Browser, der noch die alte
Einfügung hat, schickt sie beim Abgleich mit; Yjs führt beide zusammen, und weil der Browser als
Editor schreiben darf, wird das Ergebnis gespeichert.

Den alten Stand haben Browser in zwei Fällen:
- **Lokale Kopie in IndexedDB** (`nf:<person>:page:<seite>`, seit M1, Stück 3): Jede einmal
  geöffnete Seite liegt dort mit dem Stand des letzten Abgleichs.
- **Neustart des Collab-Servers** (Recreate beim Ausrollen) bei offenen Tabs: Der Browser
  verbindet sich neu, der Server lädt die Seite frisch.

**Ablauf:** Lukas legt „Protokoll“ an; die Seitenleiste öffnet die neue Seite sofort. Er tippt
nichts und schließt den Tab, das Dokument wird ohne Speichern entladen. Später öffnet er die
Seite wieder: Die lokale Kopie bringt Einfügung A, der Server hat Einfügung B, der Titel heißt
danach „ProtokollProtokoll“, in `Y.Text` und nach dem nächsten Speichern auch in `pages.title`.
Neue Seiten haben immer einen Titel (`pageTitleSchema.trim().min(1)` in `routes/spaces.ts`), der
Fall ist also der Normalfall, nicht die Ausnahme. Für den Inhalt gilt das nicht: Der Rückfall mit
`content_json` speichert sofort über `app.store_initial_ydoc`.

**Vorschlag:** Den Anfangszustand mit Titel genauso sofort sichern wie im Rückfall: im Speicher
aufbauen, mit `app.store_initial_ydoc` speichern (schreibt nur, solange noch `\x0000` steht),
bei `false` den gespeicherten Stand laden. Dann gibt es pro Seite genau eine Einfügung des
Titels. Dazu ein Test in `collab.dbtest.ts`: Seite öffnen, ohne Änderung trennen, Dokument
entladen, mit dem alten Client-Zustand neu verbinden, Titel vergleichen. Seiten, die schon
betroffen sind, lassen sich nur von Hand reparieren (Titel neu setzen); vor dem Pilot gibt es
keine echten Daten.

### R-20 · Mittel · Zeitfenster beim Neu-Prüfen

**Fundstelle:** [server.ts:65](../../apps/collab/src/server.ts:65) bis
[server.ts:80](../../apps/collab/src/server.ts:80) (`onAuthenticate`, `onLoadDocument`),
[server.ts:113](../../apps/collab/src/server.ts:113) (`connections`)

**Befund:** `recheck` sieht nur Verbindungen, deren Dokument schon in `open` steht und die
Hocuspocus schon in `doc.connections` eingetragen hat. Zwischen der Rechteprüfung in
`onAuthenticate` und diesen beiden Schritten liegen Datenbankzugriffe (`onLoadDocument` lädt den
Yjs-Zustand, im Rückfall mit Umwandlung). Kommt in dieser Zeit ein `grant.changed`,
`member.removed` oder `page.trashed`, findet `recheck` die Verbindung nicht. Sie bleibt mit der
alten Rolle offen, bis zur regelmäßigen Prüfung nach `COLLAB_RECHECK_SECONDS` (5 Minuten).
Dasselbe gilt für `endSession` beim Abmelden. Das widerspricht nicht E04-06 („spätestens 5
Minuten“), wohl aber dem Anspruch „sofort“ aus `CLAUDE.md`, Abschnitt 6.

**Ablauf:** Max öffnet eine Seite als Editor; `onAuthenticate` liefert „schreiben“. Während
`onLoadDocument` noch lädt, entzieht ein Admin das Recht. Das Ereignis kommt an, `recheck` läuft
über `open` und findet das Dokument nicht. Max schreibt danach noch bis zu 5 Minuten, und
`store_ydoc` speichert es (die Funktion prüft keine Rechte).

**Vorschlag:** Pro Space den Zeitpunkt des letzten Ereignisses merken. In `onConnect` bzw. nach
dem Laden vergleichen: Kam seit der Anmeldung ein Ereignis für den Space (oder ein Abmelden für
die Sitzung), die Verbindung sofort neu prüfen. Alternativ `open` schon in `onAuthenticate`
vorläufig füllen und Verbindungen aus `onConnect` mitzählen. Dazu ein Test in `rights.dbtest.ts`
mit künstlich verzögertem Laden.

### R-21 · Mittel · Neu-Prüfen belastet den Pool

**Fundstelle:** [server.ts:137](../../apps/collab/src/server.ts:137) (`recheck`),
[collab.ts:14](../../apps/collab/src/collab.ts:14) (Pool mit `max: 5`)

**Befund:** `recheck` öffnet für jede betroffene Verbindung eine eigene Transaktion
(`BEGIN`, `set_config`, `sessions`, `page_rank`, `COMMIT`, also fünf Rundreisen) und startet alle
gleichzeitig mit `Promise.all`. Der Pool hat fünf Verbindungen und dient auch `onStoreDocument`.
Dieselbe Person mit derselben Sitzung auf derselben Seite (zwei Tabs) wird doppelt geprüft, und
`recheckAll` läuft alle 5 Minuten über alle offenen Verbindungen.

**Ablauf:** Im Space ENTW sind 50 Personen im Editor, ein Organisations-Admin nimmt jemanden aus
einer Gruppe (`member.changed` an jeden Space der Gruppe). Es folgen 50 Transaktionen, die alle
fünf Pool-Verbindungen belegen; das Speichern wartet dahinter. Der Lasttest (50 Clients,
Speichern in rund 70 ms) hat diesen Fall nicht geprüft, dort gab es keine Ereignisse.

**Vorschlag:** Verbindungen nach (Mandant, Seite, Person, Sitzung) gruppieren und pro Mandant
eine einzige Abfrage stellen, z. B. `unnest` über die Paare mit `app.page_rank` und einem Join auf
`sessions`. Die Zahl gleichzeitiger Prüfungen begrenzen oder einen eigenen kleinen Pool dafür
nehmen. Den Lasttest um ein Ereignis während der Last erweitern.

### R-22 · Niedrig · Umbenennen meldet Erfolg ohne Speichern

**Fundstelle:** [internal.ts:59](../../apps/collab/src/internal.ts:59) bis
[internal.ts:78](../../apps/collab/src/internal.ts:78) (`renamePage`),
[store.ts:80](../../apps/collab/src/store.ts:80)

**Befund:** `renamePage` prüft den Papierkorb, ändert den Titel über die direkte Verbindung und
meldet `ok`, sobald `disconnect()` fertig ist. Liegt die Seite inzwischen im Papierkorb, lehnt
`store_ydoc` ab, und `storeDocument` schluckt den Fehler gewollt (E04-07). Die API antwortet
trotzdem mit 204; die Seitenleiste schließt das Formular, als hätte es geklappt, der Titel bleibt
aber der alte.

**Vorschlag:** Das Ergebnis des Speicherns an `renamePage` zurückgeben (z. B. eine Markierung
in `OpenDocument`, die `onStoreDocument` setzt) und dann 409 `trashed` melden.

### R-23 · Niedrig · Start ohne Datenbank

**Fundstelle:** [collab.ts:23](../../apps/collab/src/collab.ts:23) bis
[collab.ts:55](../../apps/collab/src/collab.ts:55), [events.ts:32](../../apps/collab/src/events.ts:32)

**Befund:** `collab.start()` öffnet zuerst den WebSocket-Server und wartet dann auf
`listener.ready`. Das wird erst aufgelöst, wenn `LISTEN` einmal geklappt hat; bis dahin versucht
der Listener es mit wachsendem Abstand immer wieder. Der interne Server und die Handler für
`SIGTERM` und `SIGINT` kommen erst nach diesem `await`. Ist PostgreSQL beim Start nicht
erreichbar (Neustart von CloudNativePG), nimmt der Server schon Verbindungen an, Umbenennen
liefert 503, und ein `SIGTERM` in dieser Zeit beendet den Prozess sofort, ohne die geladenen
Dokumente zu speichern (`server.destroy` läuft nicht).

**Vorschlag:** Signal-Handler vor `await collab.start()` anmelden. Auf `ready` mit Zeitlimit
warten (dann mit Fehler beenden, Kubernetes startet neu) oder den WebSocket-Server erst danach
öffnen.

### R-24 · Niedrig · Leerer Titel beim Umbenennen

**Fundstelle:** [spaces.ts:105](../../apps/api/src/routes/spaces.ts:105) (`renameBody`)

**Befund:** `renameBody` kürzt den Leerraum, verlangt aber keine Mindestlänge; das Anlegen
verlangt `pageTitleSchema.trim().min(1)`. `POST /pages/:id/title` mit `{"title": "   "}` leert
`Y.Text`, und `pages.title` wird `''`. Nur das Formular in der Seitenleiste verhindert das.
Im Editor selbst darf der Titel bewusst leer sein (Platzhalter „Ohne Titel“); dann sollte die
Regel für beide Wege gleich entschieden werden.

**Vorschlag:** Entweder `min(1)` nach dem Kürzen wie beim Anlegen, oder bewusst leere Titel
erlauben und das in `docs/CONCEPTS.md` festhalten.

### R-25 · Niedrig · Worker wandelt bei offener Transaktion um

**Fundstelle:** [derive.ts:36](../../apps/api/src/jobs/derive.ts:36) bis
[derive.ts:53](../../apps/api/src/jobs/derive.ts:53), [derive.ts:89](../../apps/api/src/jobs/derive.ts:89)

**Befund:** `derivePage` liest den Yjs-Zustand, wandelt ihn mit dem Editor ohne Oberfläche um
(CPU-lastig, bis zu 50 MB pro Seite) und ruft danach `store_derived` auf, alles in einer
Transaktion. Die Transaktion und eine Pool-Verbindung bleiben während der Umwandlung offen, und
`deriveOnce` arbeitet bis zu 100 Seiten pro Durchlauf nacheinander ab. Nach einem großen Import
liegen Suche und Export damit deutlich länger als die vorgesehenen rund 30 s hinter dem Editor.

**Vorschlag:** Yjs-Zustand ohne Transaktion lesen, außerhalb umwandeln, nur `store_derived` im
Mandanten-Kontext aufrufen; die Prüfung über `p_seen` bleibt dieselbe. Mit pg-boss (M2) mehrere
Seiten parallel, begrenzt auf die Zahl der Kerne.

### R-26 · Niedrig · Doppelter Transaktionsrahmen

**Fundstelle:** [db.ts:5](../../apps/collab/src/db.ts:5) (Collab-Server),
[db.ts:26](../../apps/api/src/db.ts:26) (API und Worker, `withContext`)

**Befund:** `withTenant` baut denselben Rahmen nach wie `withContext`: `BEGIN`, `set_config` für
`app.tenant_id` und `app.user_id`, `COMMIT` bzw. `ROLLBACK`, `release`. Ändert sich die
Konvention (weiterer Schlüssel, `statement_timeout` pro Transaktion), muss sie an zwei Stellen
gleich nachgezogen werden.

**Vorschlag:** `withContext` nach `packages/shared` verschieben (wie `assertDbRole`) und in
API, Worker und Collab-Server verwenden.

## Hinweise ohne eigenen Befund

- **Doppelter Anfangsblock:** Öffnen zwei Personen eine neue, leere Seite gleichzeitig, kann
  BlockNote in beiden Browsern einen leeren Anfangsblock anlegen; danach stehen zwei leere Absätze
  da. Bekanntes Verhalten von y-prosemirror, harmlos, beim Import und bei Vorlagen im Blick behalten.
- **Titelfeld als gesteuertes `input`:** `setTitle` rechnet die kleinste Änderung aus, damit
  gleichzeitiges Tippen erhalten bleibt. Ändert jemand anderes den Titel, springt die eigene
  Schreibmarke ans Ende. Für M1 in Ordnung, später als Y.Text-Bindung lösen.
- **Gesamtes WebSocket schließen:** `disconnect` schließt den WebSocket, nicht nur das Dokument.
  Heute hat jeder Editor seinen eigenen `HocuspocusProvider` und damit sein eigenes WebSocket;
  bei einem geteilten Socket (mehrere Dokumente pro Tab, z. B. Link-Vorschau) träfe es alle.
- **Abmelden ohne Verbindung:** Scheitert `POST /auth/logout`, bleiben die lokalen Kopien liegen
  (`clearAllLocalCopies` läuft erst danach). Restrisiko wie in `CLAUDE.md`, Abschnitt 3.
- **Deaktivieren:** `app.set_user_active` löscht die Sitzungen direkt, ohne `NOTIFY
  nf_sessions`. Die Verbindungen schließen trotzdem, weil `user.deactivated` an jeden Space der
  Person geht und das Neu-Prüfen die fehlende Sitzung bemerkt. Folgerichtig, steht aber nirgends.

## Nicht geprüft

- Die Doku-Änderungen der M1-Commits (`CLAUDE.md`, `docs/`), außer wo der Code sich darauf beruft
- Datenbanktests, API-Tests gegen die Datenbank, Build und Lizenzen (siehe „Automatische Prüfungen“)
- Verhalten im Browser und unter Last; die Befunde sind aus dem Code abgeleitet
- `apps/collab/src/load-test.ts` und die Testhelfer (`testing.ts`) nur überflogen
