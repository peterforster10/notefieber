# Use Cases in der Oberfläche

Was sich im Frontend schon durchklicken lässt. **Stand: 23. November 2026** (M0 abgeschlossen,
M1 mit Editor, gemeinsamem Bearbeiten, Rechten, die auch für offene Editoren sofort gelten,
Umbenennen aus der Seitenleiste und lokalen Kopien für Funklöcher; M2 mit Seitenbaum, der
ebenenweise lädt, Drag & Drop und Space-Einstellungen sowie den Blöcken im Editor: Callouts, Bilder, Code, Tabellen, Seitenlinks, Erwähnungen, Inhaltsverzeichnis). Wird nachgeführt, sobald ein neuer Ablauf in der Oberfläche dazukommt; was es
nur in Datenbank oder API gibt, steht unten unter „Noch nicht in der Oberfläche“.

**Spalte „Geprüft“:** *Browser* = am 12. November 2026 von Hand gegen die lokale Umgebung
durchgeklickt (`reviews/REVIEW_M0.md`, „Prüfung im Browser“); *Skript* = durch `scripts/check-login.mjs`
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
| Max Mustermann | `max.mustermann@alpenwerk.example` | nur Lesen in `ENTW`, sieht „Personalplanung 2027“ nicht, aber „Urlaubsplanung Vertrieb“ darunter |
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
| UC-08 | Seitenbaum auf- und zuklappen | alle | Browser (22. November 2026, jede Ebene lädt erst beim Aufklappen; Baum und Papierkorb bleiben beim Seitenwechsel und Neuladen offen) |
| UC-09 | Seite anlegen | Bearbeitende | Browser |
| UC-10 | Seite verschieben | Bearbeitende | Browser (↑), Code (↓ → ←); Drag & Drop: UC-28 |
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
| UC-22 | Titel im Editor ändern | Bearbeitende | Browser (19. November 2026; Enter im Titel: 23. November 2026) |
| UC-23 | Recht verlieren, während die Seite offen ist | alle | Browser (19. November 2026, Max verliert den Zugang zu „Release-Prozess“) |
| UC-24 | Seite im Papierkorb, während jemand schreibt | Bearbeitende | Browser (19. November 2026, mit „Wiederherstellen“) |
| UC-25 | Abmelden schließt Editoren in anderen Tabs | alle | Browser (19. November 2026, zwei Tabs) |
| UC-26 | Seite in der Seitenleiste umbenennen | Bearbeitende | Browser (19. November 2026, Editor offen) |
| UC-27 | Weiterschreiben nach einem Funkloch, auch nach Neuladen | Bearbeitende | Browser (19. November 2026, Collab-Server gestoppt) |
| UC-28 | Seite per Drag & Drop verschieben | Bearbeitende | Browser (22. November 2026; Ziehen per Skript ausgelöst, weil die Testautomatik kein natives Ziehen kann) |
| UC-29 | Space umbenennen und beschreiben | Space-Admins | Browser (22. November 2026) |
| UC-30 | Space archivieren und zurückholen | Space-Admins, Organisations-Admins | Browser (22. November 2026, Peter als Organisations-Admin in „Vertrieb“) |
| UC-31 | Blöcke einfügen (Überschriften, Listen, Tabellen, Code) | Bearbeitende | Browser (23. November 2026, /-Menü und Markdown-Kürzel, Code mit SQL-Hervorhebung, Tabelle) |
| UC-32 | Callout setzen und Art wählen | Bearbeitende | Browser (23. November 2026, Art per Tastatur gewechselt; Lesende sehen nur das Symbol) |
| UC-33 | Bild einfügen | Bearbeitende; sehen: alle mit Leserecht | Browser (23. November 2026, per Einfügen aus der Zwischenablage; Leser Max sieht es; fremde Bild-Adresse von der CSP blockiert) |
| UC-34 | Seite verlinken | Bearbeitende | Browser (23. November 2026, „[“ im Absatz und in einer Tabellenzelle) |
| UC-36 | Person erwähnen | Bearbeitende; sehen: alle mit Leserecht | Browser (23. November 2026, „@“ im Absatz; Gast Elena sieht auf „Kampagne Frühjahr“ nur „@Unbekannt“ und findet nur sich selbst) |
| UC-37 | Inhaltsverzeichnis einfügen | Bearbeitende | Browser (23. November 2026, zieht neue Überschriften sofort nach, Unterüberschriften eingerückt, Sprung zur Überschrift) |
| UC-35 | Seitenlink bleibt gültig und verrät nichts | alle | Browser (23. November 2026, Ziel umbenannt und verschoben; Max sieht bei „Personalplanung 2027“ nur „Seite nicht verfügbar“) |

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

Mit dem Dreieck vor einer Seite; das Dreieck steht nur an Seiten mit (sichtbaren) Unterseiten.
Beim Öffnen einer Seite ist der Weg zu ihr aufgeklappt. Was man auf- oder zugeklappt hat,
bleibt beim Wechsel auf eine andere Seite und beim Neuladen so, ebenso der Papierkorb (pro Space
und Tab; Abmelden vergisst es). Der Baum lädt Ebene für Ebene: zuerst
nur die oberste Ebene und die Unterseiten der Startseite, jede weitere erst beim Aufklappen
(kurz „…“). So öffnet sich auch ein Space mit Tausenden Seiten sofort.

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
als Admin dieses Bereichs; sonst erscheint eine Meldung. Mit der Maus geht es per Drag & Drop
(UC-28); die Knöpfe bleiben für Tastatur und Touch.

An Seiten, deren Elternseite die Person nicht sieht (sie stehen unter der nächsten sichtbaren
Seite, UC-14), gibt es ↑, ↓ und ← nicht: Umsortieren dort verlangt Rechte auf der unsichtbaren
Elternseite.

### UC-11 Seite in den Papierkorb legen

Papierkorb-Knopf an der Seite, Rückfrage mit Titel (und „alle Unterseiten“, falls es welche gibt) bestätigen. Die
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
gibt keine Knöpfe zum Anlegen, Verschieben oder Löschen. Archivieren und zurückholen: UC-30.

### UC-14 Nur sehen, was man sehen darf

Kein eigener Knopf, sondern eine Eigenschaft aller Ansichten: Seiten mit eigenen Rechten fehlen
für Personen ohne Zugriff im Baum, in der Brotkrume und in der API. Ein direkter Link zeigt
„Diese Seite gibt es nicht, oder sie ist für dich nicht sichtbar“. Knöpfe zum Bearbeiten
erscheinen nur mit Rolle Bearbeiten oder Admin. Darf jemand eine Seite unter einer für ihn
unsichtbaren lesen, steht sie im Baum unter der nächsten Seite, die er sieht (wie in der
Brotkrume), mit Schloss.

Zum Ausprobieren: als Lukas und als Max „Entwicklung“ → „Betrieb“ öffnen. Lukas sieht
„Personalplanung 2027“ mit „Urlaubsplanung Vertrieb“ darunter, Max nur „Urlaubsplanung
Vertrieb“, direkt unter „Betrieb“.

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
zurück ist.“ (UC-27).

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
auch für Bearbeitende nur lesbar (UC-24).

### UC-22 Titel im Editor ändern

Der Titel ist ein Eingabefeld über dem Inhalt (höchstens 255 Zeichen). Andere sehen die
Änderung sofort; Seitenbaum, Brotkrume und Adresse (`/spaces/…/pages/<titel>-<id>`) ziehen nach
spätestens 10 s nach. Umbenennen geht auch aus der Seitenleiste (UC-26). Enter im Titel fügt oben im
Inhalt eine neue, leere Zeile ein und setzt den Cursor hinein; ist die erste Zeile schon leer
(neue Seite), springt der Cursor nur dorthin. Der Titel selbst bleibt dabei unverändert.

### UC-23 Recht verlieren, während die Seite offen ist

Ändert ein Admin die Rechte, während jemand die Seite offen hat (Recht entzogen oder
herabgestuft, eigene Rechte für die Seite, Seite in einen eingeschränkten Bereich verschoben,
aus dem Workspace entfernt, deaktiviert, Space archiviert), meldet der Collab-Server die
betroffene Verbindung innerhalb weniger Sekunden neu an. Wer nur noch lesen darf, hat danach
einen schreibgeschützten Editor; wer die Seite gar nicht mehr sehen darf, sieht „Kein Zugriff mehr
auf diese Seite.“ statt des Inhalts, und die Seite verschwindet aus seinem Seitenbaum. Wer nicht
betroffen ist, merkt nichts. Einen Rechte-Dialog gibt es noch nicht (M3); zum Ausprobieren die
Rechte mit `app.set_page_inheritance` und `app.set_grant` in der Datenbank ändern.

### UC-24 Seite im Papierkorb, während jemand schreibt

Legt jemand die Seite (oder eine Seite darüber) in den Papierkorb, wird der Editor aller, die sie
offen haben, innerhalb weniger Sekunden schreibgeschützt. Bearbeitende sehen „Diese Seite liegt
im Papierkorb und kann nicht bearbeitet werden.“ mit „Wiederherstellen“; danach können sie gleich
weiterschreiben. Was bis dahin gespeichert war, bleibt erhalten. Wiederherstellen geht nur für
die Seite, die in den Papierkorb gelegt wurde, nicht für mitgelöschte Unterseiten (dann zeigt der
Hinweis den Fehler der API).

### UC-25 Abmelden schließt Editoren in anderen Tabs

Wer sich in einem Tab abmeldet, dessen Editoren in anderen Tabs schließen sich nach etwa einer
Sekunde mit „Abgemeldet. Bitte neu anmelden.“ und dem Knopf „Neu anmelden“. Abmelden löscht
außerdem alle lokalen Kopien von Seiten in diesem Browser (UC-27); was noch nicht übertragen war,
ist damit verworfen. Läuft die Sitzung
ab, schließt der Editor spätestens nach 5 Minuten (regelmäßige Prüfung im Collab-Server).

### UC-26 Seite in der Seitenleiste umbenennen

Im Seitenbaum über ✎ an der Seite (erscheint beim Darüberfahren oder per Tastatur), neuen Titel
eingeben, Enter. Nur für Bearbeitende; die Startseite benennt man im Editor um. Der neue Titel
steht sofort im Baum, in der Brotkrume und in der Adresse, und wer die Seite gerade offen hat,
sieht ihn im Editor ohne Neuladen (die API bittet den Collab-Server, den Titel im Yjs-Dokument zu
ändern). Lokal braucht das `COLLAB_INTERNAL_SECRET` in der `.env` (siehe `.env.example`), sonst
antwortet die API mit „Umbenennen ist nicht eingerichtet“.

### UC-27 Weiterschreiben nach einem Funkloch, auch nach Neuladen

Reißt die Verbindung zum Collab-Server ab, schreibt man einfach weiter; der Editor zeigt „Offline.
Änderungen werden übertragen, sobald die Verbindung zurück ist.“ und verbindet sich von selbst
neu. Jede geöffnete Seite hat dafür eine lokale Kopie im Browser (IndexedDB, pro Person und
Seite): Lädt man die Seite neu, während die Verbindung noch weg ist, wartet der Editor mit
„Collab-Server nicht erreichbar …“, und sobald er wieder da ist, kommen die Änderungen an.
Ausprobieren: Collab-Server stoppen, tippen, neu laden, Collab-Server starten. Abmelden löscht
alle lokalen Kopien (UC-25), „Kein Zugriff mehr“ die der Seite (UC-23).

## Seitenbaum und Spaces (M2)

### UC-28 Seite per Drag & Drop verschieben

Eine Seite im Baum anfassen und ziehen. Wo sie landet, zeigt der Baum beim Darüberfahren:

- obere Kante einer Seite (Linie darüber): davor, als Geschwister
- untere Kante (Linie darunter): dahinter; ist die Seite aufgeklappt, als ihre erste Unterseite
- Mitte (Rahmen): hinein, als letzte Unterseite; eine zugeklappte Seite klappt nach kurzem
  Verweilen auf
- „Startseite“: hinein in die Startseite

Der Baum zeigt das Ergebnis sofort und springt zurück, wenn die Datenbank ablehnt (z. B. aus
einem Bereich mit eigenen Rechten heraus ohne Admin-Recht, siehe UC-10). Auf sich selbst und
in die eigenen Unterseiten lässt sich nichts ablegen; die Startseite und Seiten unter
unsichtbaren Seiten lassen sich nicht ziehen. Escape bricht ab.

### UC-29 Space umbenennen und beschreiben

„Einstellungen“ unter dem Space-Umschalter (nur für Admins des Spaces und
Organisations-Admins). Name und Beschreibung ändern, „Speichern“. Der Name ändert sich sofort im
Umschalter und auf der Startseite; die Beschreibung steht in der Liste der Spaces. Der
Schlüssel (z. B. `ENTW`) bleibt fest. Im archivierten Space erst zurückholen (UC-30).
Organisations-Admins ohne Admin-Recht im Space sehen die Felder nur zum Lesen.

### UC-30 Space archivieren und zurückholen

In den Einstellungen „Space archivieren“, Rückfrage bestätigen. Danach können alle den Space
nur noch lesen (UC-13), offene Editoren werden schreibgeschützt. „Space zurückholen“ stellt die
bisherigen Rechte wieder her. Erlaubt für Admins des Spaces und Organisations-Admins, die den
Space sehen.

## Blöcke im Editor (M2)

### UC-31 Blöcke einfügen

„/“ öffnet das Menü mit allen Blöcken: Überschriften, Listen (Aufzählung, nummeriert, Aufgaben,
aufklappbar), Zitat, Callout, Link auf Seite, Tabelle, Code, Trennlinie, Bild. Tippen filtert
(„/tab“). Markdown-Kürzel gehen auch: `## ` für eine Überschrift, `- ` für eine Liste,
`[] ` für eine Aufgabe, ``` und Enter für Code. Im Code-Block wählt man oben die Sprache
(SQL, TypeScript, Shell …); die Hervorhebung ist reine Darstellung, gespeichert wird nur der Name
der Sprache.

### UC-32 Callout setzen

„/callout“ (auch „/hinweis“, „/warnung“) fügt einen Kasten ein. Links steht die Art: Info,
Hinweis, Erfolg, Warnung, Fehler; Bearbeitende wechseln sie über die Auswahl (auch mit Tab und
Pfeiltasten), Lesende sehen nur das Symbol. Entspricht den Panels in Confluence.

### UC-33 Bild einfügen

„/bild“ und „Hochladen“, oder ein Bild einfach einfügen bzw. hineinziehen. Erlaubt sind PNG,
JPEG, GIF und WebP bis 10 MB (`UPLOAD_MAX_BYTES`); die API prüft den Typ an den ersten Bytes, nicht
am Dateinamen. Das Bild liegt in Garage und gehört zur Seite: Sehen kann es nur, wer die Seite
lesen darf (`GET /api/v1/files/<id>`, sonst `404`). Bilder von fremden Adressen (z. B. aus
einer kopierten Webseite) lädt der Browser nicht; es gibt deshalb keinen Reiter „URL einbetten“.
Bis zum Virenscan (M3) muss lokal `FILES_REQUIRE_SCAN=false` in der `.env` stehen, sonst
antwortet die API für jedes Bild mit „wird geprüft“ (`409`), und es bleibt leer.

### UC-34 Seite verlinken

„[“ tippen (wie in Confluence) oder „/link auf seite“: Es öffnet sich eine Suche nach
Seitentiteln, Seiten des eigenen Spaces zuerst, andere mit Space-Schlüssel dahinter. Enter fügt
den Link ein. Gefunden wird nur, was man lesen darf; Seiten im Papierkorb und in archivierten
Spaces nicht. Klick auf den Link öffnet die Seite (Strg-Klick in neuem Tab).

### UC-35 Seitenlink bleibt gültig und verrät nichts

Der Link speichert nur die ID der Zielseite, den Titel holt der Browser jedes Mal neu
(`POST /api/v1/pages/lookup`). Nach Umbenennen oder Verschieben zeigt er den neuen Titel und
führt weiter zur Seite. Wer die Zielseite nicht lesen darf (oder wenn sie endgültig gelöscht ist),
sieht nur „Seite nicht verfügbar“, nie den Titel. Liegt sie im Papierkorb, ist der Link
durchgestrichen. Etwa 30 s nach der letzten Änderung trägt der Worker die Links in
`page_links` ein (für Rückverweise, M3).

### UC-36 Person erwähnen

„@“ tippen oder „/person erwähnen“: Es öffnet sich eine Suche nach Personen im Workspace des
Spaces (Name oder E-Mail), Enter fügt „@Name“ ein. Gespeichert wird nur die ID der Person; der
Name kommt beim Anzeigen aus `POST /api/v1/people/lookup`, ändert er sich, stimmt er überall.
Wer die Person nicht sehen darf (Gäste sehen nur sich selbst), liest „@Unbekannt“; deaktivierte
Personen sind durchgestrichen. Eine Benachrichtigung an die erwähnte Person gibt es erst mit E16.

### UC-37 Inhaltsverzeichnis einfügen

„/inhalt“ fügt ein Inhaltsverzeichnis ein. Es listet alle Überschriften der Seite, Unterüberschriften
eingerückt, und zieht neue oder geänderte Überschriften sofort nach, auch die von anderen. Klick
springt zur Überschrift. Gespeichert wird nur der Block, nicht die Liste (wie das Makro in
Confluence).

## Noch nicht in der Oberfläche

Teils in Datenbank oder API schon vorhanden, aber noch nicht klickbar:

| Was | Wann | Stand dahinter |
|---|---|---|
| Versionen ansehen und wiederherstellen | M2 | Datenbank fertig (`page_versions`, `save_version`) |
| Profil (Name, Bild, Sprache, Zeitzone), Oberfläche auf Englisch | M2 | Spalten in `users` (`display_name`, `locale`, `time_zone`, `avatar_file_id`) |
| Zuletzt besuchte Seiten | M2 | – |
| Anhänge (Dateien außer Bildern), Virenscan | M3 | Tabelle `files` mit `scan_status`; mit `FILES_REQUIRE_SCAN` liefert die API nur geprüfte Dateien aus |
| Rückverweise („Wer verlinkt hierher?“) | M3 | Worker pflegt `page_links` |
| Kommentare | M3 | Datenbank fertig (`add_comment` …) |
| Rechte-Dialog, eigene Rechte für eine Seite, Gruppen pflegen | M3 | Datenbank fertig (`set_grant`, `set_page_inheritance`, `create_group` …) |
| „Ansehen als …“ | M3 | Datenbank fertig (`app.view_as`) |
| Suche | M3 | Worker pflegt `page_search` (nach etwa 30 s Ruhe), Abfrage fehlt |
| Mitglieder eines Workspaces verwalten (Rolle ändern, entfernen) | M3 | Datenbank fertig (`set_workspace_member_role`, `remove_workspace_member`) |
| Confluence-Import, Export | M4 | Datenbank vorbereitet (`imports`, `start_import`) |
| Audit-Log, Admin-Konsole | später (E17) | Datenbank schreibt das Audit-Log schon |
