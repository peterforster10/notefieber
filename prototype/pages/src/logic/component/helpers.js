  // ---------- Hilfen ----------
  chain(id) { const out = []; let x = id; while (x) { out.unshift(x); x = this.state.pages[x].parent; } return out; }
  /** Nächste Seite mit eigenen Rechten (die Seite selbst eingeschlossen), sonst der Space */
  source(id, includeSelf = true) {
    const ch = this.chain(id);
    if (!includeSelf) ch.pop();
    const own = ch.reverse().find((x) => this.state.grants[x]);
    return own || 'space:' + this.state.pages[id].space;
  }
  role(id) {
    const s = this.state; const p = s.pages[id];
    let best = null;
    for (const g of s.grants[this.source(id)] || []) {
      if (g.role !== 'none' && (g.key === 'peter' || g.key === 'ws') && (!best || RANK[g.role] > RANK[best])) best = g.role;
    }
    if (best && s.spaces[p.space].archived) best = 'viewer';
    return best;
  }
  canEdit(id) { const r = this.role(id); return r === 'editor' || r === 'admin'; }
  /** Wirksame Rolle einer Person aus einer Liste von Grants (wie app.page_rank: Person, Gruppen,
      „Alle im Workspace“ ohne Gäste; nur Mitglieder des Workspaces; archiviert höchstens Lesen) */
  effRole(list, who, archived) {
    const m = this.state.members.find((x) => x.key === who);
    if (!m) return null;
    let best = null;
    for (const g of list || []) {
      if (g.role === 'none') continue;
      const grp = this.state.groups[g.key];
      const hit = g.key === who || (g.key === 'ws' && m.role !== 'guest') || (!!grp && grp.members.includes(who));
      if (hit && (!best || RANK[g.role] > RANK[best])) best = g.role;
    }
    if (best && archived) best = 'viewer';
    return best;
  }
  /** Wirksame Rolle einer beliebigen Person auf einer Seite (für „Ansehen als …“) */
  roleFor(id, who) {
    const s = this.state;
    return this.effRole(s.grants[this.source(id)], who, s.spaces[s.pages[id].space].archived);
  }
  /** Name und Farbe eines Subjekts in Grants: Person, Gruppe (aus dem Zustand) oder „Alle im Workspace“ */
  subject(key) {
    const g = this.state.groups[key];
    if (g) return { name: g.name, bg: g.color, group: true };
    return SUBJECTS[key] || { name: 'Gelöschte Gruppe', bg: '#5B6573', group: true };
  }
  set(patch) { this.setState(patch); }
  stop(e) { if (e && e.stopPropagation) e.stopPropagation(); }
  prevent(e) { if (e && e.preventDefault) e.preventDefault(); }
  focusLater(sel) { setTimeout(() => { const el = document.querySelector(sel); if (el) el.focus(); }, 30); }

  go(id) {
    // Persönliche Einstellung: Kommentarspalte bei offenen Kommentaren von selbst öffnen (nur breite Fenster)
    const auto = (st) => st.prefs.commentsAuto && typeof innerWidth !== 'undefined' && innerWidth >= 1280 && (st.threads[id] || []).some((t) => !t.resolved);
    this.setState((st) => ({ current: id, space: st.pages[id].space, view: 'page', menu: null, spaceMenu: false, drawer: false, versions: null, reactPicker: false, lookPop: null, ...(auto(st) ? { commentsOpen: true } : {}) }));
  }

