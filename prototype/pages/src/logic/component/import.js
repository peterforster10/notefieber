  // ---------- Confluence-Import (Ausblick M4) ----------
  // Drei Schritte: Export hochladen, Probelauf prüfen (Gruppen, Personen, Rechte vorab, Makros), importieren.
  // Der Probelauf ändert nichts. Die Rechte rechnet der Importer vorher aus; „weiter als vorher“ sperrt den Import.
  openImport() {
    this.edSave();
    this.setState((st) => ({
      view: 'import', drawer: false, menu: null, palette: null, versions: null,
      imp: st.imp
    }));
    setTimeout(() => { try { window.scrollTo(0, 0); } catch (err) { /* egal */ } }, 0);
  }
  setImp(patch) { this.setState((st) => ({ imp: { ...st.imp, ...patch } })); }
  /** Import „laufen“ lassen: Fortschritt in Phasen, danach Seiten im Ziel-Space anlegen */
  runImport() {
    const phases = 4;
    this.setImp({ step: 3, progress: 0, phase: 0 });
    clearInterval(this._impT);
    this._impT = setInterval(() => {
      const p = Math.min(100, (this.state.imp.progress || 0) + 7);
      this.setImp({ progress: p, phase: Math.min(phases - 1, Math.floor(p / (100 / phases))) });
      if (p >= 100) { clearInterval(this._impT); this.finishImport(); }
    }, 120);
  }
  finishImport() {
    const s = this.state, key = s.imp.space, home = s.spaces[key].home;
    const n = s.seq;
    const ids = { root: 'imp' + n, onb: 'imp' + n + 'a', api: 'imp' + n + 'b', jira: 'imp' + n + 'c', vert: 'imp' + n + 'd' };
    const g = s.imp.groups;
    const pageOf = (title, parent, kids, text) => ({ space: key, title, parent, kids, author: 'peter', editor: 'peter', when: 'gerade eben', text: text || [] });
    this.setState((st) => {
      const pages = { ...st.pages };
      pages[ids.root] = pageOf('Aus Confluence (' + tplDate() + ')', home, [ids.onb, ids.api, ids.jira, ids.vert], ['Importiert aus dem Confluence-Space ENTW (Export vom 28.10.2026). 212 Seiten, 486 Anhänge.']);
      pages[ids.onb] = pageOf('Onboarding', ids.root, [], ['Erste Schritte im Entwicklungsteam: Zugänge, Werkzeuge und Ansprechpersonen.']);
      pages[ids.api] = pageOf('API-Richtlinien', ids.root, [], ['Versionierung, Fehlerformat und Pagination für alle internen APIs.']);
      pages[ids.jira] = pageOf('Jira-Übersicht', ids.root, []);
      pages[ids.vert] = pageOf('Lieferanten-Verträge', ids.root, [], ['Rahmenverträge mit Dienstleistern. Eingeschränkt wie in Confluence.']);
      pages[home] = { ...pages[home], kids: [...pages[home].kids, ids.root] };
      const grants = { ...st.grants };
      // Eingeschränkte Seite wie im Probelauf berechnet: Gruppe Entwicklung, agentur-nord nur wenn zugeordnet
      grants[ids.vert] = [{ key: 'peter', role: 'admin' }, ...(g.team && g.team !== 'skip' ? [{ key: g.team === 'ws' ? 'ws' : 'grp', role: 'viewer' }] : [])];
      return {
        pages, grants, seq: st.seq + 1,
        restoredBody: { ...st.restoredBody, [ids.jira]: [vB.p('Offene Vorgänge des Teams, wie sie in Confluence eingebunden waren:'), vB.co('warning', 'Platzhalter: Confluence-Makro „Jira-Vorgänge“ (project = ENTW AND status != Done). Den Originalinhalt und den Link zur Quelle zeigt der Import-Bericht.'), vB.p('Stand der Liste: 28.10.2026.')] },
        pageIcons: { ...st.pageIcons, [ids.root]: '📦' },
        expanded: { ...st.expanded, [ids.root]: true },
        imp: { ...st.imp, step: 4, created: { key, ids: Object.values(ids), root: ids.root, jira: ids.jira, home } }
      };
    });
  }
  undoImport() {
    const c = this.state.imp.created;
    this.setState((st) => {
      if (!c) return { imp: { ...st.imp, step: 1, file: false } };
      const pages = { ...st.pages };
      c.ids.forEach((id) => { delete pages[id]; });
      pages[c.home] = { ...pages[c.home], kids: pages[c.home].kids.filter((k) => k !== c.root) };
      const grants = { ...st.grants };
      c.ids.forEach((id) => { delete grants[id]; });
      return { pages, grants, current: c.ids.includes(st.current) ? c.home : st.current, imp: { ...st.imp, step: 1, file: false, progress: 0, created: null } };
    });
    this.showToast('Import rückgängig gemacht: ' + c.ids.length + ' Seiten entfernt');
  }
  importVals() {
    const s = this.state, imp = s.imp;
    if (!imp) return {};
    const names = ['Export hochladen', 'Probelauf prüfen', 'Importieren'];
    const stepNo = Math.min(imp.step, 3);
    const steps = names.map((label, i) => ({
      num: i + 1 < stepNo || imp.step === 4 ? '✓' : String(i + 1),
      label,
      state: imp.step === 4 || i + 1 < stepNo ? 'done' : i + 1 === stepNo ? 'current' : 'todo',
      current: i + 1 === stepNo && imp.step !== 4 ? 'step' : 'false'
    }));
    // Ziel: Spaces, die man verwaltet (Admin), nicht archiviert
    const targets = Object.values(s.spaces).filter((x) => !x.archived && this.role(x.home) === 'admin');
    const target = s.spaces[imp.space] || targets[0];
    const T = { ws: 'Alle im Workspace', grp: 'Gruppe Entwicklung', new: 'Neue Gruppe „entw-admins“', skip: 'Nicht übernehmen', '': 'Bitte wählen' };
    const defs = [
      { key: 'users', name: 'confluence-users', count: 48 },
      { key: 'team', name: 'entw-team', count: 12 },
      { key: 'admins', name: 'entw-admins', count: 3 },
      { key: 'extern', name: 'agentur-nord', count: 2 }
    ];
    const g = imp.groups;
    const groups = defs.map((d) => ({
      ...d,
      target: g[d.key],
      label: 'Zuordnung für ' + d.name,
      missing: !g[d.key] ? 'true' : 'false',
      change: (e) => { const v = e.target.value; this.setState((st) => ({ imp: { ...st.imp, groups: { ...st.imp.groups, [d.key]: v } } })); }
    }));
    const missingCount = defs.filter((d) => !g[d.key]).length;
    // Rechte vorab: eingeschränkte Confluence-Seiten und was daraus wird
    const restricted = [
      { title: 'Personalplanung (alt)', what: 'Lesen nur entw-admins', groups: ['admins'] },
      { title: 'Lieferanten-Verträge', what: 'Lesen nur entw-team und agentur-nord', groups: ['team', 'extern'] },
      { title: 'Bereitschaftsplan', what: 'Bearbeiten nur entw-team, lesen alle', groups: ['team'], editOnly: true },
      { title: 'Gehaltsrunde 2025', what: 'Lesen nur 2 Personen', groups: [], people: 'Peter Forster, Sophie Bauer' }
    ];
    const rows = restricted.map((r) => {
      const mapped = r.groups.map((k) => ({ k, t: g[k] }));
      const open = mapped.some((m) => !m.t);
      const wider = !r.editOnly && mapped.some((m) => m.t === 'ws');
      const narrower = mapped.some((m) => m.t === 'skip');
      const who = r.people ? r.people : mapped.filter((m) => m.t && m.t !== 'skip').map((m) => T[m.t]).join(', ') || 'nur du (Admin der Seite)';
      const state = open ? 'open' : wider ? 'wider' : narrower ? 'narrower' : 'same';
      return {
        title: r.title, what: r.what,
        result: open ? 'Zuordnung fehlt' : (r.editOnly ? 'Bearbeiten: ' : 'Lesen: ') + who,
        state,
        stateLabel: { open: 'Offen', wider: 'Weiter als vorher', narrower: 'Enger als vorher', same: 'Wie vorher' }[state],
        hint: wider ? 'Alle im Workspace könnten die Seite lesen. Ordne die Gruppe anders zu.' : narrower ? 'Wer nur über „Nicht übernehmen“ Zugriff hatte, sieht die Seite nicht mehr.' : ''
      };
    });
    const widerCount = rows.filter((r) => r.state === 'wider').length;
    const ok = { cls: 'nf-imp-tag-ok' };
    const warn = { cls: 'nf-imp-tag-warn' };
    const macros = [
      { name: 'Code-Block', pages: 58, target: 'Code-Block', ...ok },
      { name: 'Info, Hinweis, Warnung', pages: 41, target: 'Callout', ...ok },
      { name: 'Inhaltsverzeichnis', pages: 17, target: 'Inhaltsverzeichnis', ...ok },
      { name: 'Jira-Vorgänge', pages: 6, target: 'Platzhalter mit Link', ...warn },
      { name: 'Seiteneigenschaften-Bericht', pages: 3, target: 'Platzhalter', ...warn }
    ];
    const blockers = [missingCount ? (missingCount === 1 ? '1 Gruppe ist noch nicht zugeordnet.' : missingCount + ' Gruppen sind noch nicht zugeordnet.') : '', widerCount ? (widerCount === 1 ? '1 Seite wäre danach für mehr Personen sichtbar als in Confluence.' : widerCount + ' Seiten wären danach für mehr Personen sichtbar als in Confluence.') : ''].filter(Boolean);
    const phases = ['Seiten anlegen', 'Anhänge übertragen', 'Rechte setzen', 'Suchindex aufbauen'];
    const c = imp.created;
    return {
      steps,
      s1: imp.step === 1, s2: imp.step === 2, s3: imp.step === 3, s4: imp.step === 4,
      targets: targets.map((x) => ({ key: x.key, label: x.name + ' (' + x.key + ')' })),
      space: target ? target.key : '',
      spaceName: target ? target.name : '',
      noTarget: targets.length === 0,
      onSpace: (e) => this.setImp({ space: e.target.value }),
      file: imp.file, noFile: !imp.file,
      chooseFile: () => this.setImp({ file: true }),
      removeFile: () => this.setImp({ file: false }),
      runDry: () => { this.setImp({ step: 2 }); setTimeout(() => { try { window.scrollTo(0, 0); } catch (err) { /* egal */ } }, 0); },
      back: () => this.setImp({ step: 1 }),
      groups,
      groupNote: missingCount ? (missingCount === 1 ? '1 Gruppe noch nicht zugeordnet' : missingCount + ' Gruppen noch nicht zugeordnet') : '',
      hasGroupNote: missingCount > 0,
      invite: imp.invite,
      toggleInvite: () => this.setImp({ invite: !imp.invite }),
      rows,
      macros,
      blocked: blockers.length > 0,
      blockers: blockers.map((t) => ({ t })),
      startImport: () => { if (!blockers.length) this.runImport(); },
      reportToast: () => this.showToast('Bericht als PDF und CSV (Ausblick)'),
      progress: imp.progress || 0,
      progressLabel: (imp.progress || 0) + ' %',
      phases: phases.map((label, i) => ({ label, state: (imp.progress || 0) >= 100 || i < imp.phase ? 'done' : i === imp.phase ? 'current' : 'todo' })),
      doneText: c ? '212 Seiten und 486 Anhänge sind jetzt im Space ' + s.spaces[c.key].name + ', unter „Aus Confluence (' + tplDate() + ')“. 9 Seiten enthalten Platzhalter für Makros, 1 Seite hat eigene Rechte wie in Confluence.' : '',
      openSpace: () => c && this.go(c.root),
      openPlaceholders: () => c && this.go(c.jira),
      checkRights: () => { if (!c) return; this.go(c.root); setTimeout(() => this.openViewAs(false), 0); },
      undo: () => this.undoImport()
    };
  }
