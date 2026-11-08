# Epics: NoteFieber – europäische Wiki-Plattform

Diese Epics sind die Grundlage für die späteren User Stories. Architektur, Datenmodell und Entscheidungen beschreibt die `CLAUDE.md` im Wurzelverzeichnis, auf deren Abschnitte hier verwiesen wird. Die Nummern gelten nur in diesem Projekt; Verweise auf das Schwesterprojekt heißen „TalkFieber E…“.

## Rollen

| Rolle | Beschreibung |
|---|---|
| **Leser** (viewer) | Liest Seiten, sucht, exportiert, was er sehen darf |
| **Kommentierende** (commenter) | Zusätzlich Kommentare an Seiten und Textstellen |
| **Bearbeitende** (editor) | Zusätzlich Seiten anlegen, bearbeiten, verschieben, löschen |
| **Space-Admin** (admin) | Zusätzlich Rechte, Vererbung, Space-Einstellungen, Import |
| **Workspace-Admin** | Verwaltet Mitglieder eines Workspaces |
| **Organisations-Admin** | Verwaltet den Mandanten: Workspaces, SSO, Richtlinien, Abrechnung. Liest Inhalte nicht automatisch, kann Rechte aber wiederherstellen |
| **Gast** | Externe Person, sieht nur, wofür sie ausdrücklich berechtigt ist |
| **Betrieb** | Wir als Anbieter: Infrastruktur, Sicherheit, Support |

## Stufen

| Stufe | Ziel | Epics |
|---|---|---|
| **0 – Vorbereitung** | Entscheidungen, Gespräche | keine |
| **1 – Lokal entwickeln** (M0–M4) | Fundament, MVP und Import | E01–E15 |
| **2 – Demo und Pilot** (M5) | Pilotkunden auf eigenem VPS | Teile von E01 (VPS, Backups), einfache Version von E22 |
| **3 – Bereit für Geschäftskunden** | Erfüllt, was der Einkauf verlangt, SaaS und On-Prem | E03 (voll), E16–E25 |
| **4 – Ausbau** | TalkFieber, KI, Hochverfügbarkeit, Notion-Funktionen | E26–E31 |

## Vorlage für User Stories

```
Als <Rolle> möchte ich <Ziel>, damit <Nutzen>.

Abnahmekriterien:
- Gegeben … wenn … dann …
```

Jede Story verweist auf ihr Epic (z. B. `E09-03`) und gilt erst als fertig, wenn:
- Tests vorliegen.
- Mandantentrennung und Leserechte geprüft sind (RLS und `app.page_rank`).
- Die Oberfläche mit der Tastatur bedienbar ist.
- Die Texte auf Deutsch und Englisch vorhanden sind.

---

## Stufe 1 – Fundament (M0)

### E01 – Entwicklungsumgebung, Infrastruktur und Betrieb

**Ziel:** Lokal entwickeln, auf dem eigenen Server ausrollen, Daten jederzeit wiederherstellbar. Das Wiki legt dabei die Plattform an, die TalkFieber mitnutzt.

**Umfang:**
- Lokale Umgebung mit PostgreSQL 18, Zitadel und Garage (Docker Compose oder k3d)
- Hostinger-VPS mit K3s und Namespaces `staging` und `pilot` (erst in Stufe 2)
- CloudNativePG mit Datenbanken `wiki`, `zitadel` und später `chat`; Zitadel; Garage mit Bucket pro Produkt; cert-manager
- Deployments: `web` (Next.js), `api`, `collab` (eine Replik, Recreate), `worker`
- CI/CD auf GitLab (Repository auf GitHub, `main` per GitHub Action nach GitLab gespiegelt): Build, Tests, Lizenzprüfung, Ausrollen nach `staging`, Freigabe für `pilot`
- Secrets mit SOPS oder Sealed Secrets, Firewall nur 80, 443 und SSH
- Laufende Backups zu einem S3-Speicher bei einem anderen Anbieter
- Monitoring: Logs, Metriken, Alarm bei Ausfall, vollem Speicher, fehlgeschlagenem Backup, Yjs-Dokumenten über 10 MB

**Nicht enthalten:** NATS und Valkey (kommen mit TalkFieber), Umzug (E24), Hochverfügbarkeit (E28).

