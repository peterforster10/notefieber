# TODOs

Offene Punkte aus der letzten Konsistenzprüfung. Erledigte Punkte abhaken und danach löschen;
Entscheidungen wandern in die `CLAUDE.md`.

Quelle: [REVIEW.md](REVIEW.md) vom 12. November 2026. Befund, Beleg und Fundstellen stehen
dort unter der jeweiligen ID; Punkte mit `UC-…` stammen aus [docs/USE_CASES.md](docs/USE_CASES.md).
Änderungen am Schema wie immer in `schema/` **und** als neue Migration, mit Test in
`schema_test/` und Nachtrag in `docs/SCHEMA.md`.

**Nicht hier:** Die Befunde aus [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md) (`A-01` …) stehen
mit ihrem Meilenstein in [docs/ROADMAP.md](docs/ROADMAP.md) und, wo noch eine Entscheidung fehlt,
in [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md). Diese Liste enthält nur kleine Korrekturen am
Bestehenden.

## Mit M1 (Editor und Echtzeit, E04)

- [ ] **R-12 (Niedrig):** mit dem Outbox-Publisher den Index `outbox_unpublished` auf `id` umstellen

## Mit M5 (Pilot im Cluster)

- [ ] **R-08 (Rest):** In der Datenbank `wiki` hat `PUBLIC` kein `CONNECT` mehr. Im Cluster
  (CloudNativePG) dasselbe für `postgres`, `zitadel` und später `chat`, damit sich die
  Login-Rollen der Apps nur mit ihrer eigenen Datenbank verbinden können

## Klein, jederzeit

- [ ] **D-02 (Rest):** Das ER-Diagramm (`data_model.mmd`) hat jetzt alle Spalten; `data_model.svg`
  daraus neu exportieren (z. B. mit Mermaid Live oder `@mermaid-js/mermaid-cli`)
