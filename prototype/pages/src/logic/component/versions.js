  // ---------- Versionen (Prototyp) ----------
  versionList(pid) {
    const base = pid === 'dm' ? DM_VERSIONS : vGeneric(this.state.pages[pid]);
    return base.concat(this.state.vextra[pid] || []);
  }
  vNow() { this._vClock = (this._vClock || 41) + 1; return V_TODAY + 'T15:' + String(this._vClock).padStart(2, '0'); }
  openVersions(pid) {
    this.edSave();
    const l = this.versionList(pid);
    this.setState({ versions: { pid, sel: l[l.length - 1].n, cmp: 'prev', changes: true }, dialog: null, pageMenu: false, commentsOpen: false, activeThread: null, palette: false });
    setTimeout(() => { try { window.scrollTo(0, 0); } catch (err) { /* egal */ } }, 0);
  }
  currentBlocks(pid) {
    const l = this.versionList(pid);
    return vClone(this.state.restoredBody[pid] || l[l.length - 1].blocks);
  }
  saveVersion(pid, name) {
    const l = this.versionList(pid);
    const nv = { n: l[l.length - 1].n + 1, kind: 'manual', by: 'peter', name: name.trim() || null, authors: ['peter'], at: this.vNow(), title: this.state.pages[pid].title, blocks: this.currentBlocks(pid) };
    this.setState((st) => ({
      vextra: { ...st.vextra, [pid]: [...(st.vextra[pid] || []), nv] },
      versions: st.versions ? { ...st.versions, sel: nv.n, cmp: 'prev', changes: true } : st.versions,
      dialog: null, vName: ''
    }));
    this.showToast('Als Version ' + nv.n + ' gesichert');
  }
  restoreVersion(pid, n) {
    const l = this.versionList(pid);
    const src = l.find((v) => v.n === n);
    const nv = { n: l[l.length - 1].n + 1, kind: 'restore', from: n, by: 'peter', authors: ['peter'], at: this.vNow(), title: src.title, blocks: vClone(src.blocks) };
    this.setState((st) => ({
      vextra: { ...st.vextra, [pid]: [...(st.vextra[pid] || []), nv] },
      restoredBody: { ...st.restoredBody, [pid]: vClone(src.blocks) },
      pages: { ...st.pages, [pid]: { ...st.pages[pid], title: src.title, editor: 'peter', when: 'gerade eben' } },
      versions: st.versions ? { ...st.versions, sel: nv.n, cmp: 'prev', changes: true } : st.versions,
      dialog: null, confirm: null
    }));
    this.markSaving();
    this.showToast('Version ' + n + ' wiederhergestellt, neu als Version ' + nv.n);
  }