**Abnahmekriterien:**
- Ein frischer Server lässt sich mit einer Anleitung in unter einer Stunde aufsetzen.
- Eine Wiederherstellung auf einen beliebigen Zeitpunkt ist getestet und dokumentiert.
- Dieselben Manifeste laufen lokal und auf dem Server.

**Abhängigkeiten:** keine.

**Story-Kandidaten:** Lokales Setup mit einem Befehl starten · Ausrollen nach `staging` bei jedem Merge · Wiederherstellung proben · Alarm bei fehlgeschlagenem Backup

---

### E02 – Mandanten, Workspaces, Personen und Gruppen

**Ziel:** Eine Organisation registriert sich, lädt ihr Team ein, und legt Gruppen an, über die sie Rechte vergibt.

**Umfang:**
- Mandant mit erstem Workspace und Organisations-Admin in einer Transaktion (`app.create_tenant`), optional mit der ID aus TalkFieber
- Einladung per Link, Rollen owner, admin, member, guest pro Workspace
- Profil mit Name, Bild, Sprache, Zeitzone
- Gruppen im Wiki anlegen und pflegen, nur Organisations-Admins (`app.create_group`, `app.add_group_member` …). Datenbank fertig; API und Oberfläche kommen mit E09 in M3, zusammen mit dem Rechte-Dialog. Zitadel hat keine Gruppen; SCIM (E17) und ein Gruppen-Claim im Token (E03) kommen später als Quellen dazu
- Personen deaktivieren, aus Workspaces entfernen (persönliche Rechte fallen weg)

**Nicht enthalten:** SCIM (E17), Login über mehrere Mandanten.

**Abnahmekriterien:**
- Niemand sieht Daten eines anderen Mandanten, abgesichert durch Tests gegen RLS.
- Wer aus einer Gruppe entfernt wird, verliert sofort deren Rechte; offene Verbindungen zum Collab-Server werden neu geprüft.
- Eine Gruppe, die irgendwo letzter Admin ist, verliert ihr letztes aktives Mitglied nicht.

**Abhängigkeiten:** E01, E03.

**Story-Kandidaten:** Organisation registrieren · Team einladen · Gruppen anlegen und pflegen · Person deaktivieren · Person aus Workspace entfernen

---

### E03 – Anmeldung und SSO

**Ziel:** Sicher anmelden, später das bestehende Login der Organisation anbinden.

**Umfang:**
- Zitadel als Login-Dienst, gemeinsam mit TalkFieber (eine Organisation pro Mandant)
- Die App spricht nur generisches OIDC; Zitadel-Claims (Mandant, Person) liest die API an einer Stelle mit einstellbaren Claim-Namen
- Später: Gruppen aus einem Gruppen-Claim im Token übernehmen (Quelle `idp`, `app.sync_user_groups`), z. B. bei Entra ID
- E-Mail und Passwort, Magic Link, Passkeys, Zwei-Faktor
- Kurzlebige Tokens für die WebSocket-Verbindung zum Collab-Server
- SSO über OIDC und SAML, insbesondere Entra ID (Stufe 1 und 2 als Pilotfunktion, Stufe 3 voll)

**Nicht enthalten:** SCIM (E17).

**Abnahmekriterien:**
- Wer in TalkFieber angemeldet ist, ist es im Wiki auch (sobald TalkFieber läuft).
- Ein Logout beendet auch die Verbindung zum Collab-Server.

**Abhängigkeiten:** E01.

**Story-Kandidaten:** Anmelden per OIDC · Zwei-Faktor einrichten · Entra ID anbinden · Alle Sitzungen beenden

---

## Stufe 1 – Durchstich, MVP und Import (M1–M4)

### E04 – Echtzeit-Editor und Persistenz

**Ziel:** Mehrere Personen bearbeiten dieselbe Seite gleichzeitig, und nichts geht verloren, auch nach einem Funkloch.

