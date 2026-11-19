# Use Cases in der Oberfläche

Was sich im Frontend schon durchklicken lässt. **Stand: 19. November 2026** (M0 abgeschlossen,
M1 mit Editor und gemeinsamem Bearbeiten, noch ohne Trennen bei Rechteänderungen). Wird nachgeführt, sobald ein neuer Ablauf in der Oberfläche dazukommt; was es
nur in Datenbank oder API gibt, steht unten unter „Noch nicht in der Oberfläche“.

**Spalte „Geprüft“:** *Browser* = am 12. November 2026 von Hand gegen die lokale Umgebung
durchgeklickt (`REVIEW.md`, „Prüfung im Browser“); *Skript* = durch `scripts/check-login.mjs`
abgedeckt; *Code* = nur aus dem Code abgeleitet, noch nicht von Hand geklickt.

## Ausprobieren

Lokale Umgebung starten (`docker compose up -d`, dann `pnpm dev:api`, `pnpm dev:collab`, `pnpm dev:worker` und `pnpm dev:web`, siehe
[LOCAL_SETUP.md](LOCAL_SETUP.md), Abschnitt 7) und `http://localhost:3000` öffnen. Der Mandant
`alpenwerk` ist vorgeschlagen. Anmeldename ist die E-Mail, das Passwort der Testpersonen steht
in `compose.yaml` (`NF_TEST_PASSWORD`).

| Person | Anmeldename | Gut für |
|---|---|---|
| Peter Forster | `peter.forster@alpenwerk.example` | Organisations-Admin: alles, auch Einladungen und der Space `PERS` |
| Lukas Gruber | `lukas.gruber@alpenwerk.example` | Bearbeiten in `ENTW`, sieht die eingeschränkte Seite „Personalplanung 2027“ |
| Max Mustermann | `max.mustermann@alpenwerk.example` | nur Lesen in `ENTW`, sieht „Personalplanung 2027“ nicht |
| Elena Novak | `elena.novak@agentur-nord.example` | Gast im Workspace |
| Eva Fischer | `eva.fischer@nordlicht.example` | anderer Mandant (`nordlicht`); bei `alpenwerk` abgelehnt |
| Nina Neu | `nina.neu@alpenwerk.example` | gibt es nur in Zitadel: zum Ausprobieren einer Einladung |

## Übersicht

| ID | Use Case | Wer | Geprüft |
|---|---|---|---|
| UC-01 | Anmelden | alle | Browser, Skript |
| UC-02 | Hinweis bei fehlgeschlagener Anmeldung | alle | Skript |
| UC-03 | Abmelden | alle | Browser, Skript (14. November 2026, ohne Kontenauswahl) |
| UC-04 | Eigene Spaces sehen | alle | Browser |
| UC-05 | Space anlegen | Mitglieder (keine Gäste) | Browser (14. November 2026, mit zwei Workspaces) |
| UC-06 | Space wechseln | alle | Browser |
| UC-07 | Seite öffnen | alle mit Leserecht | Browser |
| UC-08 | Seitenbaum auf- und zuklappen | alle | Browser |
| UC-09 | Seite anlegen | Bearbeitende | Browser |
| UC-10 | Seite verschieben | Bearbeitende | Browser (↑), Code (↓ → ←) |
| UC-11 | Seite in den Papierkorb legen | Bearbeitende | Browser |
| UC-12 | Seite aus dem Papierkorb wiederherstellen | Bearbeitende | Browser |
| UC-13 | Archivierten Space lesen | alle mit Leserecht | Browser |
| UC-14 | Nur sehen, was man sehen darf | alle | Browser |
| UC-15 | Person einladen | Workspace-Owner und -Admins, Organisations-Admins | Browser |
| UC-16 | Einladungen ansehen und zurücknehmen | wie UC-15 | Browser |
| UC-17 | Einladung annehmen | eingeladene Person | Browser (Einladungsseite), Skript (Annehmen) |
| UC-18 | Links bleiben gültig | alle | Browser (19. November 2026, Adresse nach Umbenennen) |
| UC-19 | Seite bearbeiten | Bearbeitende | Browser (19. November 2026) |
| UC-20 | Gemeinsam bearbeiten, sehen wer da ist | alle mit Leserecht | Browser (19. November 2026, Lukas und Max in getrennten Browsern; Cursor mit Namen: Code) |
| UC-21 | Live lesen, ohne zu schreiben | Lesende, Kommentierende | Browser (19. November 2026) |
| UC-22 | Titel im Editor ändern | Bearbeitende | Browser (19. November 2026) |

