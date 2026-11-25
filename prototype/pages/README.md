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
    Ausblick), Sprache (Deutsch/English als Auswahl mit Haken), Darstellung (Hell, Dunkel, System)
    und „Abmelden“.
- **Dunkles Farbschema (Vorschlag, nur im Prototyp):** dunkle Werte aller Tokens unter
  `:root[data-theme='dark']`; „System“ folgt `prefers-color-scheme`. Alle Text-Paare erreichen
  mindestens 4,5:1, Bedienelemente 3:1 (nachgerechnet, aber noch nicht in
  `apps/web/src/app/contrast.test.mjs`). Die Auswahl merkt sich der Browser (`localStorage`,
  `nf-proto-theme`), Standard ist Hell. Der Import-Assistent hat noch kein dunkles Schema.
  - Rechts: Kommentar-Knopf, „Teilen und Rechte“ als normaler Knopf (nicht mehr primär, unter 900 px
    nur mit Icon) und „⋯“ mit einem Menü für „Versionen“ und „Exportieren“.
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
