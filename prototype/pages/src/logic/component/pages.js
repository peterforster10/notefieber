  movePage(id, parent, index) {
    this.setState((st) => {
      const pages = { ...st.pages };
      const p = { ...pages[id] };
      const oldParent = { ...pages[p.parent], kids: pages[p.parent].kids.filter((k) => k !== id) };
      pages[p.parent] = oldParent;
      const np = { ...pages[parent] };
      const kids = np.kids.filter((k) => k !== id);
      kids.splice(Math.max(0, Math.min(index, kids.length)), 0, id);
      np.kids = kids;
      pages[parent] = np;
      p.parent = parent;
      pages[id] = p;
      return { pages, menu: null, expanded: { ...st.expanded, [parent]: true } };
    });
  }

  createPage(parent, title) {
    this.setState((st) => {
      const id = 'neu' + st.seq;
      const pages = { ...st.pages };
      pages[id] = { space: st.pages[parent].space, title: title || '', parent, kids: [], author: 'peter', editor: 'peter', when: 'gerade eben', text: [] };
      pages[parent] = { ...pages[parent], kids: [...pages[parent].kids, id] };
      return { pages, seq: st.seq + 1, current: id, view: 'page', expanded: { ...st.expanded, [parent]: true }, menu: null, drawer: false };
    });
    this.focusLater('#nf-title');
  }

  trashPage(id) {
    this.setState((st) => {
      const pages = { ...st.pages };
      const parent = pages[id].parent;
      const index = pages[parent].kids.indexOf(id);
      pages[parent] = { ...pages[parent], kids: pages[parent].kids.filter((k) => k !== id) };
      const sub = (x) => [x, ...st.pages[x].kids.flatMap(sub)];
      const inside = sub(id).includes(st.current);
      return { pages, trash: [...st.trash, { id, index, by: 'peter', when: 'gerade eben', daysLeft: 30 }], dialog: null, confirm: null, current: inside ? parent : st.current };
    });
  }

  restorePage(id) {
    this.setState((st) => {
      const entry = st.trash.find((t) => t.id === id);
      const pages = { ...st.pages };
      const parent = pages[id].parent;
      const kids = [...pages[parent].kids];
      kids.splice(Math.min(entry.index, kids.length), 0, id);
      pages[parent] = { ...pages[parent], kids };
      return { pages, trash: st.trash.filter((t) => t.id !== id) };
    });
  }

  /** Speicherstatus wie beim Collab-Server: sofort „Speichert …“, nach kurzer Ruhe „Gespeichert“ */
  markSaving() {
    this.setState({ save: 'saving' });
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.setState({ save: 'saved' }), 1200);
  }
  showToast(text) {
    this.setState({ toast: text });
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.setState({ toast: null }), 2200);
  }

  setTitle(id, title) {
    this.markSaving();
    this.setState((st) => ({ pages: { ...st.pages, [id]: { ...st.pages[id], title, editor: 'peter', when: 'gerade eben' } } }));
  }

  /** Rechte-Dialog. Auf der Startseite (oder mit spaceKey aus dem Menü eines Spaces) zeigt er die
      Rechte des Spaces: Die Startseite ist die Wurzel des Seitenbaums, eigene Rechte dort wären nur
      eine zweite Fassung der Space-Rechte. Aus einem anderen Space oder der Übersicht geht es
      vorher auf dessen Startseite, damit „Ansehen als …“ denselben Space zeigt. */
  openRights(spaceKey) {
    const s = this.state;
    const base = { query: '', addRole: 'viewer', addOpen: false, addActive: 0 };
    const key = spaceKey || s.space;
    const sp = s.spaces[key];
    if (spaceKey || s.current === sp.home) {
      const list = s.grants['space:' + key] || [];
      const nav = key !== s.space || s.view !== 'page' ? { space: key, current: sp.home, view: 'page', versions: null } : {};
      this.setState({ ...nav, spaceMenu: false, spaceSub: null, sideMenu: null, drawer: false, dialog: 'rights', rightsDraft: { ...base, scope: 'space', own: true, grants: list.map((g) => ({ ...g })) } });
      return;
    }
    const cur = s.current;
    const own = !!s.grants[cur];
    const list = s.grants[cur] || s.grants[this.source(cur, false)] || [];
    this.setState({ dialog: 'rights', rightsDraft: { ...base, scope: 'page', own, grants: list.map((g) => ({ ...g })) } });
  }
  /** Oberster Dialog zu; eine Rückfrage mit back führt in den Dialog zurück, aus dem sie kam */
  closeTopDialog() {
    this.setState((st) => (st.dialog === 'confirm' && st.confirm && st.confirm.back
      ? { dialog: st.confirm.back, confirm: null }
      : { dialog: null, confirm: null, rightsDraft: null }));
  }
  /** fromRights: 'space' bzw. 'page', wenn „Zurück zu den Rechten“ dorthin führen soll */
  openViewAs(fromRights) {
    this.setState((st) => ({ dialog: 'viewAs', viewAsBack: fromRights || false, viewAsWho: st.viewAsWho || 'max' }));
  }

  openSpaceSettings(key) {
    this.setState({ dialog: 'spaceSettings', settingsKey: key, settingsDraft: null, spaceMenu: false, spaceSub: null, sideMenu: null, drawer: false });
    this.focusLater('#st-name');
  }

