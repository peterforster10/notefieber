# TODOs

Offene Punkte aus der Konsistenzprüfung vom 5. November 2026. Erledigte Punkte abhaken und
danach löschen; Entscheidungen wandern in die `CLAUDE.md`.

## 3. Rest aus den Schema-Entscheidungen

„Ansehen als …“ (`app.view_as`) und das BlockNote-JSON (`content_json`) sind im Schema, in den
Tests (43, 44) und in der Doku umgesetzt. Offen sind nur noch Exporte, die ein Werkzeug brauchen:

- [ ] `docs/models/data_model/data_model.svg` und `.png` aus der aktualisierten `data_model.mmd`
  neu exportieren (neue Spalte `content_json` in `page_contents` und `page_versions`).
- [ ] `docs/MVP.pdf` aus der geänderten `docs/MVP.md` neu erzeugen (Export mit BlockNote-JSON,
  „Ansehen als …“, 44 Tests).

## 4. TalkFieber angleichen

Damit beide Produkte dieselbe Plattform teilen, müssen die TalkFieber-Dokumente zwei Dinge
übernehmen:

- [ ] **Personen pro Mandant eindeutig:** im TalkFieber-Schema
  - `UNIQUE (tenant_id, idp_subject)` statt global eindeutigem `idp_subject`
  - Datenmodell-Diagramme und Konzept-Dokument dazu anpassen
  - Dieselbe Person kann in mehreren Mandanten ein eigenes Konto haben.
- [ ] **VPS:** Formulierung auf „Hostinger KVM 4 (4 vCPU, 16 GB), ausschließlich für Wiki und
  TalkFieber“ angleichen. Außerdem festhalten, dass NATS JetStream und Valkey erst mit TalkFieber
  in den gemeinsamen Cluster kommen.
- [ ] Gleiche `tenant_id` und gleiche Rollenkonvention (App- und Worker-Rolle) gegenprüfen.
  `app.create_tenant` im Wiki übernimmt eine vorhandene Mandanten-ID.
