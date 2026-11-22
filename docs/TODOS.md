# TODOs

Offene Punkte aus der letzten Konsistenzprüfung. Erledigte Punkte abhaken und danach löschen;
Entscheidungen wandern in die `../CLAUDE.md`.

Quellen: [REVIEW_M0.md](reviews/REVIEW_M0.md) vom 12. November 2026 (`R-01` bis `R-18`, `D-…`)
und [REVIEW_M1.md](reviews/REVIEW_M1.md) vom 22. November 2026 (`R-19` bis `R-26`). Befund,
Beleg und Fundstellen stehen dort unter der jeweiligen ID; Punkte mit `UC-…` stammen aus
[docs/USE_CASES.md](USE_CASES.md).
Änderungen am Schema wie immer in `schema/` **und** als neue Migration, mit Test in
`schema_test/` und Nachtrag in `SCHEMA.md`.

**Nicht hier:** Die Befunde aus [ARCHITECTURE_REVIEW.md](reviews/ARCHITECTURE_REVIEW.md) (`A-01` …) stehen
mit ihrem Meilenstein in [docs/ROADMAP.md](ROADMAP.md) und, wo noch eine Entscheidung fehlt,
in [docs/OPEN_QUESTIONS.md](OPEN_QUESTIONS.md). Diese Liste enthält nur kleine Korrekturen am
Bestehenden.

## Mit M2 (Worker-Jobs mit pg-boss)

- [ ] **R-20 (Mittel):** Rechteänderungen zwischen Anmelden und Laden eines Dokuments nicht
  verlieren (Ereignis pro Space merken, nach dem Laden bzw. in `onConnect` neu prüfen), mit Test
  in `rights.dbtest.ts`
- [ ] **R-21 (Mittel):** Neu-Prüfen im Collab-Server gruppieren (eine Abfrage pro Mandant statt
  einer Transaktion pro Verbindung), Gleichzeitigkeit begrenzen; Lasttest um ein Ereignis erweitern
- [ ] **R-25 (Niedrig):** Worker wandelt außerhalb der Transaktion um, mit pg-boss mehrere Seiten
  parallel
- [ ] **R-12 (Niedrig):** mit dem Outbox-Publisher (`app.claim_outbox`, `OPEN_QUESTIONS.md`,
  Frage 2) den Index `outbox_unpublished` auf `id` umstellen. In M1 nicht nötig: Der
  Collab-Server bekommt die Ereignisse über `LISTEN/NOTIFY`, nicht über die Outbox

## Mit M5 (Pilot im Cluster)

- [ ] **R-08 (Rest):** In der Datenbank `wiki` hat `PUBLIC` kein `CONNECT` mehr. Im Cluster
  (CloudNativePG) dasselbe für `postgres`, `zitadel` und später `chat`, damit sich die
  Login-Rollen der Apps nur mit ihrer eigenen Datenbank verbinden können

## Klein, jederzeit

- [ ] **R-22 (Niedrig):** Umbenennen meldet 409, wenn das Speichern wegen Papierkorb abgelehnt wurde
  (`../apps/collab/src/internal.ts`)
- [ ] **R-23 (Niedrig):** Signal-Handler im Collab-Server vor `collab.start()` anmelden, auf
  `LISTEN` mit Zeitlimit warten
- [ ] **R-24 (Niedrig):** Leeren Titel beim Umbenennen entweder ablehnen (wie beim Anlegen) oder
  bewusst erlauben und in `CONCEPTS.md` festhalten
- [ ] **R-26 (Niedrig):** `withContext` nach `../packages/shared`, im Collab-Server statt `withTenant`

- [ ] **D-02 (Rest):** Das ER-Diagramm (`data_model.mmd`) hat jetzt alle Spalten; `data_model.svg`
  daraus neu exportieren (z. B. mit Mermaid Live oder `@mermaid-js/mermaid-cli`)
