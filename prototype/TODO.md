# Prototyp: noch nicht entworfen

Stand: 27. November 2026. Was im Prototyp (`pages/Main.dc.html`, Quellen in `pages/src/`) noch fehlt,
geordnet nach dem Meilenstein, in dem es gebraucht wird ([ROADMAP](../docs/ROADMAP.md)). Was schon
entworfen ist, beschreibt [README.md](README.md).

**Regel:** Lücken nicht auf Vorrat schließen, sondern kurz vor der Story, die sie braucht. Ist ein Punkt
entworfen, kommt er in die README (Abschnitt „Ausblick“ bzw. „Was wie im Frontend ist“) und wird hier
gelöscht.

## Für M2

Nichts offen; Benutzerprofil und persönliche Einstellungen sind entworfen (27. November 2026).

## Für M3

- **Audit-Log** für Organisations-Admins: in M3 nur in der Datenbank, eine Ansicht kommt mit E17.
  Hier nur festhalten, falls der Rechte-Dialog oder „Ansehen als …“ darauf verlinken soll.

## Für M4

- **Bericht herunterladen** im Import-Assistenten: heute Ausblick. Inhalt und Format (PDF, CSV,
  Markdown) des Berichts nach dem Probelauf.
- **Import-Assistent im dunklen Farbschema** prüfen (in der README noch als offen vermerkt, seit dem
  Umzug in `Main.dc.html#import` ggf. erledigt).
- **Import rückgängig machen:** Rückfrage mit dem, was entfernt wird, und was passiert, wenn
  importierte Seiten inzwischen bearbeitet wurden.

## Später (nach dem Pilot bzw. Stufe 3)

- **Vorlagen bearbeiten und löschen** (E25): die Galerie kann bisher nur anlegen und verwenden.
- **Personen-Profil ansehen:** Personen in der Befehlspalette öffnen noch nichts.

## Bekannte Abweichungen im Prototyp selbst

- Drag & Drop im Seitenbaum fehlt (im Frontend gebaut); das Zeilenmenü ersetzt es.
- Die Kommentar-Schublade unter 1280 px fängt den Fokus noch nicht wie ein Dialog.
- Die dunklen Farbpaare sind nachgerechnet, stehen aber noch nicht in
  `apps/web/src/app/contrast.test.mjs`; das gehört zur Story „Dunkles Farbschema“ in M2.