**Umfang:**
- Hocuspocus mit `onAuthenticate` (Rolle über die API), `onLoadDocument`, `onStoreDocument`
- Lesende Verbindung für viewer und commenter, schreibende für editor
- Entprelltes Speichern über `app.store_content` als `wiki_worker`, mit BlockNote-JSON (`editor.document`), Klartext und Bearbeitenden
- Cursor und Anwesenheit über Yjs Awareness
- Verbindungen trennen, wenn sich Rechte ändern (`grant.changed`, `page.permissions_changed`, `member.removed`, `member.changed`, `user.deactivated`, `space.archived`)
- Bei einer neuen, leeren Seite zuerst den Titel aus `pages.title` ins Yjs-Dokument schreiben; ist `content_json` gefüllt (Testdaten, Import), das Dokument daraus bauen
- Kurze Verbindungsabbrüche lokal puffern (IndexedDB)

**Nicht enthalten:** echter Offline-Modus (E30), mehrere Collab-Instanzen (E28).

**Abnahmekriterien:**
- 20 Personen bearbeiten eine Seite gleichzeitig ohne Datenverlust (Lasttest).
- Wer das Leserecht verliert, verliert die Verbindung innerhalb von 5 Sekunden.

**Abhängigkeiten:** E01, E03.

**Story-Kandidaten:** Seite gemeinsam bearbeiten · Cursor anderer sehen · Nach Reconnect weiterarbeiten · Rechteentzug wirkt sofort

---

### E05 – Spaces

**Ziel:** Wissen ist nach Teams, Projekten oder Bereichen geordnet, wie in Confluence.

**Umfang:**
- Space mit Key, Name, Beschreibung und Startseite anlegen (`app.create_space`)
- Zugriff für alle im Workspace wählbar (keiner, lesen, kommentieren, bearbeiten)
- Space-Übersicht, archivieren (danach nur lesbar)

**Nicht enthalten:** Space-Vorlagen (E25).

**Abnahmekriterien:**
- Space-Keys sind pro Mandant eindeutig und importierte Keys bleiben erhalten.
- Archivierte Spaces sind für alle nur noch lesbar.

**Abhängigkeiten:** E02.

**Story-Kandidaten:** Space anlegen · Space finden · Space archivieren

---

### E06 – Seitenbaum und Navigation

**Ziel:** Seiten sind in einem Baum geordnet, der sich leicht umbauen lässt.

**Umfang:**
- Seiten anlegen, Unterseiten, Reihenfolge per Fractional Index
- Verschieben und Umsortieren per Drag & Drop mit ganzem Teilbaum (`app.move_page`)
- Wer eine Seite aus einem Bereich mit eigenen Rechten herausschiebt, muss dort Admin sein
- Brotkrume, zuletzt besuchte Seiten
- Rückverweise („Wer verlinkt hierher?“) über `page_links`

**Nicht enthalten:** Verschieben zwischen Spaces (später, wegen Rechten).

**Abnahmekriterien:**
- Verschieben nimmt auch eingeschränkte Unterseiten mit, die die handelnde Person nicht sieht.
- Eine Seite lässt sich nicht unter sich selbst verschieben.

**Abhängigkeiten:** E05.

**Story-Kandidaten:** Unterseite anlegen · Seite verschieben · Reihenfolge ändern · Rückverweise sehen

---

### E07 – Editor und Inhalte

**Ziel:** Schreiben fühlt sich modern an und deckt ab, was Confluence-Nutzer täglich brauchen.

**Umfang:**
- BlockNote: Überschriften, Listen, Aufgaben, Tabellen, Code, Zitate, Callouts
- Bilder und Dateien einfügen (mit E11)
- Links auf andere Seiten mit Suche beim Tippen
- Erwähnungen von Personen (Benachrichtigung erst mit E16)
- Inhaltsverzeichnis, Tastenkürzel, Markdown-Kürzel

**Nicht enthalten:** mehrspaltige Layouts und BlockNote-XL-Pakete (offene Entscheidung), Datenbanken (E29).

**Abnahmekriterien:**
- Alle Blöcke überstehen Speichern, Versionen, Export und Wiederherstellen ohne Verlust.
- Ein Seitenlink bleibt nach Umbenennen und Verschieben gültig.

**Abhängigkeiten:** E04.

**Story-Kandidaten:** Tabelle einfügen · Seite verlinken · Callout setzen · Inhaltsverzeichnis einfügen

---

