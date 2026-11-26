# Seite mit Seitenbaum, Kommentaren und Rechten — design reference

Klickbarer Prototyp der Seitenansicht. **Stand: Web-Client vom 25. November 2026** (helle
Seitenleiste, Inter, Kopfbereich mit Brotkrume, Byline, Blöcke wie im Editor). Grundlage für die
Überarbeitung der Oberfläche: Was hier geändert wird, lässt sich 1:1 ins Frontend übertragen, weil
Klassennamen (`nf-…`) und Farb-Tokens dieselben sind wie in `apps/web/src/app/globals.css`.

Treat it as a REFERENCE MOCKUP, not production code: the markup and styles carry the design's
values (colors, font sizes, spacing, radii, shadows, layout).

## Inhalt

- `Main.dc.html` — the artboard (a Design Component: an `<x-dc>` template + a small logic class).
  Styles live in the `<helmet><style>` block (tokens on `:root`, same class names as the frontend),
  test data in the script (Alpenwerk from `database/scripts/seed/seed.sql`, signed in as Peter Forster).
- `support.js`, `vendor/react*.js` — the runtime that renders the component; not part of the design.
- `../fonts/` — Inter (variabel) und IBM Plex Mono als woff2 aus `@fontsource` (OFL-1.1, Lizenzen daneben).
- `../brand/` — Logo-Entwürfe (`Logo.html` zum Vergleichen); das graue „NF“ ist in Seitenleiste, Import und als Browser-Icon eingesetzt.

## Was wie im Frontend ist

- Seitenleiste: Logo und Mandant, Space-Umschalter (Menü mit allen Spaces, „⋯“ → Einstellungen, Archivieren),
  Seitenbaum mit „Startseite“, Aufklappen, „+“ und Zeilenmenü (Umbenennen, Nach oben/unten,
  Einrücken, Ausrücken, In den Papierkorb), Papierkorb mit Wiederherstellen, „Daten gehostet in der
  EU“. Unter 1024 px eine Schublade. **Abweichend vom Frontend:** Abmelden und Sprache stehen nicht
  mehr in der Seitenleiste, sondern im Konto-Menü (siehe unten).
- Brotkrume, Anwesenheit, „Versionen“, „Exportieren“, „Teilen und Rechte“. Export öffnet wie im
  Frontend einen Dialog mit Ausblick, Versionen eine eigene Ansicht (siehe „Ausblick“). **Abweichend vom Frontend (25. November 2026):**
  - Sie stehen in einer eigenen Zeile unter der Leiste oben (`.nf-pagebar`, scrollt mit dem Inhalt);
    die Leiste oben (`.nf-topbar`, bleibt stehen) enthält links die Suche (unter 1024 px mit dem
    Menü-Knopf davor) und rechts zwei Knöpfe mit eigenem Menü:
    - **Zahnrad „Einstellungen“:** Darstellung (Hell, Dunkel, System),
      „Persönliche Einstellungen“ und „Tastenkürzel“ (vorerst Dialoge mit Ausblick), für Owner und
      Admins des Workspaces „Workspace“ und „Einladungen“.
    - **Avatar „Konto“:** Name, E-Mail und Rolle, „Benutzerprofil“, Sprache (Deutsch/English, die
      Sprache gehört zur Person, `users.locale`) und „Abmelden“.
  - **Workspace** (Dialog): Name ändern, Mitglieder mit Rolle (Admin, Mitglied, Gast; Owner fest),
    Entfernen mit Rückfrage, Knopf „Personen einladen“. Im Frontend gibt es dafür noch keine
    Oberfläche; die Datenbank kann es schon (`app.set_workspace_member_role`,
    `app.remove_workspace_member`).
  - **Einladungen** (Dialog, wie `apps/web/src/components/invites.tsx` auf der Startseite): E-Mail
    und Rolle, danach den Link anzeigen und kopieren; Liste mit Status (offen, angenommen,
    zurückgenommen, abgelaufen), offene zurücknehmen. Im Menü zeigt eine Zahl die offenen Einladungen.
