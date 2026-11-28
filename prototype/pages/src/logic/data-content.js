// Benachrichtigungen (Ausblick, E16): im Produkt aus den Ereignissen der Outbox; vor dem Anzeigen gegen das
// Leserecht geprüft (app.page_rank), Seiten ohne Leserecht fallen ohne Hinweis heraus
const NOTIFS = [
  { id: 'n1', kind: 'mention', who: 'sophie', page: 'dm', thread: 't2', pre: 'hat dich in einem Kommentar zu', post: 'erwähnt', snippet: '@Peter Forster, nimmst du files und comments mit in die Liste?', when: 'vor 12 Min.', unread: true },
  { id: 'n2', kind: 'reply', who: 'lukas', page: 'dm', thread: 't1', pre: 'hat in', post: 'auf einen Kommentar geantwortet, dem du folgst', snippet: 'Ja, ergänzt. Der Schematest prüft jetzt alle Tabellen.', when: 'vor 40 Min.', unread: true },
  { id: 'n3', kind: 'share', who: 'max', page: 'kampagne', pre: 'hat', post: 'mit dir geteilt', role: 'Kommentieren', snippet: '', when: 'vor 3 Std.', unread: true },
  { id: 'n4', kind: 'mention', who: 'lukas', page: 'backup', pre: 'hat dich auf der Seite', post: 'erwähnt', snippet: 'Die nächste Probe-Wiederherstellung am 3. Dezember übernimmt @Peter Forster.', when: 'gestern', unread: false },
  { id: 'n5', kind: 'comment', who: 'sophie', page: 'rechte', thread: 't4', pre: 'hat deine Seite', post: 'kommentiert', snippet: 'Gilt die Kappung auch für Unterseiten, die später dazukommen?', when: 'am 21. November', unread: false }
];
// Reaktionen auf eine Seite (Ausblick): Auswahl und Startwerte; im Produkt eine eigene Tabelle (Vorschlag)
const REACTIONS = [
  ['👍', 'Daumen hoch'], ['❤️', 'Herz'], ['🎉', 'Feiern'], ['👀', 'Schaue ich mir an'],
  ['✅', 'Erledigt'], ['🙏', 'Danke'], ['😄', 'Lachen'], ['🚀', 'Rakete']
];
// Emoji und Titelbild einer Seite (Ausblick): Auswahl im Prototyp; im Produkt Spalten an der Seite (Vorschlag)
const EMOJIS = [
  ['📄', 'Seite Dokument'], ['📝', 'Notiz Schreiben'], ['📘', 'Buch Handbuch'], ['📚', 'Bücher Wissen'], ['📌', 'Pin Wichtig'], ['📎', 'Büroklammer Anhang'],
  ['🗂️', 'Register Ordner'], ['🗄️', 'Aktenschrank Archiv'], ['📊', 'Diagramm Auswertung'], ['📈', 'Anstieg Wachstum'], ['📅', 'Kalender Termin'], ['🗓️', 'Planer Plan'],
  ['✅', 'Erledigt Haken'], ['☑️', 'Aufgabe Checkliste'], ['🚀', 'Rakete Release Start'], ['💡', 'Idee Glühbirne'], ['🔒', 'Schloss Vertraulich'], ['🔑', 'Schlüssel Zugang'],
  ['🛡️', 'Schild Sicherheit'], ['⚙️', 'Zahnrad Einstellungen'], ['🔧', 'Werkzeug Wartung'], ['🧪', 'Test Labor'], ['🐛', 'Fehler Bug'], ['💾', 'Diskette Backup Speichern'],
  ['☁️', 'Wolke Cloud'], ['🖥️', 'Bildschirm Rechner'], ['📦', 'Paket Lieferung'], ['🏠', 'Haus Start'], ['🏢', 'Gebäude Firma'], ['👥', 'Team Personen'],
  ['🤝', 'Handschlag Partner'], ['💬', 'Sprechblase Diskussion'], ['📣', 'Megafon Ankündigung'], ['🎯', 'Ziel'], ['🏁', 'Flagge Ziel Meilenstein'], ['⭐', 'Stern Favorit'],
  ['❤️', 'Herz'], ['🎉', 'Feiern'], ['🌱', 'Pflanze Anfang'], ['🌍', 'Erde Welt'], ['🏛️', 'Behörde Verwaltung Amt'], ['💶', 'Euro Geld Budget'],
  ['🧭', 'Kompass Orientierung'], ['🗺️', 'Karte Roadmap'], ['⚠️', 'Warnung'], ['❓', 'Frage FAQ'], ['🔥', 'Feuer Dringend'], ['🎓', 'Lernen Schulung']
];
const COVERS = [
  ['blau', 'Blau', 'linear-gradient(120deg, #1f5fd6 0%, #6b9cf5 100%)'],
  ['petrol', 'Petrol', 'linear-gradient(120deg, #0e7490 0%, #67c3d0 100%)'],
  ['wald', 'Wald', 'linear-gradient(120deg, #1e5135 0%, #5f9a4a 100%)'],
  ['abend', 'Abendrot', 'linear-gradient(120deg, #7c3aed 0%, #db2777 100%)'],
  ['orange', 'Orange', 'linear-gradient(120deg, #c2410c 0%, #f59e0b 100%)'],
  ['sand', 'Sand', 'linear-gradient(120deg, #e9c99f 0%, #f6e7c9 100%)'],
  ['grau', 'Grau', 'linear-gradient(120deg, #5b6573 0%, #aab2bd 100%)'],
  ['nebel', 'Nebel', 'linear-gradient(120deg, #d6e0ee 0%, #f1f4f9 100%)']
];
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const pg = (space, title, parent, kids, editor, when, text, extra) =>
  ({ space, title, parent, kids, author: 'peter', editor, when, text: text || [], ...(extra || {}) });