### E08 – Versionen und Papierkorb

**Ziel:** Nichts geht unbemerkt verloren, jeder Stand ist nachvollziehbar.

**Umfang:**
- Automatische Version nach 10 Minuten Ruhe, manuelle Version mit Klick (`app.save_version`)
- Versionen mit Autoren anzeigen und vergleichen
- Wiederherstellen als neue Version (im Collab-Server über Yjs)
- Papierkorb für ganze Teilbäume, Wiederherstellen, endgültiges Löschen nach 30 Tagen durch den Worker

**Nicht enthalten:** Aufbewahrungsrichtlinien (E17).

**Abnahmekriterien:**
- Wiederherstellen ändert keine alte Version, die Historie bleibt linear.
- In den Papierkorb kann nur, wer den ganzen Teilbaum bearbeiten darf.

**Abhängigkeiten:** E04, E06.

**Story-Kandidaten:** Versionen ansehen · Zwei Versionen vergleichen · Version wiederherstellen · Seite löschen und zurückholen

---

### E09 – Rechte

**Ziel:** Jede Seite ist genau für die Richtigen sichtbar, und das lässt sich verstehen und nachvollziehen.

**Umfang:**
- Rollen viewer, commenter, editor, admin für Personen, Gruppen und „Alle im Workspace“
- Rechte auf dem Space, an Seiten vererbt
- Vererbung kappen (kopiert bisherige Rechte, macht die handelnde Person zum Admin), danach einschränken
- Anzeige „Erbt Rechte von …“ bzw. Schloss-Symbol
- Wiederherstellung durch Organisations-Admins, im Audit-Log festgehalten
- **„Ansehen als …“:** Space-Admins sehen eine Seite, den Baum oder die Suche so, wie eine bestimmte Person sie sieht. In der Datenbank fertig: `app.view_as(space, person, actor)` liefert Struktur und Rolle der Person (keine Inhalte), nur für Admins des Spaces und Organisations-Admins, ohne Seiten mit eigenen Rechten, die die handelnde Person nicht verwaltet, jeder Aufruf im Audit-Log. Offen sind API und Oberfläche; die Suche „als …“ filtert die API auf die Seiten mit Rolle
- „Alle im Workspace“ höchstens Bearbeiten, Admins immer namentlich oder als Gruppe
- Eine zentrale Rechte-Funktion (`app.page_rank`) für alle Lesepfade

**Nicht enthalten:** Freigaben nach außen (E18).

**Abnahmekriterien:**
- Baum, Suche, Links, Kommentare, Versionen, Dateien und Export zeigen nichts ohne Leserecht. Durch Tests abgesichert.
- Jeder Space und jede eingeschränkte Seite behält mindestens einen wirksamen Admin (aktive Person oder Gruppe mit aktivem Mitglied).
- Ein Space-Admin prüft nach einem Import mit „Ansehen als“, dass niemand mehr sieht als in Confluence.

**Abhängigkeiten:** E02, E05, E06.

**Story-Kandidaten:** Space für eine Gruppe freigeben · Seite einschränken · Sehen, wer Zugriff hat · Space als eine bestimmte Person ansehen · Rechte als Organisations-Admin wiederherstellen

---

### E10 – Kommentare

**Ziel:** Rückfragen und Abstimmungen passieren direkt an der Seite.

**Umfang:**
- Kommentare an Textstellen (verankert über relative Yjs-Positionen) und an der Seite
- Antworten eine Ebene tief, Thread als erledigt markieren, Antwort öffnet wieder
- Eigene Kommentare bearbeiten (`app.edit_comment`)
- Löschen überschreibt den Inhalt, fremde Kommentare nur durch Admins der Seite (bei eingeschränkten Seiten deren Admins, sonst Space-Admins)
- Keine neuen Kommentare auf Seiten im Papierkorb

**Nicht enthalten:** Benachrichtigungen (E16).

**Abnahmekriterien:**
- Ein Kommentar bleibt an seiner Textstelle, auch wenn davor Text eingefügt wird.
- Gelöschte Kommentare sind auch in der Datenbank ohne Inhalt.

**Abhängigkeiten:** E04, E09.