- **Dunkles Farbschema (Vorschlag, nur im Prototyp):** dunkle Werte aller Tokens unter
  `:root[data-theme='dark']`; „System“ folgt `prefers-color-scheme`. Alle Text-Paare erreichen
  mindestens 4,5:1, Bedienelemente 3:1 (nachgerechnet, aber noch nicht in
  `apps/web/src/app/contrast.test.mjs`). Die Auswahl merkt sich der Browser (`localStorage`,
  `nf-proto-theme`), Standard ist Hell. Der Import-Assistent hat noch kein dunkles Schema.
  - Rechts, von links nach rechts:
    - **Speicherstatus** „Gespeichert“ / „Speichert …“ / „Offline“ (orange) / „Nur lesen“ bzw.
      „Archiviert“; ersetzt den Offline-Hinweis über dem Inhalt. Unter 900 px nur das Icon.
    - **Anwesenheit nur der anderen** (man selbst steht oben rechts); bis drei Avatare, ab vier zwei
      plus „+N“. Allein auf der Seite: keine Avatare.
    - **Kommentar-Knopf** ohne Rahmen, mit der Zahl offener Threads (siehe Kommentare unter „Ausblick“).
    - **„Teilen“** als normaler Knopf; mit eigenen Rechten orange mit Schloss und „Eingeschränkt“.
      Der Hinweis „Eingeschränkt“ über dem Titel entfällt dafür.
    - **„⋯“** ohne Rahmen, mit Link kopieren, Seiteninfo (Angaben, Rechte, Rückverweise), Versionen,
      Exportieren, Verschieben … (Dialog mit Zielseite) und In den Papierkorb. Auf der Startseite und
      ohne Bearbeitungsrecht sind Verschieben und Papierkorb gesperrt.
- Seite: „Eingeschränkt“, Titel als Eingabefeld (ändert Baum und Brotkrume beim Tippen), Byline,
  Blöcke (Callout mit Art, Tabelle, Code-Block, Aufgaben, Seitenlinks, Erwähnungen, Inhaltsverzeichnis).
- Neue Seite über „+“: ohne Titel, Cursor im Titel. Rückfragen als Dialog, Fokus auf „Abbrechen“.
- **Einstellungen eines Spaces als Dialog** (statt der Seite `/s/<schlüssel>/settings`), geöffnet über
  „⋯“ im Space-Umschalter oder in der Übersicht: Name, Beschreibung, Farbe (acht Farben mit weißer
  Schrift >= 4,5:1), Schlüssel mit Adresse (fest), Bereich „Archivieren“ bzw. „Archiviert“ mit
  „Zurückholen“. Ohne Admin-Recht oder archiviert nur lesbar mit Hinweis. Nach der Rückfrage zum
  Archivieren geht es zurück in den Dialog.
- **Archivieren direkt im Menü:** „⋯“ an einem Space (Umschalter und Übersicht) hat „Archivieren“
  (mit Rückfrage) bzw. bei archivierten Spaces „Zurückholen“ (sofort).
- Knöpfe in einer Zeile der Seitenleiste („+“, „⋯“) werden beim Darüberfahren leicht dunkler
  (`--nf-sidebar-press`, halbtransparent, auch auf der ausgewählten Zeile) statt weiß.
- Rollen: In „Vertrieb“ nur Kommentieren (kein „+“, Titel nicht änderbar), „Altes Intranet“ archiviert.

## Übersicht (Startseite nach dem Login), neuer Entwurf

Erreichbar über das Logo, „Alle Spaces“ im Space-Umschalter oder direkt mit
`Main.dc.html#uebersicht`. Ersetzt die bisherige Liste mit Formularen (`apps/web/src/app/home.tsx`).

- Seitenleiste: „Übersicht“ und die Liste aller Spaces mit farbigem Kürzel (Archivierte gedämpft),
  „+“ für einen neuen Space; an jedem Space „⋯“ (wie im Seitenbaum beim Darüberfahren) mit
  Einstellungen, Link kopieren und Archivieren bzw. Zurückholen. Kein Seitenbaum, kein Papierkorb,
  keine Zeile unter der Suche.
