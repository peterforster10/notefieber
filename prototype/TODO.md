# Prototyp: noch nicht entworfen

Stand: 26. November 2026. Was im Prototyp (`pages/Main.dc.html`, Quellen in `pages/src/`) noch fehlt,
geordnet nach dem Meilenstein, in dem es gebraucht wird ([ROADMAP](../docs/ROADMAP.md)). Was schon
entworfen ist, beschreibt [pages/README.md](README.md).

**Regel:** Lücken nicht auf Vorrat schließen, sondern kurz vor der Story, die sie braucht. Ist ein Punkt
entworfen, kommt er in die README (Abschnitt „Ausblick“ bzw. „Was wie im Frontend ist“) und wird hier
gelöscht.

## Für M2

- **Benutzerprofil** (E02, Story „Profil“): Name, Profilbild (hochladen, entfernen, Kürzel als
  Rückfall), Sprache, Zeitzone. Heute nur ein Dialog mit Ausblick im Konto-Menü. Offen: eigene Seite
  oder Dialog; wo die Zeitzone überall wirkt (Byline, Versionen, Papierkorb).
- **Persönliche Einstellungen** (E15): was dort steht, wenn Sprache und Darstellung schon in den
  Menüs sind (z. B. Standard-Ansicht Karten oder Liste, später Benachrichtigungen aus E16). Heute nur
  ein Dialog mit Ausblick.

## Für M3

- **Gruppen pflegen** (E02, E09, nur Organisations-Admins): Liste der Gruppen mit Quelle (`local`,
  `import`, später `idp`, `scim`), anlegen, umbenennen, löschen, Mitglieder hinzufügen und entfernen.
  Gruppen aus dem Login-Dienst oder per SCIM nur lesbar. Rückfragen, wenn eine Gruppe irgendwo
  letzter Admin ist (die Datenbank lehnt dann ab, `app.has_admin`). Wohl im Zahnrad-Menü neben
  „Workspace“ und „Einladungen“.
- **Person deaktivieren** (E02): im Dialog „Workspace“ gibt es bisher nur „Entfernen“. Deaktivieren
  gilt für den ganzen Mandanten und beendet alle Sitzungen; nur für Organisations-Admins. Anzeige
  deaktivierter Personen in Listen und Erwähnungen.
- **Rechte wiederherstellen durch Organisations-Admins** (E09): ein Space oder eine Seite ohne
  erreichbaren Admin; wie man sie findet, sich selbst Rechte gibt und dass es im Audit-Log steht.
- **Export** (E14): heute ein Dialog mit Ausblick. Auswahl Seite, Teilbaum oder ganzer Space,
  Format (Markdown + BlockNote-JSON + Anhänge als ZIP), Hinweis, dass nur Lesbares exportiert wird,
  Fortschritt und Download für große Spaces (läuft im Worker).
- **Anhänge** (E11, mit dem Virenscan): Datei-Block im Editor (Name, Größe, Typ, Herunterladen),
  Zustände „wird geprüft“ und „blockiert“ an Datei und Bild, Anhänge-Liste der Seite (etwa in der
  Seiteninfo).
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
- **Einstellungen für Benachrichtigungen** (E16): der Link unten im Fenster der Glocke führt noch
  ins Leere.
- **Personen-Profil ansehen:** Personen in der Befehlspalette öffnen noch nichts.

## Bekannte Abweichungen im Prototyp selbst

- Drag & Drop im Seitenbaum fehlt (im Frontend gebaut); das Zeilenmenü ersetzt es.
- Die Kommentar-Schublade unter 1280 px fängt den Fokus noch nicht wie ein Dialog.
- Die dunklen Farbpaare sind nachgerechnet, stehen aber noch nicht in
  `apps/web/src/app/contrast.test.mjs`; das gehört zur Story „Dunkles Farbschema“ in M2.
