# Offene Fragen

Themen, die in [EPICS.md](EPICS.md) und [ROADMAP.md](ROADMAP.md) fehlen oder zu spät stehen (Durchsicht vom
8. November 2026, ergänzt am 14. November 2026 um die Fragen 8 bis 11 aus
[ARCHITECTURE_REVIEW.md](reviews/ARCHITECTURE_REVIEW.md); Frage 8, der Entwurf des Collab-Servers, ist am selben Tag
entschieden und steht jetzt in der `CLAUDE.md`, Abschnitte 3, 6 und 7). Jeder Punkt hat einen Vorschlag, wo er hingehört. Ist ein Punkt geklärt, wandert
er in EPICS und ROADMAP (Entscheidungen in die `CLAUDE.md`) und wird hier gelöscht. Offene Produktentscheidungen (Name, Lizenz, Zielgruppe …) stehen dagegen in der `CLAUDE.md`, Abschnitt 4.

Ohne die Fragen 1 bis 3 gibt es keinen Pilot (M5), bzw. das gemeinsame Bearbeiten (M1) bleibt
unvollständig.

---

## 1. Mandanten anlegen (Betreiber-Seite)

**Problem:** E02 sagt „Eine Organisation registriert sich“. Dafür braucht es die Organisation in
Zitadel, den Mandanten in der Datenbank (`app.create_tenant` mit `idp_org_id`) und die erste Admin
mit einem Konto in Zitadel. Die App spricht mit Zitadel aber nur über OIDC und legt dort nichts an
(`CLAUDE.md`, Abschnitt 3). Wer legt also einen neuen Kunden an?

**Offene Fragen:**
- Selbstregistrierung im SaaS oder nur durch den Betreiber (für Geschäftskunden üblich)?
- Ein eigenes Betreiber-Werkzeug mit Zugang zur Verwaltungs-API von Zitadel: Skript, CLI oder
  später eine Betreiber-Konsole? Getrennt von der App, damit die App selbst keine Rechte in Zitadel
  braucht.
- Support-Zugriff des Betreibers auf einen Mandanten: ja oder nein, und wenn ja, mit Zustimmung und
  Eintrag im Audit-Log.

**Vorschlag:** in E02; als Punkt in M5 (mindestens ein Skript, das Organisation, Mandant und erste
Admin anlegt).

## 2. Worker, Outbox und Hintergrundjobs

**Problem:** Jede Änderung schreibt ein Ereignis in die Outbox, aber kein Epic und kein Meilenstein
sagt, wer sie liest und wie die Ereignisse ankommen.

**Offene Fragen:**
- **Collab-Server:** Er muss bei `grant.changed`, `member.removed` usw. Verbindungen trennen
  (`CLAUDE.md`, Abschnitt 6). NATS kommt erst mit TalkFieber. Bis dahin `LISTEN/NOTIFY` in
  PostgreSQL, ein Aufruf vom Worker an den Collab-Server, oder liest der Collab-Server die Outbox
  selbst? **Entschieden:** `LISTEN/NOTIFY` (`CLAUDE.md`, Abschnitt 6). **Gebaut** am 19. November 2026
  (Migration `0013`, `apps/collab/src/events.ts`).
- **Mandantentrennung:** Der Worker (`wiki_worker`) unterliegt RLS und sieht ohne Mandant nichts.
  Zum Lesen der Outbox über alle Mandanten braucht es eine eigene Funktion in der Datenbank (z. B.
  `app.claim_outbox(limit)` als `SECURITY DEFINER`), oder der Worker geht Mandant für Mandant durch.
  **Muster vorhanden** (19. November 2026): `app.pages_to_derive` sieht als `SECURITY DEFINER` alle
  Mandanten, gibt nur IDs heraus und ist nur für `wiki_worker` ausführbar; gelesen und geschrieben
  wird danach im Mandanten der Seite. `app.claim_outbox` kann genauso gebaut werden.
- **Geplante Jobs mit pg-boss** (im Tech-Stack, aber nirgends geplant): Papierkorb nach 30 Tagen
  leeren, abgelaufene Sitzungen und Einladungen aufräumen, Versionen nach 10 Minuten Ruhe anlegen,
  Verlinkungen pflegen. Den Suchindex pflegt der Worker seit M1 ohne pg-boss: Er fragt alle 5 s
  `app.pages_to_derive` ab (`apps/api/src/jobs/derive.ts`); mit pg-boss in M2 neu entscheiden, ob das so bleibt. pg-boss legt ein eigenes Schema an; dafür braucht es eine
  Migration mit den passenden Rechten.

**Vorschlag:** in E04 und E08; als Punkte in M1 (Verbindungen trennen, Outbox lesen) und M2
(geplante Jobs).