## Anmelden und Abmelden

### UC-01 Anmelden

1. Auf der Startseite den Kurznamen des Mandanten eingeben (z. B. `alpenwerk`) und „Anmelden“.
2. Weiter auf die Anmeldeseite von Zitadel (nur Konten dieser Organisation), Anmeldename und Passwort.
3. Zurück in NoteFieber: „Angemeldet als … , Mandant …“, bei Organisations-Admins mit Zusatz.

Wer eine Seite ohne Anmeldung aufruft, sieht dort das Anmeldeformular und landet danach wieder
auf dieser Seite.

### UC-02 Hinweis bei fehlgeschlagener Anmeldung

Die Startseite zeigt eine verständliche Meldung, u. a. bei unbekanntem Mandanten, Konto aus einer
anderen Organisation, Konto ohne Zugang im Mandanten („Bitte eine Einladung nutzen“),
deaktiviertem Konto, zu langsamer Anmeldung, nicht erreichbarem Login-Dienst und ungültiger
oder fremder Einladung.

### UC-03 Abmelden

„Abmelden“ auf der Startseite oder unten in der Seitenleiste. Die Sitzung in NoteFieber endet
sofort, die bei Zitadel ebenfalls, ohne weiteren Klick (das ID-Token aus dem Login geht als
`id_token_hint` mit). Danach steht wieder das Anmeldeformular da. Beim nächsten Anmelden
schlägt Zitadel das bekannte Konto vor, verlangt aber das Passwort.

## Spaces

### UC-04 Eigene Spaces sehen

Nach der Anmeldung listet die Startseite alle Spaces, die die Person sehen darf, mit Name und
Schlüssel; archivierte sind markiert. Ein Klick öffnet den Space.

### UC-05 Space anlegen

Auf der Startseite unter „Neuer Space“:

1. Schlüssel (Großbuchstaben, z. B. `ENTW`) und Name eingeben.
2. Workspace wählen: Die Auswahl erscheint nur, wenn die Person in mehreren Workspaces Mitglied
   ist (ohne Gast); sonst gilt der eine.
3. Wählen, was alle im Workspace (ohne Gäste) dürfen: Lesen (vorgeschlagen), Kommentieren,
   Bearbeiten oder Nichts (nur die Person selbst als Admin).
4. „Anlegen“.

Die Person wird Admin des Spaces, eine Startseite mit dem Namen des Spaces entsteht, danach
öffnet sich der neue Space. Ein schon vergebener Schlüssel wird gemeldet. Gäste sehen das
Formular nicht, weil sie keine Spaces anlegen dürfen.

Zum Ausprobieren der Auswahl braucht es eine Person in zwei Workspaces; in den Testdaten ist
jede nur in „Alpenwerk“.

### UC-06 Space wechseln

Oben in der Seitenleiste per Auswahlliste, oder über „NoteFieber“ zurück zur Startseite.

## Seiten und Seitenbaum

### UC-07 Seite öffnen

Ein Klick im Seitenbaum öffnet die Seite. Ohne Auswahl zeigt ein Space seine Startseite
(eigener Eintrag „Startseite“ über dem Baum). Angezeigt werden Brotkrume (nur Seiten, die die
Person sehen darf), Titel, Schloss bei Seiten mit eigenen Rechten und die eigene Rolle (Lesen,
Kommentieren, Bearbeiten, Admin). Darunter der Editor mit dem Inhalt (UC-19 bis UC-22).

### UC-08 Seitenbaum auf- und zuklappen

Mit dem Dreieck vor einer Seite. Beim Öffnen einer Seite ist der Weg zu ihr aufgeklappt.

### UC-09 Seite anlegen

- „+ Neue Seite“ oben im Baum: neue Unterseite der Startseite.
- „+“ an einer Seite (erscheint beim Darüberfahren oder per Tastatur): neue Unterseite dieser Seite.

Titel eingeben, „Anlegen“ (oder Escape zum Abbrechen). Die Seite steht am Ende der Geschwister
und öffnet sich sofort.

### UC-10 Seite verschieben

Knöpfe an der Seite (beim Darüberfahren oder per Tastatur):