**Story-Kandidaten:** Textstelle kommentieren · Antworten · Thread erledigen · Kommentar löschen

---

### E11 – Dateien und Bilder

**Ziel:** Anhänge und Bilder sind sicher abgelegt und nur für Berechtigte abrufbar.

**Umfang:**
- Hochladen direkt in Garage über signierte URLs
- Virenscan vor der Freigabe, Vorschau für Bilder und PDFs
- Anhänge-Liste pro Seite
- Download nur über kurzlebige, signierte URLs nach Rechteprüfung

**Nicht enthalten:** Office-Bearbeitung (E31), Suche im Dateiinhalt.

**Abnahmekriterien:**
- Dateien sind ohne Leserecht auf die Seite nicht abrufbar, auch nicht über erratene URLs.
- Infizierte Dateien werden blockiert und gekennzeichnet.

**Abhängigkeiten:** E01, E09.

**Story-Kandidaten:** Bild einfügen · Anhang hochladen · Anhang herunterladen · Blockierte Datei erkennen

---

### E12 – Suche

**Ziel:** Wissen lässt sich finden, auch Jahre später.

**Umfang:**
- Volltext über Titel und Inhalt (`tsvector`, Titel stärker gewichtet), `pg_trgm` für Tippfehler
- Filter nach Space, Autor, Zeitraum
- Schnellsuche nach Titeln beim Tippen
- Index vom Worker gepflegt, damit OpenSearch später ohne Umbau dazukommen kann

**Nicht enthalten:** Suche in Dateiinhalten, gemeinsame Suche mit TalkFieber (E26).

**Abhängigkeiten:** E04, E09.

**Abnahmekriterien:**
- Die Suche liefert nur Seiten mit Leserecht.
- Antwort unter einer Sekunde bei 100.000 Seiten pro Mandant (Zielwert).

**Story-Kandidaten:** Nach Stichwort suchen · Nach Space filtern · Seite beim Tippen finden

---

### E13 – Confluence-Import

**Ziel:** Ein Confluence-Space zieht vollständig und nachvollziehbar um. Das ist das Feature, das Kaufentscheidungen trifft.

**Umfang:**
- Space-Export (HTML bzw. XML) hochladen, nur durch Space-Admins (`app.start_import`)
- Probelauf mit Bericht: übernommen, als Platzhalter, übersprungen
- Hierarchie, Inhalte, Anhänge, Versionen (optional), Erstellende und Datum
- Rechte übersetzen: eingeschränkte Seiten werden Seiten mit gekappter Vererbung, Confluence-Gruppen werden Gruppen im Wiki zugeordnet oder neu angelegt (Quelle `import`)
- Die häufigsten Makros (aus echten Exporten gezählt) in BlockNote-Blöcke übersetzen, Rest als sichtbarer Platzhalter-Block mit Originalinhalt
- Interne Links umschreiben über `import_items`
- Import wiederholbar und vollständig rückgängig machbar

**Nicht enthalten:** laufender Abgleich mit Confluence, Import aus Confluence Cloud über die API (später), Import aus Notion.

**Abnahmekriterien:**
- Ein echter Pilot-Space wird vom Kunden als vollständig abgenommen.
- Der Bericht nennt jedes nicht vollständig übernommene Element.
- Nach dem Import sieht niemand mehr als in Confluence.

**Abhängigkeiten:** E05–E11.

**Story-Kandidaten:** Export hochladen · Probelauf prüfen · Gruppen zuordnen · Import ausführen · Import rückgängig machen

---

### E14 – Export und Audit-Log

**Ziel:** Die Daten gehören dem Kunden, und wichtige Aktionen sind nachvollziehbar.

**Umfang:**
- Export einer Seite, eines Teilbaums oder eines Spaces als Markdown plus BlockNote-JSON plus Anhänge (ZIP), ohne Support-Ticket. Markdown zum Lesen und Weiterverwenden, BlockNote-JSON verlustfrei für den Re-Import und einen späteren Editorwechsel. Grundlage ist `page_contents.content_json` (bei alten Versionen `page_versions.content_json`); fehlt es, wandelt der Worker den Yjs-Zustand um
- Export enthält nur, was die Person lesen darf
- Audit-Log für Rechte, Vererbung, Papierkorb, Verschieben, Import, Export, „Ansehen als …“, Löschen fremder Kommentare

