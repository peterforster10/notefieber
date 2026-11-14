# Kernkonzepte von NoteFieber

Dieses Dokument erklärt einem Neuling, wie NoteFieber funktioniert und warum es so gebaut ist. Es geht der Reihe nach vom Fachlichen zum Technischen. Wer nur die Entscheidungen und den aktuellen Stand braucht, liest `CLAUDE.md`. Maßgeblich für jedes Detail der Datenbank ist das Schema in `database/scripts/schema/` (Einstieg `schema.sql`), nachschlagen lässt es sich in `docs/SCHEMA.md`.

Alle Beispiele nutzen die erfundene Firma **Alpenwerk** mit Anna Huber (Organisations-Admin), Lukas Gruber, Sophie Bauer, Max Mustermann und dem Gast Elena Novak von der Agentur Nord.

## Inhalt

**Fachliche Grundlagen**

1. [Was NoteFieber ist](#1-was-notefieber-ist)
2. [Die Begriffe: vom Mandanten bis zur Seite](#2-die-begriffe-vom-mandanten-bis-zur-seite)
3. [Confluence-Begriffe übersetzt](#3-confluence-begriffe-übersetzt)
4. [Rechte](#4-rechte)
5. [Login und Sitzung](#5-login-und-sitzung)
6. [Gemeinsames Bearbeiten in Echtzeit](#6-gemeinsames-bearbeiten-in-echtzeit)
7. [Versionen, Papierkorb und Kommentare](#7-versionen-papierkorb-und-kommentare)
8. [Dateien](#8-dateien)
9. [Suche](#9-suche)
10. [Der Confluence-Import](#10-der-confluence-import)

**Technik**

11. [Das Datenmodell](#11-das-datenmodell)
12. [Sicherheit in der Datenbank](#12-sicherheit-in-der-datenbank)
13. [Ereignisse in der Outbox](#13-ereignisse-in-der-outbox)
14. [Die Architektur](#14-die-architektur)
15. [Der Stack und warum](#15-der-stack-und-warum)
16. [Betrieb](#16-betrieb)
17. [Compliance](#17-compliance)
18. [Zusammenspiel mit TalkFieber](#18-zusammenspiel-mit-talkfieber)

**Praxis**

19. [Durchgespielte Abläufe](#19-durchgespielte-abläufe)
20. [Entwicklungsablauf](#20-entwicklungsablauf)
21. [Bewusste Kompromisse und Grenzen](#21-bewusste-kompromisse-und-grenzen)
22. [Typische Fehler und wie man sie vermeidet](#22-typische-fehler-und-wie-man-sie-vermeidet)
23. [Häufige Fragen](#23-häufige-fragen)
24. [Glossar](#24-glossar)

Was als **Empfehlung** gekennzeichnet ist, ist noch nicht entschieden und gehört bei der Umsetzung in eine Entscheidungsnotiz (siehe [Abschnitt 20](#20-entwicklungsablauf)).

---

## 1. Was NoteFieber ist

NoteFieber ist ein Firmen-Wiki: ein Ort, an dem Teams ihr Wissen in Seiten ablegen, die in einem Baum geordnet sind, gemeinsam bearbeitet werden und gut durchsuchbar sind. Funktional ist es eine Alternative zu Confluence.

Drei Dinge unterscheiden es von einem beliebigen Wiki:

- **Europäisch:** entwickelt und betrieben in der EU, von einem Anbieter ohne US-Mutterfirma. Damit greift der US CLOUD Act nicht, der US-Behörden Zugriff auf Daten bei US-Firmen erlaubt, auch wenn die Server in Europa stehen.
- **Für den Umstieg von Confluence gebaut:** Atlassian stellt Confluence Data Center ein. Ab 28. März 2029 sind diese Installationen nur noch lesbar. Viele Organisationen, die bewusst nicht in die US-Cloud wollen, brauchen einen Nachfolger. Deshalb sind der Import und ein vertrautes Rechtemodell zentral.
- **Für regulierte Organisationen:** Rechte, Audit-Log, Export und Löschung sind von Anfang an mitgedacht (siehe [Compliance](#17-compliance)).

Bewusst **kein** Notion: Es gibt im MVP keine Datenbanken, Boards oder KI. Erst das Wiki richtig, dann mehr.

---

## 2. Die Begriffe: vom Mandanten bis zur Seite

Die Ordnung ist eine Hierarchie aus fünf Ebenen:

```
Mandant (Tenant)            Alpenwerk GmbH – der zahlende Kunde
 └─ Workspace               Alpenwerk (später evtl. auch „Alpenwerk Schweiz“)
     └─ Space               Entwicklung (Key ENTW), Vertrieb (VERT), Personal (HR)
         └─ Seite           Entwicklung (Startseite)
             └─ Unterseite      Architektur
                 └─ Unterseite      Datenmodell
```

### Mandant (Tenant)

Der Mandant ist die Organisation, die NoteFieber nutzt und bezahlt. Er ist die **harte Grenze**: Daten eines Mandanten sind für einen anderen niemals sichtbar, auch nicht durch einen Programmierfehler in der App. Das sichert die Datenbank selbst ab (siehe [Abschnitt 12](#12-sicherheit-in-der-datenbank)).

Am Mandanten hängen auch Login (eine Organisation im Login-Dienst Zitadel), Abrechnung und Datenregion. Ein Mandant hat dieselbe ID in NoteFieber und in TalkFieber.

### Workspace

Ein Mandant hat einen oder mehrere Workspaces, z. B. für Tochterfirmen oder Ämter. Zum Start hat jeder Mandant genau einen, und in der Oberfläche merkt man nichts davon. Personen sind **Mitglieder** in Workspaces, mit einer Rolle:

| Rolle im Workspace | Bedeutung |
|---|---|
| owner | Verwaltet den Workspace, mindestens einer muss immer bleiben |
| admin | Verwaltet Mitglieder |
| member | Normales Mitglied |
| guest | Externe Person, sieht nur, wofür sie ausdrücklich freigegeben ist |

Der Workspace ist **keine Sicherheitsgrenze zwischen Kunden** (das ist der Mandant), sondern regelt, wer innerhalb einer Organisation grundsätzlich dazugehört.

### Personen und Gruppen

Eine **Person** gehört zu genau einem Mandanten. Sie meldet sich über Zitadel an. Mit `role = 'org_admin'` ist sie **Organisations-Admin** und verwaltet den ganzen Mandanten.

**Gruppen** (z. B. „Entwicklung“, „Personalabteilung“) bündeln Personen eines Mandanten, damit Rechte nicht an Einzelnen hängen: Wer neu in die Entwicklung kommt, wird in die Gruppe aufgenommen und sieht sofort alle Entwicklungsseiten; wer wechselt, verliert die alten Rechte genauso. Rechte an Gruppen zu vergeben statt an einzelne Personen ist deshalb die Regel.

Die Gruppen **gehören dem Wiki**, nicht dem Login-Dienst (Zitadel hat keine Gruppen). Jede Gruppe hat eine Quelle (`groups.source`):

| Quelle | Woher | Wer pflegt die Mitglieder |
|---|---|---|
| `local` | in der Oberfläche angelegt (`app.create_group`) | Organisations-Admins (`app.add_group_member`, `app.remove_group_member`) |
| `import` | vom Confluence-Import angelegt | wie `local` |
| `idp` | Gruppen-Claim im Token, z. B. aus Entra ID (`app.sync_user_groups`, nur für `wiki_worker` ausführbar), **noch nicht genutzt** | der Login-Dienst; der Abgleich beim Login fügt hinzu und entfernt |
| `scim` | später per SCIM aus dem Firmen-Verzeichnis (E17) | das Verzeichnis |

Gruppen aus dem Login-Dienst oder per SCIM lassen sich im Wiki nicht ändern, sonst überschriebe der nächste Abgleich die Änderung. Umgekehrt berührt der Abgleich beim Login nur Gruppen mit Quelle `idp`.

**Wer sieht wen?** Personen, Workspaces und Mitgliedschaften sieht man nur aus den Workspaces, in denen man selbst Mitglied ist (nicht nur Gast), dazu immer sich selbst; Gruppen sieht, wer irgendwo Mitglied ist. Organisations-Admins sehen alle. Gäste sehen damit nur sich selbst und ihren Workspace, keine Personenliste und keine Gruppen. Für die Personenauswahl im Rechte-Dialog reicht das, weil Rechte ohnehin nur an Mitglieder des Workspaces gehen.

### Space

Ein Space ist ein **Bereich** für ein Team, ein Projekt oder ein Thema, genau wie in Confluence. Er hat:

- einen **Key** aus Großbuchstaben (`ENTW`), eindeutig im Mandanten. Importierte Confluence-Keys bleiben erhalten.
- eine **Startseite**, die beim Anlegen automatisch entsteht und nicht gelöscht werden kann.
- **Rechte**, die für alle Seiten darin gelten, solange eine Seite nichts anderes sagt.

Ein **archivierter** Space ist für alle nur noch lesbar.

### Seite

Seiten bilden einen **Baum**: Jede Seite hat höchstens eine Elternseite im selben Space. Eine Seite hat einen Titel, einen Inhalt (Text, Tabellen, Bilder, Code …), Versionen, Kommentare und Anhänge.

---

## 3. Confluence-Begriffe übersetzt

Viele Kunden und Pilotnutzer kommen von Confluence. Diese Tabelle hilft beim Übersetzen, im Code wie im Gespräch.

| In Confluence | In NoteFieber | Hinweis |
|---|---|---|
| Instanz bzw. Site | Mandant, darin ein oder mehrere Workspaces | Der Mandant ist die harte Datengrenze |
| Space | Space | Der Key (z. B. `ENTW`) bleibt beim Import erhalten |
| Space-Startseite | Startseite des Space | Entsteht automatisch, lässt sich nicht löschen |
| Seitenbaum, untergeordnete Seite | Seitenbaum, Unterseite | |
| Space-Berechtigungen (Matrix aus Einzelrechten) | Grants auf dem Space mit vier Rollen | Lesen, Kommentieren, Bearbeiten, Admin |
| Seiten-Einschränkungen (Anzeigen, Bearbeiten) | Seite mit eigenen Rechten (Vererbung gekappt) | Andere Logik, siehe [Häufige Fragen](#23-häufige-fragen) |
| Gruppe `confluence-users` | meist „Alle im Workspace“ | |
| Andere Gruppen | Gruppen im Wiki | Beim Import einer vorhandenen Gruppe zugeordnet oder neu angelegt (Quelle `import`) |
| Anonymer Zugriff | nicht vorgesehen | Später öffentliche Lese-Links (E18) |
| Seitenverlauf | Versionen | |
| Inline-Kommentar | Kommentar an einer Textstelle | |
| Anhänge | Dateien in Garage | |
| Papierkorb | Papierkorb | Endgültig gelöscht nach 30 Tagen |
| Makro „Info“, „Hinweis“, „Warnung“ | Callout-Block | |
| Makro „Inhaltsverzeichnis“ | Inhaltsverzeichnis-Block | |
| Makro „Jira-Vorgänge“ | Platzhalter mit Link | Später Jira-Verweise (E19) |
| Seiteneigenschaften, Labels, Vorlagen | später | Epic E25 |
| Blogbeiträge | werden im MVP nicht übernommen | Der Import-Bericht nennt sie |
| Marketplace-Apps | keine | Integrationen über API und Webhooks (E19) |
| Entwurf und „Veröffentlichen“ | kein eigener Entwurf | Änderungen sind sofort für alle sichtbar, siehe [Kompromisse](#21-bewusste-kompromisse-und-grenzen) |

---

## 4. Rechte

Rechte sind das wichtigste Konzept in NoteFieber. Ein Wiki, das einer Person eine Seite zeigt, die sie nicht sehen darf, ist für regulierte Kunden unbrauchbar.

### Die vier Rollen

| Rolle | Darf |
|---|---|
| **viewer** (Lesen) | Lesen, suchen, exportieren, was er sehen darf |
| **commenter** (Kommentieren) | zusätzlich kommentieren |
| **editor** (Bearbeiten) | zusätzlich Seiten anlegen, bearbeiten, verschieben, in den Papierkorb legen |
| **admin** | zusätzlich Rechte und Vererbung ändern, Space-Einstellungen, Import |

Jede Rolle enthält alle Rechte der darunterliegenden. Intern sind sie als Rang 1 bis 4 gespeichert (`app.role_rank`), 0 heißt „kein Zugriff“.

### Wer Rechte bekommen kann

Ein Recht („Grant“) gibt einem **Subjekt** eine Rolle auf einem **Objekt**.

- **Subjekt:** eine Person, eine Gruppe oder `workspace` = „Alle im Workspace“, also alle Mitglieder des Workspaces **außer Gästen**.
- **Objekt:** ein Space **oder** eine Seite (Seite nur, wenn sie eigene Rechte hat, siehe unten).

Hat eine Person mehrere Grants (direkt, über zwei Gruppen und über „Alle im Workspace“), **gewinnt die höchste Rolle**.

Beim Anlegen eines Spaces wird die anlegende Person automatisch Admin, und „Alle im Workspace“ bekommt standardmäßig Leserechte. Beides lässt sich ändern. „Alle im Workspace“ kann höchstens Bearbeiten sein, Admins werden immer namentlich oder als Gruppe vergeben.

### Vererbung

Rechte werden am Space vergeben und **gelten für alle Seiten darunter**. Das ist der Normalfall: Eine Seite „erbt“.

Soll eine Seite nur für wenige sichtbar sein, **kappt** man ihre Vererbung (`inherit_perms = false`). Ab dann gelten für diese Seite **und alle ihre Unterseiten** nur noch die Grants, die direkt an dieser Seite hängen.

```
Space Entwicklung        Grants: Anna admin · Gruppe Entwicklung editor · Alle im Workspace viewer
 ├─ Architektur          erbt  → Rechte des Space
 │   └─ Datenmodell      erbt  → Rechte des Space
 └─ Betrieb              erbt  → Rechte des Space
     └─ Personalplanung  EIGENE RECHTE: nur Anna admin
         └─ Urlaub 2027  erbt  → Rechte von „Personalplanung“
```

Max (normales Mitglied) sieht Architektur und Datenmodell (über „Alle im Workspace“), aber weder „Personalplanung“ noch „Urlaub 2027“.

### Wie die Datenbank die Rolle einer Person auf einer Seite berechnet

Die Funktion `app.page_rank(seite, person)` geht so vor:

1. **Gehört die Person dazu?** Sie muss aktiv sein und Mitglied im Workspace des Spaces. Sonst: kein Zugriff.
2. **Wo kommen die Rechte her?** Von der Seite aus den Baum hinauf bis zur nächsten Seite mit gekappter Vererbung, die Seite selbst eingeschlossen. Gibt es eine, gelten deren Grants. Gibt es keine, gelten die Grants des Spaces.
3. **Welche Grants passen?** Die der Person selbst, ihrer Gruppen und „Alle im Workspace“ (außer für Gäste). Die höchste Rolle zählt.
4. **Archiviert?** Ist der Space archiviert, höchstens „Lesen“.

**Diese eine Funktion ist die einzige Wahrheit.** Seitenbaum, Suche, Link-Vorschau, Kommentare, Anhänge, Export, Benachrichtigungen und Import fragen alle sie. Die meisten Datenlecks in Wikis entstehen über Nebenwege (ein Suchtreffer zeigt den Titel einer geheimen Seite, ein Rückverweis verrät, dass es sie gibt). Deshalb gibt es keine zweite Rechte-Logik irgendwo in der App. Die API kann damit nur die Rechte der angemeldeten Person abfragen (`app.page_rank(seite)`), die Variante für eine beliebige Person ist ihr bewusst verwehrt.

### Vererbung kappen, ohne sich auszusperren

Wer die Vererbung einer Seite kappt (`app.set_page_inheritance`), dem passiert nichts Überraschendes:

1. Die bisher geltenden Rechte werden auf die Seite **kopiert**. Zunächst ändert sich also nichts daran, wer sie sieht.
2. Die handelnde Person wird **Admin der Seite**.
3. Danach schränkt man die Rechte ein, z. B. „Alle im Workspace“ entfernen (`app.set_grant`).

Jeder Space und jede Seite mit eigenen Rechten muss **mindestens einen wirksamen Admin** behalten: eine aktive Person oder eine Gruppe mit mindestens einem aktiven Mitglied, jeweils Mitglied im Workspace des Spaces. Gruppen gelten für den ganzen Mandanten; wer nicht im Workspace ist, kommt trotz Gruppe nicht in den Space und zählt deshalb nicht. Den letzten zu entfernen, lehnt die Datenbank ab, ebenso das Entfernen des letzten aktiven Mitglieds aus einer Admin-Gruppe und das Löschen einer solchen Gruppe. Nicht abfangen lässt sich, dass der letzte Admin deaktiviert wird oder der Login-Dienst die letzte Person aus einer Admin-Gruppe nimmt, weil sich dabei keine Grants ändern. Dann setzt ein Organisations-Admin einen neuen Admin.

Wird die Vererbung wieder eingeschaltet, fallen die Grants der Seite weg und sie erbt wieder.

### Organisations-Admins

Ein Organisations-Admin sieht Inhalte **nicht automatisch**. Die Personalplanung bleibt auch für die IT-Leitung verborgen, wenn sie nicht freigegeben ist. Ein Organisations-Admin kann sich aber auf jedem Space oder jeder eingeschränkten Seite Rechte geben, z. B. wenn der einzige Admin das Unternehmen verlassen hat. Das ist ein bewusster Notausgang und steht immer im Audit-Log.

### „Ansehen als …“

Ein Space-Admin kann den Seitenbaum oder die Suche so sehen, wie eine bestimmte Person sie sieht. Das ist das wichtigste Prüfwerkzeug nach einem Import: Sieht Max nach der Migration wirklich nur, was er auch in Confluence gesehen hat?

Weil die API die Rechte anderer Personen bewusst nicht abfragen darf, gibt es dafür eine eigene Funktion, `app.view_as(space, person, handelnde_person)`:

- Aufrufen dürfen nur Admins des Spaces und Organisations-Admins. Jeder Aufruf steht im Audit-Log.
- Sie liefert nur die **Struktur**: jede Seite mit Titel, Platz im Baum und der Rolle der Person, keine Inhalte. Seiten, die die Person nicht lesen darf, stehen mit „kein Zugriff“ drin; genau die will man beim Prüfen sehen.
- Seiten mit eigenen Rechten, die die handelnde Person **nicht selbst verwaltet**, fehlen ganz. Anna sieht über „Ansehen als Max“ also nicht, dass es Lukas' private Seite gibt. Das Werkzeug soll Rechte prüfen, nicht verborgene Bereiche aufdecken.
- Die Suche „als Max“ filtert die API selbst: Sie zeigt von ihren Treffern nur die Seiten, für die Max eine Rolle hat.

### Gäste

Gäste sind Mitglieder mit Rolle `guest`. „Alle im Workspace“ gilt für sie nicht. Sie sehen nur Spaces und Seiten, auf denen sie selbst oder eine ihrer Gruppen ausdrücklich ein Recht haben. Im MVP sind Gastzugänge noch nicht vorgesehen (Epic E18), das Datenmodell kann sie aber schon.

### Wer aus einem Workspace entfernt wird

Verliert sofort jeden Zugriff (Schritt 1 oben), und seine persönlichen Grants auf Spaces und Seiten dieses Workspaces werden gelöscht (`app.remove_workspace_member`). Wird die Person später wieder eingeladen, beginnt sie ohne alte Rechte. Ist sie irgendwo der letzte wirksame Admin, auch über eine Gruppe, lehnt die Datenbank das Entfernen ab, bis ein anderer Admin bestimmt ist. Ihre offenen Verbindungen zum Collab-Server werden getrennt.

---

## 5. Login und Sitzung

NoteFieber baut kein eigenes Login. Angemeldet wird über **Zitadel**, den Login-Dienst, den auch TalkFieber nutzt. Die App spricht mit Zitadel nur über den Standard **OpenID Connect (OIDC)**. Dadurch kann ein Kunde später auch sein eigenes Login anbinden, etwa Microsoft Entra ID, über Zitadel oder im On-Prem-Paket direkt.

### Der Weg vom Klick bis zur Sitzung

1. **Mandant finden.** Aus der Adresse oder einer Eingabe kennt die App den Kurznamen des Mandanten (`alpenwerk`). `app.resolve_tenant` liefert dazu die Mandanten-ID und die Organisation in Zitadel. Diese Funktion funktioniert schon vor dem Login.
2. **Weiterleitung zu Zitadel.** Die Person meldet sich dort an, mit Passwort, Passkey oder über das Firmen-Login. Technisch ist das der OIDC *Authorization Code Flow* mit PKCE.
3. **Zurück zur API.** Zitadel leitet mit einem einmaligen Code zurück. Die API tauscht ihn gegen Tokens und prüft, dass die Organisation im Token zur `idp_org_id` des Mandanten passt.
4. **Person zuordnen.** Über Mandant und `users.idp_subject` findet die API die Person. `idp_subject` ist pro Mandant eindeutig, nicht global: Dieselbe Person aus Zitadel, etwa ein Dienstleister, kann in mehreren Mandanten je ein eigenes Konto haben. Bei der ersten Anmeldung kommt sie über eine Einladung: `app.find_invite` prüft den Link, `app.accept_invite` legt die Person an und macht sie zum Mitglied des Workspaces. Die API nimmt die Einladung nur an, wenn die bestätigte E-Mail aus dem Login zur Einladung passt; gehört das Login schon einer Person (etwa nach einer Änderung der E-Mail im Login-Dienst), wird genau diese Mitglied; gab es die Person schon ohne Login, wird es verknüpft. Ohne Einladung lehnt die API Personen ab, die es im Mandanten nicht gibt. Das Konto beim Login-Dienst legt NoteFieber nie an: Es entsteht beim Kunden über SSO oder durch eine Admin in Zitadel.
5. **Gruppen.** Gruppen kommen nicht aus dem Token, sie stehen im Wiki ([Personen und Gruppen](#personen-und-gruppen)). Erst wenn ein Login-Dienst einen Gruppen-Claim liefert, gleicht `app.sync_user_groups` die Gruppen mit Quelle `idp` ab.
6. **Sitzung.** Die API setzt das Sitzungs-Cookie `nf_session` (`HttpOnly`, `Secure`, `SameSite=Lax`) mit einem zufälligen Token; in der Tabelle `sessions` steht nur sein SHA-256-Hash (`app.create_session`). Die Tokens von Zitadel bleiben auf dem Server, werden nach der Prüfung verworfen und kommen nie in den Browser. Weil Oberfläche und API unter derselben Adresse laufen (`/` und `/api`; lokal leitet das Frontend `/api` weiter), funktioniert das ohne CORS. Ändernde Anfragen nimmt die API nur von der eigenen Adresse an (`Origin`). Umgesetzt in `apps/api/src/auth/`, Ablauf und Fehlerfälle in [LOCAL_SETUP.md, Abschnitt 7](LOCAL_SETUP.md#anmelden).

### Bei jeder Anfrage

Die API findet die Sitzung über den Hash des Cookies (`app.resolve_session`, gilt nur für aktive Personen in nicht gekündigten Mandanten), liest daraus Mandant und Person und setzt beides zu Beginn jeder Datenbank-Transaktion (`app.tenant_id`, `app.user_id`). Ab da arbeiten alle Rechteprüfungen in der Datenbank für genau diese Person.

### Für den Collab-Server

Die WebSocket-Verbindung zum Collab-Server bekommt kein Sitzungs-Cookie, sondern ein **kurzlebiges Token**, das der Browser vorher bei der API holt. *Empfehlung:* signiert, etwa eine Minute gültig, mit Mandant, Person und Seite. Der Collab-Server prüft es in `onAuthenticate` und fragt die API nach der Rolle der Person auf dieser Seite.

### Abmelden, deaktivieren, entfernen

- **Logout** löscht die Sitzung (`app.end_session`), meldet bei Zitadel ab (mit dem ID-Token aus dem Login als `id_token_hint`, damit Zitadel seine Sitzung ohne Kontenauswahl beendet) und trennt offene Verbindungen zum Collab-Server (sobald es ihn gibt, E04).
- **Deaktivierte Personen** haben sofort keinen Zugriff mehr: `app.set_user_active` löscht ihre Sitzungen, und die Rechte-Berechnung prüft `deactivated_at` ohnehin bei jeder Anfrage.
- **Aus dem Workspace entfernte Personen** verlieren Zugriff und persönliche Rechte (siehe [Rechte](#4-rechte)).

---

## 6. Gemeinsames Bearbeiten in Echtzeit

Mehrere Personen können dieselbe Seite gleichzeitig bearbeiten und sehen die Cursor der anderen, wie in Google Docs.

### Das Problem und die Lösung: CRDT

Wenn zwei Personen gleichzeitig an derselben Stelle tippen, darf weder ein Text verloren gehen noch ein Durcheinander entstehen. Klassisch würde man sperren („Seite wird gerade von Lukas bearbeitet“) oder beim Speichern einen Konflikt melden. Beides ist für Nutzer schlecht.

NoteFieber nutzt stattdessen **Yjs**, eine Bibliothek für **CRDTs** (Conflict-free Replicated Data Types). Vereinfacht: Jede Änderung wird als kleines „Update“ beschrieben, das sich mit allen anderen Updates in beliebiger Reihenfolge zusammenführen lässt, und am Ende haben alle denselben Text. Es gibt keine Konflikte und keine Sperren.

### Wer was macht

- **Im Browser** läuft der Editor **BlockNote** (Notion-artige Blöcke) mit einem Yjs-Dokument pro Seite.
- Der **Collab-Server** (Hocuspocus) verteilt die Updates zwischen allen Browsern, die dieselbe Seite offen haben, und speichert den Stand in der Datenbank.
- **Cursor und Anwesenheit** („Sophie ist gerade hier“) laufen über Yjs *Awareness*. Sie werden nie gespeichert.

### Ablauf einer Bearbeitung

```
Browser                          Collab-Server                 API               Datenbank
   │  1. Token holen  ───────────────────────────────────────►  │
   │  2. WebSocket öffnen, Dokument page:<id>  ─►│               │
   │                                             │ 3. Rolle?  ─► │ app.page_role()
   │                                             │ ◄── editor ── │
   │                                             │ 4. Inhalt laden ───────────────►  page_contents.ydoc
   │  ◄── aktueller Stand ───────────────────────│
   │  5. tippt … Updates ──────────────────────► │ ─► an alle anderen Browser
   │                                             │ 6. alle ~2 s: app.store_content ─► ydoc, JSON, Klartext, Titel
   │                                             │                                    + Event in outbox
```

Wichtig dabei:

- **Lesende und Kommentierende** bekommen eine **schreibgeschützte** Verbindung. Sie sehen Änderungen live, können aber nichts ändern.
- Nur der Collab-Server darf den Inhalt speichern (Datenbankrolle `wiki_worker`). Die API kann es nicht, ein Leser erst recht nicht.
- **Ändern sich Rechte**, während jemand eine Seite offen hat (Recht geändert, Vererbung gekappt, Seite in einen anderen Rechtebereich verschoben, Person entfernt, herabgestuft oder deaktiviert, Space archiviert), trennt der Collab-Server die betroffenen Verbindungen. Sie melden sich neu an und bekommen die neue Rolle oder keinen Zugang mehr.
- **Der Titel lebt im Yjs-Dokument** (`Y.Text` „title“) und wird nur im Editor geändert. `pages.title` ist eine Kopie, die `store_content` schreibt. Lädt der Collab-Server eine neue, noch leere Seite, schreibt er deshalb zuerst den Titel aus `pages.title` ins Dokument, sonst würde das erste Speichern ihn leeren. Hat eine solche Seite schon BlockNote-JSON (aus den Testdaten oder später aus dem Import), baut er das Dokument daraus. So müssen Import und Testdaten kein Yjs erzeugen.
- Beim Speichern schreibt der Collab-Server zusätzlich das **BlockNote-JSON** (dieselben Blöcke als lesbares JSON, für Export, Import und einen späteren Editorwechsel) und **Klartext** für Suche (und später KI). Die Yjs-Daten selbst sind binär, an BlockNote und ProseMirror gebunden und für alles andere unbrauchbar.

### Kein echter Offline-Modus

Kurze Funklöcher überbrückt Yjs von selbst. Stundenlang offline arbeiten und danach zusammenführen ist im MVP nicht vorgesehen, weil sich zwischendurch Rechte geändert haben könnten.

---

## 7. Versionen, Papierkorb und Kommentare

### Versionen

Jede Seite hat eine **Versionshistorie** mit fortlaufender Nummer (1, 2, 3 …). Eine Version ist ein vollständiger Schnappschuss: Titel, Yjs-Zustand, Klartext und die Liste der Personen, die seit der letzten Version bearbeitet haben.

| Art | Wann |
|---|---|
| `auto` | Der Worker legt sie an, wenn eine Seite 10 Minuten nicht bearbeitet wurde |
| `manual` | Jemand mit Bearbeitungsrecht klickt „Version speichern“ (`app.save_version`) |
| `restore` | Eine alte Version wurde wiederhergestellt |
| `import` | Version aus Confluence übernommen |

**Wiederherstellen überschreibt nichts.** Die API prüft zuerst das Bearbeitungsrecht. Der alte Stand wird als neue Änderung auf die aktuelle Seite angewendet, und es entsteht eine neue Version vom Typ `restore`. Die Historie bleibt linear und vollständig.

### Papierkorb

Gelöscht wird nie sofort, sondern in den **Papierkorb** (`app.trash_page`):

- Eine Seite geht immer **mit allen Unterseiten** in den Papierkorb.
- Das geht nur, wenn man **jede** Seite in diesem Teilbaum bearbeiten darf. Liegt darunter eine eingeschränkte Seite, die man nicht bearbeiten darf, wird abgelehnt.
- Die **Startseite** eines Spaces lässt sich nicht löschen.
- Wiederherstellen (`app.restore_page`) holt genau die Seiten zurück, die gemeinsam gelöscht wurden (über `trash_root_id`).
- Nach 30 Tagen löscht ein Worker endgültig.

### Verschieben

Eine Seite wird **mit ihrem ganzen Teilbaum** verschoben (`app.move_page`), auch mit Unterseiten, die die handelnde Person gar nicht sieht. Das ist Absicht: Sonst würde ein Baum zerreißen. Eine Seite unter sich selbst zu verschieben, lehnt die Datenbank ab. Verschieben zwischen Spaces ist im MVP nicht vorgesehen. Auch das Umsortieren unter derselben Elternseite läuft über `app.move_page`.

Ändert sich durch das Verschieben, woher eine Seite ihre Rechte bekommt, gilt eine Zusatzregel: Wer eine Seite **aus einem Bereich mit eigenen Rechten herausschiebt, muss dort Admin sein**. Sonst könnte ein Bearbeiter eine vertrauliche Seite unter eine offene Elternseite ziehen und sie damit für den ganzen Space freigeben. Hinein genügt Bearbeitungsrecht am Ziel. Alle Änderungen am Seitenbaum eines Spaces laufen nacheinander (`app.lock_tree`), damit gleichzeitiges Verschieben keine Zyklen und keine veralteten Pfade erzeugt.

### Kommentare

- **Seitenkommentare** gelten für die ganze Seite, **Kommentare an Textstellen** hängen an einer markierten Stelle. Die Stelle ist als relative Yjs-Position gespeichert und wandert mit, wenn davor Text eingefügt wird.
- Antworten gibt es **eine Ebene tief** (Thread mit Antworten, keine Antworten auf Antworten).
- Ein Thread lässt sich **als erledigt markieren**. Eine neue Antwort öffnet ihn wieder.
- **Löschen überschreibt den Inhalt** mit `NULL`. Ein reines „gelöscht“-Kennzeichen reicht für die DSGVO nicht, deshalb erzwingt die Datenbank, dass gelöschte Kommentare keinen Text mehr haben. Fremde Kommentare löschen nur Admins der Seite (bei eingeschränkten Seiten deren Admins, sonst Space-Admins).
- Eigene Kommentare lassen sich bearbeiten (`app.edit_comment`). Auf Seiten im Papierkorb lässt sich nicht kommentieren.

---

## 8. Dateien

Anhänge und Bilder liegen nicht in der Datenbank, sondern in **Garage**, einem S3-kompatiblen Speicher. In der Datenbank steht nur ein Eintrag in `files` mit Name, Typ, Größe, Prüfstatus und dem Schlüssel des Objekts in Garage (`storage_key`).

### Hochladen

1. Der Browser meldet bei der API einen Upload an: Seite, Dateiname, Größe, Typ.
2. Die API prüft das Größenlimit (Wert noch festzulegen).
3. Die API legt den Eintrag in `files` an (`scan_status = 'pending'`, zufälliger `storage_key`). Die Datenbank prüft dabei selbst: im eigenen Namen, ungeprüft, und an einer Seite nur mit **Bearbeitungsrecht**. Dann gibt die API eine **signierte Upload-URL** zurück, die nur wenige Minuten gilt.
4. Der Browser lädt die Datei **direkt in Garage**. Die API muss die Bytes nicht durchreichen.
5. Der Worker prüft die Datei auf Viren (z. B. mit ClamAV) und setzt `scan_status` auf `clean`, `infected` oder `error`.

### Herunterladen und anzeigen

- Nur Dateien mit `clean` werden ausgeliefert. Blockierte Dateien erscheinen gekennzeichnet.
- Die API prüft das **Leserecht** auf die Seite. Die Datenbank tut es zusätzlich: Ein Eintrag in `files` ist nur sichtbar, wenn die Seite sichtbar ist.
- Dann stellt die API eine **signierte Download-URL** aus, die nur kurz gilt. Eine erratene oder weitergeleitete URL nützt nach Ablauf nichts.
- *Empfehlung:* Dateien, die der Browser ausführen könnte (HTML, SVG), immer als Download ausliefern (`Content-Disposition: attachment`) und `X-Content-Type-Options: nosniff` setzen. Sonst könnte eine hochgeladene Datei Skripte im Namen anderer ausführen.

### Sonderfälle

- **Profilbilder** hängen an keiner Seite und sind für alle im Mandanten sichtbar. Als Profilbild lässt sich nur eine eigene Datei ohne Seite eintragen, sonst könnte jemand einen fremden Anhang so für alle sichtbar machen.
- **Löschen** (`deleted_at`) dürfen die hochladende Person und Bearbeitende der Seite.
- **Import-Archive** hängen an keiner Seite und sind nur für die hochladende Person sichtbar.
- Wird eine Seite **endgültig gelöscht**, fallen ihre Datei-Einträge mit weg. Ein Worker löscht danach die Objekte in Garage.

---

## 9. Suche

Gesucht wird mit der eingebauten Volltextsuche von PostgreSQL. Das ist ein System weniger als eine eigene Suchmaschine und reicht für den Start weit.

### Wie der Index entsteht

Nach jedem gespeicherten Stand (`page.updated`) schreibt der Worker den Suchindex der Seite neu. Er besteht aus einem `tsvector`: einer Liste der Wortstämme mit Gewicht. Titel zählen stärker als der Text.

```sql
-- Worker, als wiki_worker
INSERT INTO page_search (page_id, tenant_id, space_id, tsv)
SELECT p.id, p.tenant_id, p.space_id,
       setweight(to_tsvector('german', p.title), 'A') ||
       setweight(to_tsvector('german', c.plain_text), 'B')
FROM pages p JOIN page_contents c ON c.page_id = p.id
WHERE p.id = $1
ON CONFLICT (page_id) DO UPDATE SET tsv = EXCLUDED.tsv, updated_at = now();
```

Die Sprachkonfiguration `german` versteht deutsche Wortformen: Eine Suche nach „Sicherung“ findet auch „Sicherungen“, „Seite“ auch „Seiten“. Englische Lehnwörter erkennt sie nicht: „Backup“ findet „Backups“ nicht (mit den Testdaten geprüft). Dafür gibt es die Titel-Schnellsuche (Trigramme) und, falls nötig, eine Präfixsuche (`backup:*`). Später ist die Sprache pro Mandant wählbar.

### Wie gesucht wird

```sql
-- API, als wiki_app: die Leseregeln filtern automatisch
SELECT p.id, p.title, s.key, ts_rank_cd(ps.tsv, q) AS rank
FROM page_search ps
JOIN pages p  ON p.id = ps.page_id AND p.deleted_at IS NULL
JOIN spaces s ON s.id = p.space_id,
     websearch_to_tsquery('german', $1) AS q
WHERE ps.tsv @@ q
ORDER BY rank DESC
LIMIT 20;
```

- `websearch_to_tsquery` versteht, was Nutzer von Suchmaschinen kennen: `"genaue Wortfolge"`, `-ausschließen`, `or`.
- Die **Textausschnitte** mit hervorgehobenen Treffern erzeugt `ts_headline` aus `page_contents.plain_text`.
- **Filter** nach Space, Autor und Zeitraum sind einfache Bedingungen auf `pages`.
- Die **Schnellsuche nach Titeln** beim Tippen (für Links und die Suchleiste) nutzt den Trigramm-Index auf `pages.title`. Er findet Teilwörter und verzeiht Tippfehler.

### Rechte in der Suche

Die Suchanfrage läuft als `wiki_app`. Ein Eintrag in `page_search` ist nur sichtbar, wenn die Person die Seite lesen darf. Es gibt also keinen Treffer, keinen Titel und keine Trefferzahl für Seiten ohne Leserecht. **Seiten im Papierkorb** entfernt der Worker bei `page.trashed` aus dem Index. Weil die Leseregel sie nicht von selbst ausblendet (die Papierkorb-Ansicht braucht sie), filtert die Abfrage trotzdem `deleted_at IS NULL`, für die Zeit, bis der Worker nachgezogen hat.

### Grenzen

Ziel ist eine Antwort unter einer Sekunde bei 100.000 Seiten pro Mandant. Wird es mehr, oder sollen Dateiinhalte durchsucht werden, kommt **OpenSearch** dazu. Weil der Index schon heute über Ereignisse des Workers gepflegt wird, ändert sich an der App dabei wenig.

---

## 10. Der Confluence-Import

Der Import ist das Feature, das Kaufentscheidungen trifft. Wenn die erste Migration hässlich aussieht, ist der Kunde weg.

**Ablauf:**

1. Ein Space-Admin lädt einen **Space-Export** aus Confluence hoch (HTML oder XML). Er wird auf Viren geprüft.
2. **Probelauf** (Standard): Der Worker liest den Export und schreibt einen Bericht, ohne etwas anzulegen. Darin steht, was übernommen wird, was als Platzhalter kommt und was übersprungen wird.
3. **Gruppen zuordnen:** Jede Confluence-Gruppe wird einer vorhandenen Gruppe im Wiki zugeordnet, als neue Gruppe übernommen (Quelle `import`, mit ihren Mitgliedern) oder bewusst nicht übernommen.
4. **Echter Import:** Seiten, Hierarchie, Inhalte, Anhänge, optional Versionen, Erstellende und Datum.
5. **Rückgängig** machen ist jederzeit möglich.

**Wichtige Begriffe:**

- **Makros** sind Confluence-Bausteine (Inhaltsverzeichnis, Info-Box, Jira-Liste …). Häufige werden in passende Blöcke übersetzt. Was nicht geht, wird ein sichtbarer **Platzhalter-Block** mit dem Originalinhalt, damit nichts unbemerkt verschwindet.
- **Rechte:** Eine in Confluence eingeschränkte Seite wird eine Seite mit eigenen Rechten. Ziel: Nach dem Import sieht niemand mehr als vorher.
- **`import_items`** merkt sich für jede Confluence-Seite, welche neue Seite daraus wurde. Damit lassen sich interne Links umschreiben, und ein wiederholter Import legt nichts doppelt an.

---

## 11. Das Datenmodell

Alle Daten liegen in **PostgreSQL**. Das ER-Diagramm steht in `docs/data_model.mmd` bzw. `docs/data_model.svg`.

### Die Tabellen im Überblick

| Bereich | Tabellen | Inhalt |
|---|---|---|
| Mandanten und Personen | `tenants`, `users`, `workspaces`, `workspace_members`, `groups`, `group_members`, `invites` | Wer gehört wozu (gleiches Modell wie TalkFieber) |
| Wiki-Struktur | `spaces`, `pages` | Bereiche und Seitenbaum |
| Inhalt | `page_contents`, `page_versions` | Aktueller Stand und Historie |
| Abgeleitet | `page_search`, `page_links` | Suchindex und Verlinkungen, vom Worker gepflegt |
| Rechte | `grants` | Wer welche Rolle auf welchem Space oder welcher Seite hat |
| Zusammenarbeit | `comments`, `files` | Kommentare und Anhänge |
| Import | `imports`, `import_items` | Importläufe und Zuordnung Confluence → NoteFieber |
| Querschnitt | `outbox`, `audit_log` | Ereignisse und Protokoll |

### Konventionen, die überall gelten

- **IDs sind UUIDv7.** Das sind UUIDs, die mit einem Zeitstempel beginnen. Sie sind weltweit eindeutig, können schon in der App erzeugt werden und sortieren sich nach Entstehungszeit. PostgreSQL 18 erzeugt sie mit `uuidv7()`.
- **Jede Tabelle hat `tenant_id`**, auch dort, wo man sie aus einer anderen Tabelle ableiten könnte. Nur so kann die Datenbank die Mandanten in jeder Tabelle direkt trennen.
- **Fremdschlüssel enthalten den Mandanten** (z. B. `FOREIGN KEY (page_id, tenant_id) REFERENCES pages (id, tenant_id)`). Damit kann ein Kommentar technisch gar nicht auf eine Seite eines anderen Mandanten zeigen.
- **Text ist `text` mit Grenzen per `CHECK`** (Titel bis 255 Zeichen, Kommentar bis 10.000), nicht `varchar`. Die API prüft zusätzlich und liefert verständliche Fehlermeldungen.

### Der Seitenbaum: `parent_id`, `path` und `position`

Ein Baum in einer relationalen Datenbank braucht drei Dinge:

- **`parent_id`** zeigt auf die Elternseite. Ein Fremdschlüssel stellt sicher, dass sie im selben Space liegt.
- **`path`** (Typ `ltree`) ist der Weg von der Wurzel zur Seite, aus den IDs gebildet, z. B. `a1b2….c3d4….e5f6…`. Damit beantwortet ein einziger Index-Zugriff Fragen wie „alle Seiten unter Architektur“ (`path <@ …`) oder „alle Seiten über Datenmodell“ (`path @> …`). Genau das braucht die Rechte-Berechnung. Den Pfad setzt ein Trigger beim Anlegen, ändern kann ihn nur `app.move_page`.
- **`position`** legt die Reihenfolge unter Geschwistern fest, als **Fractional Index**: kurze Zeichenketten, die sich sortieren lassen und zwischen die man immer eine neue einfügen kann (zwischen `a0` und `a1` passt `a0V`). Beim Umsortieren ändert sich so nur eine Zeile, nicht alle Geschwister. Die App erzeugt sie mit dem npm-Paket `fractional-indexing`; ohne Angabe hängt die Datenbank eine neue Seite hinter alle Geschwister, auch die unsichtbaren. Positionen sind unter Geschwistern **nicht eindeutig**, weil die App eingeschränkte Geschwister nicht sieht. Sortiert wird deshalb immer mit `ORDER BY position, id`.

Ein Wiki wird viel öfter gelesen als umgebaut. Deshalb ist Lesen billig (ein Pfad-Vergleich) und Verschieben etwas teurer (alle Pfade im Teilbaum neu schreiben).

### Der Inhalt: `page_contents`

- **`ydoc`**: der vollständige Yjs-Zustand als Binärdaten. Das ist der eigentliche Inhalt.
- **`content_json`**: derselbe Inhalt als BlockNote-JSON, bei jedem Speichern mitgeschrieben. Export, Import und ein späterer Wechsel des Editors arbeiten damit, ohne Yjs lesen zu müssen. Ist es einmal zu groß (über 20 MB) oder ungültig, bleibt es leer, statt das Speichern scheitern zu lassen; dann gilt nur `ydoc`. Versionen bekommen eine Kopie, damit sich auch alte Stände exportieren lassen.
- **`plain_text`**: abgeleiteter Klartext für Suche und später KI.
- **`editors_since_version`**: wer seit der letzten Version bearbeitet hat. Wird beim Anlegen einer Version in deren `author_ids` übernommen und geleert.

### Outbox und Audit-Log

- Die **Outbox** ist eine Tabelle, in die jede Änderung in **derselben Transaktion** ein Ereignis schreibt (`page.created`, `page.moved`, `grant.changed` …). Ein Worker liest sie und verteilt die Ereignisse weiter: an den Suchindex, an Benachrichtigungen, später an TalkFieber. Der Vorteil dieses **Outbox-Patterns**: Ein Ereignis geht nie verloren und wird nie verschickt, ohne dass die Änderung wirklich gespeichert ist. Das Subject folgt dem Muster `t.<tenant>.wiki.s.<space>`. Alle Ereignisse stehen in [Abschnitt 13](#13-ereignisse-in-der-outbox).
- Das **Audit-Log** hält sicherheitsrelevante Aktionen fest: Rechte, Vererbung, Papierkorb, Verschieben, Import, Export, „Ansehen als …“, Löschen fremder Kommentare, Wiederherstellung durch Organisations-Admins. Die App kann nur anfügen, nie ändern oder löschen. Lesen dürfen es nur Organisations-Admins.

---

## 12. Sicherheit in der Datenbank

NoteFieber verlässt sich nicht nur darauf, dass die App Rechte richtig prüft. Die Datenbank prüft selbst. Das nennt man **Verteidigung in der Tiefe**: Ein Fehler in einer Schicht reicht nicht für ein Datenleck.

### Row Level Security (RLS)

Mit RLS hängt an jeder Tabelle eine Regel („Policy“), welche Zeilen eine Datenbankverbindung sehen und schreiben darf. NoteFieber hat zwei Arten:

1. **Mandantentrennung** auf jeder Tabelle: nur Zeilen mit `tenant_id = app.current_tenant()`.
2. **Leserechte** für Anfragen von Personen: z. B. auf `pages` nur Zeilen, für die `app.page_rank(id) >= 1`. Alles, was an einer Seite hängt (Inhalt, Versionen, Suchtreffer, Kommentare, Anhänge), ist nur sichtbar, wenn die Seite sichtbar ist.

Die App setzt zu Beginn jeder Transaktion, für wen sie gerade arbeitet:

```sql
SELECT set_config('app.tenant_id', '<uuid des Mandanten>', true);
SELECT set_config('app.user_id',   '<uuid der Person>',    true);
```

Ist nichts gesetzt, ist **nichts** sichtbar. Ein vergessener Kontext führt also zu leeren Ergebnissen, nie zu fremden Daten.

### Drei Datenbankrollen

| Rolle | Wer | Was gilt |
|---|---|---|
| `wiki_owner` | nur Migrationen | Besitzt die Tabellen und **umgeht RLS**. Die App verbindet sich **nie** so |
| `wiki_app` | API (Anfragen von Personen) | Mandantentrennung **und** Leserechte |
| `wiki_worker` | Collab-Server, Worker | Nur Mandantentrennung. Darf als Einzige Inhalte speichern und automatische Versionen anlegen |

### Schreiben nur über Funktionen

`wiki_app` schreibt fast nur über Funktionen im Schema `app`. Direkt erlaubt sind wenige Fälle, jeweils durch eine Regel abgesichert: das eigene Profil, Einladungen und Workspaces (nur wer sie verwaltet) und Datei-Uploads. Neue Personen (nur über Einladungen, `accept_invite`), Seiten, Rechte, Mitgliedschaften, Gruppen, Inhalt, Versionen, Kommentare, Import, Outbox und Audit-Log gehen nur über Funktionen wie `create_space`, `archive_space`, `create_page`, `move_page`, `trash_page`, `restore_page`, `set_grant`, `set_page_inheritance`, `add_workspace_member`, `remove_workspace_member`, `set_user_active`, `create_group`, `add_group_member`, `add_comment`, `save_version`, `start_import`. Jede Funktion prüft:

- **Ist die handelnde Person die angemeldete?** Niemand kann im Namen anderer handeln (`app.require_actor`).
- **Hat sie die nötige Rolle?** (`app.require_page`, `app.require_space`)

Fast alle diese Funktionen laufen als **`SECURITY DEFINER`**, also mit den Rechten des Eigentümers statt der aufrufenden Verbindung. Das ist nötig, wenn eine Aktion Zeilen betrifft, die die Person nicht sehen darf (beim Verschieben müssen auch die Pfade unsichtbarer Unterseiten angepasst werden). Diese Funktionen prüfen den Mandanten deshalb ausdrücklich. Und deshalb darf das Schema nur `wiki_owner` einspielen, nie der Superuser `postgres`.

Interne Bausteine (Ereignisse schreiben, Audit-Einträge, Rechte anderer Personen abfragen, Versionen ohne Prüfung anlegen) kann `wiki_app` gar nicht aufrufen. Neue Funktionen sind zunächst für niemanden ausführbar, bis eine Migration sie ausdrücklich freigibt. Jede Funktion mit ihren Prüfungen beschreibt [SCHEMA.md](SCHEMA.md), Abschnitt 12.

### Die Tests

`schema_test.sql` prüft das alles in 53 Tests als `wiki_app` und `wiki_worker` (gleichzeitige Sitzungen prüft `schema_concurrency_test.sh`), z. B.: Ein Leser kann weder direkt noch über Funktionen schreiben, eingeschränkte Seiten sind samt Inhalt, Versionen, Suchtreffern, Kommentaren, Dateien und Links unsichtbar, fremde Mandanten sind unsichtbar, jede Tabelle hat RLS. **Jede Änderung am Schema bekommt zuerst einen Test.**

---

## 13. Ereignisse in der Outbox

Jede wichtige Änderung schreibt in derselben Transaktion ein Ereignis in die Tabelle `outbox`. Ein Worker veröffentlicht sie (sortiert nach `id`) und setzt `published_at`. Später gehen sie über NATS auch an TalkFieber.

| Ereignis | Ausgelöst von | Inhalt (`payload`) |
|---|---|---|
| `space.created` | `app.create_space` | `id`, `key`, `name`, `home_page` |
| `space.updated` | `app.update_space` | `id`, `name` |
| `space.archived` | `app.archive_space` | `id`, `archived` (`true` oder `false`) |
| `page.created` | `app.create_page` | `id`, `parent`, `title`, `position`, `by` |
| `page.updated` | `app.store_content` | `id`, `title`, `editors` |
| `page.moved` | `app.move_page` | `id`, `from_parent`, `to_parent`, `position` |
| `page.trashed` | `app.trash_page` | `id`, `count` (Seiten im Teilbaum) |
| `page.restored` | `app.restore_page` | `id`, `count` |
| `page.permissions_changed` | `app.set_page_inheritance`, `app.move_page` | `id`, `inherit`; beim Verschieben `reason: moved`, `from_source`, `to_source` |
| `grant.changed` | `app.set_grant`, `app.delete_group` | `space` oder `page`, `subject_type`, `user`, `group`, `role` (`null` = entfernt); beim Löschen einer Gruppe an jeden Space, in dem sie Rechte hatte |
| `comment.created` | `app.add_comment` | `id`, `page`, `parent`, `author` |
| `import.requested` | `app.start_import` | `id`, `dry_run` |
| `member.removed` | `app.remove_workspace_member` | `user`, `workspace` |
| `member.changed` | `app.set_workspace_member_role`, `app.add_group_member`, `app.remove_group_member` | `user`, `workspace`, `role` bzw. `user`, `group` (an jeden Space, in dem die Gruppe Rechte hat) |
| `user.deactivated` | `app.set_user_active` | `user` |

Die drei Ereignisse zu Personen gehen an jeden Space des betroffenen Workspaces (bei `user.deactivated` aller Workspaces der Person), damit jeder Collab-Server sie mitbekommt.

**Wer zuhört:**

- **Worker:** Suchindex und Verlinkungen bei `page.updated`, Zeitgeber für automatische Versionen, Import bei `import.requested`, später Benachrichtigungen.
- **Collab-Server:** trennt Verbindungen bei `grant.changed`, `page.permissions_changed`, `member.removed`, `member.changed`, `user.deactivated` und `space.archived`, damit neue Rechte sofort gelten.
- **Später TalkFieber:** Link-Vorschauen, Benachrichtigungen im Chat.

**Regeln für Empfänger:**

- Ereignisse kommen **mindestens einmal** an, in Ausnahmefällen doppelt. Jeder Empfänger muss damit umgehen können (idempotent sein).
- Ereignisse enthalten IDs und wenige Felder, **keinen Seiteninhalt**. Wer einer Person etwas daraus anzeigt (eine Benachrichtigung, eine Vorschau), prüft vorher deren Rechte. Ein Titel in einem Ereignis ist keine Erlaubnis, ihn zu zeigen.

---

## 14. Die Architektur

NoteFieber ist ein **modularer Monolith**: ein Code-Repository, wenige Prozesse, eine Datenbank. Keine Microservices. Das hält Entwicklung und Betrieb für ein kleines Team beherrschbar.

```
                         Browser
            (Next.js-Oberfläche, BlockNote-Editor)
                 │                         │
         HTTPS · REST                 WebSocket (Yjs)
                 ▼                         ▼
   ┌─────────────────────┐      ┌─────────────────────┐
   │ API (Express)        │◄─────│ Collab-Server        │
   │ Seiten, Rechte,      │Rechte│ (Hocuspocus)         │
   │ Suche, Kommentare,   │prüfen│ Yjs-Sync, Cursor,    │
   │ Import starten       │      │ Speichern            │
   └──────────┬──────────┘      └──────────┬──────────┘
              │      wiki_app      wiki_worker │
              ▼                                ▼
        ┌────────────────────────────────────────────┐
        │ PostgreSQL: Struktur, Rechte, Inhalt,       │
        │ Versionen, Suche, Outbox, Audit-Log         │
        └────────────────────────────────────────────┘
              ▲
   ┌──────────┴──────────┐     ┌──────────┐     ┌──────────┐
   │ Worker               │     │ Garage   │     │ Zitadel  │
   │ Suchindex, Versionen,│     │ Dateien  │     │ Login    │
   │ Links, Import, Export│     │ (S3)     │     │ (OIDC)   │
   └─────────────────────┘     └──────────┘     └──────────┘
```

### Die Prozesse

| Prozess | Aufgabe | Zustand |
|---|---|---|
| **Frontend** (Next.js) | Liefert die Oberfläche aus. **Nur Oberfläche:** keine Geschäftslogik, alle Daten kommen über die API | zustandslos |
| **API** (Express) | Alles außer dem Text selbst: Spaces, Seitenbaum, Rechte, Suche, Kommentare, Dateien, Import starten, Export | zustandslos |
| **Collab-Server** (Hocuspocus) | Verteilt und speichert Yjs-Änderungen | hält offene Dokumente im Speicher, deshalb im MVP genau eine Instanz |
| **Worker** | Hintergrundarbeit über eine Job-Queue in PostgreSQL: Suchindex, Links, automatische Versionen, Import, Export, Outbox, endgültiges Löschen | zustandslos |

### Warum zwei Wege zum Server?

Struktur und Rechte sind klassische Anfragen („gib mir den Seitenbaum“, „ändere dieses Recht“) und laufen über **REST**. Der Text dagegen ändert sich bei jedem Tastendruck und muss sofort bei allen ankommen. Dafür ist eine dauerhafte **WebSocket**-Verbindung nötig. Beide schreiben in dieselbe Datenbank, es gibt also nur eine Wahrheit.

### Dateien

Anhänge und Bilder liegen nicht in der Datenbank, sondern in **Garage**, einem S3-kompatiblen Speicher. Hoch- und heruntergeladen wird direkt dort, über **signierte, kurzlebige URLs**, die die API erst nach der Rechteprüfung ausstellt. Eine erratene URL nützt nichts. Details in [Abschnitt 8](#8-dateien).

---

## 15. Der Stack und warum

Leitlinie: **bewährte Technik, eine Sprache, offene Lizenzen ohne Falle.** Innovation nur dort, wo Nutzer sie spüren: im Editor und im Import.

| Baustein | Wahl | Warum | Lizenz |
|---|---|---|---|
| Sprache | **TypeScript** überall | Frontend, API und Collab-Server teilen Typen. Ein Team, ein Build. Wie bei TalkFieber | – |
| Oberfläche | **Next.js** (React) | Verbreitet und bekannt. Wird nur als Oberfläche genutzt | MIT |
| Editor | **BlockNote** | Notion-artige Blöcke, Slash-Menü, Drag & Drop und Yjs-Anbindung fertig. Baut auf Tiptap und ProseMirror. Die XL-Zusatzpakete (GPL-3.0) werden vorerst nicht genutzt | MPL-2.0 |
| Echtzeit | **Yjs + Hocuspocus** | Bewährter CRDT und fertiger Server mit Einstiegspunkten für Login und Speichern | MIT |
| API | **Express 5**, **Zod**, **Drizzle** | Express ist Standard. Zod prüft Eingaben, Drizzle bleibt nah an SQL | MIT |
| Jobs | **pg-boss** | Job-Queue in PostgreSQL, kein zusätzlicher Dienst | MIT |
| Datenbank | **PostgreSQL 18** mit `ltree`, `pg_trgm` | Struktur, Rechte, Inhalt, Volltextsuche und Jobs in einem System | PostgreSQL |
| Login | **Zitadel** | Selbst gehostet, nutzt PostgreSQL, gemeinsam mit TalkFieber. Die App spricht nur **OIDC**, deshalb kann ein Kunde auch Entra ID oder Keycloak anschließen | AGPL-3.0, unverändert genutzt |
| Dateien | **Garage** | Leichtgewichtiger S3-Speicher, europäisches Open-Source-Projekt | AGPL-3.0 |
| Betrieb | **K3s**, Traefik, cert-manager, CloudNativePG | Leichtes Kubernetes. Dieselben Manifeste lokal, auf dem VPS und später beim Kunden | Apache-2.0 |

**Bewusst nicht dabei:** Microservices, Kafka, eine NoSQL-Datenbank, Redis (im MVP), Ende-zu-Ende-Verschlüsselung (sie würde Suche, Import und Export unmöglich machen). Später kommen NATS und Valkey mit TalkFieber, OpenSearch erst, wenn die Suche in PostgreSQL nicht mehr reicht.

**Zur AGPL von Zitadel und Garage:** Diese Lizenz verlangt, dass man *Änderungen an diesen Programmen* offenlegt, wenn man sie als Dienst anbietet. NoteFieber ändert sie nicht und spricht nur über Standard-Schnittstellen mit ihnen. Der eigene Code ist davon nicht betroffen.

---

## 16. Betrieb

### Drei Umgebungen

1. **Lokal:** Node direkt auf dem Rechner, PostgreSQL, Zitadel und Garage per Docker Compose. Hier wird programmiert.
2. **VPS mit K3s:** ein eigener Server (Hostinger, EU-Standort) mit den Namespaces `staging` (Testen) und `pilot` (echte Pilotkunden). Gemeinsam mit TalkFieber, sonst nichts darauf.
3. **Produktiv:** ein Cluster mit mehreren Servern bei einem zertifizierten EU-Anbieter (Hetzner, STACKIT oder IONOS), vor dem ersten zahlenden Geschäftskunden.

Die Kubernetes-Manifeste sind in allen drei Umgebungen dieselben. Der Umzug ist ein Datenumzug, kein Umbau.

### Drei Betriebsmodelle für Kunden

| Modell | Wer betreibt es | Wo liegen die Daten |
|---|---|---|
| **SaaS** | wir | in unserem Cluster, alle Kunden gemeinsam, getrennt per RLS |
| **Eigene Zelle** | wir | in einer komplett getrennten Instanz nur für diesen Kunden, z. B. in Österreich |
| **On-Prem** | der Kunde | auf den Servern des Kunden, installiert per Helm-Chart (Epic E23) |

Viele Confluence-Data-Center-Kunden betreiben heute alles selbst. On-Prem ist für sie wichtig, kommt aber erst nach dem SaaS-Pilot.

### Backups

- **CloudNativePG** sichert die Datenbank laufend (WAL-Archivierung plus tägliche Vollsicherung) in einen S3-Speicher bei einem **anderen Anbieter**. Damit lässt sich jeder beliebige Zeitpunkt wiederherstellen.
- Die Dateien aus Garage werden ebenfalls dorthin gesichert.
- **Die Wiederherstellung wird regelmäßig geprobt.** Ein Backup, das nie zurückgespielt wurde, ist keins.

### Was man über einen einzelnen Server wissen muss

Ein Server heißt: keine Hochverfügbarkeit. Updates und Neustarts kosten ein paar Minuten Ausfall. Für Entwicklung und Piloten ist das in Ordnung, und man sagt es den Pilotkunden offen.

---

## 17. Compliance

Compliance heißt: Kunden müssen Gesetze, Normen und interne Regeln einhalten, und das Wiki muss ihnen dabei helfen. Es hat zwei Seiten.

### Was das Produkt können muss

| Anforderung | Wie NoteFieber sie erfüllt |
|---|---|
| Nur Berechtigte sehen Inhalte | Rechtemodell mit einer zentralen Funktion, RLS in der Datenbank, SSO und später SCIM |
| Nachvollziehbarkeit | Unveränderbares Audit-Log (lesbar nur für Organisations-Admins), Versionen mit Autoren |
| Aufbewahrung und Löschung | Papierkorb, endgültiges Löschen, später Aufbewahrungsrichtlinien. Löschen entfernt Inhalte wirklich (Kommentartext wird überschrieben) |
| DSGVO-Auskunft und -Löschung | Alle Daten einer Person sind über `tenant_id` und Personen-IDs auffindbar (Epic E17) |
| Datenhoheit | Vollständiger Export jederzeit, Daten in der EU, eigene Zelle oder On-Prem möglich |
| Verschlüsselung | TLS, verschlüsselte Datenträger und Backups |

### Was wir als Anbieter nachweisen müssen

Das ist Organisation, kein Code: Auftragsverarbeitungsvertrag (AVV) nach DSGVO, technische und organisatorische Maßnahmen (TOMs), Liste der Subunternehmer, EU-Rechtsträger ohne US-Mutter, Penetrationstests, später ISO 27001 und für Behörden oft BSI C5.

### Welche Regeln je nach Kunde gelten

| Kunde | Typische Anforderungen |
|---|---|
| Alle in der EU | DSGVO |
| Kritische Infrastruktur, viele mittlere und große Firmen | NIS2, inklusive Sicherheit der Lieferkette |
| Banken, Versicherungen | DORA: Regeln für IT-Dienstleister, Ausstiegsstrategie, Prüfrechte |
| Behörden | BSI C5, IT-Grundschutz, oft On-Prem oder eigene Zelle |
| Kliniken, Kanzleien | Berufsgeheimnis, besondere Kategorien personenbezogener Daten |

Welche Regeln im Einzelfall genau gelten, klärt man mit Rechtsberatung, bevor der erste Geschäftskunde unterschreibt.

---

## 18. Zusammenspiel mit TalkFieber

TalkFieber ist das Schwesterprojekt: ein europäischer Team-Chat mit Topics statt Threads. NoteFieber kommt zuerst und legt die gemeinsame Plattform an.

| Gemeinsam | Pro Produkt getrennt |
|---|---|
| Zitadel (ein Login für beide) | OIDC-Clients und Rollen |
| Mandanten-ID und RLS-Muster (App- und Worker-Rolle) | eigene Datenbank (`wiki` bzw. `chat`) im selben PostgreSQL-Cluster |
| Garage | eigener Bucket |
| K3s-Cluster, cert-manager, Backups | eigene Deployments und Domains |
| später NATS und Valkey | eigene Subjects (`t.<tenant>.wiki.*`, `t.<tenant>.c.*`) |
| Designsystem | eigene Oberflächen |

Später verbinden sich die Produkte: Wiki-Links im Chat mit Vorschau (gegen die Wiki-Rechte geprüft), Wiki-Benachrichtigungen als Chat-Nachricht, „Über diese Seite sprechen“ öffnet ein verknüpftes Topic, „Topic als Seite sichern“ macht aus einer Diskussion ein Entscheidungsprotokoll.

Vorbereitet ist das schon heute: gleiche Mandanten-IDs (`app.create_tenant` nimmt eine bestehende ID an) und alle Ereignisse in der Outbox.

---

## 19. Durchgespielte Abläufe

Vier Szenarien zeigen, welche Funktion und welche Tabelle in jedem Schritt beteiligt ist. Sie entsprechen weitgehend den Tests in `schema_test.sql`.

### Szenario 1: Anna legt einen vertraulichen Space an

1. Anna klickt „Neuer Space“, Key `HR`, Name „Personal“, Zugriff für den Workspace: keiner. Die API ruft `app.create_space(…, p_workspace_access => NULL)`.
2. Die Funktion legt in einer Transaktion an: den Space, einen Grant „Anna ist Admin“, die Startseite mit leerem Inhalt, das Ereignis `space.created` und einen Eintrag im Audit-Log.
3. Anna gibt der Gruppe „Personalabteilung“ Bearbeitungsrechte: `app.set_grant(space, NULL, 'group', NULL, <gruppe>, 'editor', anna)`. Ereignis `grant.changed`.
4. Max ist nicht in der Gruppe. Für ihn ergibt `app.space_rank` 0, der Space fehlt schon in seiner Space-Liste. Auch Anna als Organisations-Admin sähe ihn nur, weil sie ihn selbst angelegt hat.

### Szenario 2: Eine Seite wird eingeschränkt, Max sucht sie

1. Anna legt im Space „Entwicklung“ unter „Betrieb“ die Seite „Personalplanung 2027“ an (`app.create_page`, sie braucht dafür Bearbeitungsrecht auf „Betrieb“).
2. Sie öffnet „Teilen und Rechte“ und schaltet „Eigene Rechte“ ein: `app.set_page_inheritance(seite, false, anna)`. Die bisherigen Grants (Anna Admin, Gruppe Entwicklung Bearbeiten, Alle im Workspace Lesen) werden auf die Seite kopiert.
3. Sie entfernt „Alle im Workspace“ und „Gruppe Entwicklung“: zweimal `app.set_grant(…, NULL, anna)`. Jedes Mal entsteht `grant.changed`, und der Collab-Server trennt alle, die die Seite gerade offen haben.
4. Max sucht „Personalplanung“. Die Volltextsuche und die Schnellsuche laufen als `wiki_app`, die Leseregeln auf `page_search` und `pages` filtern die Seite heraus: kein Treffer, keine Trefferzahl.
5. Lukas hatte die Seite auf „Betrieb“ verlinkt. Max sieht dort einen Link, dessen Vorschau die API nicht auflöst („Seite nicht verfügbar“), und im Seitenbaum fehlt die Seite ganz. Rückverweise zeigt `page_links` nur, wenn beide Seiten lesbar sind.

### Szenario 3: Sophie baut den Baum um

Unter „Architektur“ liegt „Datenmodell“, darunter die Seite „Intern“ mit eigenen Rechten, die Sophie nicht sehen darf.

1. Sophie zieht „Architektur“ an die oberste Ebene. `app.move_page(architektur, NULL, 'a1', sophie)` prüft ihr Bearbeitungsrecht auf der Seite und auf dem Ziel. Admin-Recht braucht sie nicht, weil „Architektur“ seine Rechte vor und nach dem Verschieben vom Space bekommt.
2. Die Funktion schreibt den `path` des ganzen Teilbaums neu, **auch von „Intern“**, das Sophie nicht sieht. Sonst wäre der Baum zerrissen. Ereignis `page.moved`, Eintrag im Audit-Log.
3. Sophie versucht, „Architektur“ zu löschen. `app.trash_page` lehnt ab, weil darunter eine Seite liegt, die sie nicht bearbeiten darf. Anna als Admin von „Intern“ kann es.
4. Anna holt den Teilbaum aus dem Papierkorb zurück: `app.restore_page(architektur, anna)` stellt genau die drei gemeinsam gelöschten Seiten wieder her.

### Szenario 4: Gemeinsam bearbeiten und eine Version zurückholen

1. Sophie und Lukas haben „Datenmodell“ offen. Beide haben Bearbeitungsrecht und bekommen eine schreibende Verbindung zum Collab-Server.
2. Etwa alle zwei Sekunden ruft der Collab-Server `app.store_content` mit dem Yjs-Zustand, dem BlockNote-JSON, dem Klartext, dem Titel und den IDs der Bearbeitenden. Ereignis `page.updated`, der Worker erneuert Suchindex und Verlinkungen.
3. Zehn Minuten lang tippt niemand. Der Worker ruft `app.create_version(seite, 'auto')`. Die Version bekommt die Autoren Sophie und Lukas, die Liste in `page_contents` wird geleert.
4. Anna stellt Version 3 wieder her. Die API prüft ihr Bearbeitungsrecht, dann lädt der Collab-Server den alten Stand, wendet ihn als neue Änderung an, speichert und ruft `app.create_version(seite, 'restore', NULL, 3)`. Version 3 selbst bleibt unverändert.

---

## 20. Entwicklungsablauf

### Projektstruktur

```
apps/
  web/        Next.js-Oberfläche (nur Oberfläche)
  api/        Express-API und Worker (Suchindex, Versionen, Import, Export, Outbox):
              ein Paket, später ein Image, zwei Deployments
  collab/     Hocuspocus-Server
packages/
  shared/     Typen, Zod-Schemas, Rollen, Ereignisse
database/
  scripts/    Rollen, Schema (schema/), Migrationen (migrations/), Tests (schema_test/)
deploy/       (geplant)
  k8s/        Manifeste (Kustomize), später Helm-Chart
docs/
  models/     Datenmodell und Architektur als Diagramme
prototype/    UI-Prototyp (Referenz, kein Produktcode)
```

Ein Repository mit pnpm-Workspaces (Monorepo): jede App ein eigenes Node-Projekt mit eigener `package.json`, eine gemeinsame Lock-Datei. Typen für Ereignisse und Rollen leben einmal in `packages/shared` und werden von allen Apps genutzt. Node 24 führt TypeScript direkt aus, API, Worker und Collab-Server brauchen deshalb keinen Build-Schritt. Jede App verbindet sich mit einer eigenen Login-Rolle und prüft beim Start, dass es nicht `wiki_owner` oder ein Superuser ist. Einzelheiten in [LOCAL_SETUP.md, Abschnitt 7](LOCAL_SETUP.md#7-apps-nodejs).

### Lokal arbeiten

Die vollständige Anleitung steht in [LOCAL_SETUP.md](LOCAL_SETUP.md). Kurz:

1. PostgreSQL 18 im Docker-Container starten, später zusammen mit Zitadel und Garage per Docker Compose.
2. `roles_database.sql` einmal als `postgres`, danach alle Migrationen (`migrate.sh`) als `wiki_owner`.
3. `schema_test.sql`, `schema_concurrency_test.sh` und `schema_migrations_test.sh` laufen lassen: alle Tests müssen bestehen.
4. Die Apps später direkt mit Node starten (schnelles Neuladen). k3d nur, um Manifeste vor dem Ausrollen zu prüfen.

### Migrationen

- **Zwei Stellen:** `database/scripts/schema/` ist der vollständige, lesbare Stand. `database/scripts/migrations/` sind die Schritte dorthin: `0001_initial_schema.sql` ist das Schema vom 8. November 2026, gebündelt mit `schema/bundle.sh`. Danach bekommt **jede Änderung eine neue Migrationsdatei** und dieselbe Änderung in `schema/`. `schema_migrations_test.sh` spielt beide Wege in frische Datenbanken ein und vergleicht sie mit `pg_dump`.
- **Einspielen** mit `database/scripts/migrate.sh`: fehlende Migrationen in der Reihenfolge der Nummern, jede in einer Transaktion, Buchführung in `migrations.applied`. Eine Prüfsumme pro Datei verhindert, dass eine eingespielte Migration nachträglich geändert wird; zwei gleichzeitige Läufe warten aufeinander.
- Migrationen laufen immer als `wiki_owner`, auf dem Server in einem eigenen Kubernetes-Job vor dem Ausrollen, nie beim Start der App. Die App kennt die Zugangsdaten des Eigentümers nicht.
- Jede Migration ist **eine Version rückwärtskompatibel**: Die alte App-Version muss mit dem neuen Schema noch laufen. Das ermöglicht Updates ohne Ausfall und ist für On-Prem-Kunden Pflicht, die Updates spät einspielen.
- **Reines SQL**, weil das Schema viel Logik in Funktionen, Triggern und Policies enthält, die ein ORM nicht abbildet. Drizzle nur für Abfragen in der App. Ein eigenes kleines Skript statt eines Werkzeugs wie dbmate: Es nutzt psql wie Tests und Testdaten, `wiki_owner` braucht im Container kein Passwort, und Rückwärts-Migrationen sind nicht vorgesehen. Auf dem Server läuft dasselbe Skript im Image `postgres:18` als Job.

### Tests

- `schema_test.sql`, `schema_concurrency_test.sh` und `schema_migrations_test.sh` laufen bei jedem Push auf `main` in der CI (`ci.sh`). Die CI läuft auf **GitLab**: Das Repository liegt auf GitHub, und eine GitHub Action (`sync-to-gitlab.yml`) spiegelt `main` nach GitLab, wo `.gitlab-ci.yml` die Tests startet (Einzelheiten in [LOCAL_SETUP.md](LOCAL_SETUP.md), „CI (GitLab)“).
- API-Tests laufen gegen eine **echte PostgreSQL**, nicht gegen Mocks. Die Rechte stecken in der Datenbank, ein Mock würde genau das nicht testen. Umgesetzt als `*.dbtest.ts` in `apps/api` (`pnpm test:db`, CI-Job `api`) auf einer Wegwerf-Datenbank mit den Testdaten; reine Logik ohne Datenbank testen `*.test.ts` (`pnpm test`).
- Später Ende-zu-Ende-Tests mit Playwright, z. B. zwei Browser, die dieselbe Seite bearbeiten.
- Alles, was Rechte, Mandantentrennung oder Sichtbarkeit berührt, bekommt **zuerst** einen Test.

```markdown
# 7. Sitzungscookie statt Tokens im Browser

Status: angenommen · 2026-11-10

## Kontext
Was ist das Problem, welche Möglichkeiten gab es?

## Entscheidung
Was wurde entschieden?

## Folgen
Was wird dadurch einfacher, was schwerer?
```

Eine geänderte Entscheidung bekommt eine neue Notiz, die alte wird auf „ersetzt durch 0012“ gesetzt. Die Kurzfassung steht zusätzlich in `CLAUDE.md`.

### Wann eine Story fertig ist

Aus `EPICS.md`: Tests liegen vor, Mandantentrennung und Leserechte sind geprüft, die Oberfläche ist mit der Tastatur bedienbar, Texte gibt es auf Deutsch und Englisch.

### Arbeiten mit Claude Code

- Eine User Story pro Sitzung, größere Stücke zuerst im Planungsmodus.
- Tests zuerst bei allem, was Rechte berührt.
- Jeden Diff selbst lesen, besonders bei Rechten, Datenbankzugriff, Login und Collab-Server.
- Neue Entscheidungen sofort in `CLAUDE.md` und als ADR.

---

## 21. Bewusste Kompromisse und Grenzen

Manches ist mit Absicht einfach gehalten. Wer es ändern will, sollte den Grund kennen.

| Kompromiss | Warum so | Wann ändern |
|---|---|---|
| Rechte werden bei jeder Abfrage pro Zeile berechnet | Eine Wahrheit, immer aktuell, kein Abgleich nötig | Bei großen Bäumen oder langsamen Abfragen: eine vom Worker gepflegte Tabelle mit effektiven Rechten (E28) |
| Genau eine Collab-Server-Instanz | Kein Abgleich zwischen Instanzen nötig | Bei mehr Last oder Bedarf an Ausfallsicherheit: Hocuspocus mit Valkey oder Verteilung nach Seite (E28) |
| Ein einzelner Server | Günstig, einfach | Vor dem ersten zahlenden Geschäftskunden (E24) |
| Keine Ende-zu-Ende-Verschlüsselung | Sonst gingen Suche, Import, Export und KI nicht | Bewusst dauerhaft. Stattdessen EU-Betrieb, Verschlüsselung der gespeicherten Daten, eigene Zelle oder On-Prem |
| Suche in PostgreSQL | Ein System weniger | Ab etwa 100.000 Seiten pro Mandant oder für Dateiinhalte: OpenSearch |
| Kein Entwurf, Änderungen sofort sichtbar | Einfach, wie in Google Docs | Wenn Pilotkunden Freigabeprozesse brauchen |
| Rechte nur „erben“ oder „eigene“ | Leicht zu verstehen | Wenn echte Importe zeigen, dass die Confluence-Logik nötig ist (offene Entscheidung in `CLAUDE.md`) |
| Jede Version speichert den vollen Yjs-Zustand | Wiederherstellen ist trivial | Wenn der Speicher wächst: Versionen ausdünnen oder komprimieren |
| Kein Verschieben zwischen Spaces | Rechte und Keys würden kompliziert | Nach Bedarf |
| Kein Offline-Modus | Rechte könnten sich zwischendurch ändern | Mit den Mobile-Apps (E30) |
| Deaktivieren einer Person und Gruppenwechsel aus dem Login-Dienst ändern keine Grants | Grants bleiben für eine spätere Reaktivierung erhalten | Fehlt einem Space dadurch der wirksame Admin, setzt ein Organisations-Admin einen neuen. Später ein Hinweis in der Admin-Konsole (E17) |
| Positionen unter Geschwistern nicht eindeutig | Die App sieht eingeschränkte Geschwister nicht | Bleibt so, immer nach `position, id` sortieren |
| Kein sofortiges endgültiges Löschen, nur Papierkorb und Worker nach 30 Tagen | Schutz vor Fehlbedienung | Mit Aufbewahrungsrichtlinien und DSGVO-Löschung (E17) |

---

## 22. Typische Fehler und wie man sie vermeidet

| Fehler | Folge | Richtig |
|---|---|---|
| App verbindet sich als `wiki_owner` | RLS greift nicht, alle Mandanten sichtbar | API als `wiki_app`, Collab-Server und Worker als `wiki_worker` |
| Schema als `postgres` eingespielt | `SECURITY DEFINER`-Funktionen laufen als Superuser | Immer als `wiki_owner` einspielen |
| `app.tenant_id` nicht gesetzt | Leere Ergebnisse | Pro Transaktion setzen, bei `wiki_app` auch `app.user_id` |
| Rechte in der App selbst nachgebaut | Zwei Wahrheiten, früher oder später ein Leck | Immer `app.page_rank` bzw. die Leseregeln nutzen |
| Direktes `INSERT` statt Funktion | Scheitert für `wiki_app` an fehlenden Rechten; in Worker-Code fehlen sonst Rechteprüfung, Pfad, Outbox oder Audit | Schreibende Abläufe über das Schema `app` |
| `INSERT … RETURNING` auf eine Tabelle mit Leseregel, bevor die Zeile lesbar ist | Fehler, weil RLS auch die zurückgegebene Zeile prüft (z. B. ein Space vor seinem ersten Grant) | ID vorher mit `uuidv7()` erzeugen, kein `RETURNING` |
| Geschäftslogik in Next.js (Server Actions) | Zweites Backend neben Express | Next.js nur als Oberfläche |
| Zwei Collab-Server-Instanzen | Zwei Stände desselben Dokuments, Datenverlust | Im MVP genau eine Instanz, Update-Strategie „Recreate“ |
| BlockNote-XL-Paket eingebunden | GPL-3.0-Pflichten für den eigenen Code | Nur Core-Pakete, Lizenzprüfung in der CI |
| Schemaänderung ohne Test | Unbemerkte Lücke in Rechten oder Trennung | Erst Test in `schema_test.sql`, dann Änderung |
| Seiten im Papierkorb nicht ausgefiltert | Gelöschte Seiten tauchen in Baum, Suche oder Links auf | Überall `deleted_at IS NULL`, außer in der Papierkorb-Ansicht |
| Titel über die API geändert | Wird beim nächsten Speichern aus dem Yjs-Dokument überschrieben | Titel nur im Editor ändern (`Y.Text` „title“) |
| Neue Seite im Collab-Server geladen, ohne den Titel ins Dokument zu schreiben | Das erste Speichern leert den Titel | Bei leerem Zustand (`\x0000`) zuerst `pages.title` in `Y.Text` „title“ schreiben |
| Nur nach `position` sortiert | Seiten mit gleicher Position springen | Immer `ORDER BY position, id` |
| Neue Funktion ohne `GRANT EXECUTE` | Niemand kann sie aufrufen | In `90_privileges.sql` ausdrücklich freigeben |
| Neue `SECURITY DEFINER`-Funktion ruft `require_worker` auf | Prüft den Eigentümer statt des Aufrufers | `require_worker` nur in Funktionen ohne `SECURITY DEFINER` |
| Hochgeladenes HTML oder SVG inline ausgeliefert | Fremde Skripte laufen im Namen anderer | Als Download ausliefern, `nosniff` setzen |
| Inhalt aus einem Ereignis ohne Rechteprüfung angezeigt | Titel geheimer Seiten in Benachrichtigungen | Vor dem Anzeigen die Rechte der Person prüfen |
| Ereignis-Empfänger nicht idempotent | Doppelte Benachrichtigungen oder Versionen | Mit doppelten Ereignissen rechnen |
| Eingespielte Migration nachträglich geändert | Umgebungen laufen auseinander | Immer eine neue Migration schreiben |

---

## 23. Häufige Fragen

**Warum nicht das Rechtemodell von Confluence 1:1?**
Confluence kombiniert eine Matrix aus vielen Einzelrechten pro Space mit Seiten-Einschränkungen, die unterschiedlich wirken: Anzeige-Einschränkungen gelten auch für alle Unterseiten (es zählt die Schnittmenge), Bearbeitungs-Einschränkungen nur für die eine Seite. Das verstehen selbst erfahrene Admins oft nicht. NoteFieber hat vier Rollen und eine einzige Regel: erben oder eigene Rechte. Der Import rechnet die Confluence-Logik in dieses Modell um.

**Kann eine Unterseite mehr Personen zeigen als ihre eingeschränkte Elternseite?**
Ja, anders als in Confluence. Hat die Unterseite eigene Rechte, gelten nur diese. Wer die Unterseite sehen darf, die Elternseite aber nicht, sieht in der Brotkrume an deren Stelle nur einen Platzhalter. Beim Import muss der Importer deshalb die Confluence-Schnittmenge ausrechnen, damit niemand mehr sieht als vorher.

**Darf ein Organisations-Admin alles lesen?**
Nein. Er kann sich aber auf jedem Space Rechte geben, wenn sonst niemand mehr Admin ist. Das ist ein Notausgang und steht im Audit-Log.

**Was passiert mit Links, wenn eine Seite umbenannt oder verschoben wird?**
Nichts. Links zeigen auf die ID der Seite, nicht auf Titel oder Pfad. Die Anzeige holt den aktuellen Titel.

**Warum kein Fork von La Suite Docs?**
La Suite Docs ist in Python mit Django gebaut (TalkFieber in TypeScript), richtet sich eher an Notion und Google Docs aus als an Confluence-Umsteiger und hängt an der Planung der beiden Staaten, die es finanzieren. NoteFieber nutzt dieselben Bausteine (BlockNote, Yjs) direkt und baut das, was den Unterschied macht, selbst: Rechte, Import und Compliance.

**Warum TypeScript und nicht Go oder Python?**
Eine Sprache für Oberfläche, API und Collab-Server. Hocuspocus und BlockNote sind ohnehin TypeScript. TalkFieber nutzt dieselbe Sprache, damit lassen sich Pakete und Wissen teilen.

**Warum Next.js nur als Oberfläche?**
Sonst entstünden zwei Backends: Logik in Next.js und Logik in Express. Ein internes Wiki hinter einem Login braucht die Stärken von Next.js (Server-Rendering für Suchmaschinen) kaum. Für spätere öffentliche Seiten kann es nützlich werden.

**Warum PostgreSQL für fast alles?**
Struktur, Rechte, Inhalt, Volltextsuche und Job-Queue in einem System heißt: eine Transaktion für alles, ein Backup, eine Sache zu überwachen. Weitere Systeme kommen erst, wenn PostgreSQL nachweislich nicht mehr reicht.

**Warum keine Ende-zu-Ende-Verschlüsselung?**
Dann könnte der Server den Inhalt nicht lesen: keine Suche, kein Import, kein Export, keine KI. Für ein Firmen-Wiki ist das ein schlechter Tausch. Den Schutz liefern EU-Betrieb, ein EU-Anbieter, Verschlüsselung der gespeicherten Daten und auf Wunsch eine eigene Zelle oder On-Prem.

**Warum Zitadel und nicht Keycloak oder ein eigenes Login?**
Ein eigenes Login ist viel Sicherheitsarbeit ohne Vorteil. Keycloak läuft auf Java und braucht deutlich mehr Speicher. Zitadel ist leichtgewichtig, nutzt PostgreSQL und wird mit TalkFieber geteilt. Weil die App nur OIDC spricht, bleibt der Login-Dienst austauschbar.

**Warum K3s und nicht Docker Compose?**
Dieselben Manifeste laufen lokal, auf dem VPS, beim zertifizierten Anbieter und beim On-Prem-Kunden. CloudNativePG liefert Backups mit Wiederherstellung auf jeden Zeitpunkt. Der Preis: mehr Begriffe und etwa 0,5 bis 1 GB Speicher.

**Warum UUIDv7 und keine fortlaufenden Nummern?**
UUIDs lassen sich nicht erraten, die App kann sie schon vor dem Speichern erzeugen, und sie bleiben über Produkte und Zellen hinweg eindeutig. Version 7 beginnt mit einem Zeitstempel und hält Indizes deshalb so kompakt wie fortlaufende Nummern.

---

## 24. Glossar

| Begriff | Bedeutung |
|---|---||
| **Audit-Log** | Unveränderbares Protokoll sicherheitsrelevanter Aktionen |
| **AVV** | Auftragsverarbeitungsvertrag nach Art. 28 DSGVO zwischen Kunde und Anbieter |
| **BlockNote** | Block-Editor im Browser, auf Basis von Tiptap und ProseMirror |
| **CloudNativePG** | Kubernetes-Operator, der PostgreSQL betreibt, sichert und repliziert |
| **CLOUD Act** | US-Gesetz, das US-Behörden Zugriff auf Daten bei US-Anbietern erlaubt, auch in Europa |
| **Collab-Server** | Hocuspocus-Prozess, der Yjs-Änderungen verteilt und speichert |
| **CRDT** | Datenstruktur, deren Änderungen sich ohne Konflikte zusammenführen lassen |
| **Fractional Index** | Sortierbare Zeichenkette für die Reihenfolge, zwischen die man immer einfügen kann |
| **Garage** | S3-kompatibler Dateispeicher |
| **Grant** | Ein Recht: Subjekt + Rolle + Space oder Seite |
| **Hocuspocus** | Fertiger WebSocket-Server für Yjs |
| **Idempotent** | Mehrfaches Ausführen hat dieselbe Wirkung wie einmaliges |
| **ltree** | PostgreSQL-Datentyp für Pfade in Bäumen |
| **Makro** | Confluence-Baustein in einer Seite, z. B. Inhaltsverzeichnis oder Jira-Liste |
| **Mandant (Tenant)** | Die Kundenorganisation, harte Grenze für alle Daten |
| **OIDC** | OpenID Connect, Standard für Login über einen Identity Provider |
| **On-Prem** | Der Kunde betreibt die Software auf eigenen Servern |
| **Outbox** | Tabelle für Ereignisse, die in derselben Transaktion wie die Änderung geschrieben werden |
| **PKCE** | Zusatz zum OIDC-Login, der verhindert, dass ein abgefangener Code missbraucht wird |
| **Platzhalter-Block** | Block für ein Confluence-Makro, das sich nicht übersetzen lässt, mit dem Originalinhalt |
| **Probelauf** | Import, der nur einen Bericht erzeugt und nichts anlegt |
| **RLS** | Row Level Security: Zugriffsregeln pro Zeile in PostgreSQL |
| **SCIM** | Standard, mit dem Firmen-Verzeichnisse Personen und Gruppen automatisch anlegen und entfernen |
| **`SECURITY DEFINER`** | Funktion läuft mit den Rechten ihres Eigentümers, nicht des Aufrufers |
| **Signierte URL** | Kurzlebige Adresse für genau eine Datei, die Garage nur bis zum Ablauf annimmt |
| **Space** | Bereich im Wiki mit eigenem Key, eigener Startseite und eigenen Rechten |
| **SSO** | Single Sign-on, Anmeldung über das Firmen-Login |
| **TOMs** | Technische und organisatorische Maßnahmen, die ein Anbieter zum Datenschutz nachweist |
| **Trigramm-Index** | Index aus Drei-Zeichen-Stücken, findet Teilwörter und verzeiht Tippfehler (`pg_trgm`) |
| **tsvector** | Liste der Wortstämme eines Textes, Grundlage der Volltextsuche in PostgreSQL |
| **UUIDv7** | UUID mit Zeitstempel am Anfang, nach Entstehung sortierbar |
| **Vererbung kappen** | Einer Seite eigene Rechte geben, die dann auch für ihre Unterseiten gelten |
| **Worker** | Hintergrundprozess für Suchindex, Versionen, Import, Export und Outbox |
| **Workspace** | Arbeitsbereich innerhalb eines Mandanten, regelt, wer grundsätzlich dazugehört |
| **Yjs** | CRDT-Bibliothek für gemeinsames Bearbeiten |
| **Zelle** | Komplett getrennte Instanz des ganzen Stacks für einen einzelnen großen Kunden |
| **Zitadel** | Selbst gehosteter Login-Dienst (Identity Provider), gemeinsam mit TalkFieber |