const PAGES = {
  home: pg('ENTW', 'Entwicklung', null, ['arch', 'release', 'betrieb'], 'lukas', 'am 28. Oktober', [], { body: 'home' }),
  arch: pg('ENTW', 'Architektur', 'home', ['dm', 'rechte'], 'lukas', 'am 30. Oktober',
    ['Frontend, API und Collab-Server laufen als eigene Prozesse. PostgreSQL ist die einzige Wahrheit für Struktur, Rechte und Inhalt.']),
  dm: pg('ENTW', 'Datenmodell', 'arch', [], 'sophie', 'vor 2 Minuten', [], { body: 'dm' }),
  rechte: pg('ENTW', 'Rechte-Konzept', 'arch', [], 'peter', 'am 29. Oktober',
    ['Rechte werden am Space vergeben und an Seiten vererbt. Eine Seite kann die Vererbung kappen und eigene Rechte bekommen.']),
  release: pg('ENTW', 'Release-Prozess', 'home', [], 'markus', 'am 21. Oktober',
    ['Jeder Merge rollt automatisch nach staging aus. Für pilot braucht es eine Freigabe im Review.']),
  betrieb: pg('ENTW', 'Betrieb', 'home', ['backup', 'personal'], 'lukas', 'am 2. November',
    ['Alles zum Cluster auf dem VPS: Backups, Überwachung und Bereitschaft.']),
  backup: pg('ENTW', 'Backups und Wiederherstellung', 'betrieb', [], 'lukas', 'am 2. November',
    ['CloudNativePG sichert laufend in einen S3-Speicher bei einem anderen Anbieter. Die Wiederherstellung wird einmal pro Quartal geprobt.']),
  personal: pg('ENTW', 'Personalplanung 2027', 'betrieb', ['urlaub'], 'peter', 'am 1. November',
    ['Bereitschaftsplan und Personalplanung für 2027. Diese Seite sehen nur ausgewählte Personen.']),
  urlaub: pg('ENTW', 'Urlaubsplanung Vertrieb', 'personal', [], 'peter', 'am 1. November',
    ['Urlaube im Vertrieb für 2027. Max Mustermann darf mitlesen.']),
  notizen: pg('ENTW', 'Alte Notizen', 'home', [], 'peter', 'am 12. Oktober', ['Sammlung aus der Anfangszeit.']),
  skizzen: pg('ENTW', 'Architektur-Skizzen 2025', 'arch', ['skizze1', 'skizze2'], 'sophie', 'am 2. Oktober', ['Erste Überlegungen zum Aufbau.']),
  skizze1: pg('ENTW', 'Skizze Monolith', 'skizzen', [], 'sophie', 'am 2. Oktober', ['Ein Prozess für alles.']),
  skizze2: pg('ENTW', 'Skizze Microservices', 'skizzen', [], 'sophie', 'am 2. Oktober', ['Viele kleine Dienste.']),
  vert_home: pg('VERT', 'Vertrieb', null, ['angebote', 'kampagne'], 'max', 'am 25. Oktober',
    ['Angebote, Kampagnen und Material für den Vertrieb.'], { author: 'max' }),
  angebote: pg('VERT', 'Angebote 2027', 'vert_home', [], 'max', 'am 30. Oktober', ['Vorlagen und Preise für Angebote im nächsten Jahr.'], { author: 'max' }),
  kampagne: pg('VERT', 'Kampagne Frühjahr', 'vert_home', [], 'max', 'am 3. November', ['Planung der Frühjahrskampagne: Messen, Mailings, Webinare.'], { author: 'max' }),
  pers_home: pg('PERS', 'Personal', null, ['urlaubsregel', 'gehalt'], 'peter', 'am 20. Oktober', ['Nur für die Geschäftsleitung.']),
  urlaubsregel: pg('PERS', 'Urlaubsregelung', 'pers_home', [], 'peter', 'am 20. Oktober', ['Wie Urlaub beantragt und genehmigt wird.']),
  gehalt: pg('PERS', 'Gehaltsbänder 2027', 'pers_home', [], 'peter', 'am 22. Oktober', ['Gehaltsbänder nach Rolle und Erfahrung.']),
  alt_home: pg('ALT', 'Altes Intranet', null, ['telefon'], 'peter', 'am 2. März 2025', ['Archiv, nur noch lesbar.']),
  telefon: pg('ALT', 'Telefonliste (veraltet)', 'alt_home', [], 'peter', 'am 2. März 2025', ['Bitte das Adressbuch im Login-Dienst nutzen.'])
};
const SPACES = {
  ENTW: { key: 'ENTW', name: 'Entwicklung', description: 'Architektur, Abläufe und Betrieb des Entwicklungsteams', home: 'home', archived: false, color: '#1F5FD6', lastChange: 'vor 2 Minuten' },
  VERT: { key: 'VERT', name: 'Vertrieb', description: 'Angebote, Kampagnen und Material für den Vertrieb', home: 'vert_home', archived: false, color: '#0E7490', lastChange: 'am 3. November' },
  PERS: { key: 'PERS', name: 'Personal', description: 'Nur für die Geschäftsleitung', home: 'pers_home', archived: false, color: '#7C3AED', lastChange: 'am 22. Oktober' },
  ALT: { key: 'ALT', name: 'Altes Intranet', description: 'Archiv, nur noch lesbar', home: 'alt_home', archived: true, color: '#5B6573', lastChange: 'am 2. März 2025' }
};
// Grants auf Spaces („space:KEY“) und auf Seiten mit eigenen Rechten (Seiten-ID)
const GRANTS = {
  'space:ENTW': [{ key: 'peter', role: 'admin' }, { key: 'grp', role: 'editor' }, { key: 'ws', role: 'viewer' }],
  'space:VERT': [{ key: 'grp_vert', role: 'admin' }, { key: 'ws', role: 'commenter' }],
  'space:PERS': [{ key: 'peter', role: 'admin' }, { key: 'grp_gl', role: 'editor' }],
  'space:ALT': [{ key: 'peter', role: 'admin' }, { key: 'ws', role: 'viewer' }],
  personal: [{ key: 'peter', role: 'admin' }, { key: 'lukas', role: 'editor' }],
  urlaub: [{ key: 'peter', role: 'admin' }, { key: 'lukas', role: 'editor' }, { key: 'max', role: 'viewer' }]
};

