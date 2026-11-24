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

## Aus M2, Schritt 2 (Blöcke)

- [ ] **Verwaiste Bilder:** Wird ein Bild aus dem Dokument gelöscht, bleiben Zeile in `files` und
  Objekt in Garage. Mit pg-boss ein Job, der Dateien ohne Verweis im aktuellen Inhalt und in
  keiner Version nach einer Frist löscht (`deleted_at`, danach das Objekt in Garage)
- [ ] **Bild auf eine andere Seite kopiert:** Der Bild-Block zeigt weiter auf die Datei der
  Ursprungsseite und ist nur für Personen sichtbar, die diese lesen dürfen. Beim Einfügen auf
  einer anderen Seite kopieren (neue Zeile in `files`, gleiches Objekt oder Kopie)

## Aus M2, Sprachen der Oberfläche (24. November 2026)

- [ ] **Sprache neuer Personen:** `users.locale` steht für alle neuen Personen auf `'de'`
  (Standardwert). Wer vor dem Login English gewählt hat, sieht nach dem ersten Login Deutsch bis
  zum Umschalten. Beim Annehmen der Einladung die Sprache aus dem Browser übernehmen (Cookie
  `nf_locale` oder `Accept-Language`); braucht einen Parameter in `app.accept_invite` (Schema,
  Migration, Test)
- [ ] **Meldungen der Datenbank mit Code:** Die API bildet die Texte aus `RAISE EXCEPTION` über
  `DB_RULES` (`apps/api/src/http/errors.ts`) auf Codes ab, die die Oberfläche übersetzt; ein Test
  prüft, dass jeder Text im Schema steht. Kommen viele Regeln dazu (Rechte-Dialog, Kommentare in
  M3), stattdessen einen Code aus der Datenbank liefern (`USING DETAIL` oder `HINT`), dann
  entfällt die Tabelle

## Aus M2, Web-Client nach UI-Entwurf (24. November 2026)

- [ ] **Kalter erster Aufruf nicht gemessen:** Die Messung mit 200 Blöcken (`apps/web/e2e/editor-200-blocks.spec.ts`)
  lädt mit Browser-Cache (Median 1,48 s). Einen Lauf in einem frischen Browser-Kontext ergänzen,
  spätestens im Pilot mit echter Netzlatenz (M5)
- [ ] **Browser-Prüfungen in die CI:** `apps/web/e2e/` läuft nur lokal gegen den ganzen Stack. Mit
  dem End-to-End-Test für das Gate in M3 einen Job in `.gitlab-ci.yml` mit PostgreSQL, Zitadel,
  API, Collab-Server und Produktions-Build aufsetzen und `a11y.spec.ts` mitlaufen lassen
- [ ] **Dialoge füllen:** „Versionen“ (E08), „Teilen und Rechte“ (M3) und „Exportieren“ (E14)
  öffnen vorerst nur einen Ausblick (`apps/web/src/components/page-header.tsx`); das Gerüst
  (`dialog.tsx`) ist für die echten Dialoge gedacht
- [ ] **TalkFieber nachziehen:** helle Seitenleiste und Inter stehen in dieser `CLAUDE.md`
  (Abschnitt 9), in der von TalkFieber noch nicht

## Open Source und öffentliches Repository (seit 23. November 2026)

Umgestellt sind `LICENSE` (AGPL-3.0-only), Lizenzprüfung, `SECURITY.md`, `.gitignore`, CI-Job
`secrets`, Dependabot und der Spiegel aller Branches (`CLAUDE.md`, Abschnitt 14). Offen:

- [ ] **`minimatch` (mittel, GHSA-g3hv-75wg-m249):** nur in Werkzeugen über `typescript-eslint`,
  deshalb lässt `audit` sie durch (Werkzeuge erst ab `high`). Verschwindet mit dem nächsten
  Update von `typescript-eslint`; sonst mit `pnpm audit --fix` (Override) beheben
- [ ] **Pipeline-Status zurück nach GitHub:** GitHub kennt das Ergebnis der GitLab-Pipeline
  nicht, „rote Pipeline = kein Merge“ ist deshalb eine Regel, kein Zwang. Möglich: ein letzter
  Job, der den Status über die GitHub-API an den Commit meldet (eigenes Token mit
  `statuses: write`), dann eine Schutzregel auf diesen Status
- [ ] **Images in `.gitlab-ci.yml` und `compose.yaml`** (Node, PostgreSQL, gitleaks, Zitadel,
  Garage) hält Dependabot nicht aktuell; mit jedem Meilenstein von Hand prüfen oder später
  Renovate nur dafür
- [ ] **Snippet-Matching (Option):** `scripts/check-notices.mjs` findet nur fremden Code mit
  Hinweis. Wörtlich wiedergegebene Snippets ohne Hinweis fände SCANOSS (`scanoss-py`, schickt nur
  Fingerabdrücke an die API): zuerst als Bericht ohne Rot in der wöchentlichen geplanten Pipeline,
  bekannte Fehltreffer in eine Liste, rot nur bei unverträglicher Lizenz. Vorher Grenzen der
  kostenlosen API und Version prüfen; spätestens vor dem ersten Enterprise-Teil oder einer
  Lizenzprüfung durch einen Kunden
- [ ] **TalkFieber:** `LICENSE` mit AGPL-3.0-only und dieselbe Lizenzprüfung, sobald dort Code
  entsteht (Entscheidung steht in beiden `CLAUDE.md`)
- [ ] **CLA oder DCO** vor dem ersten fremden Beitrag entscheiden (`CLAUDE.md` Abschnitt 4,
  Punkt 12), dann `CONTRIBUTING.md`

## Klein, jederzeit

