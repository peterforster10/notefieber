# Sicherheit / Security

## Sicherheitslücken melden

Bitte melde Sicherheitslücken **vertraulich** und **nie als öffentliches Issue, Pull Request oder
Diskussion**.

So geht es: Im GitHub-Repository unter **Security → Advisories → „Report a vulnerability“**
(private Meldung über GitHub). Nur die Maintainer sehen die Meldung; wir besprechen sie dort mit
dir, bis eine Korrektur veröffentlicht ist.

Hilfreich sind:

- betroffene Version bzw. Commit und Baustein (Frontend, API, Worker, Collab-Server, Datenbankschema)
- Schritte zum Nachstellen, ein Beispiel oder ein Test
- was ein Angreifer damit erreicht (z. B. Seiten ohne Leserecht sehen, fremden Mandanten lesen,
  Rechte ausweiten)

Bitte nutze für Tests nur eine eigene, lokale Installation (`docs/LOCAL_SETUP.md`) mit den
synthetischen Testdaten, nie fremde Installationen oder echte Daten.

## Was passiert dann

- Wir bestätigen den Eingang innerhalb von 5 Werktagen.
- Wir schätzen die Schwere ein und sagen dir, bis wann wir eine Korrektur planen.
- Nach der Korrektur veröffentlichen wir ein Security Advisory und nennen dich, wenn du das möchtest.
- Bitte gib uns bis zur Korrektur, höchstens 90 Tage, Zeit, bevor du Einzelheiten veröffentlichst.

## Geltungsbereich

Besonders wichtig sind uns Lücken in der Trennung von Mandanten und in den Rechten: Jeder Weg,
auf dem eine Person Inhalte, Titel, Kommentare oder Dateien einer Seite ohne Leserecht sieht
(Seitenbaum, Suche, Links, Export, Dateien, gemeinsames Bearbeiten), ist eine Sicherheitslücke.

Nicht im Geltungsbereich: die lokalen Testwerte in `.env.example` und `compose.yaml` (sie sind
absichtlich öffentlich und nur für den eigenen Rechner), Lücken in Abhängigkeiten ohne Auswirkung
auf NoteFieber (bitte direkt beim jeweiligen Projekt melden) und Angriffe, die Zugang zum Server
oder zur Datenbank voraussetzen.

## Unterstützte Versionen

NoteFieber ist in Entwicklung (vor dem ersten Release). Korrekturen gibt es nur für den aktuellen
Stand von `main`.

---

## Reporting a vulnerability (English)

Please report security issues **privately** via GitHub: **Security → Advisories → “Report a
vulnerability”** in this repository. Do not open public issues or pull requests for security
problems. We acknowledge reports within 5 business days and ask for up to 90 days before public
disclosure. Any way to see content of a page without read permission, or data of another tenant,
is in scope.
