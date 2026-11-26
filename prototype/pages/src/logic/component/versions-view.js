  versionVals(pid, editable, archived) {
    const s = this.state, V = s.versions;
    const list = this.versionList(pid);
    const byN = {};
    list.forEach((v) => { byN[v.n] = v; });
    const last = list[list.length - 1];
    const sel = byN[V.sel] || last;
    const cmpN = typeof V.cmp === 'number' && V.cmp < sel.n ? V.cmp : sel.n - 1;
    const base = byN[cmpN];
    const diffOn = V.changes && !!base;
    const blocks = diffOn ? vBlockDiff(base.blocks, sel.blocks) : vPlain(sel.blocks);
    const titleSegs = diffOn ? vWordDiff(base.title || 'Ohne Titel', sel.title || 'Ohne Titel') : [{ k: '=', text: sel.title || 'Ohne Titel' }];
    const st = vStats(blocks, titleSegs);
    const who = (k) => (k === 'peter' ? 'dir' : PEOPLE[k].name);
    const kindText = (v) => v.kind === 'manual' ? 'Gesichert von ' + who(v.by)
      : v.kind === 'restore' ? 'Wiederhergestellt aus Version ' + v.from + ' von ' + who(v.by)
      : v.kind === 'import' ? 'Aus Confluence importiert' : '';
    const people = (v) => v.authors.map((k) => PEOPLE[k].name).join(', ');
    const groups = [];
    list.slice().reverse().forEach((v) => {
      const label = vDayLabel(vDay(v.at));
      let g = groups[groups.length - 1];
      if (!g || g.label !== label) { g = { label, items: [] }; groups.push(g); }
      const prev = byN[v.n - 1];
      const ds = prev ? vStats(vBlockDiff(prev.blocks, v.blocks), vWordDiff(prev.title, v.title)) : null;
      g.items.push({
        label: 'Version ' + v.n,
        isCurrent: v === last,
        current: v === sel ? 'true' : 'false',
        aria: 'Version ' + v.n + (v.name ? ' „' + v.name + '“' : '') + ', ' + vLong(v.at) + ', ' + people(v) + (ds ? ', ' + ds.plus + ' Wörter hinzugefügt, ' + ds.minus + ' entfernt' : ''),
        time: vTime(v.at),
        hasName: !!v.name, name: v.name || '',
        hasKind: !!kindText(v), kind: kindText(v),
        avatars: v.authors.slice(0, 3).map((k) => ({ color: PEOPLE[k].color, initials: initials(PEOPLE[k].name) })),
        names: people(v),
        hasDelta: !!ds && ds.plus + ds.minus > 0,
        plus: ds ? ds.plus : 0, minus: ds ? ds.minus : 0,
        hasPlus: !!ds && ds.plus > 0, hasMinus: !!ds && ds.minus > 0,
        select: () => this.setState((x) => ({ versions: { ...x.versions, sel: v.n, cmp: 'prev' } }))
      });
    });
    const isLast = sel === last;
    const canRestore = editable && !isLast;
    return {
      count: list.length,
      groups,
      sel: { label: 'Version ' + sel.n + (sel.name ? ' · „' + sel.name + '“' : ''), isCurrent: isLast, dateLong: vLong(sel.at), people: people(sel), hasNote: !!kindText(sel), note: kindText(sel) },
      titleSegs: vTplSegs(titleSegs),
      blocks: blocks.map(vTpl),
      empty: blocks.length === 0,
      changes: diffOn,
      noCompare: !base,
      hasCompare: !!base,
      cmp: cmpN === sel.n - 1 ? 'prev' : String(cmpN),
      cmpDisabled: !V.changes,
      cmpOptions: list.filter((v) => v.n < sel.n).reverse().map((v) => ({
        value: v.n === sel.n - 1 ? 'prev' : String(v.n),
        label: (v.n === sel.n - 1 ? 'vorheriger Version ' : 'Version ') + v.n + ' · ' + vShort(v.at) + (v.name ? ' · ' + v.name : '')
      })),
      onCmp: (e) => { const val = e.target.value; this.setState((x) => ({ versions: { ...x.versions, cmp: val === 'prev' ? 'prev' : Number(val) } })); },
      toggleChanges: () => this.setState((x) => ({ versions: { ...x.versions, changes: !x.versions.changes } })),
      showStats: diffOn && st.plus + st.minus > 0,
      noChange: diffOn && st.plus + st.minus === 0 && blocks.every((b) => !b.cls),
      plus: st.plus, minus: st.minus, hasPlus: st.plus > 0, hasMinus: st.minus > 0,
      statsLabel: st.plus + ' Wörter hinzugefügt, ' + st.minus + ' entfernt',
      canRestore,
      restoreHint: !editable && !isLast,
      restoreHintText: archived ? 'Archiviert: nur lesbar' : 'Wiederherstellen dürfen nur Bearbeitende',
      restore: () => { this.setState({ dialog: 'confirm', confirm: { kind: 'restoreVersion', pid, n: sel.n } }); this.focusLater('#nf-confirm-cancel'); },
      canSave: editable,
      openSave: () => { this.setState({ dialog: 'saveVersion', vName: '' }); this.focusLater('#nf-vname'); },
      close: () => this.setState({ versions: null })
    };
  }