## 3. AV-Vertrag schon vor dem Pilot

**Problem:** AV-Vertrag, TOMs und die Liste der Subunternehmer stehen erst in Stufe 3 (ROADMAP,
E21). Sobald Pilotkunden echte Daten mit Personenbezug einspielen, ist ein AV-Vertrag nach
Art. 28 DSGVO aber Pflicht. M5 sieht bisher nur Datenschutzerklärung und Nutzungsbedingungen vor.

**Offene Fragen:**
- Eine einfache Fassung für den Pilot selbst schreiben (Vorlagen gibt es z. B. von Bitkom und den
  Aufsichtsbehörden) oder prüfen lassen?
- Subunternehmer im Pilot: Hostinger (VPS), Anbieter des externen Backup-Speichers, E-Mail-Anbieter.
- Reichen TOMs in kurzer Form für den Pilot?

**Vorschlag:** in M5: AV-Vertrag, TOMs und Subunternehmer in einer Pilotfassung; die vollständigen
Unterlagen bleiben in E21.

## 4. Grundschutz der Anwendung fürs Internet

**Problem:** M5 sieht Firewall und Backups vor, aber nichts gegen Missbrauch der Anwendung selbst.
E21 nennt Sicherheit nur pauschal und erst für Stufe 3.

**Offene Fragen:**
- **Rate Limiting:** Login, Einladungen anlegen, öffentlicher Einladungslink, später Suche und
  Uploads. In der API, in Traefik oder beides?
- **Sicherheitsheader:** Content-Security-Policy (der Editor braucht passende Regeln), HSTS,
  `X-Content-Type-Options`, `Referrer-Policy`.
- **Abhängigkeiten:** Scan in der CI (z. B. `pnpm audit` oder ein Werkzeug aus der EU), Umgang mit
  Funden.

**Vorschlag:** eine Grundversion als Punkt in M5; der Penetrationstest bleibt in E21.

## 5. Kündigung eines Mandanten

**Problem:** E17 kennt den Mandanten-Export und das Löschen einzelner Personen (DSGVO), aber nicht
das Ende eines Kunden. Der Einkauf fragt danach.

**Offene Fragen:**
- Ablauf: Export anbieten, Frist (z. B. 30 Tage nur lesbar), dann endgültig löschen.
- Was alles gelöscht wird: Datenbank (alle Tabellen mit `tenant_id`), Dateien in Garage, die
  Organisation in Zitadel, die Outbox.
- Backups: Wie lange enthalten sie die Daten noch, und steht das im AV-Vertrag?
- Es gibt bewusst keine Funktion zum sofortigen Löschen (`CLAUDE.md`, Abschnitt 8); für ganze
  Mandanten braucht es einen eigenen, protokollierten Weg (Betreiber, nicht App).

**Vorschlag:** in E17; der Ablauf für den Pilot in M5 mitdenken (Pilotkunden steigen auch aus).

## 6. Wiederherstellung eines einzelnen Mandanten

**Problem:** Alle Mandanten liegen in einer Datenbank. Löscht ein Kunde aus Versehen etwas Großes
(oder ein Fehler beschädigt seine Daten), lässt sich nicht einfach das ganze Backup zurückspielen,
sonst verlieren alle anderen Mandanten ihre Änderungen seitdem.

**Offene Fragen:**
- Backup in eine getrennte Datenbank zurückspielen und den einen Mandanten daraus herauslösen
  (Skript über alle Tabellen mit `tenant_id`, in der richtigen Reihenfolge)?
- Was gilt für Dateien in Garage (Versionierung im Bucket)?
- Welche Zusage gibt man Kunden (RPO, RTO)?

**Vorschlag:** in E17 oder E24; ein erster Probelauf vor dem ersten zahlenden Kunden.

## 7. Kontingente

**Problem:** Weder Speicherplatz pro Mandant noch Grenzen für Uploads, Spaces oder Seiten sind
geplant. Das ist nötig für die Kosten auf dem VPS (16 GB RAM, begrenzter Speicher) und für die
Pläne in E20.

**Offene Fragen:**
- Welche Grenzen: Speicher für Dateien, Größe pro Upload (heute nur 50 MB pro Yjs-Dokument),
  Anzahl Personen, Anzahl Spaces?
- Wo prüfen: in der Datenbank (Funktionen) oder in der API; Anzeige für Organisations-Admins.
- Was passiert beim Überschreiten: nur noch lesen, Warnung, Upgrade?
- Kapazität des VPS: Der Virenscan mit ClamAV braucht etwa 1 bis 1,5 GB RAM und fehlt in der
  Tabelle in `CLAUDE.md`, Abschnitt 11; Confluence-Exporte mit Anhängen sind oft mehrere GB
  groß und brauchen beim Entpacken Platz auf der Platte (A-11).