- Kopf: Begrüßung nach Tageszeit, Workspace und Zahl der Spaces, „Neuer Space“.
- **Zuletzt angesehen** (Ausblick, die API merkt sich das noch nicht): Karten mit Space, Titel,
  Schloss bei eigenen Rechten, Anfang des Inhalts, wer zuletzt bearbeitet hat.
- **Favoriten** (Ausblick, unter „Zuletzt angesehen“): die Seiten-Favoriten aller Spaces, je Space eine Karte mit
  Kürzel, Name und Zahl (Klick öffnet den Space), darin die Seiten mit Emoji bzw. Icon, Schloss bei
  eigenen Rechten und Elternpfad; Favoriten-Spaces zuerst, höchstens fünf Seiten je Space, dann
  „+ n weitere in der Seitenleiste“. Der Stern beim Darüberfahren entfernt den Favoriten. Nur
  lesbare Seiten, nicht im Papierkorb. Ohne Favoriten ein kurzer Hinweis, wie man welche setzt.
  Standard im Prototyp: Datenmodell und Backups in Entwicklung, Kampagne Frühjahr in Vertrieb.
- **Spaces** als Kacheln: Kürzel in eigener Farbe (`color` pro Space, Vorschlag; auch im
  Umschalter), Name, Schlüssel, Beschreibung, eigene Rolle als Chip, Zahl der Seiten, letzte
  Änderung. Archivierte nur mit „Archivierte zeigen“. Letzte Kachel „Neuer Space“.
- **Seiten-Favoriten pro Space** (Ausblick, pro Person; im Prototyp im Browser gemerkt, Standard in
  Entwicklung: Datenmodell und Backups): Bereich „Favoriten (n)“ über „Seiten“ in der Seitenleiste,
  ein- und ausklappbar wie der Papierkorb (Zustand gemerkt), nur wenn es im Space Favoriten gibt. Die
  Seiten stehen weiter ganz normal im Seitenbaum; die geöffnete Seite ist in beiden hervorgehoben.
  Markieren über den Stern in der Leiste über der Seite (links neben den Kommentaren, für alle mit
  Leserecht) oder „Zu Favoriten hinzufügen“ im „⋯“-Menü einer Baumzeile; entfernen auch über den
  Stern, der im Bereich beim Darüberfahren erscheint. Seiten ohne Leserecht oder im Papierkorb
  fallen aus der Liste.