**Nicht enthalten:** PDF-, Word- und ODT-Export (offene Entscheidung zu BlockNote XL), Audit-Ansicht für Admins (E17).

**Abnahmekriterien:**
- Ein exportierter Space lässt sich wieder importieren, ohne Inhalt zu verlieren.
- Das Audit-Log ist für die App nicht änderbar oder löschbar.

**Abhängigkeiten:** E07, E09, E11.

**Story-Kandidaten:** Space exportieren · Seite als Markdown herunterladen · Export im Audit-Log sehen

---

### E15 – Web-Client

**Ziel:** Die Oberfläche ist im Alltag schnell, ruhig und vertraut für Confluence-Umsteiger.

**Umfang:**
- Next.js als reine Oberfläche, Daten nur über die API
- Seitenleiste mit Space-Umschalter und Seitenbaum, Kopfbereich mit Brotkrume und Anwesenheit, Kommentarspalte
- Designsystem gemeinsam mit TalkFieber (IBM Plex, Farben aus der TalkFieber-`CLAUDE.md`)
- Tastaturbedienung, WCAG 2.2 AA, Deutsch und Englisch, responsiv bis Tablet

**Nicht enthalten:** Mobile-Apps (E30).

**Abnahmekriterien:**
- Eine Seite mit 200 Blöcken ist in unter zwei Sekunden bearbeitbar.
- Die Kontrastwerte bestehen die Prüfung.

**Abhängigkeiten:** E04–E12.

**Story-Kandidaten:** Seitenbaum · Seitenansicht · Rechte-Dialog · Import-Assistent · Sprache wechseln

---

## Stufe 3 – Bereit für Geschäftskunden

### E16 – Benachrichtigungen

**Ziel:** Wer betroffen ist, erfährt es, ohne überflutet zu werden.

**Umfang:** Seiten und Spaces beobachten, Benachrichtigung bei Erwähnung, Kommentar, Antwort und Änderung, E-Mail-Zusammenfassung, Einstellungen pro Person. Später auch als Nachricht in TalkFieber (E26).

**Abnahmekriterien:** Niemand wird über Seiten benachrichtigt, die er nicht lesen darf.

**Abhängigkeiten:** E07, E09, E10.

---

### E17 – Administration und Compliance

**Ziel:** Organisationen kontrollieren die Plattform und erfüllen ihre Pflichten.

**Umfang:** Admin-Konsole für Personen, Gruppen, Workspaces und Spaces · SCIM · Aufbewahrungsrichtlinien · Audit-Log mit Ansicht und Export · Mandanten-Export · DSGVO-Auskunft und -Löschung · Richtlinien (wer darf Spaces anlegen, wer exportieren).

**Abnahmekriterien:** Jede Admin-Aktion steht im Audit-Log. Eine Löschung entfernt Inhalte auch aus Versionen, Suchindex und Dateien.

**Abhängigkeiten:** E02, E03, E14.

---

### E18 – Gäste und Freigaben nach außen

**Ziel:** Sicher mit Partnern und Kunden zusammenarbeiten.

**Umfang:** Gäste mit Rechten nur auf einzelne Spaces oder Seiten · Ablaufdatum · deutliche Kennzeichnung · Richtlinie, wer Externe einladen darf · später öffentliche Lese-Links mit Ablauf und Passwort.

**Abnahmekriterien:** Gäste sehen keine Personenliste, keine Spaces und keine Suchtreffer außerhalb ihrer Freigaben.

**Abhängigkeiten:** E09, E17.

---

### E19 – Integrationen und API

**Ziel:** Das Wiki fügt sich in bestehende Werkzeuge ein.

**Umfang:** öffentliche REST-API mit eingeschränkten Tokens · Webhooks · Einbettungen (Video, Diagramme, Git-Repos) · Jira-Verweise als Ersatz für das Jira-Makro · Kalender.

**Abnahmekriterien:** API-Tokens halten sich an dieselben Rechte wie Personen und lassen sich widerrufen.

**Abhängigkeiten:** E09.

---

### E20 – Abrechnung und Pläne