- ↑ / ↓: vor die vorige bzw. hinter die nächste Geschwisterseite
- →: einrücken, also unter die vorige Seite
- ←: ausrücken, also hinter die Elternseite (nicht aus der Startseite heraus)

Verschieben nimmt die Unterseiten mit. Aus einem Bereich mit eigenen Rechten heraus geht es nur
als Admin dieses Bereichs; sonst erscheint eine Meldung. Drag & Drop kommt mit M2.

An Seiten, deren Elternseite die Person nicht sieht (sie stehen oben im Baum), gibt es ↑ und ↓
nicht: Umsortieren dort verlangt Rechte auf der unsichtbaren Elternseite.

### UC-11 Seite in den Papierkorb legen

Papierkorb-Knopf an der Seite, Rückfrage mit Titel und Zahl der Unterseiten bestätigen. Die
Seite verschwindet samt Unterseiten aus dem Baum; war sie geöffnet, geht es zur Startseite. Die
Startseite selbst lässt sich nicht löschen, ebenso wenig eine Seite, unter der Seiten liegen,
die die Person nicht bearbeiten darf.

### UC-12 Seite aus dem Papierkorb wiederherstellen

„Papierkorb (n)“ unten in der Seitenleiste aufklappen, bei der Seite „Wiederherstellen“. Sie
kommt mit allen Seiten zurück, die mit ihr gelöscht wurden, an ihre alte Stelle. Den Knopf
sehen nur Bearbeitende; Lesende sehen die Liste ohne Knopf. Endgültig löschen gibt es bewusst
nicht in der Oberfläche (das macht später der Worker nach 30 Tagen).

### UC-13 Archivierten Space lesen

Ein archivierter Space zeigt „Archiviert, nur lesbar“. Alle haben dort höchstens Leserechte, es
gibt keine Knöpfe zum Anlegen, Verschieben oder Löschen. Archivieren selbst geht noch nicht in
der Oberfläche.

### UC-14 Nur sehen, was man sehen darf

Kein eigener Knopf, sondern eine Eigenschaft aller Ansichten: Seiten mit eigenen Rechten fehlen
für Personen ohne Zugriff im Baum, in der Brotkrume und in der API. Ein direkter Link zeigt
„Diese Seite gibt es nicht, oder sie ist für dich nicht sichtbar“. Knöpfe zum Bearbeiten
erscheinen nur mit Rolle Bearbeiten oder Admin.

Zum Ausprobieren: als Lukas und als Max „Entwicklung“ → „Betrieb“ öffnen.

## Einladungen

### UC-15 Person einladen

Auf der Startseite unter „Einladungen in ‚Workspace‘“ (nur für Owner und Admins des Workspaces
und für Organisations-Admins): E-Mail-Adresse eingeben, Rolle wählen (Mitglied, Admin, Gast),
„Einladen“. Der Link erscheint **einmal** und ist sieben Tage gültig; „Kopieren“ legt ihn in die
Zwischenablage. E-Mails verschickt NoteFieber noch nicht. Ist die Person schon Mitglied,
erscheint ein Hinweis.

### UC-16 Einladungen ansehen und zurücknehmen

Die Tabelle darunter zeigt die letzten Einladungen mit Rolle, Status (offen, angenommen,
abgelaufen, zurückgenommen) und Ablaufdatum. Offene lassen sich mit „Zurücknehmen“ ungültig
machen.

### UC-17 Einladung annehmen

1. Den Link öffnen (`/invite/…`): Die Seite nennt einladende Person, Workspace, Mandant, Rolle
   und die eingeladene E-Mail-Adresse.
2. „Annehmen und anmelden“: Anmeldung bei Zitadel mit dem Konto genau dieser Adresse
   (bestätigte E-Mail).
3. Danach ist die Person Mitglied des Workspaces und angemeldet.

Ein ungültiger, abgelaufener oder schon benutzter Link zeigt eine klare Meldung; eine Anmeldung
mit einem Konto für eine andere Adresse wird abgelehnt (UC-02). Ausprobieren: Peter lädt
`nina.neu@alpenwerk.example` ein, Nina öffnet den Link (das Konto gibt es nur in Zitadel).

## Adressen

### UC-18 Links bleiben gültig

Adressen haben die Form `/spaces/entw/pages/architektur-<kurze id>`. Nur die kurze ID zählt:
Ein Link mit altem Titel oder großgeschriebenem Space-Schlüssel führt auf die richtige Seite,
und die Adresse wird ohne neuen Eintrag im Verlauf korrigiert, auch nach dem Umbenennen im
Editor (UC-22).

