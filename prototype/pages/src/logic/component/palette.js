  // ---------- Befehlspalette (Suche, Strg K) ----------
  openPalette() {
    this.setState({ palette: { q: '', scope: 'all', active: 0, limit: false }, menu: null, spaceMenu: false, spaceSub: null, pageMenu: false, userMenu: false, settingsMenu: false, sideMenu: null, drawer: false });
    this.focusLater('#nf-cmd-q');
  }
  closePalette(restoreFocus = true) {
    this.setState({ palette: null });
    if (restoreFocus) this.focusLater('#nf-search');
  }
  setPalette(patch) {
    this.setState((st) => ({ palette: st.palette ? { ...st.palette, ...patch } : st.palette }));
  }

  paletteVals() {
    const s = this.state;
    const pal = s.palette;
    if (!pal) return { open: false };
    const P = s.pages;
    const shown = (t) => t || 'Ohne Titel';
    const sp = s.spaces[s.space];
    const inSpace = s.view !== 'overview' && s.view !== 'templates';
    const trashed = new Set(s.trash.map((t) => t.id));
    const inTrash = (id) => this.chain(id).some((x) => trashed.has(x));
    const raw = pal.q;
    const commandsOnly = raw.trim().startsWith('>');
    const q = commandsOnly ? raw.trim().slice(1).trim() : raw.trim();
    const words = fold(q).split(/\s+/).filter(Boolean);
    const all = (hay) => words.every((w) => hay.includes(w));
    /** Text in drei Teile: vor, Treffer, nach (für <mark>); mit Ausschnitt um die Fundstelle */
    const split = (text, window) => {
      const f = fold(text);
      const w = words.find((x) => f.includes(x));
      if (!w) return [text, '', ''];
      const i = f.indexOf(w);
      if (!window) return [text.slice(0, i), text.slice(i, i + w.length), text.slice(i + w.length)];
      let start = Math.max(0, i - 36);
      if (start > 0) { const sp2 = text.indexOf(' ', start); if (sp2 > 0 && sp2 < i) start = sp2 + 1; }
      const end = Math.min(text.length, i + w.length + 70);
      return [(start > 0 ? '… ' : '') + text.slice(start, i), text.slice(i, i + w.length), text.slice(i + w.length, end) + (end < text.length ? ' …' : '')];
    };
    const pathOf = (id) => {
      const ch = this.chain(id).slice(1, -1).map((x) => shown(P[x].title));
      return [s.spaces[P[id].space].name, ...ch].join(' / ');
    };
    const close = (fn) => () => { this.closePalette(false); fn(); };

    // Seiten: nur mit Leserecht (page_rank), nicht im Papierkorb; optional nur im aktuellen Space
    const readable = Object.keys(P).filter((id) => this.role(id) && !inTrash(id) && (!pal.limit || P[id].space === s.space));
    const textOf = (id) => SEARCH_TEXT[id] || P[id].text.join(' ');
    let pages = [];
    if (words.length && !commandsOnly) {
      pages = readable.map((id) => {
        const title = shown(P[id].title);
        const ft = fold(title);
        const body = textOf(id);
        const inTitle = all(ft);
        if (!inTitle && !all(fold(title + ' ' + body))) return null;
        const score = (inTitle ? 10 : 0) + (ft.startsWith(words[0]) ? 5 : 0) + (P[id].space === s.space ? 1 : 0);
        return { id, score, inTitle, title, body };
      }).filter(Boolean).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'de'));
    }
    const pageItem = (x) => {
      const [t1, t2, t3] = split(x.title);
      const bodyHit = words.some((w) => fold(x.body).includes(w));
      const [s1, s2, s3] = bodyHit && (!x.inTitle || words.length) ? split(x.body, true) : ['', '', ''];
      return {
        kind: 'page', t1, t2, t3, s1, s2, s3, hasSnippet: bodyHit && !!s2,
        restricted: this.chain(x.id).some((y) => s.grants[y]),
        meta: pathOf(x.id),
        run: close(() => this.go(x.id))
      };
    };
    const recentIds = ['dm', 'personal', 'kampagne', 'release'].filter((id) => P[id] && readable.includes(id));
    const recentItems = recentIds.map((id) => ({
      kind: 'page', t1: shown(P[id].title), t2: '', t3: '', hasSnippet: false,
      restricted: this.chain(id).some((y) => s.grants[y]),
      meta: pathOf(id) + ' · ' + P[id].when,
      run: close(() => this.go(id))
    }));

    // Spaces und Personen
    const spaces = this.favFirst(Object.values(s.spaces), (x) => x.key).filter((x) => !words.length || all(fold(x.name + ' ' + x.key))).map((x) => {
      const [t1, t2, t3] = split(x.name);
      return {
        kind: 'space', t1, t2, t3, badge: x.key.slice(0, 2), iconStyle: 'background:' + (x.color || '#1F5FD6') + ';color:#fff',
        meta: x.key + (x.archived ? ' · archiviert' : ''),
        run: close(() => this.setState({ space: x.key, current: x.home, view: 'page' }))
      };
    });
    const people = s.members.filter((m) => !words.length || all(fold(PEOPLE[m.key].name + ' ' + m.email))).map((m) => {
      const name = PEOPLE[m.key].name;
      const [t1, t2, t3] = split(name);
      return {
        kind: 'person', t1, t2, t3, badge: initials(name), iconStyle: 'background:' + PEOPLE[m.key].color + ';color:#fff;border-radius:50%',
        meta: m.email,
        run: close(() => this.showToast('Profile von Personen kommen später (Ausblick)'))
      };
    });

    // Aktionen
    const isPage = s.view === 'page';
    const dark = document.documentElement.dataset.theme === 'dark';
    const acts = [
      inSpace && !sp.archived && this.canEdit(sp.home) && { label: 'Neue Seite in „' + sp.name + '“', kw: 'neue seite anlegen erstellen', run: () => this.createPage(sp.home) },
      { label: 'Neuer Space', kw: 'space anlegen erstellen neu', run: () => { this.setState({ dialog: 'newSpace', ns: null }); this.focusLater('#ns-name'); } },
      { label: 'Zur Übersicht', kw: 'startseite home übersicht spaces', run: () => this.setState({ view: 'overview' }) },
      { label: 'Vorlagen', kw: 'vorlage vorlagen muster template neue seite', run: () => this.openTemplates(null) },
      { label: 'Confluence-Import', kw: 'import importieren confluence umzug export hochladen', run: () => this.openImport() },
      isPage && { label: 'Link zur Seite kopieren', kw: 'link kopieren teilen url adresse', run: () => this.showToast('Link kopiert') },
      isPage && { label: 'Versionen anzeigen', kw: 'versionen verlauf historie wiederherstellen vergleichen änderungen', run: () => this.openVersions(this.state.current) },
      isPage && { label: 'Seite exportieren', kw: 'export exportieren markdown download', run: () => this.setState({ dialog: 'export' }) },
      { label: dark ? 'Helle Darstellung' : 'Dunkle Darstellung', kw: 'darstellung theme dunkel hell modus farbe', run: () => {
        const next = dark ? 'light' : 'dark';
        try { localStorage.setItem('nf-proto-theme', next); } catch (err) { /* nur diese Sitzung */ }
        this.setState({ theme: next });
      } },
      { label: 'Personen einladen', kw: 'einladen einladung mitglied workspace', run: () => this.setState({ dialog: 'invites', inviteLink: null }) },
      { label: 'Tastenkürzel anzeigen', kw: 'tastatur kürzel shortcuts hilfe', run: () => this.setState({ dialog: 'shortcuts' }) }
    ].filter(Boolean);
    const actions = acts.filter((a) => !words.length || all(fold(a.label + ' ' + a.kw))).map((a) => {
      const [t1, t2, t3] = split(a.label);
      return { kind: 'action', t1, t2, t3, meta: 'Befehl', run: close(a.run) };
    });

    // Bereiche und Gruppen
    const scope = commandsOnly ? 'all' : pal.scope;
    const groups = [];
    const more = (label, n, sc) => ({ hasMore: true, moreLabel: label, more: () => { this.setPalette({ scope: sc, active: 0 }); this.focusLater('#nf-cmd-q'); } });
    if (commandsOnly) {
      groups.push({ label: 'Befehle', items: actions });
    } else if (!words.length) {
      if (scope === 'all' || scope === 'pages') groups.push({ label: pal.limit ? 'Zuletzt angesehen in ' + sp.name : 'Zuletzt angesehen', items: recentItems.filter((r, i) => !pal.limit || P[recentIds[i]].space === s.space) });
      if (scope === 'spaces') groups.push({ label: 'Spaces', items: spaces });
      if (scope === 'people') groups.push({ label: 'Personen im Workspace', items: people });
      if (scope === 'all') groups.push({ label: 'Befehle', items: actions.slice(0, 5) });
    } else {
      if (scope === 'all') {
        groups.push({ label: 'Seiten', items: pages.slice(0, 5).map(pageItem), ...(pages.length > 5 ? more('Alle ' + pages.length + ' Seiten zeigen', pages.length, 'pages') : {}) });
        groups.push({ label: 'Spaces', items: spaces.slice(0, 3) });
        groups.push({ label: 'Personen', items: people.slice(0, 3), ...(people.length > 3 ? more('Alle ' + people.length + ' Personen zeigen', people.length, 'people') : {}) });
        groups.push({ label: 'Befehle', items: actions.slice(0, 3) });
      }
      if (scope === 'pages') groups.push({ label: pages.length + (pages.length === 1 ? ' Seite' : ' Seiten'), items: pages.slice(0, 50).map(pageItem) });
      if (scope === 'spaces') groups.push({ label: 'Spaces', items: spaces });
      if (scope === 'people') groups.push({ label: 'Personen', items: people });
    }
    const visible = groups.filter((g) => g.items.length);
    const flat = visible.flatMap((g) => g.items);
    const active = flat.length ? Math.min(pal.active, flat.length - 1) : -1;
    let n = 0;
    visible.forEach((g) => {
      g.items = g.items.map((it) => {
        const idx = n++;
        return {
          ...it,
          domId: 'nf-cmd-opt-' + idx,
          selected: idx === active ? 'true' : 'false',
          isPage: it.kind === 'page', isSpace: it.kind === 'space', isPerson: it.kind === 'person', isAction: it.kind === 'action',
          restricted: !!it.restricted, iconStyle: it.iconStyle || '',
          hover: () => { if (this.state.palette && this.state.palette.active !== idx) this.setPalette({ active: idx }); }
        };
      });
    });
    this._paletteFlat = flat;

    const SCOPES = [['all', 'Alles'], ['pages', 'Seiten'], ['spaces', 'Spaces'], ['people', 'Personen']];
    const counts = { all: '', pages: words.length ? pages.length : '', spaces: words.length ? spaces.length : '', people: words.length ? people.length : '' };
    const scroll = (i) => setTimeout(() => { const el = document.getElementById('nf-cmd-opt-' + i); if (el) el.scrollIntoView({ block: 'nearest' }); }, 20);
    return {
      open: true,
      q: raw,
      placeholder: 'Seiten, Spaces und Personen suchen',
      activeId: active >= 0 ? 'nf-cmd-opt-' + active : '',
      scopes: SCOPES.map(([key, label]) => ({
        label, count: counts[key] === '' ? '' : counts[key],
        selected: scope === key ? 'true' : 'false',
        choose: () => { this.setPalette({ scope: key, active: 0 }); this.focusLater('#nf-cmd-q'); }
      })),
      canLimit: inSpace,
      limitPressed: pal.limit ? 'true' : 'false',
      limitPressedBool: !!pal.limit,
      limitName: sp.name,
      limitBadge: sp.key.slice(0, 2),
      limitColor: sp.color || '#1F5FD6',
      toggleLimit: () => { this.setPalette({ limit: !pal.limit, active: 0 }); this.focusLater('#nf-cmd-q'); },
      groups: visible,
      empty: !!q && flat.length === 0,
      emptyWhere: pal.limit ? ' in ' + sp.name : '',
      // Ohne Treffer: Seite mit dem Suchbegriff als Titel anlegen (im aktuellen Space, mit Bearbeitungsrecht)
      canCreate: inSpace && !sp.archived && this.canEdit(sp.home),
      createFromQuery: () => { this.closePalette(false); this.createPage(sp.home, raw.trim()); },
      onInput: (e) => this.setPalette({ q: e.target.value, active: 0 }),
      onKey: (e) => {
        const k = e.key;
        if (k === 'ArrowDown' || k === 'ArrowUp') {
          this.prevent(e);
          if (!flat.length) return;
          const next = (active + (k === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length;
          this.setPalette({ active: next });
          scroll(next);
        } else if (k === 'Enter') {
          this.prevent(e);
          if (active >= 0) flat[active].run();
        } else if (k === 'Tab') {
          this.prevent(e);
          const i = SCOPES.findIndex(([key]) => key === scope);
          const next = SCOPES[(i + (e.shiftKey ? -1 : 1) + SCOPES.length) % SCOPES.length][0];
          this.setPalette({ scope: next, active: 0 });
        } else if (k === 'Escape') {
          this.prevent(e);
          this.stop(e);
          this.closePalette();
        }
      },
      backdrop: (e) => { if (e.target === e.currentTarget) this.closePalette(); }
    };
  }

