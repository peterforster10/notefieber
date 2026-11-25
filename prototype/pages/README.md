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

## Was wie im Frontend ist

- Seitenleiste: Logo und Mandant, Space-Umschalter (Menü mit allen Spaces, „⋯“ → Einstellungen),
  Seitenbaum mit „Startseite“, Aufklappen, „+“ und Zeilenmenü (Umbenennen, Nach oben/unten,
  Einrücken, Ausrücken, In den Papierkorb), Papierkorb mit Wiederherstellen, „Daten gehostet in der
  EU“. Unter 1024 px eine Schublade. **Abweichend vom Frontend:** Abmelden und Sprache stehen nicht
  mehr in der Seitenleiste, sondern im Konto-Menü (siehe unten).
- Brotkrume, Anwesenheit, „Versionen“, „Exportieren“, „Teilen und Rechte“. Versionen und Export
  öffnen wie im Frontend Dialoge mit Ausblick. **Abweichend vom Frontend (25. November 2026):**
  - Sie stehen in einer eigenen Zeile unter der Leiste oben (`.nf-pagebar`, scrollt mit dem Inhalt);
    die Leiste oben (`.nf-topbar`, bleibt stehen) enthält links die Suche (unter 1024 px mit dem
    Menü-Knopf davor) und rechts den Avatar der angemeldeten Person. Er öffnet das Konto-Menü: Name,
    E-Mail und Rolle, „Benutzerprofil“, „Einstellungen“, „Tastenkürzel“ (vorerst Dialoge mit
    Ausblick), für Owner und Admins des Workspaces „Workspace“ und „Einladungen“, Sprache
    (Deutsch/English als Auswahl mit Haken), Darstellung (Hell, Dunkel, System) und „Abmelden“.
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
    - **Kommentar-Knopf** ohne Rahmen, mit der Zahl offener Kommentare.
    - **„Teilen“** als normaler Knopf; mit eigenen Rechten orange mit Schloss und „Eingeschränkt“.
      Der Hinweis „Eingeschränkt“ über dem Titel entfällt dafür.
    - **„⋯“** ohne Rahmen, mit Link kopieren, Seiteninfo (Angaben, Rechte, Rückverweise), Versionen,
      Exportieren, Verschieben … (Dialog mit Zielseite) und In den Papierkorb. Auf der Startseite und
      ohne Bearbeitungsrecht sind Verschieben und Papierkorb gesperrt.
- Seite: „Eingeschränkt“, Titel als Eingabefeld (ändert Baum und Brotkrume beim Tippen), Byline,
  Blöcke (Callout mit Art, Tabelle, Code-Block, Aufgaben, Seitenlinks, Erwähnungen, Inhaltsverzeichnis).
- Neue Seite über „+“: ohne Titel, Cursor im Titel. Rückfragen als Dialog, Fokus auf „Abbrechen“.
- Einstellungen eines Spaces mit Archivieren und Zurückholen.
- Rollen: In „Vertrieb“ nur Kommentieren (kein „+“, Titel nicht änderbar), „Altes Intranet“ archiviert.

## Ausblick (noch nicht im Frontend)

- Suche in der Leiste oben über dem Inhalt, Strg K setzt den Fokus hinein (M3)
- Kommentarspalte rechts mit Markierung an der Textstelle (Knopf mit Sprechblase im Kopfbereich)
- Rechte-Dialog mit „Eigene Rechte für diese Seite“, Rollen pro Person/Gruppe, Hinzufügen (M3)
- „Confluence-Import“ unten in der Seitenleiste, führt zu `../import/Import.dc.html` (M4)
- Drag & Drop im Baum fehlt im Prototyp (im Frontend gebaut); das Zeilenmenü ersetzt es hier.

## Ansehen

Den Ordner `prototype/` ausliefern, z. B. `py -m http.server 8090 --directory prototype`, und
`http://localhost:8090/pages/Main.dc.html` öffnen; über file:// blockieren manche Browser die Skripte.