## Editor

### UC-19 Seite bearbeiten

Wer die Seite bearbeiten darf (Rolle Bearbeiten oder Admin), schreibt direkt unter dem Titel im
Block-Editor (BlockNote, deutsche Oberfläche, Menü mit „/“). Gespeichert wird von selbst: etwa
2 s nach der letzten Änderung, spätestens nach 10 s. Klartext und Suchindex zieht der Worker
nach, wenn die Seite etwa 30 s ruht. Seiten aus den Testdaten haben ihren Inhalt schon beim
ersten Öffnen. Ist der Collab-Server nicht erreichbar, steht da „Collab-Server nicht erreichbar …“;
reißt die Verbindung später ab, „Offline. Änderungen werden übertragen, sobald die Verbindung
zurück ist.“

### UC-20 Gemeinsam bearbeiten, sehen wer da ist

Zwei Personen öffnen dieselbe Seite (zum Ausprobieren in zwei verschiedenen Browsern oder einem
privaten Fenster, sonst teilen sie sich das Sitzungs-Cookie). Was die eine tippt, sieht die
andere sofort. Rechts neben dem Titel stehen die Avatare aller, die die Seite offen haben, auch
der Lesenden; eine Person mit mehreren Tabs nur einmal. Andere Bearbeitende haben einen Cursor
mit Namen und Farbe (die Farbe hängt an der Person).

### UC-21 Live lesen, ohne zu schreiben

Mit Rolle Lesen oder Kommentieren (z. B. Max in `ENTW`) ist der Editor schreibgeschützt, und
der Titel ist kein Eingabefeld; Änderungen anderer erscheinen trotzdem sofort. Der Collab-Server
verbindet nur lesend und verwirft Änderungen, die trotzdem kommen. Seiten im Papierkorb sind
auch für Bearbeitende nur lesbar, mit dem Hinweis „Diese Seite liegt im Papierkorb …“.

### UC-22 Titel im Editor ändern

Der Titel ist ein Eingabefeld über dem Inhalt (höchstens 255 Zeichen). Andere sehen die
Änderung sofort; Seitenbaum, Brotkrume und Adresse (`/spaces/…/pages/<titel>-<id>`) ziehen nach
spätestens 10 s nach. Umbenennen aus der Seitenleiste kommt mit M1, Stück 3.

## Noch nicht in der Oberfläche

Teils in Datenbank oder API schon vorhanden, aber noch nicht klickbar:

| Was | Wann | Stand dahinter |
|---|---|---|
| Rechteentzug und Papierkorb wirken sofort auf offene Editoren, Abmelden schließt Editoren in anderen Tabs | M1 (E04-05 bis E04-07) | Collab-Server prüft Rechte bisher nur beim Verbinden |
| Umbenennen in der Seitenleiste | M1 (E04-08) | interner Aufruf an den Collab-Server fehlt noch |
| Änderungen nach einem Funkloch auch über ein Neuladen retten (IndexedDB) | M1 (E04-04) | kurze Abbrüche überbrückt der Editor schon im Speicher |
| Drag & Drop im Seitenbaum | M2 | API fertig (`/pages/:id/move`) |
| Versionen ansehen und wiederherstellen | M2 | Datenbank fertig (`page_versions`, `save_version`) |
| Kommentare | M3 | Datenbank fertig (`add_comment` …) |
| Rechte-Dialog, eigene Rechte für eine Seite, Gruppen pflegen | M3 | Datenbank fertig (`set_grant`, `set_page_inheritance`, `create_group` …) |
| „Ansehen als …“ | M3 | Datenbank fertig (`app.view_as`) |
| Suche | M3 | Worker pflegt `page_search` (nach etwa 30 s Ruhe), Abfrage fehlt |
| Space umbenennen, archivieren | offen | Datenbank fertig (`update_space`, `archive_space`) |
| Mitglieder eines Workspaces verwalten (Rolle ändern, entfernen) | offen | Datenbank fertig (`set_workspace_member_role`, `remove_workspace_member`) |
| Confluence-Import, Export | M4 | Datenbank vorbereitet (`imports`, `start_import`) |
| Audit-Log, Admin-Konsole | später (E17) | Datenbank schreibt das Audit-Log schon |
