  // ---------- Exportieren (M3: E14) ----------
  // Eine Seite, eine Seite mit Unterseiten oder ein ganzer Space als ZIP: Markdown zum Lesen, BlockNote-JSON
  // verlustfrei für Re-Import und Editorwechsel, Bilder und Anhänge, manifest.json mit IDs und Pfaden.
  // Nur, was die Person lesen darf (app.page_rank, Papierkorb nie); was fehlt, fehlt ohne Hinweis.
  // Kleine Exporte lädt die API direkt, größere baut der Worker als Auftrag (pg-boss) und legt das ZIP in
  // Garage ab (über die API herunterladbar, 7 Tage). Jeder Export steht im Audit-Log (app.audit_event, export).
  openExport(scope, space) {
    const s = this.state;
    const fromPage = scope !== 'space';
    this.setState({
      dialog: 'export', pageMenu: false, sideMenu: null, menu: null,
      exp: { scope: scope || 'page', pid: fromPage ? s.current : null, space: space || s.space, json: true, files: true }
    });
  }
  setExp(patch) { this.setState((st) => ({ exp: { ...st.exp, ...patch } })); }
  /** Lesbare Seiten außerhalb des Papierkorbs, im Teilbaum von root (root eingeschlossen) */
  exportPages(root) {
    const s = this.state, P = s.pages;
    const trashed = new Set(s.trash.map((t) => t.id));
    const out = [];
    const walk = (id, depth, path) => {
      if (trashed.has(id) || !this.role(id)) return;   // ohne Leserecht samt Unterseiten (wie der Export im Worker)
      out.push({ id, depth, path });
      P[id].kids.forEach((k) => walk(k, depth + 1, path.concat(id)));
    };
    walk(root, 0, []);
    return out;
  }
  /** Dateiname aus dem Titel: Umlaute ausgeschrieben (ü → ue), sonst nur a–z, 0–9 und Bindestrich */
  slug(t) {
    const de = (t || 'ohne-titel').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
    return fold(de).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'seite';
  }
  /** Ungefähre Größe: Text der Seiten, BlockNote-JSON etwa dreimal so groß, Bilder pauschal */
  exportSize(list, json, files) {
    const P = this.state.pages;
    const text = list.reduce((n, x) => n + (SEARCH_TEXT[x.id] || P[x.id].text.join(' ')).length + 400, 0);
    const bytes = text * (json ? 4 : 1) + (files ? list.length * 180000 : 0);
    return bytes < 1e6 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (bytes / 1e6).toFixed(1).replace('.', ',') + ' MB';
  }
  runExport(job) {
    const phases = EXPORT_PHASES.length;
    this.setState((st) => ({ exports: [job, ...st.exports] }));
    const step = Math.max(2, Math.round(60 / job.pages));
    const t = setInterval(() => {
      const cur = this.state.exports.find((x) => x.id === job.id);
      if (!cur) { clearInterval(t); return; }
      const p = Math.min(100, cur.progress + step);
      const done = p >= 100;
      this.setState((st) => ({ exports: st.exports.map((x) => (x.id === job.id ? { ...x, progress: p, phase: Math.min(phases - 1, Math.floor(p / (100 / phases))), status: done ? 'ready' : 'running', when: done ? 'gerade eben' : x.when } : x)) }));
      if (done) { clearInterval(t); this.showToast('Export fertig: ' + job.label); }
    }, 160);
  }

  exportVals() {
    const s = this.state, P = s.pages;
    if (s.dialog !== 'export' || !s.exp) return { exp: { open: false } };
    const e = s.exp;
    const sp = s.spaces[e.space];
    const page = e.pid ? P[e.pid] : null;
    const isHome = !!page && e.pid === sp.home;
    const title = (id) => (id === sp.home ? sp.name : P[id].title || 'Ohne Titel');
    const lists = {
      page: page ? this.exportPages(e.pid).slice(0, 1) : [],
      tree: page ? this.exportPages(e.pid) : [],
      space: this.exportPages(sp.home)
    };
    const n = (k) => lists[k].length;
    const pagesText = (k) => n(k) + (n(k) === 1 ? ' Seite' : ' Seiten');
    const options = [
      page && { key: 'page', label: 'Nur diese Seite', hint: '„' + title(e.pid) + '“' },
      page && !isHome && n('tree') > 1 && { key: 'tree', label: 'Seite mit Unterseiten', hint: '„' + title(e.pid) + '“ und darunter, ' + pagesText('tree') },
      { key: 'space', label: 'Ganzer Space', hint: '„' + sp.name + '“, ' + pagesText('space') }
    ].filter(Boolean).map((o) => ({
      ...o, id: 'exp-scope-' + o.key, checked: e.scope === o.key,
      choose: () => this.setExp({ scope: o.key })
    }));
    const scope = options.some((o) => o.key === e.scope) ? e.scope : options[0].key;
    const list = lists[scope];
    const root = scope === 'space' ? sp.home : e.pid;
    const big = list.length > 5;
    // Inhalt des ZIP: Ordner nach dem Seitenbaum, je Seite Markdown und (wenn gewählt) BlockNote-JSON
    const base = (scope === 'space' ? sp.key.toLowerCase() : this.slug(title(root))) + '-2026-11-28';
    const files = [];
    list.slice(0, 5).forEach((x) => {
      const rel = x.path.concat(x.id).map((id) => this.slug(title(id))).join('/');
      files.push({ name: rel + '.md', kind: 'md' });
      if (e.json) files.push({ name: rel + '.blocknote.json', kind: 'json' });
    });
    if (list.length > 5) files.push({ name: '… und ' + (list.length - 5) + ' weitere Seiten', kind: 'more' });
    if (e.files) files.push({ name: 'files/ (Bilder und Anhänge der Seiten)', kind: 'dir' });
    files.push({ name: 'manifest.json (Seiten-IDs, Titel, Pfade, Zeitpunkt)', kind: 'json' });
    const label = scope === 'space' ? 'Space „' + sp.name + '“' : '„' + title(root) + '“' + (scope === 'tree' ? ' mit Unterseiten' : '');
    const zip = base + '.zip';
    const running = s.exports.filter((x) => x.status === 'running');
    const start = () => {
      if (!big) { this.showToast('Download von ' + zip + ' startet (im Prototyp ohne Datei)'); this.closeTopDialog(); return; }
      this.runExport({ id: 'x' + Date.now(), label, zip, pages: list.length, size: this.exportSize(list, e.json, e.files), status: 'running', progress: 0, phase: 0, when: 'läuft', expires: '5. Dezember' });
      this.focusLater('#exp-jobs');
    };
    return {
      exp: {
        open: true,
        title: 'Exportieren',
        options,
        md: true,
        json: !!e.json, toggleJson: () => this.setExp({ json: !e.json }),
        withFiles: !!e.files, toggleFiles: () => this.setExp({ files: !e.files }),
        files,
        zip,
        summary: pagesText(scope) + ' · ca. ' + this.exportSize(list, e.json, e.files),
        big, small: !big,
        startLabel: big ? 'Export starten' : 'Herunterladen',
        start,
        bigHint: 'Größere Exporte baut der Server im Hintergrund. Du kannst den Dialog schließen; wenn das ZIP fertig ist, erscheint es hier unter „Deine Exporte“ (7 Tage lang).',
        jobs: s.exports.map((x) => ({
          id: x.id, label: x.label, zip: x.zip,
          running: x.status === 'running', ready: x.status === 'ready',
          meta: x.status === 'running'
            ? EXPORT_PHASES[x.phase] + ' … ' + x.progress + ' %'
            : x.pages + (x.pages === 1 ? ' Seite' : ' Seiten') + ' · ' + x.size + ' · erstellt ' + x.when + ' · verfügbar bis ' + x.expires,
          progress: x.progress, progressLabel: x.label + ': ' + x.progress + ' %',
          download: () => this.showToast('Download von ' + x.zip + ' startet (im Prototyp ohne Datei)')
        })),
        hasJobs: s.exports.length > 0,
        hasRunning: running.length > 0
      }
    };
  }
