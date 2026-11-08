# TODOs

Offene Punkte aus der Konsistenzprüfung vom 5. November 2026. Erledigte Punkte abhaken und
danach löschen; Entscheidungen wandern in die `CLAUDE.md`.

## 1. TalkFieber angleichen

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