**Ziel:** Kunden buchen, testen und bezahlen selbst. Gemeinsam mit TalkFieber (TalkFieber E18) bauen.

**Umfang:** Pläne, Testphase, Abrechnung pro aktiver Person, EU-Umsatzsteuer, EU-Zahlungsanbieter (z. B. Mollie), Paketpreis Wiki + Chat, Lizenzschlüssel für On-Prem.

**Abnahmekriterien:** Rechnungen sind für B2B-Kunden in allen EU-Ländern korrekt. Ein Downgrade verliert keine Daten.

**Abhängigkeiten:** E02.

---

### E21 – Sicherheit und Zertifizierung

**Ziel:** Der Einkauf von Geschäftskunden und Behörden kann zustimmen.

**Umfang:** Verschlüsselung der gespeicherten Daten, Penetrationstest, Abhängigkeits-Scans, TOMs, AV-Vertrag, Subunternehmer, Vorbereitung ISO 27001 und ggf. BSI C5, Sicherheitsseite. Gemeinsam mit TalkFieber E19.

**Abnahmekriterien:** Penetrationstest ohne kritische offene Befunde, Unterlagen für Einkaufsfragebögen liegen vor.

**Abhängigkeiten:** E01, E17.

---

### E22 – Onboarding und Hilfe

**Ziel:** Neue Teams und Confluence-Umsteiger sind in Minuten arbeitsfähig.

**Umfang:** geführter Start (erster Space, Einladungen, Import anbieten), Einführung für Confluence-Umsteiger („Was heißt hier wie?“), Hilfe-Center, Support-Kontakt.

**Abnahmekriterien:** Ein neues Team legt ohne Hilfe einen Space an, schreibt eine Seite und schränkt eine Unterseite ein (Nutzertest mit 5 Personen).

**Abhängigkeiten:** E15.

---

### E23 – Self-Hosting-Paket

**Ziel:** Confluence-Data-Center-Kunden, die on-prem bleiben wollen, betreiben das Wiki selbst.

**Umfang:** Helm-Chart aus den bestehenden Manifesten · externes PostgreSQL und S3 anbindbar · beliebiger OIDC-Anbieter (Entra ID, Keycloak) statt Zitadel · Update-Kanal mit rückwärtskompatiblen Migrationen · Lizenzschlüssel · Backup- und Wiederherstellungsanleitung · Betrieb ohne Telemetrie.

**Abnahmekriterien:** Ein Admin installiert das Wiki an einem Nachmittag auf einem vorhandenen Kubernetes. Ein Update um eine Version läuft ohne Ausfall der Daten.

**Abhängigkeiten:** E01, E03, E20.

---

### E24 – Umzug zu zertifiziertem Hosting

**Ziel:** Vor dem ersten zahlenden Geschäftskunden laufen Wiki und TalkFieber bei einem zertifizierten EU-Anbieter. Ein gemeinsamer Umzug mit TalkFieber E24.

**Umfang:** Anbieter wählen (Hetzner, STACKIT oder IONOS), Cluster mit mehreren Knoten, PostgreSQL mit Replikat, Umzug per Backup, AV-Vertrag umstellen.

**Abnahmekriterien:** Umzug ohne Datenverlust, Wiederherstellung beim neuen Anbieter getestet, Ausfall eines App-Knotens ohne Unterbrechung.

**Abhängigkeiten:** E01, E21.

---

### E25 – Vorlagen und Seiteneigenschaften

**Ziel:** Ersatz für die Confluence-Funktionen, die Teams am meisten vermissen.

**Umfang:** Seiten- und Space-Vorlagen (Besprechungsnotiz, Entscheidung, Anleitung) · Seiteneigenschaften als Block und Übersicht über alle Seiten mit diesen Eigenschaften · Labels · Unterseiten-Liste als Block.

**Abnahmekriterien:** Die beim Import gezählten häufigsten Makros zu Seiteneigenschaften und Unterseiten-Listen werden ohne Platzhalter übernommen.

**Abhängigkeiten:** E07, E13.

---

## Stufe 4 – Ausbau

### E26 – Integration mit TalkFieber

**Ziel:** Wiki und Chat fühlen sich wie ein Produkt an.