- **Favoriten** (Ausblick, pro Person; im Prototyp im Browser gemerkt, Standard: Entwicklung): Stern
  oben rechts an jeder Kachel (bei Favoriten immer sichtbar und gefüllt, sonst beim Darüberfahren),
  in der linken Liste beim Darüberfahren neben „⋯“; beim Darüberfahren wird nur der Stern ocker, ohne
  Hintergrund. Favoriten stehen überall zuerst: als eigene
  Gruppe „Favoriten“ in der linken Liste (die übrigen unter „Weitere Spaces“), in der Kachelansicht,
  im Space-Umschalter (Stern direkt in jeder Zeile: gefüllt bei Favoriten, sonst beim
  Darüberfahren; Klick schaltet um, ohne den Space zu wechseln) und bei den Spaces in der Suche. Farbe `--nf-fav` (Ocker #B45309, dunkel
  #F5B93F).
- Rechte Spalte: **Letzte Änderungen** in sichtbaren Spaces (Ausblick, aus den Ereignissen der
  Outbox) und für Owner/Admins eine Karte zum Workspace (Mitglieder, offene Einladungen, Knöpfe zu
  den Dialogen). Unter 1200 px rutscht die Spalte unter den Inhalt.
- **Neuer Space** als Dialog statt Formular: Name, Schlüssel (aus dem Namen vorgeschlagen, belegte
  weichen aus, z. B. ENTW2; Prüfung wie in der Datenbank), Beschreibung, was alle im Workspace
  dürfen. Danach öffnet sich die leere Startseite des neuen Spaces.

## Editor-Bedienung (Entwurf)

Der vorhandene Seiteninhalt ist fester Teil der Vorlage. Darunter beginnt auf jeder bearbeitbaren
Seite ein echt bearbeitbarer Bereich (leere Seiten sind es ganz); Enter im Titel springt hinein. Was
man dort schreibt, merkt sich der Prototyp pro Seite bis zum Neuladen. Im Frontend übernimmt das
BlockNote; dieser Entwurf legt fest, wie dessen Menüs aussehen und sich verhalten sollen.

- **Platzhalter** „Text eingeben oder '/' für Befehle tippen“ nur im Block mit dem Cursor (Überschrift:
  „Überschrift 1“ usw.), auf einer ganz leeren Seite immer.
- **„/“-Menü** am Cursor (klappt nach oben, wenn unten kein Platz ist): Blöcke in Gruppen
  Überschriften, Grundblöcke, Medien, Verknüpfen, je mit Icon, Kurzbeschreibung und Markdown-Kürzel;
  filtert beim Weitertippen („/call“ → Callout). ↑↓ auswählen, Enter oder Tab einfügen, Esc schließen.
  Ein leerer Absatz wird zum Block, sonst kommt der Block dahinter.
- **Markdown-Kürzel** am Anfang eines Absatzes: `#`, `##`, `###`, `-`, `1.`, `[]`, `>`, ```` ``` ````, `---`
  plus Leerzeichen.
- **„[“ Seitenlink und „@“ Erwähnung:** Auswahl am Cursor, filtert beim Tippen; Seiten nur mit
  Leserecht und nicht im Papierkorb, mit Space-Kürzel und Pfad, Seiten des aktuellen Spaces zuerst;
  Personen aus dem Workspace mit Avatar und E-Mail. Eingefügt als Chip (Klick auf einen Seitenlink
  öffnet die Seite).
- **Leiste beim Markieren:** im bearbeitbaren Bereich Blocktyp (Absatz, Überschrift 1–3, Zitat), Fett,
  Kursiv, Unterstrichen, Durchgestrichen, Code, Link (Adresse direkt in der Leiste) und Kommentieren;
  im festen Inhalt (zum Beispiel für Lesende mit Kommentarrecht) nur „Kommentieren“.
- **Links am Block** beim Darüberfahren: „+“ legt darunter einen Block an und öffnet das „/“-Menü,
  der Ziehpunkt verschiebt den Block per Ziehen (blaue Linie zeigt das Ziel) oder öffnet per Klick
  das Blockmenü (Nach oben, Nach unten, Duplizieren, Löschen). Auf dem Handy ausgeblendet.
- Aufgaben zum Abhaken, Enter in einer Aufgabe gibt eine neue, Enter in einer leeren beendet die
  Liste; Enter am Ende einer Überschrift gibt einen Absatz; Rücktaste in einem leeren besonderen
  Block macht ihn zum Absatz.
- Strg K bleibt global die Suche; einen Link setzt man über die Leiste.

## Ausblick (noch nicht im Frontend)

- **Versionen** (E08, M3), statt des Dialogs mit Ausblick: geöffnet über „Versionen“ im „⋯“-Menü,
  über „Zuletzt bearbeitet von …“ in der Byline oder „Versionen anzeigen“ in der Suche. Die Ansicht
  ersetzt die Seite; die Brotkrume endet mit „Versionen“, rechts oben „Zurück zur Seite“ (ebenso Esc).
  - **Rechts die Liste**, neueste zuerst und nach Tagen gruppiert (Heute, Gestern, Wochentag): je
    Version Nummer, Uhrzeit, „Aktuell“ an der neuesten, Avatare und Namen aller, die seit der vorigen
    Version bearbeitet haben (`author_ids`), dazu wie viele Wörter hinzugekommen (grün) und
    weggefallen (rot) sind. Gesicherte Versionen tragen ihren Namen und „Gesichert von …“,
    wiederhergestellte „Wiederhergestellt aus Version 4 von …“. Unter 1100 px steht die Liste über
    dem Inhalt.
  - **Links der Inhalt der gewählten Version** mit Titel, darüber eine Karte mit Nummer, Zeitpunkt,
    Beteiligten und „Wiederherstellen“. „Änderungen hervorheben“ (Standard an) vergleicht mit der
    vorigen oder einer frei gewählten älteren Version: Hinzugefügtes grün hinterlegt, Entferntes rot
    und durchgestrichen (als `<ins>`/`<del>`, also auch für Screenreader), neue bzw. entfernte Blöcke
    mit grünem bzw. rotem Strich am Rand, geänderte mit grauem; abgehakte Aufgaben und eine andere
    Callout-Art als kleiner Hinweis. Daneben die Summe der Wörter. Farben als Tokens `--nf-ins-…`
    und `--nf-del-…`, hell und dunkel (Text auf Hintergrund mindestens 7:1).
  - **Wiederherstellen** (nur mit Bearbeitungsrecht, nicht an der aktuellen Version) fragt nach und
    legt eine neue Version an („Daraus entsteht Version 13; alle bisherigen bleiben erhalten“), wie
    im Collab-Server geplant: Die Historie bleibt linear. Danach zeigt die Ansicht die neue Version
    im Vergleich zur vorigen, die Seite den alten Stand. Ohne Bearbeitungsrecht steht dort
    „Wiederherstellen dürfen nur Bearbeitende“.
  - **Version sichern** (nur Bearbeitende, `app.save_version`) mit optionalem Namen, z. B. „Vor dem
    Review“. **Der Name ist ein Vorschlag:** `page_versions` hat dafür noch keine Spalte, das wäre
    eine Schemaänderung (zuerst Test und Migration, Peter liest den Diff).
  - Daten im Prototyp: „Datenmodell“ hat 12 Versionen vom 3. bis 25. November (zwei gesichert, eine
    umbenannt, Zeilen der Tabelle kommen und gehen), die übrigen Seiten je drei. Die Blöcke sind
    vereinfacht; neue und wiederhergestellte Versionen gelten bis zum Neuladen. Den Vergleich
    rechnet der Prototyp selbst (längste gemeinsame Teilfolge über Blöcke und Wörter); im Frontend
    kommt er aus dem BlockNote-JSON der Versionen und gehört in eine Bibliothek (z. B. das npm-Paket
    `diff`), nicht in eigenen Code.
- **Laden statt „Einen Moment …“:** Beim ersten Öffnen einer Seite steht kurz ein Platzhalter-Skelett
  (Titel, Byline, Zeilen, ein Block) mit sanftem Schimmer, beim ersten Öffnen eines Spaces eines im
  Seitenbaum. Danach kommt die Seite sofort aus dem Zwischenspeicher (wie mit TanStack Query im
  Frontend). Für Screenreader `aria-busy` und „Seite wird geladen …“ als Status; mit „Bewegung
  reduzieren“ ohne Schimmer. Neu angelegte Seiten sind sofort da. Zum Ansehen die Seite neu laden.
- **Leere Zustände:**
  - **Leerer Space** (z. B. über „Neuer Space“ anlegen): im Seitenbaum „Noch keine Seiten unter der
    Startseite“ mit „Erste Seite anlegen“; auf der Startseite eine Karte „Willkommen in …“ mit
    Erste Seite anlegen, Aus Confluence importieren und Personen einladen. Wer nur lesen darf, sieht
    nur den Hinweis.
  - **Suche ohne Treffer:** Icon, Hinweis auf Leserecht und Verzögerung, „In allen Spaces suchen“
    und mit Bearbeitungsrecht „Seite „…“ anlegen“ (der Suchbegriff wird zum Titel).
  - **Keine Kommentare:** „Noch keine Kommentare“ bzw. „Keine offenen Kommentare“ mit Anleitung;
    im Reiter „Erledigt“ „Nichts erledigt“; ohne Kommentarrecht ein Hinweis auf die Rolle.
- **Benachrichtigungen** (E16): Glocke oben rechts links vom Zahnrad, mit Zahl der ungelesenen.
  Das Fenster zeigt Erwähnungen (in Seiten und Kommentaren), Antworten in Threads, denen man folgt,
  geteilte Seiten (mit Rolle) und Kommentare an eigenen Seiten, je mit Avatar, Art als kleines
  Abzeichen, Ausschnitt, Space und Zeit; Ungelesene blau hinterlegt mit Punkt. Reiter „Alle“ und
  „Ungelesen“, „Alle als gelesen markieren“, unten „Einstellungen für Benachrichtigungen“. Ein Klick
  markiert als gelesen, öffnet die Seite und bei Kommentaren den Thread. Nur Seiten mit Leserecht
  und nicht im Papierkorb; im Produkt prüft das die Zustellung (`app.page_rank`), die Quelle sind
  die Ereignisse der Outbox. Esc oder Klick daneben schließt, Fokus zurück auf die Glocke.
- **Emoji und Titelbild einer Seite:** Beim Darüberfahren über den Titel erscheinen darüber
  „Emoji hinzufügen“ und „Titelbild hinzufügen“ (nur mit Bearbeitungsrecht, per Tastatur
  erreichbar, auf Touch-Geräten immer sichtbar).
  - **Emoji** steht groß links neben dem Titel und statt des Seiten-Icons im Seitenbaum, bei den
    Favoriten und bei den Unterseiten im Fuß. Klick darauf öffnet die Auswahl: Suche über deutsche
    Begriffe („sicher“ findet 🛡️), Raster mit 48 Emojis (Pfeiltasten, ↓ aus dem Suchfeld ins Raster),
    „Entfernen“. Startwerte im Prototyp: Datenmodell 🗂️, Release-Prozess 🚀, Backups 💾,
    Personalplanung 👥.
  - **Titelbild** über die volle Breite des Hauptbereichs (200 px, auf dem Handy 140 px): acht
    Farbverläufe aus der Palette oder ein eigenes Bild (PNG, JPEG, GIF, WebP wie Bilder im Text; im
    Prototyp nur im Browser, im Frontend über `POST /pages/:id/files`, damit es unter der Leseregel
    der Seite liegt und die CSP passt). Beim Darüberfahren „Titelbild ändern“ und „Entfernen“. Die
    Startseite von Entwicklung hat im Prototyp ein blaues Titelbild.
  - Esc oder Klick daneben schließt die Auswahl. **Vorschlag:** Beides braucht Spalten an der Seite
    (z. B. `pages.icon` als Text, `pages.cover` als Verweis auf `files` oder Name eines Verlaufs) und
    eine Funktion zum Setzen (editor); das ist eine Schemaänderung, zuerst Test und Migration, Peter
    liest den Diff. Wie der Titel ginge es auch über Yjs; als Spalte bleibt es aber für Baum und
    Suche ohne Yjs lesbar.
- **Reaktionen auf die Seite:** in der Zeile unter dem Titel rechts Emoji-Chips mit Zahl (eigene
  blau), Namen beim Darüberfahren („Sophie Bauer, Lukas Gruber und du haben mit 👍 reagiert“);
  „+“ mit Smiley öffnet eine Auswahl aus acht Emojis, ein Klick setzt bzw. nimmt zurück. Ab
  Kommentieren, nicht in archivierten Spaces; wer nur lesen darf, sieht die Zahlen. **Vorschlag:**
  Dafür gibt es noch keine Tabelle; das wäre eine Schemaänderung (`page_reactions` mit Seite,
  Person, Emoji, Leseregel wie die Seite), zuerst Test und Migration, Peter liest den Diff. Die
  Emojis sind Inhalt, keine Icons der Oberfläche (dort bleibt es bei eigenen SVGs).
- **Dialoge wie natives `<dialog>`** (wie im Frontend): Beim Öffnen springt der Fokus hinein (erstes
  Eingabefeld, sonst der erste Knopf außer „Schließen“; Rückfragen auf „Abbrechen“), Tab und
  Umschalt+Tab bleiben im Dialog, der Rest der Seite ist `inert` (weder klick- noch fokussierbar,
  für Screenreader ausgeblendet). Beim Schließen geht der Fokus zurück zum Auslöser; kam der Dialog
  aus einem Menü, zum Menüknopf, bei nur beim Darüberfahren sichtbaren Knöpfen zum Link der Zeile.
  Gilt auch für die Befehlspalette. Die Kommentarspalte als Schublade unter 1280 px fängt den Fokus
  noch nicht.
- **Fuß jeder Seite** (unter dem Inhalt, nach einer Trennlinie), die zwei häufigsten Wege durch ein
  Wiki:
  - **Unterseiten (n)** als Karten (Titel, Schloss bei eigenen Rechten, Anfang des Inhalts in zwei
    Zeilen, wer zuletzt bearbeitet hat und wann, Zahl eigener Unterseiten) oder als Liste (eine Zeile
    je Seite; unter 640 px ohne Text). Umschalter rechts, pro Person gemerkt (im Prototyp
    `localStorage`, `nf-proto-subview`). Mit Bearbeitungsrecht daneben „+ Unterseite“; hat die Seite
    keine Unterseiten, steht dort nur ein dezentes „+ Unterseite anlegen“.
  - **Verlinkt von (n):** Seiten, die per Seitenlink hierher zeigen, mit Pfad und dem Satz um den
    Link (Linktext hervorgehoben). Im Prototyp aus den festen Links der Vorlage und aus Seitenlinks,
    die man in dieser Sitzung im Editor einfügt; im Frontend aus `page_links` (pflegt der Worker
    schon), über die API nur Quellen mit Leserecht (`app.page_rank`, M3).
  - Nur Seiten mit Leserecht und nicht im Papierkorb; was fehlt, fehlt ohne Hinweis (wie bei
    `POST /pages/lookup`), damit der Fuß nicht verrät, dass es eingeschränkte Seiten gibt. Ohne
    Unterseiten, Rückverweise und Bearbeitungsrecht entfällt der Fuß ganz.
- **Papierkorb als Dialog** (statt der kleinen Liste unten in der Seitenleiste; „Papierkorb (n)“
  öffnet ihn): Suche über Titel, auch der Unterseiten; je Eintrag gelöscht von wem und wann, aus
  welcher Elternseite, Restzeit bis zum endgültigen Löschen („noch 17 Tage“, ab 7 Tagen orange),
  die mit gelöschten Unterseiten zum Aufklappen und „Wiederherstellen“ (nur mit Bearbeitungsrecht
  an der Elternseite). Sofort endgültig löschen gibt es bewusst nicht; das macht der Worker nach
  30 Tagen. Die Datenbank kennt beides schon (`pages.deleted_at`, `pages.deleted_by`); die API
  (`GET /spaces/:key/trash`) müsste es mitliefern, dazu die Zahl der Unterseiten.
- **Suche als Befehlspalette** (M3): Das Feld oben öffnet sie, ebenso Strg K (noch einmal: zu).
  - Volltext über Titel und Inhalt, nur Seiten mit Leserecht und ohne Papierkorb (im Frontend
    `page_search` und `app.page_rank`); Groß- und Kleinschreibung und Akzente egal („uberblick“ findet
    „Überblick“), mehrere Wörter müssen alle vorkommen. Titeltreffer zuerst.
  - Treffer mit Markierung im Titel und einem Ausschnitt aus dem Inhalt, Pfad (Space / Eltern),
    Schloss bei eigenen Rechten.
  - Bereiche Alles, Seiten, Spaces, Personen (mit Zahl der Treffer), dazu „Nur in <Space>“; ohne
    Treffer im Space ein Knopf „In allen Spaces suchen“.
  - Ohne Eingabe: zuletzt angesehen und Befehle. Mit „>“ am Anfang nur Befehle (ohne Hinweis in
    der Palette; neue Seite, neuer
    Space, Übersicht, Link kopieren, Exportieren, Darstellung, Personen einladen, Tastenkürzel).
  - Tastatur (ohne Leiste mit Kürzeln unten): ↑↓ auswählen, Enter öffnen, Tab bzw. Umschalt+Tab Bereich, Esc schließen (Fokus
    zurück aufs Suchfeld). Als Combobox mit `aria-activedescendant` für Screenreader.
  - Personen öffnen noch nichts (Profile kommen später). Auf dem Handy fast bildschirmfüllend.
- **Kommentare** (M3):
  - Die Spalte ist standardmäßig zu, der Text hat die volle Breite. Offene Kommentare an Textstellen
    zeigen sich als Sprechblase mit Zahl am rechten Rand neben der Stelle; die Stelle ist dezent
    hinterlegt. Klick auf Sprechblase oder Stelle öffnet die Spalte mit diesem Thread (Stelle und
    Thread dann kräftiger hervorgehoben). Der Knopf in der Leiste zeigt die Zahl offener Threads.
  - Spalte: Reiter „Offen“ und „Erledigt“ mit Zahl; unter den offenen Threads ein Feld „Kommentar
    zur ganzen Seite …“ (sieht aus wie „Antworten …“) für einen Kommentar ohne Textstelle.
    Jeder Thread mit Zitat (Klick springt zur Stelle) bzw. „Kommentar zur Seite“, den Kommentaren,
    „Antworten …“ und „Erledigt“ bzw. „Wieder öffnen“.
  - Neuer Kommentar über „Kommentieren“ in der Leiste beim Markieren: Im bearbeitbaren Bereich wird
    die Stelle markiert, im festen Inhalt nur zitiert. Die Spalte öffnet sich mit dem Cursor im
    Kommentarfeld; Strg Enter sendet, Abbrechen bzw. Esc verwirft einen leeren neuen Thread samt
    Markierung.
  - Wer nur lesen darf, kann nicht kommentieren; in archivierten Spaces auch niemand sonst.
  - Ab 1280 px steht die Spalte rechts neben dem Text und läuft beim Scrollen mit, darunter ist sie
    eine Schublade von rechts (Esc oder Klick daneben schließt). Auf dem Handy keine Sprechblasen am
    Rand; die Stelle selbst ist antippbar.
- **Rechte-Dialog** (M3), über „Teilen“ bzw. „Eingeschränkt“ in der Leiste über der Seite:
  - Oben die **Zusammenfassung** „Zugriff“: wie viele Personen im Workspace welche wirksame Rolle
    haben (Admin, Bearbeiten, Kommentieren, Lesen, ohne Zugriff; Namen beim Darüberfahren),
    berechnet wie `app.page_rank` aus Personen, Gruppen und „Alle im Workspace“ (ohne Gäste), mit
    den Änderungen im Entwurf. Rechts daneben „Ansehen als …“.
  - Schalter „Eigene Rechte für diese Seite“ (Vererbung kappen übernimmt die bisherigen Rechte und
    macht dich zum Admin), darunter Personen, Gruppen und „Alle im Workspace“ mit Rolle und „×“
    zum Entfernen („Alle im Workspace“ höchstens Bearbeiten).
  - **Hinzufügen** mit Vorschlagsliste beim Tippen (Personen mit E-Mail, Gäste markiert, Gruppen
    mit Mitgliederzahl, „Alle im Workspace“), daneben die Rolle für neue Einträge; ↑↓ und Enter.
  - **Absicherungen:** Nimmst du dir selbst Admin, erscheint eine Warnung und der Knopf heißt
    „Trotzdem speichern“ (orange). Bliebe gar kein wirksamer Admin, sperrt der Dialog das Speichern
    (die Datenbank prüft dasselbe mit `app.has_admin`).
  - Ohne Admin-Recht nur lesbar mit Hinweis auf die eigene Rolle.
- **„Ansehen als …“** (`app.view_as`, E09): Person wählen, darunter der ganze Seitenbaum des Spaces
  mit ihrer Rolle pro Seite (ohne Zugriff gedämpft, eigene Rechte mit Schloss) und „sieht 8 von 9
  Seiten“. Nur Struktur, keine Inhalte, Hinweis aufs Audit-Log; zeigt den gespeicherten Stand.
- „Confluence-Import“ unten in der Seitenleiste, führt zu `../import/Import.dc.html` (M4)
- Drag & Drop im Baum fehlt im Prototyp (im Frontend gebaut); das Zeilenmenü ersetzt es hier.

## Ansehen

Den Ordner `prototype/` ausliefern, z. B. `py -m http.server 8090 --directory prototype`, und
`http://localhost:8090/pages/Main.dc.html` öffnen; über file:// blockieren manche Browser die Skripte.
