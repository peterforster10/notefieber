// Daten wie in database/scripts/seed/seed.sql (Mandant Alpenwerk); angemeldet ist Peter Forster
const PEOPLE = {
  peter: { name: 'Peter Forster', color: '#1F5FD6' },
  sophie: { name: 'Sophie Bauer', color: '#0E7490' },
  lukas: { name: 'Lukas Gruber', color: '#7C3AED' },
  markus: { name: 'Markus Wagner', color: '#B45309' },
  max: { name: 'Max Mustermann', color: '#BE185D' },
  elena: { name: 'Elena Novak', color: '#4D7C0F' },
  // Nur im Prototyp: hat Alpenwerk verlassen und ist deaktiviert; war einzige Admin einer Seite in „Vertrieb“
  anja: { name: 'Anja Keller', color: '#0F766E' }
};
const SUBJECTS = {
  ...Object.fromEntries(Object.entries(PEOPLE).map(([k, p]) => [k, { name: p.name, sub: k === 'peter' ? 'Du' : 'Person', bg: p.color }])),
  ws: { name: 'Alle im Workspace', sub: 'Alle Mitglieder von Alpenwerk, ohne Gäste', bg: '#5B6573' }
};
const ROLE_LABEL = { admin: 'Admin', editor: 'Bearbeiten', commenter: 'Kommentieren', viewer: 'Lesen', none: 'Kein Zugriff' };
const RANK = { viewer: 1, commenter: 2, editor: 3, admin: 4 };
// Wer gerade welche Seite offen hat (Peter immer); die Startseite zeigt den Überlauf „+N“
const PRESENCE = { dm: ['peter', 'sophie', 'lukas'], home: ['peter', 'sophie', 'lukas', 'markus', 'max', 'elena'] };
// Seitenlinks im Inhalt (für die Rückverweise in der Seiteninfo)
const LINKS = { home: ['arch', 'release', 'betrieb'], dm: ['rechte'] };
// Satz um jeden Seitenlink (für „Verlinkt von“ im Fuß der Seite); Schlüssel Quelle>Ziel
const LINK_CTX = {
  'home>arch': 'Architektur – Frontend, API, Datenmodell und Rechte',
  'home>release': 'Release-Prozess – vom Merge bis zum Pilot',
  'home>betrieb': 'Betrieb – Cluster, Backups und Bereitschaft',
  'dm>rechte': 'Wie Rechte vererbt werden, steht unter Rechte-Konzept.'
};
// Workspace „Alpenwerk“ (seed.sql): Peter ist Owner, Elena Gast von außen
const MEMBERS = [
  { key: 'peter', email: 'peter.forster@alpenwerk.example', role: 'owner' },
  { key: 'lukas', email: 'lukas.gruber@alpenwerk.example', role: 'member' },
  { key: 'sophie', email: 'sophie.bauer@alpenwerk.example', role: 'member' },
  { key: 'markus', email: 'markus.wagner@alpenwerk.example', role: 'member' },
  { key: 'max', email: 'max.mustermann@alpenwerk.example', role: 'member' },
  { key: 'elena', email: 'elena.novak@agentur-nord.example', role: 'guest' },
  { key: 'anja', email: 'anja.keller@alpenwerk.example', role: 'member' }
];
// Export im Worker (E14): Phasen eines Auftrags und ein früherer Export der angemeldeten Person
const EXPORT_PHASES = ['Neuesten Stand ableiten', 'Markdown und BlockNote-JSON schreiben', 'Bilder und Anhänge einpacken', 'ZIP fertigstellen'];
const EXPORTS = [
  { id: 'x0', label: 'Space „Vertrieb“', zip: 'vert-2026-11-26.zip', pages: 3, size: '1,1 MB', status: 'ready', progress: 100, phase: 3, when: 'am 26. November', expires: '3. Dezember' }
];
// Audit-Log (nur Einträge zum Wiederherstellen von Rechten; die ganze Ansicht kommt mit E17)
const AUDIT = [
  { id: 'a1', when: 'am 3. November', actor: 'peter', who: 'peter', label: 'Space „Altes Intranet“', reason: 'Bisheriger Admin hat das Unternehmen verlassen; Space wird archiviert.' }
];
const INVITES = [
  { id: 'i1', email: 'nina.neu@alpenwerk.example', role: 'member', status: 'open', until: '2. Dez. 2026', by: 'Peter Forster' },
  { id: 'i2', email: 'elena.novak@agentur-nord.example', role: 'guest', status: 'accepted', until: '12. Nov. 2026', by: 'Peter Forster' },
  { id: 'i3', email: 'jonas.berg@alpenwerk.example', role: 'member', status: 'expired', until: '3. Nov. 2026', by: 'Lukas Gruber' }
];
// Klartext der Seiten mit eigenem Inhalt im Prototyp (im Frontend: page_contents.plain_text, page_search)
const SEARCH_TEXT = {
  home: 'Hier dokumentiert das Entwicklungsteam von Alpenwerk Architektur, Abläufe und Betrieb. Bereiche: Architektur – Frontend, API, Datenmodell und Rechte. Release-Prozess – vom Merge bis zum Pilot. Betrieb – Cluster, Backups und Bereitschaft. Mitmachen: Neue Seiten bitte unter dem passenden Bereich anlegen. Seiten mit eigenen Rechten sind mit einem Schloss markiert. Fragen zum Wiki an @Lukas Gruber.',
  dm: 'Überblick: Jede Tabelle trägt tenant_id. Row Level Security trennt die Mandanten in der Datenbank selbst; die API setzt den Mandanten zu Beginn jeder Transaktion. Maßgeblich ist schema.sql. Jede Änderung am Schema braucht einen Test in schema_test.sql. Kerntabellen: spaces – Bereich wie in Confluence, Einheit für Rechte und Import. pages – Seitenbaum mit Pfad und Position, Papierkorb. page_contents – Yjs-Zustand, BlockNote-JSON und Klartext für die Suche. grants – Rechte auf einen Space oder eine Seite. Mandant setzen: SELECT set_config(\'app.tenant_id\', $1, true). Offene Punkte: RLS-Tests für alle Lesepfade. Tabelle mit effektiven Rechten für große Seitenbäume. Wie Rechte vererbt werden, steht unter Rechte-Konzept. Fragen an @Sophie Bauer.'
};
// Blöcke im „/“-Menü (Namen wie im BlockNote-Wörterbuch, Gruppen wie im Frontend: components/editor/menus.tsx)
const SLASH = [
  { group: 'Überschriften', key: 'h1', title: 'Überschrift 1', hint: 'Große Überschrift', glyph: 'H1', md: '#', alias: 'h1 heading titel' },
  { group: 'Überschriften', key: 'h2', title: 'Überschrift 2', hint: 'Mittlere Überschrift', glyph: 'H2', md: '##', alias: 'h2 heading' },
  { group: 'Überschriften', key: 'h3', title: 'Überschrift 3', hint: 'Kleine Überschrift', glyph: 'H3', md: '###', alias: 'h3 heading' },
  { group: 'Grundblöcke', key: 'p', title: 'Absatz', hint: 'Normaler Text', glyph: '¶', md: '', alias: 'text paragraph' },
  { group: 'Grundblöcke', key: 'ul', title: 'Aufzählung', hint: 'Liste mit Punkten', glyph: '•', md: '-', alias: 'liste bullet punkte' },
  { group: 'Grundblöcke', key: 'ol', title: 'Nummerierte Liste', hint: 'Liste mit Zahlen', glyph: '1.', md: '1.', alias: 'liste numbered zahlen' },
  { group: 'Grundblöcke', key: 'todo', title: 'Aufgabe', hint: 'Liste mit Kästchen zum Abhaken', glyph: '☐', md: '[]', alias: 'checkliste todo check' },
  { group: 'Grundblöcke', key: 'quote', title: 'Zitat', hint: 'Zitat oder Hervorhebung', glyph: '„', md: '>', alias: 'quote' },
  { group: 'Grundblöcke', key: 'callout', title: 'Callout', hint: 'Hinweis: Info, Warnung, Erfolg, Fehler', glyph: 'ℹ', md: '', alias: 'hinweis info warnung box' },
  { group: 'Grundblöcke', key: 'code', title: 'Code', hint: 'Code mit Sprachauswahl', glyph: '</>', md: '```', alias: 'code snippet programm' },
  { group: 'Grundblöcke', key: 'table', title: 'Tabelle', hint: 'Tabelle mit Kopfzeile', glyph: '▦', md: '', alias: 'table' },
  { group: 'Grundblöcke', key: 'hr', title: 'Trennlinie', hint: 'Horizontale Linie', glyph: '—', md: '---', alias: 'divider linie' },
  { group: 'Medien', key: 'img', title: 'Bild', hint: 'PNG, JPEG, GIF oder WebP hochladen', glyph: '▣', md: '', alias: 'image foto upload' },
  { group: 'Medien', key: 'file', title: 'Datei', hint: 'Anhang hochladen, wird auf Viren geprüft', glyph: '⎘', md: '', alias: 'anhang attachment upload pdf' },
  { group: 'Verknüpfen', key: 'pagelink', title: 'Link auf Seite', hint: 'Eine andere Seite verlinken (auch mit „[“)', glyph: '↗', md: '[', alias: 'seitenlink verlinken page' },
  { group: 'Verknüpfen', key: 'mention', title: 'Person erwähnen', hint: 'Eine Person aus dem Workspace nennen (auch mit „@“)', glyph: '@', md: '@', alias: 'erwähnung mention person' },
  { group: 'Verknüpfen', key: 'toc', title: 'Inhaltsverzeichnis', hint: 'Liste der Überschriften dieser Seite', glyph: '≡', md: '', alias: 'toc inhalt verzeichnis' }
];
const BLOCK_PH = { P: "Text eingeben oder '/' für Befehle tippen", H1: 'Überschrift 1', H2: 'Überschrift 2', H3: 'Überschrift 3', LI: 'Liste', BLOCKQUOTE: 'Zitat' };
const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** Für den Vergleich: klein, ohne Akzente (ü → u); bei vorkomponierten Zeichen gleich lang wie das Original */
const fold = (t) => t.normalize('NFC').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Farben für Spaces (weiße Schrift auf jeder Farbe >= 4,5:1, wie die Personenfarben)
const SPACE_COLORS = [
  { color: '#1F5FD6', label: 'Blau' }, { color: '#0E7490', label: 'Petrol' }, { color: '#7C3AED', label: 'Violett' },
  { color: '#BE185D', label: 'Beere' }, { color: '#B45309', label: 'Ocker' }, { color: '#1E5135', label: 'Grün' },
  { color: '#4D7C0F', label: 'Oliv' }, { color: '#5B6573', label: 'Grau' }
];
// Gruppen im Wiki (Tabelle groups, für den ganzen Mandanten). Geschäftsleitung, Entwicklung und Vertrieb wie in
// seed.sql; „qs-team“ (Confluence-Import) und „Alpenwerk-IT“ (Login-Dienst, Ausblick) nur im Prototyp.
// source wie groups.source: local und import pflegen Organisations-Admins, idp und scim nur ihre Quelle.
const GROUPS = {
  grp_gl: { name: 'Geschäftsleitung', source: 'local', color: '#B45309', members: ['peter'], by: 'peter', when: 'am 2. Oktober' },
  grp: { name: 'Entwicklung', source: 'local', color: '#1E5135', members: ['lukas', 'sophie', 'markus'], by: 'peter', when: 'am 2. Oktober' },
  grp_vert: { name: 'Vertrieb', source: 'local', color: '#BE185D', members: ['max'], by: 'peter', when: 'am 2. Oktober' },
  grp_qs: { name: 'qs-team', source: 'import', externalId: 'qs-team', color: '#0E7490', members: ['sophie', 'max', 'elena'], by: 'peter', when: 'am 26. November' },
  grp_it: { name: 'Alpenwerk-IT', source: 'idp', externalId: 'Alpenwerk-IT', color: '#5B6573', members: ['peter', 'markus'], when: 'beim letzten Login' }
};
const GROUP_SOURCE = { local: 'Im Wiki', import: 'Confluence-Import', idp: 'Login-Dienst', scim: 'SCIM' };
const WS_ROLE = { owner: 'Owner', admin: 'Admin', member: 'Mitglied', guest: 'Gast' };
const INVITE_STATUS = { open: 'offen', accepted: 'angenommen', revoked: 'zurückgenommen', expired: 'abgelaufen' };
// Dialoge mit Ausblick (wie im Frontend: was dort entsteht)
const SOON = {
  shortcuts: () => ({ title: 'Tastenkürzel', text: 'Strg K Suche · F2 Seite umbenennen · Entf Seite in den Papierkorb · / Befehle im Editor · [ Seitenlink · @ Person erwähnen' })
};
const CALLOUT = {
  info: { icon: 'ℹ', label: 'Info' }, note: { icon: '✎', label: 'Hinweis' }, success: { icon: '✓', label: 'Erfolg' },
  warning: { icon: '⚠', label: 'Warnung' }, error: { icon: '✕', label: 'Fehler' }
};