**Umfang:** Wiki-Links im Chat mit Vorschau (gegen Wiki-Rechte geprüft) · Benachrichtigungen aus dem Wiki als Chat-Nachricht · „Über diese Seite sprechen“ öffnet ein mit der Seite verknüpftes Topic · „Topic als Seite sichern“ übernimmt eine erledigte Diskussion als Entscheidungsprotokoll · gemeinsame Suche · Wiki-Events über NATS (`t.{tenant}.wiki.*`).

**Abnahmekriterien:** Eine Link-Vorschau im Chat verrät nichts über Seiten, die die lesende Person nicht sehen darf.

**Abhängigkeiten:** TalkFieber M3, E09, E16.

---

### E27 – KI-Funktionen

**Ziel:** Schneller zum Wissen, ohne Daten aus der EU zu geben.

**Umfang:** Seite zusammenfassen, Fragen an einen Space mit Quellenangabe (nur aus lesbaren Seiten), Schreibhilfe, europäisches Modell (z. B. Mistral) in der EU, pro Mandant abschaltbar.

**Abnahmekriterien:** Antworten nutzen nur Seiten, die die fragende Person lesen darf. Keine Kundendaten verlassen die EU.

**Abhängigkeiten:** E09, E12, E17.

---

### E28 – Hochverfügbarkeit und Skalierung

**Ziel:** Ausfälle überstehen und mit großen Kunden wachsen.

**Umfang:** mehrere Collab-Instanzen (Hocuspocus-Redis-Erweiterung mit Valkey oder Routing nach Dokument-ID) · Tabelle mit effektiven Rechten statt Berechnung pro Zeile · OpenSearch · mehrere Zonen · Zellen-Architektur für große Kunden.

**Abnahmekriterien:** Der Ausfall einer Collab-Instanz kostet keine Änderungen. Eine neue Zelle steht in unter einem Tag.

**Abhängigkeiten:** E24.

---

### E29 – Datenbanken und Tabellen-Ansichten

**Ziel:** Der Schritt Richtung Notion, wenn Kunden danach fragen.

**Umfang:** strukturierte Sammlungen mit Eigenschaften, Tabellen-, Board- und Kalenderansicht, Filter.

**Abhängigkeiten:** E07, E25.

---

### E30 – Mobile-Apps und Offline-Lesen

**Ziel:** Unterwegs lesen, kommentieren und kurz bearbeiten.

**Umfang:** Apps für iOS und Android (Technologie offen, idealerweise gemeinsam mit TalkFieber E21), Offline-Lesen markierter Spaces, Push ohne Inhalt.

**Abhängigkeiten:** E04, E15.

---

### E31 – Integration mit Nextcloud, Office und openDesk

**Ziel:** Ein guter Wiki-Baustein für Organisationen, die Microsoft 365 verlassen.

**Umfang:** Dateien aus Nextcloud einbetten statt hochladen (mit Rechteprüfung), Office-Dokumente in OnlyOffice oder Collabora öffnen, gleiches SSO, Anbindung an openDesk.

**Abhängigkeiten:** E03, E11, E19.

---

## Reihenfolge für den Start

Meilensteine und Übergangskriterien stehen in der `ROADMAP.md`.

1. **E01, E02, E03** parallel, weil alles darauf aufbaut (M0). Fürs Gate von M0 vorgezogen: Spaces anlegen und Seitenbaum aus **E05** und **E06**.
2. **E04** früh fertigstellen und mit Lasttests absichern (M1).
3. **E05, E06, E07, E08** zusammen mit **E15** Stück für Stück (M2). Ab hier selbst nutzen.
4. **E09, E10, E11, E12, E14** schließen das MVP ab (M3), dazu die Gruppenpflege aus **E02** (mit dem Rechte-Dialog). Rechte zuerst, weil der Import sie braucht.
5. **E13** Confluence-Import (M4).
6. **Stufe 2:** Pilot auf dem VPS mit den VPS- und Backup-Teilen von E01 und einer einfachen Version von E22 (M5).
7. **Stufe 3** nach Rückmeldung der Pilotkunden. **E17, E21, E24** sind Voraussetzung für zahlende Geschäftskunden, **E23** für On-Prem-Kunden.
