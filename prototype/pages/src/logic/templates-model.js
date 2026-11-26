// ---------- Vorlagen (Ausblick) ----------
// Mitgelieferte und eigene Vorlagen. „scope“ leer = für alle Spaces (pflegen Organisations-Admins),
// sonst nur für diesen Space (pflegen seine Admins). Im Produkt eine eigene Tabelle (Vorschlag):
// Inhalt als BlockNote-JSON, Lesen wie der Space bzw. für alle im Mandanten.
const tplDate = () => { const [y, m, d] = V_TODAY.split('-'); return d + '.' + m + '.' + y; };
const tplTitle = (pattern) => (pattern || '').replace('{datum}', tplDate());
// Blöcke als HTML des bearbeitbaren Bereichs (gleicher Aufbau wie die Blöcke aus dem „/“-Menü)
const tplHtml = (blocks) => {
  const out = [];
  let rows = null;
  const flush = () => {
    if (!rows) return;
    const [head, ...body] = rows;
    out.push('<div class="nf-table-block"><table><thead><tr><th>' + esc(head.c1) + '</th><th>' + esc(head.c2) + '</th></tr></thead><tbody>'
      + body.map((r) => '<tr><td>' + esc(r.c1) + '</td><td>' + esc(r.c2) + '</td></tr>').join('') + '</tbody></table></div>');
    rows = null;
  };
  blocks.forEach((b) => {
    if (b.t === 'row') { (rows = rows || []).push(b); return; }
    flush();
    if (b.t === 'h2') out.push('<h2>' + esc(b.text) + '</h2>');
    else if (b.t === 'p') out.push('<p>' + esc(b.text) + '</p>');
    else if (b.t === 'callout') out.push('<div class="nf-callout" data-variant="' + b.variant + '"><span class="nf-callout-icon" contenteditable="false">' + CALLOUT[b.variant].icon + ' ' + CALLOUT[b.variant].label + '</span><div class="nf-callout-content"><p>' + esc(b.text) + '</p></div></div>');
    else if (b.t === 'code') out.push('<div class="nf-code"><span class="nf-code-lang" contenteditable="false">Text</span><pre><code>' + esc(b.text) + '</code></pre></div>');
    else if (b.t === 'task') out.push('<div class="nf-check" data-checked="' + (b.done ? 'true' : 'false') + '"><input type="checkbox" contenteditable="false" aria-label="Erledigt"' + (b.done ? ' checked' : '') + '><span>' + esc(b.text) + '</span></div>');
  });
  flush();
  return out.join('');
};
const TEMPLATES = [
  { id: 'meeting', name: 'Besprechungsnotizen', icon: '📝', scope: null, uses: 48, by: 'sophie', title: 'Besprechung am {datum}',
    desc: 'Teilnehmende, Tagesordnung, Entscheidungen und Aufgaben einer Besprechung.',
    blocks: [vB.h('Teilnehmende'), vB.p('Wer ist dabei? Mit @ erwähnen.'), vB.h('Tagesordnung'), vB.task('Punkt 1'), vB.task('Punkt 2'),
      vB.h('Entscheidungen'), vB.co('success', 'Was wurde entschieden, und warum?'), vB.h('Aufgaben'), vB.task('Aufgabe mit @Person und Termin')] },
  { id: 'howto', name: 'Anleitung', icon: '📘', scope: null, uses: 35, by: 'lukas', title: 'Anleitung: ',
    desc: 'Schritt für Schritt erklären, wie etwas geht, mit Voraussetzungen und Fehlerbehebung.',
    blocks: [vB.h('Ziel'), vB.p('Was kann man danach?'), vB.h('Voraussetzungen'), vB.task('Zugang zu …'), vB.h('Schritte'), vB.p('1. …'), vB.p('2. …'),
      vB.co('warning', 'Worauf man achten muss.'), vB.h('Fehlerbehebung'), vB.p('Wenn … passiert, hilft …')] },
  { id: 'decision', name: 'Entscheidung', icon: '🧭', scope: null, uses: 21, by: 'peter', title: 'Entscheidung: ',
    desc: 'Kontext, Optionen und Folgen einer Entscheidung, damit sie später nachvollziehbar bleibt.',
    blocks: [vB.co('info', 'Status: vorgeschlagen · Entscheidet: @Person · bis: Datum'), vB.h('Kontext'), vB.p('Welches Problem lösen wir? Was ist der Rahmen?'),
      vB.h('Optionen'), vB.row('Option', 'Vor- und Nachteile', true), vB.row('A', '…'), vB.row('B', '…'),
      vB.h('Entscheidung'), vB.p('Wir nehmen …, weil …'), vB.h('Folgen'), vB.p('Was ändert sich, was müssen wir nachziehen?')] },
  { id: 'retro', name: 'Retrospektive', icon: '🎯', scope: null, uses: 12, by: 'markus', title: 'Retrospektive {datum}',
    desc: 'Was lief gut, was nicht, und was ändern wir im nächsten Abschnitt?',
    blocks: [vB.h('Was lief gut?'), vB.p('…'), vB.h('Was lief nicht gut?'), vB.p('…'), vB.h('Maßnahmen'), vB.task('Maßnahme mit @Person')] },
  { id: 'project', name: 'Projektsteckbrief', icon: '🗺️', scope: null, uses: 9, by: 'peter', title: 'Projekt: ',
    desc: 'Ziel, Umfang, Beteiligte und Meilensteine eines Projekts auf einer Seite.',
    blocks: [vB.co('note', 'In einem Satz: Worum geht es?'), vB.h('Ziel'), vB.p('…'), vB.h('Nicht im Umfang'), vB.p('…'),
      vB.h('Beteiligte'), vB.row('Rolle', 'Person', true), vB.row('Verantwortlich', '@…'), vB.row('Mitarbeit', '@…'), vB.h('Meilensteine'), vB.task('Meilenstein 1 · Datum')] },
  { id: 'incident', name: 'Störungsbericht', icon: '🔥', scope: 'ENTW', uses: 6, by: 'lukas', title: 'Störung am {datum}: ',
    desc: 'Was ist passiert, wie haben wir reagiert, was lernen wir daraus? Ohne Schuldzuweisung.',
    blocks: [vB.co('error', 'Status: behoben · Dauer: … · Betroffen: …'), vB.h('Zusammenfassung'), vB.p('…'), vB.h('Zeitlinie'),
      vB.row('Zeit', 'Ereignis', true), vB.row('10:00', '…'), vB.h('Ursache'), vB.p('…'), vB.h('Maßnahmen'), vB.task('…')] },
  { id: 'release', name: 'Release-Notizen', icon: '🚀', scope: 'ENTW', uses: 14, by: 'markus', title: 'Release vom {datum}',
    desc: 'Neu, verbessert, behoben: was ein Release bringt, für alle verständlich.',
    blocks: [vB.h('Neu'), vB.p('…'), vB.h('Verbessert'), vB.p('…'), vB.h('Behoben'), vB.p('…'), vB.co('warning', 'Was Betrieb oder Kundschaft beachten müssen.')] },
  { id: 'offer', name: 'Angebot', icon: '💶', scope: 'VERT', uses: 17, by: 'max', title: 'Angebot für ',
    desc: 'Ausgangslage, Leistungen, Preise und nächste Schritte für ein Kundenangebot.',
    blocks: [vB.h('Ausgangslage'), vB.p('…'), vB.h('Leistungen'), vB.row('Leistung', 'Preis', true), vB.row('…', '… €'), vB.h('Nächste Schritte'), vB.task('Angebot abstimmen mit @…')] }
].map((t) => ({ ...t, html: tplHtml(t.blocks) }));
