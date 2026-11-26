// ---------- Versionen (Prototyp) ----------
// Der Prototyp spielt am 25. November 2026. Blöcke stark vereinfacht (Überschrift, Absatz, Callout, Tabellenzeile,
// Code, Aufgabe); im Produkt kommt der Vergleich aus dem BlockNote-JSON der Versionen (page_versions.content_json).
const V_TODAY = '2026-11-25';
const vB = {
  h: (text) => ({ t: 'h2', text }),
  p: (text) => ({ t: 'p', text }),
  co: (variant, text) => ({ t: 'callout', variant, text }),
  row: (c1, c2, head) => ({ t: 'row', c1, c2, head: !!head }),
  code: (text) => ({ t: 'code', text }),
  task: (text, done) => ({ t: 'task', text, done: !!done })
};
const vClone = (x) => JSON.parse(JSON.stringify(x));
// Datenmodell: 12 Versionen, jede aus der vorigen abgeleitet (die letzte entspricht der Seite)
const DM_VERSIONS = (() => {
  const L = [];
  const step = (meta, fn) => {
    const prev = L[L.length - 1];
    const blocks = prev ? vClone(prev.blocks) : [];
    fn(blocks);
    L.push({ n: L.length + 1, kind: 'auto', ...meta, title: meta.title || prev.title, blocks });
  };
  const row = (bl, c1) => bl.find((b) => b.t === 'row' && b.c1 === c1);
  const after = (bl, c1, block) => bl.splice(bl.indexOf(row(bl, c1)) + 1, 0, block);
  step({ at: '2026-11-03T10:14', authors: ['sophie'], title: 'Datenmodell (Entwurf)' }, (bl) => bl.push(
    vB.h('Überblick'), vB.p('Jede Tabelle hat eine tenant_id. Row Level Security trennt die Mandanten.'),
    vB.h('Kerntabellen'), vB.row('Tabelle', 'Zweck', true), vB.row('spaces', 'Bereich wie in Confluence'), vB.row('pages', 'Seitenbaum mit Pfad')));
  step({ at: '2026-11-03T16:40', authors: ['sophie', 'lukas'] }, (bl) => {
    bl.splice(2, 0, vB.co('info', 'Maßgeblich ist schema.sql.'));
    bl.push(vB.row('page_contents', 'Yjs-Zustand und Klartext'));
  });
  step({ at: '2026-11-05T11:02', authors: ['lukas'] }, (bl) => bl.push(vB.h('Mandant setzen'), vB.code("SELECT set_config('app.tenant_id', $1, true);")));
  step({ at: '2026-11-08T09:30', kind: 'manual', by: 'peter', name: 'Vor dem Review', authors: ['peter', 'sophie'], title: 'Datenmodell' }, (bl) => {
    bl[1].text = 'Jede Tabelle trägt tenant_id. Row Level Security trennt die Mandanten in der Datenbank selbst.';
  });
  step({ at: '2026-11-12T14:20', authors: ['markus'] }, (bl) => {
    after(bl, 'page_contents', vB.row('grants', 'Rechte auf Spaces'));
    bl.push(vB.h('Offene Punkte'), vB.task('RLS-Tests für alle Lesepfade'));
  });
  step({ at: '2026-11-14T10:05', authors: ['sophie'] }, (bl) => {
    after(bl, 'grants', vB.row('page_links', 'Verlinkungen für Rückverweise'));
    bl[2].text = 'Maßgeblich ist schema.sql. Jede Änderung am Schema braucht einen Test.';
  });
  step({ at: '2026-11-19T15:48', authors: ['lukas', 'sophie'] }, (bl) => {
    bl.find((b) => b.t === 'code').text = "SELECT set_config('app.tenant_id', $1, true);\nSELECT set_config('app.user_id',   $2, true);";
    row(bl, 'page_contents').c2 = 'Yjs-Zustand, BlockNote-JSON und Klartext für die Suche';
    bl.find((b) => b.t === 'task').done = true;
  });
  step({ at: '2026-11-21T09:12', authors: ['markus'] }, (bl) => {
    bl.splice(bl.indexOf(row(bl, 'page_links')), 1);
    row(bl, 'grants').c2 = 'Rechte auf einen Space oder eine Seite';
  });
  step({ at: '2026-11-23T17:30', authors: ['sophie'] }, (bl) => {
    bl[2].text = 'Maßgeblich ist schema.sql. Jede Änderung am Schema braucht einen Test in schema_test.sql.';
    row(bl, 'spaces').c2 = 'Bereich wie in Confluence, Einheit für Rechte und Import';
    row(bl, 'pages').c2 = 'Seitenbaum mit Pfad und Position, Papierkorb';
  });
  step({ at: '2026-11-24T11:45', authors: ['lukas'] }, (bl) => {
    bl[1].text = 'Jede Tabelle trägt tenant_id. Row Level Security trennt die Mandanten in der Datenbank selbst; die API setzt den Mandanten zu Beginn jeder Transaktion.';
    bl.push(vB.task('Tabelle mit effektiven Rechten für große Seitenbäume'));
  });
  step({ at: '2026-11-24T16:20', kind: 'manual', by: 'peter', name: 'Stand für M2', authors: ['peter', 'lukas'] }, (bl) => bl.push(vB.p('Wie Rechte vererbt werden, steht unter Rechte-Konzept.')));
  step({ at: '2026-11-25T15:38', authors: ['sophie', 'lukas'] }, (bl) => { bl[bl.length - 1].text = 'Wie Rechte vererbt werden, steht unter Rechte-Konzept. Fragen an @Sophie Bauer.'; });
  return L;
})();
const HOME_BLOCKS = [
  vB.p('Hier dokumentiert das Entwicklungsteam von Alpenwerk Architektur, Abläufe und Betrieb.'),
  vB.h('Bereiche'),
  vB.p('Architektur – Frontend, API, Datenmodell und Rechte'),
  vB.p('Release-Prozess – vom Merge bis zum Pilot'),
  vB.p('Betrieb – Cluster, Backups und Bereitschaft'),
  vB.h('Mitmachen'),
  vB.co('note', 'Neue Seiten bitte unter dem passenden Bereich anlegen. Seiten mit eigenen Rechten sind mit einem Schloss markiert.'),
  vB.p('Fragen zum Wiki an @Lukas Gruber.')
];
const V_MONTHS = { Januar: 1, Februar: 2, März: 3, April: 4, Mai: 5, Juni: 6, Juli: 7, August: 8, September: 9, Oktober: 10, November: 11, Dezember: 12 };
const vShift = (day, d) => { const x = new Date(day + 'T12:00:00'); x.setDate(x.getDate() - d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const vDayOf = (when) => {
  const m = /am (\d+)\. (\S+)(?: (\d{4}))?/.exec(when || '');
  return m ? (m[3] || '2026') + '-' + String(V_MONTHS[m[2]] || 11).padStart(2, '0') + '-' + m[1].padStart(2, '0') : V_TODAY;
};
// Übrige Seiten: drei Versionen, die den Text nach und nach aufbauen
const vGeneric = (p) => {
  const full = p.body === 'home' ? HOME_BLOCKS : p.text.map((t) => vB.p(t));
  const cut = (frac) => {
    if (full.length >= 3) return full.slice(0, Math.max(1, Math.round(full.length * frac)));
    if (!full.length) return [];
    const w = full[0].text.split(' ');
    return [vB.p(w.slice(0, Math.max(2, Math.round(w.length * frac))).join(' '))].concat(full.slice(1));
  };
  const day = vDayOf(p.when);
  return [
    { n: 1, kind: 'auto', at: vShift(day, 5) + 'T09:10', authors: [p.author], title: p.title, blocks: vClone(cut(0.45)) },
    { n: 2, kind: 'auto', at: vShift(day, 2) + 'T14:05', authors: [...new Set([p.author, p.editor])], title: p.title, blocks: vClone(cut(0.75)) },
    { n: 3, kind: 'auto', at: day + (day === V_TODAY ? 'T15:38' : 'T10:20'), authors: [p.editor], title: p.title, blocks: vClone(full) }
  ];
};
const vDay = (at) => at.slice(0, 10);
const vTime = (at) => at.slice(11, 16);
const vDayLabel = (day) => day === V_TODAY ? 'Heute' : day === vShift(V_TODAY, 1) ? 'Gestern'
  : new Date(day + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const vLong = (at) => {
  const d = vDay(at);
  const l = d === V_TODAY ? 'Heute' : d === vShift(V_TODAY, 1) ? 'Gestern' : new Date(d + 'T12:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  return l + ', ' + vTime(at) + ' Uhr';
};
const vShort = (at) => new Date(vDay(at) + 'T12:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });

// Vergleich (nur Prototyp): längste gemeinsame Teilfolge über Blöcke, in geänderten Blöcken über Wörter.
// Im Frontend dafür eine Bibliothek nehmen (CLAUDE.md, „Fremder Code“), z. B. das npm-Paket diff.
const vLcs = (a, b, eq) => {
  const n = a.length, m = b.length;
  const dp = [];
  for (let i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) { ops.push({ op: '=', a: a[i], b: b[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ op: '-', a: a[i] }); i++; }
    else { ops.push({ op: '+', b: b[j] }); j++; }
  }
  while (i < n) ops.push({ op: '-', a: a[i++] });
  while (j < m) ops.push({ op: '+', b: b[j++] });
  return ops;
};
const vTokens = (s) => String(s || '').split(/(\s+)/).filter((x) => x !== '');
const vWordDiff = (a, b) => {
  const raw = vLcs(vTokens(a), vTokens(b), (x, y) => x === y).map((o) => ({ k: o.op, text: o.op === '+' ? o.b : o.a }));
  // Leerraum zwischen zwei Änderungen gehört zur Änderung: liest sich als „alt → neu“ statt Wort für Wort
  raw.forEach((r, i) => { if (r.k === '=' && !r.text.trim() && raw[i - 1] && raw[i + 1] && raw[i - 1].k !== '=' && raw[i + 1].k !== '=') r.k = 'both'; });
  const out = [];
  for (let i = 0; i < raw.length;) {
    if (raw[i].k === '=') { out.push({ k: '=', text: raw[i].text }); i++; continue; }
    let del = '', ins = '';
    while (i < raw.length && raw[i].k !== '=') { const r = raw[i]; if (r.k !== '+') del += r.text; if (r.k !== '-') ins += r.text; i++; }
    if (del) out.push({ k: del.trim() ? '-' : '=', text: del });
    if (ins && (ins.trim() || !del)) out.push({ k: ins.trim() ? '+' : '=', text: ins });
  }
  return out.reduce((acc, x) => { const l = acc[acc.length - 1]; if (l && l.k === x.k) l.text += x.text; else acc.push({ ...x }); return acc; }, []);
};
const vRender = (block, mode, old) => {
  const kind = { add: '+', del: '-', eq: '=' }[mode];
  const segsOf = (f) => mode === 'chg' ? vWordDiff(old[f], block[f]) : [{ k: kind, text: block[f] }];
  const r = { t: block.t, cls: { add: 'nf-v-added', del: 'nf-v-removed', chg: 'nf-v-changed', eq: '' }[mode] };
  if (block.t === 'row') { r.c1 = segsOf('c1'); r.c2 = segsOf('c2'); r.head = block.head; } else r.segs = segsOf('text');
  if (block.t === 'callout') { r.variant = block.variant; if (mode === 'chg' && old.variant !== block.variant) r.note = 'Art: ' + CALLOUT[old.variant].label + ' → ' + CALLOUT[block.variant].label; }
  if (block.t === 'task') { r.done = block.done; if (mode === 'chg' && old.done !== block.done) r.note = block.done ? 'abgehakt' : 'wieder offen'; }
  return r;
};
const vMarkRows = (out) => out.map((r, i) => {
  if (r.t !== 'row') return r;
  const first = !(out[i - 1] && out[i - 1].t === 'row');
  const last = !(out[i + 1] && out[i + 1].t === 'row');
  return { ...r, rowCls: [first && 'nf-vrow-first', last && 'nf-vrow-last', r.head && 'nf-vrow-head'].filter(Boolean).join(' ') };
});
const vPlain = (blocks) => vMarkRows(blocks.map((b) => vRender(b, 'eq')));
const vBlockDiff = (a, b) => {
  const key = (x) => JSON.stringify(x);
  const ops = vLcs(a, b, (x, y) => key(x) === key(y));
  const out = [];
  for (let i = 0; i < ops.length;) {
    if (ops[i].op === '=') { out.push(vRender(ops[i].b, 'eq')); i++; continue; }
    const dels = [], adds = [];
    while (i < ops.length && ops[i].op !== '=') { if (ops[i].op === '-') dels.push(ops[i].a); else adds.push(ops[i].b); i++; }
    // Gleiche Blockart (Tabellenzeile: gleiche Spalte) gilt als geändert, Rest als entfernt bzw. neu
    const used = new Set();
    const pair = adds.map((x) => {
      const j = dels.findIndex((d, k) => !used.has(k) && d.t === x.t && (x.t !== 'row' || d.c1 === x.c1 || d.c2 === x.c2));
      if (j >= 0) used.add(j);
      return j;
    });
    // Reihenfolge erhalten: entfernte Blöcke vor dem geänderten Block, der hinter ihnen stand
    let next = 0;
    const flushDels = (upTo) => { for (; next < upTo; next++) if (!used.has(next)) out.push(vRender(dels[next], 'del')); };
    adds.forEach((x, k) => {
      if (pair[k] >= 0) { flushDels(pair[k]); next = Math.max(next, pair[k] + 1); out.push(vRender(x, 'chg', dels[pair[k]])); }
      else out.push(vRender(x, 'add'));
    });
    flushDels(dels.length);
  }
  return vMarkRows(out);
};
const vWords = (segs, k) => (segs || []).filter((x) => x.k === k).reduce((n, x) => n + vTokens(x.text).filter((t) => t.trim()).length, 0);
const vStats = (blocks, titleSegs) => {
  const all = [titleSegs, ...blocks.flatMap((b) => b.t === 'row' ? [b.c1, b.c2] : [b.segs])];
  return { plus: all.reduce((n, l) => n + vWords(l, '+'), 0), minus: all.reduce((n, l) => n + vWords(l, '-'), 0) };
};
const vTplSegs = (l) => (l || []).map((x) => ({ text: x.text, ins: x.k === '+', del: x.k === '-', eq: x.k === '=' }));
const vTpl = (r) => ({
  isH2: r.t === 'h2', isP: r.t === 'p', isCallout: r.t === 'callout', isCode: r.t === 'code', isTask: r.t === 'task', isRow: r.t === 'row',
  cls: r.cls, rowCls: r.rowCls || '',
  segs: vTplSegs(r.segs), c1: vTplSegs(r.c1), c2: vTplSegs(r.c2),
  variant: r.variant || 'info', icon: r.variant ? CALLOUT[r.variant].icon : '', variantLabel: r.variant ? CALLOUT[r.variant].label : '',
  done: !!r.done, doneAttr: r.done ? 'true' : 'false', doneLabel: r.done ? 'Erledigt' : 'Offen', locked: true,
  hasNote: !!r.note, note: r.note || ''
});
