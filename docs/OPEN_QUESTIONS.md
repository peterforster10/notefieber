# Offene Fragen

Themen, die in [EPICS.md](EPICS.md) und [ROADMAP.md](ROADMAP.md) fehlen oder zu spät stehen (Durchsicht vom
8. November 2026). Jeder Punkt hat einen Vorschlag, wo er hingehört. Ist ein Punkt geklärt, wandert
er in EPICS und ROADMAP (Entscheidungen in die `CLAUDE.md`) und wird hier gelöscht. Offene Produktentscheidungen (Name, Lizenz, Zielgruppe …) stehen dagegen in der `CLAUDE.md`, Abschnitt 4.

Die ersten drei sind dringend: Ohne sie gibt es keinen Pilot (M5), bzw. das gemeinsame Bearbeiten
(M1) bleibt unvollständig.

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
  selbst?
- **Mandantentrennung:** Der Worker (`wiki_worker`) unterliegt RLS und sieht ohne Mandant nichts.
  Zum Lesen der Outbox über alle Mandanten braucht es eine eigene Funktion in der Datenbank (z. B.
  `app.claim_outbox(limit)` als `SECURITY DEFINER`), oder der Worker geht Mandant für Mandant durch.
- **Geplante Jobs mit pg-boss** (im Tech-Stack, aber nirgends geplant): Papierkorb nach 30 Tagen
  leeren, abgelaufene Sitzungen und Einladungen aufräumen, Versionen nach 10 Minuten Ruhe anlegen,
  Suchindex und Verlinkungen pflegen. pg-boss legt ein eigenes Schema an; dafür braucht es eine
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

**Vorschlag:** einfache feste Grenzen in M5; Pläne mit unterschiedlichen Grenzen in E20.

---

## Ebenfalls offen (kleiner)

- **Erklärung zur Barrierefreiheit** für Behörden (BITV 2.0, EN 301 549), zusätzlich zu WCAG 2.2 AA
  in E15. Gehört zu E21.
- **Statusseite** für Ausfälle und Wartung, ab dem Pilot sinnvoll (M5, E22).
