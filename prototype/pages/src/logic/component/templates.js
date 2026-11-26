  // ---------- Vorlagen (Ausblick) ----------
  /** Vorlagen, die die Person sehen darf: für alle Spaces oder für einen lesbaren Space */
  templatesFor(spaceKey) {
    const s = this.state;
    return s.templates.filter((t) => !t.scope || (s.spaces[t.scope] && this.role(s.spaces[t.scope].home) && (!spaceKey || t.scope === spaceKey)));
  }
  openTemplates(target) {
    this.edSave();
    this.setState({ view: 'templates', tplTarget: target || null, tplQ: '', tplFilter: 'all', drawer: false, menu: null, pageMenu: false, palette: null });
    setTimeout(() => { try { window.scrollTo(0, 0); } catch (err) { /* egal */ } }, 0);
  }
  openTemplate(id) {
    const s = this.state;
    const t = s.templates.find((x) => x.id === id);
    const usable = Object.values(s.spaces).filter((x) => !x.archived && this.canEdit(x.home) && (!t.scope || x.key === t.scope));
    const space = usable.find((x) => x.key === (t.scope || s.space)) || usable[0];
    this.setState({ dialog: 'tplUse', tplUse: { id, space: space ? space.key : '', parent: space ? space.home : '', title: tplTitle(t.title) } });
  }
  /** Vorlage in den bearbeitbaren Bereich einer (leeren) Seite setzen */
  applyTemplate(pid, id) {
    const t = this.state.templates.find((x) => x.id === id);
    this._drafts[pid] = t.html;
    const el = this.edEl();
    if (el && this._edPid === pid) el.innerHTML = t.html;
    this.setState((st) => ({
      pages: st.pages[pid].title ? st.pages : { ...st.pages, [pid]: { ...st.pages[pid], title: tplTitle(t.title) } },
      pageIcons: st.pageIcons[pid] ? st.pageIcons : { ...st.pageIcons, [pid]: t.icon },
      templates: st.templates.map((x) => (x.id === id ? { ...x, uses: x.uses + 1 } : x)),
      // Aus der Galerie (Zielseite) zurück zur Seite
      view: 'page', current: pid, space: st.pages[pid].space,
      dialog: null, tplTarget: null
    }));
    this.markSaving();
    this.showToast('Vorlage „' + t.name + '“ eingefügt');
    // Titel wie „Anleitung: “ gleich weiterschreiben: Cursor ans Ende des Titels
    if (!this.state.pages[pid].title && t.title) setTimeout(() => { const i = document.getElementById('nf-title'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 60);
  }
  createFromTemplate(parent, title, id) {
    const s = this.state;
    const t = s.templates.find((x) => x.id === id);
    const pid = 'neu' + s.seq;
    this._drafts[pid] = t.html;
    this.setState((st) => {
      const pages = { ...st.pages };
      pages[pid] = { space: st.pages[parent].space, title: title.trim(), parent, kids: [], author: 'peter', editor: 'peter', when: 'gerade eben', text: [] };
      pages[parent] = { ...pages[parent], kids: [...pages[parent].kids, pid] };
      return {
        pages, seq: st.seq + 1, current: pid, space: pages[pid].space, view: 'page', versions: null,
        expanded: { ...st.expanded, [parent]: true },
        pageIcons: { ...st.pageIcons, [pid]: t.icon },
        templates: st.templates.map((x) => (x.id === id ? { ...x, uses: x.uses + 1 } : x)),
        dialog: null, tplUse: null, tplTarget: null, drawer: false
      };
    });
    this.showToast('Seite aus der Vorlage „' + t.name + '“ angelegt');
    this.focusLater(title.trim() ? '#nf-editable' : '#nf-title');
  }
  /** Inhalt einer Seite als HTML für eine neue Vorlage: fester Inhalt der Vorlage plus Bearbeitetes */
  pageHtml(pid) {
    const s = this.state, p = s.pages[pid];
    const blocks = s.restoredBody[pid] || (p.body === 'dm' ? DM_VERSIONS[DM_VERSIONS.length - 1].blocks : p.body === 'home' ? HOME_BLOCKS : p.text.map((x) => vB.p(x)));
    this.edSave();
    const draft = this._drafts[pid] || '';
    const d = document.createElement('div');
    d.innerHTML = draft;
    return tplHtml(blocks) + (d.textContent.trim() ? draft : '');
  }
  saveAsTemplate() {
    const s = this.state, d = s.tplSaveDraft;
    const id = 'eigen' + s.seq;
    const t = { id, name: d.name.trim(), icon: s.pageIcons[d.pid] || '📄', scope: d.scope || null, uses: 0, fresh: true, by: 'peter', title: '', desc: d.desc.trim() || 'Aus „' + (s.pages[d.pid].title || 'Ohne Titel') + '“', html: this.pageHtml(d.pid) };
    this.setState((st) => ({ templates: [t, ...st.templates], seq: st.seq + 1, dialog: null, tplSaveDraft: null }));
    this.showToast('Vorlage „' + t.name + '“ gespeichert');
  }
  /** Vorschauen füllen (HTML der Vorlage, außerhalb von React wie der bearbeitbare Bereich) */
  tplPreviewSync() {
    setTimeout(() => {
      document.querySelectorAll('[data-tpl-preview]').forEach((el) => {
        const t = this.state.templates.find((x) => x.id === el.dataset.tplPreview);
        if (t && el.dataset.tplShown !== t.id) { el.innerHTML = t.html; el.dataset.tplShown = t.id; }
      });
    }, 0);
  }
  templatesVals() {
    const s = this.state, P = s.pages;
    this.tplPreviewSync();
    const shown = (t) => t || 'Ohne Titel';
    const all = this.templatesFor(null);
    const words = fold((s.tplQ || '').trim()).split(/\s+/).filter(Boolean);
    const match = (t) => words.every((w) => fold(t.name + ' ' + t.desc).includes(w));
    const inFilter = (t) => s.tplFilter === 'all' || (s.tplFilter === 'org' ? !t.scope : t.scope === s.tplFilter);
    const list = all.filter((t) => inFilter(t) && match(t)).sort((a, b) => (b.fresh ? 1 : 0) - (a.fresh ? 1 : 0) || b.uses - a.uses);
    const spaceKeys = [...new Set(all.filter((t) => t.scope).map((t) => t.scope))];
    const target = s.tplTarget && P[s.tplTarget] ? s.tplTarget : null;
    const filters = [['all', 'Alle'], ['org', 'Alle Spaces'], ...spaceKeys.map((k) => [k, s.spaces[k].name])].map(([key, label]) => ({
      label, count: all.filter((t) => key === 'all' || (key === 'org' ? !t.scope : t.scope === key)).length,
      selected: s.tplFilter === key ? 'true' : 'false',
      choose: () => this.setState({ tplFilter: key })
    }));
    return {
      lead: 'Vorlagen für neue Seiten: für alle Spaces oder nur für einen. ' + all.length + ' Vorlagen, die du nutzen darfst.',
      q: s.tplQ || '',
      onQ: (e) => this.setState({ tplQ: e.target.value }),
      filters,
      hasTarget: !!target,
      targetTitle: target ? shown(P[target].title) : '',
      cancelTarget: () => this.go(target),
      empty: list.length === 0,
      emptyText: words.length ? 'Keine Vorlage passt zu „' + s.tplQ.trim() + '“.' : 'In diesem Bereich gibt es noch keine Vorlagen.',
      cards: list.map((t) => ({
        id: t.id, name: t.name, icon: t.icon, desc: t.desc,
        scopeLabel: t.scope ? s.spaces[t.scope].name : 'Alle Spaces',
        scopeCls: t.scope ? '' : 'nf-chip-admin',
        meta: (t.uses === 0 ? 'Neu' : t.uses + '× verwendet') + ' · von ' + (t.by === 'peter' ? 'dir' : PEOPLE[t.by].name),
        previewLabel: 'Vorschau: ' + t.name,
        open: () => this.openTemplate(t.id),
        useLabel: target ? 'Einfügen' : 'Verwenden',
        use: () => (target ? this.applyTemplate(target, t.id) : this.openTemplate(t.id))
      }))
    };
  }
  tplDialogVals() {
    const s = this.state, P = s.pages;
    if (s.dialog !== 'tplUse' || !s.tplUse) return { open: false };
    this.tplPreviewSync();
    const u = s.tplUse;
    const t = s.templates.find((x) => x.id === u.id);
    const target = s.tplTarget && P[s.tplTarget] ? s.tplTarget : null;
    const shown = (x) => x || 'Ohne Titel';
    const usable = Object.values(s.spaces).filter((x) => !x.archived && this.canEdit(x.home) && (!t.scope || x.key === t.scope));
    const parents = [];
    if (u.space) {
      const home = s.spaces[u.space].home;
      const walk = (id, depth) => {
        if (s.trash.some((x) => x.id === id)) return;
        if (this.canEdit(id)) parents.push({ id, label: '   '.repeat(depth) + (id === home ? 'Startseite' : shown(P[id].title)) });
        P[id].kids.forEach((k) => walk(k, depth + 1));
      };
      walk(home, 0);
    }
    const set = (patch) => this.setState((st) => ({ tplUse: { ...st.tplUse, ...patch } }));
    return {
      open: true, id: t.id, name: t.name, icon: t.icon, desc: t.desc,
      scopeNote: t.scope ? 'Nur in „' + s.spaces[t.scope].name + '“' : 'Für alle Spaces',
      noTarget: !target,
      title: u.title,
      onTitle: (e) => set({ title: e.target.value }),
      space: u.space,
      spaces: usable.map((x) => ({ key: x.key, label: x.name })),
      spaceFixed: !!t.scope || usable.length < 2,
      onSpace: (e) => { const k = e.target.value; set({ space: k, parent: s.spaces[k].home }); },
      parent: u.parent,
      parents,
      onParent: (e) => set({ parent: e.target.value }),
      noSpace: !target && usable.length === 0,
      cantSubmit: !target && (!u.space || !u.parent),
      submitLabel: target ? 'In „' + shown(P[target].title) + '“ einfügen' : 'Seite anlegen',
      submit: (e) => {
        this.prevent(e);
        if (target) this.applyTemplate(target, t.id);
        else if (u.space && u.parent) this.createFromTemplate(u.parent, u.title, t.id);
      }
    };
  }
  tplSaveVals(pid, sp) {
    const s = this.state;
    const d = s.tplSaveDraft;
    const canSpace = this.role(sp.home) === 'admin' && !sp.archived;
    const canOrg = true; // Peter ist Organisations-Admin (seed.sql)
    return {
      open: s.dialog === 'tplSave' && !!d,
      name: d ? d.name : '', desc: d ? d.desc : '', scope: d ? d.scope : '',
      onName: (e) => { const v = e.target.value; this.setState((st) => ({ tplSaveDraft: { ...st.tplSaveDraft, name: v } })); },
      onDesc: (e) => { const v = e.target.value; this.setState((st) => ({ tplSaveDraft: { ...st.tplSaveDraft, desc: v } })); },
      onScope: (e) => { const v = e.target.value; this.setState((st) => ({ tplSaveDraft: { ...st.tplSaveDraft, scope: v } })); },
      scopes: [...(canSpace ? [{ value: sp.key, label: 'Nur in „' + sp.name + '“' }] : []), ...(canOrg ? [{ value: '', label: 'Alle Spaces' }] : [])],
      cantSave: !d || !d.name.trim(),
      open_: () => {
        this.setState({ dialog: 'tplSave', pageMenu: false, tplSaveDraft: { pid, name: s.pages[pid].title || '', desc: '', scope: canSpace ? sp.key : '' } });
        this.focusLater('#tpl-save-name');
      },
      submit: (e) => { this.prevent(e); if (d && d.name.trim()) this.saveAsTemplate(); }
    };
  }