**Vorschlag:** einfache feste Grenzen in M5; Pläne mit unterschiedlichen Grenzen in E20.

## 9. Personen beim Import (vor M4)

**Problem:** Der Import soll die Rechte vorher berechnen. Rechte an Personen setzt
`app.set_grant` aber nur für aktive Mitglieder, und Personen entstehen nur über eine Einladung
beim Login. Nach einem Import sind die meisten Personen eines Confluence-Spaces noch nicht im
Wiki; ihre Rechte, Gruppenmitgliedschaften und Autorenschaften hätten keinen Halt
([ARCHITECTURE_REVIEW.md](reviews/ARCHITECTURE_REVIEW.md), A-02).

**Offene Fragen:**
- Darf der Import (und später SCIM) Personen **ohne Login** anlegen, mit E-Mail, Mitgliedschaft
  und Rechten? `app.accept_invite` verknüpft sie beim ersten Login schon heute über die E-Mail.
- Sammeleinladung nach dem Import: alle importierten Personen auf einmal, mit Vorschau?
- Was passiert mit Confluence-Personen, die es beim Kunden nicht mehr gibt (Autor ohne Konto)?

**Vorschlag:** Ja zum Anlegen ohne Login über eine eigene Funktion für den Import; die
Entscheidung „neue Personen nur über eine Einladung“ in `CLAUDE.md`, Abschnitt 3, wird zu „über
eine Einladung, den Import oder SCIM“. In E13 und E02.

## 10. Adressen der Mandanten (vor M5)

**Problem:** Beim Anmelden tippt man den Kurznamen des Mandanten ein. Das ist für Endnutzer
ungewohnt, verrät, welche Kurznamen es gibt, und hängt mit Adressen, Cookies, TLS und Ingress
zusammen. Nach dem Pilot schwer zu ändern ([ARCHITECTURE_REVIEW.md](reviews/ARCHITECTURE_REVIEW.md),
A-09).

**Offene Fragen:**
- Eine Adresse pro Mandant (`alpenwerk.wiki.<domain>`, Wildcard-Zertifikat, Cookie pro
  Unterdomain)?
- Oder eine Adresse für alle, Mandant über die E-Mail-Domain bzw. die Organisationssuche von
  Zitadel?
- Was gilt On-Prem (dort meist nur ein Mandant)?

**Vorschlag:** in E02; Entscheidung als Punkt in M5, bevor Pilotkunden Links verschicken.

## 11. Effektive Rechte als Tabelle? (vor M4)

**Problem:** Die Leseregel auf `pages` rechnet `page_rank` pro Zeile. Gemessen braucht der
Seitenbaum eines Spaces mit 10.000 Seiten 2–3 s, direkt nach einem Massenimport ohne
`ANALYZE` 28–52 s ([ARCHITECTURE_REVIEW.md](reviews/ARCHITECTURE_REVIEW.md), A-01). Für Listen
ist in M3 eine mengenbasierte Berechnung geplant.

**Offene Fragen:**
- Reicht die mengenbasierte Berechnung für Listen, oder braucht es die in `CLAUDE.md`,
  Abschnitt 8, angedachte Tabelle mit effektiven Rechten pro Person und Seite (vom Worker über
  die Ereignisse gepflegt)?
- Wenn die Tabelle kommt: Wie lange darf sie nach einer Rechteänderung veraltet sein?

**Vorschlag:** nach der Lastprüfung in M3 entscheiden (Gate: 10.000 Seiten unter einer Sekunde).

---

## Ebenfalls offen (kleiner)

- **Erklärung zur Barrierefreiheit** für Behörden (BITV 2.0, EN 301 549), zusätzlich zu WCAG 2.2 AA
  in E15. Gehört zu E21.
- **Statusseite** für Ausfälle und Wartung, ab dem Pilot sinnvoll (M5, E22).
- **Drizzle** steht in `CLAUDE.md` (Abschnitte 3 und 10) und CONCEPTS, wird aber nicht genutzt:
  Die API schreibt SQL mit `pg` und ruft vor allem Funktionen im Schema `app` auf. Streichen oder
  nur für typisierte Abfragen einführen, dann die Doku angleichen (A-13).
- **Statische Oberfläche:** Next.js ist nur Oberfläche, alle Daten holt der Browser. Ein
  statischer Export spart den Node-Prozess (0,2–0,4 GB); Next.js als Server erst, wenn
  Server-Rendering gebraucht wird, etwa für Link-Vorschauen (A-14).
