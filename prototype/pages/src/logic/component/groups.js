  // ---------- Gruppen pflegen (M3: E02, E09; nur Organisations-Admins) ----------
  // Gruppen gelten für den ganzen Mandanten (groups, group_members). local und import pflegen
  // Organisations-Admins (app.create_group, rename_group, delete_group, add_group_member,
  // remove_group_member), idp und scim nur ihre Quelle. Bliebe ein Space oder eine Seite mit eigenen
  // Rechten ohne wirksamen Admin, lehnt die Datenbank ab (app.has_admin); der Dialog sagt es vorher.
  openGroups(key) {
    this.setState({ dialog: 'groups', gmSel: key || null, gmQ: '', gmNew: null, gmName: null, gmAddQ: '', gmAddOpen: false, gmAddActive: 0, gmError: null, userMenu: false, settingsMenu: false });
    this.focusLater(key ? '#gm-back' : '#gm-q');
  }

  /** Quellen (Space „space:KEY“ oder Seite mit eigenen Rechten) ohne wirksamen Admin: Grant für eine
      Person im Workspace oder eine Gruppe mit mindestens einem solchen Mitglied (wie app.has_admin) */
  sourcesWithoutAdmin(groups, grants) {
    const inWs = (k) => this.state.members.some((m) => m.key === k);
    return Object.keys(grants).filter((src) => !(grants[src] || []).some((g) => g.role === 'admin'
      && (inWs(g.key) || (!!groups[g.key] && groups[g.key].members.some(inWs)))));
  }
  /** Quellen, die durch die Änderung ihren letzten Admin verlören (vorher hatten sie einen) */
  adminLoss(groups, grants) {
    const before = new Set(this.sourcesWithoutAdmin(this.state.groups, this.state.grants));
    return this.sourcesWithoutAdmin(groups, grants).filter((src) => !before.has(src));
  }
  /** Wo eine Gruppe Rechte hat; Seiten nur mit Titel, wenn du sie sehen kannst */
  groupUses(key) {
    const s = this.state;
    const uses = [];
    let hidden = 0;
    Object.entries(s.grants).forEach(([src, list]) => {
      const g = list.find((x) => x.key === key);
      if (!g) return;
      if (src.startsWith('space:')) {
        const sp = s.spaces[src.slice(6)];
        uses.push({ src, kind: 'space', label: 'Space „' + sp.name + '“', meta: sp.archived ? 'archiviert' : 'Space · ' + sp.key, role: g.role });
      } else if (s.pages[src] && this.role(src)) {
        const p = s.pages[src];
        uses.push({ src, kind: 'page', label: 'Seite „' + (p.title || 'Ohne Titel') + '“', meta: 'eigene Rechte · ' + s.spaces[p.space].name, role: g.role });
      } else hidden++;
    });
    return { uses, hidden };
  }
  /** „1 Space und 2 Seiten“ */
  usesCount(uses, hidden) {
    const sp = uses.filter((u) => u.kind === 'space').length;
    const pg = uses.length - sp + hidden;
    const parts = [];
    if (sp) parts.push(sp + (sp === 1 ? ' Space' : ' Spaces'));
    if (pg) parts.push(pg + (pg === 1 ? ' Seite' : ' Seiten'));
    return parts.join(' und ');
  }
  /** Kürzel einer Gruppe: zwei Wörter → Anfangsbuchstaben, ein Wort → die ersten zwei Buchstaben */
  groupInitials(name) {
    const w = name.split(/[\s_-]+/).filter(Boolean);
    return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase();
  }
  sourceLabel(src) {
    const s = this.state;
    if (src.startsWith('space:')) return 'Space „' + s.spaces[src.slice(6)].name + '“';
    return this.role(src) ? 'Seite „' + (s.pages[src].title || 'Ohne Titel') + '“' : 'eine Seite mit eigenen Rechten, die du nicht siehst';
  }
  openRightsOf(src) {
    if (src.startsWith('space:')) { this.openRights(src.slice(6)); return; }
    this.go(src);
    setTimeout(() => this.openRights(), 0);
  }

  groupDeleteConfirm() {
    const s = this.state;
    const key = s.confirm.key;
    const grp = s.groups[key];
    const { uses, hidden } = this.groupUses(key);
    const n = uses.length + hidden;
    return {
      title: 'Gruppe „' + grp.name + '“ löschen?',
      text: (n === 0 ? 'Die Gruppe hat keine Rechte. ' : 'Ihre Rechte in ' + this.usesCount(uses, hidden) + ' entfallen; wer nur über die Gruppe Zugriff hatte, verliert ihn sofort. ')
        + 'Die ' + grp.members.length + (grp.members.length === 1 ? ' Person bleibt' : ' Personen bleiben') + ' im Workspace. Löschen lässt sich nicht rückgängig machen.',
      label: 'Gruppe löschen', cls: 'nf-btn-danger',
      ok: () => {
        this.setState((st) => {
          const groups = { ...st.groups };
          delete groups[key];
          const grants = {};
          Object.entries(st.grants).forEach(([src, list]) => { grants[src] = list.filter((g) => g.key !== key); });
          return { groups, grants, dialog: 'groups', confirm: null, gmSel: null, gmError: null };
        });
        this.showToast('Gruppe „' + grp.name + '“ gelöscht');
        this.focusLater('#gm-q');
      }
    };
  }

  groupsVals() {
    const s = this.state;
    if (s.dialog !== 'groups') return { groupsOpen: false, gm: {}, groupCount: Object.keys(s.groups).length };
    const set = (patch) => this.setState(patch);
    const fmtCount = (n) => n + (n === 1 ? ' Mitglied' : ' Mitglieder');
    const sel = s.gmSel && s.groups[s.gmSel] ? s.gmSel : null;
    const nameTaken = (name, except) => Object.entries(s.groups).some(([k, g]) => k !== except && fold(g.name) === fold(name));

    // Liste
    const words = fold(s.gmQ.trim()).split(/\s+/).filter(Boolean);
    const items = Object.entries(s.groups)
      .sort((a, b) => a[1].name.localeCompare(b[1].name, 'de'))
      .filter(([, g]) => words.every((w) => fold(g.name + ' ' + GROUP_SOURCE[g.source] + ' ' + g.members.map((m) => PEOPLE[m].name).join(' ')).includes(w)))
      .map(([key, g]) => {
        const { uses, hidden } = this.groupUses(key);
        const n = uses.length + hidden;
        return {
          key, name: g.name, bg: g.color, initials: this.groupInitials(g.name),
          sub: fmtCount(g.members.length) + ' · ' + (n === 0 ? 'keine Rechte' : 'Rechte in ' + this.usesCount(uses, hidden)),
          source: g.source, sourceLabel: GROUP_SOURCE[g.source],
          open: () => this.openGroups(key)
        };
      });
    const createNew = (e) => {
      this.prevent(e);
      const name = (s.gmNew || '').trim();
      if (!name) { set({ gmError: 'Bitte einen Namen eingeben.' }); return; }
      if (nameTaken(name)) { set({ gmError: 'Eine Gruppe „' + name + '“ gibt es schon.' }); return; }
      const key = 'g' + Date.now();
      this.setState((st) => ({ groups: { ...st.groups, [key]: { name, source: 'local', color: SPACE_COLORS[Object.keys(st.groups).length % SPACE_COLORS.length].color, members: [], by: 'peter', when: 'gerade eben' } } }));
      this.openGroups(key);
      this.focusLater('#gm-add');
      this.showToast('Gruppe „' + name + '“ angelegt');
    };
    const list = {
      q: s.gmQ,
      onQ: (e) => set({ gmQ: e.target.value }),
      items,
      hasItems: items.length > 0,
      noItems: items.length === 0,
      noItemsText: words.length ? 'Keine Gruppe passt zu „' + s.gmQ.trim() + '“.' : 'Noch keine Gruppen.',
      count: Object.keys(s.groups).length,
      newOpen: s.gmNew !== null,
      newClosed: s.gmNew === null,
      newName: s.gmNew || '',
      onNewName: (e) => set({ gmNew: e.target.value, gmError: null }),
      startNew: () => { set({ gmNew: '', gmError: null }); this.focusLater('#gm-new'); },
      cancelNew: () => { set({ gmNew: null, gmError: null }); this.focusLater('#gm-new-btn'); },
      createNew
    };

    // Eine Gruppe
    let one = {};
    if (sel) {
      const g = s.groups[sel];
      const editable = g.source === 'local' || g.source === 'import';
      const draftName = s.gmName === null ? g.name : s.gmName;
      const { uses, hidden } = this.groupUses(sel);
      // Letzter Admin: was bliebe ohne Admin, wenn sich die Gruppe so ändert
      const lossText = (lost, what) => {
        const names = lost.map((src) => this.sourceLabel(src));
        return what + ' geht nicht: Sonst hätte ' + names.join(', ') + ' keinen Admin mehr. Gib dort zuerst einer anderen Person oder Gruppe Admin.';
      };
      const withMembers = (members) => ({ ...s.groups, [sel]: { ...g, members } });
      const candidates = s.members
        .filter((m) => !g.members.includes(m.key))
        .map((m) => ({ key: m.key, name: PEOPLE[m.key].name, sub: m.email + (m.role === 'guest' ? ' · Gast' : ''), bg: PEOPLE[m.key].color, hay: PEOPLE[m.key].name + ' ' + m.email }))
        .filter((c) => fold(s.gmAddQ.trim()).split(/\s+/).filter(Boolean).every((w) => fold(c.hay).includes(w)));
      const active = Math.min(s.gmAddActive || 0, Math.max(0, candidates.length - 1));
      const addMember = (key) => {
        this.setState((st) => ({ groups: { ...st.groups, [sel]: { ...st.groups[sel], members: [...st.groups[sel].members, key] } }, gmAddQ: '', gmAddActive: 0, gmAddOpen: false, gmError: null }));
        this.showToast(PEOPLE[key].name + ' zu „' + g.name + '“ hinzugefügt');
      };
      const suggestOpen = editable && s.gmAddOpen;
      const SOURCE_TEXT = {
        local: 'Im Wiki angelegt von ' + (g.by ? PEOPLE[g.by].name : '–') + ' ' + g.when + '.',
        import: 'Aus dem Confluence-Import ' + g.when + ' (Confluence-Gruppe „' + g.externalId + '“). Name und Mitglieder lassen sich hier pflegen; ein neuer Import gleicht sie nicht ab.',
        idp: 'Aus dem Login-Dienst (Gruppe „' + g.externalId + '“ im Token), abgeglichen ' + g.when + '. Name und Mitglieder ändern sich nur dort.',
        scim: 'Per SCIM aus dem Verzeichnis der Organisation. Name und Mitglieder ändern sich nur dort.'
      };
      one = {
        key: sel,
        name: g.name,
        bg: g.color,
        initials: this.groupInitials(g.name),
        source: g.source,
        sourceLabel: GROUP_SOURCE[g.source],
        sourceText: SOURCE_TEXT[g.source],
        editable,
        readonly: !editable,
        back: () => { set({ gmSel: null, gmName: null, gmError: null, gmAddQ: '', gmAddOpen: false }); this.focusLater('#gm-q'); },
        draftName,
        nameUnchanged: draftName.trim() === g.name,
        onName: (e) => set({ gmName: e.target.value, gmError: null }),
        saveName: (e) => {
          this.prevent(e);
          const v = draftName.trim();
          if (!v) { set({ gmError: 'Der Name darf nicht leer sein.' }); return; }
          if (v === g.name) return;
          if (nameTaken(v, sel)) { set({ gmError: 'Eine Gruppe „' + v + '“ gibt es schon.' }); return; }
          this.setState((st) => ({ groups: { ...st.groups, [sel]: { ...st.groups[sel], name: v } }, gmName: null, gmError: null }));
          this.showToast('Umbenannt in „' + v + '“');
        },
        memberCount: g.members.length,
        membersTitle: 'Mitglieder (' + g.members.length + ')',
        hasMembers: g.members.length > 0,
        noMembers: g.members.length === 0,
        members: g.members.map((k) => {
          const m = s.members.find((x) => x.key === k);
          return {
            name: PEOPLE[k].name + (k === 'peter' ? ' (du)' : ''),
            email: m ? m.email + (m.role === 'guest' ? ' · Gast' : '') : 'nicht im Workspace',
            color: PEOPLE[k].color, initials: initials(PEOPLE[k].name),
            removeLabel: PEOPLE[k].name + ' aus „' + g.name + '“ entfernen',
            remove: () => {
              const lost = this.adminLoss(withMembers(g.members.filter((x) => x !== k)), s.grants);
              if (lost.length) { set({ gmError: { text: lossText(lost, PEOPLE[k].name + ' zu entfernen'), src: lost[0] } }); return; }
              this.setState((st) => ({ groups: { ...st.groups, [sel]: { ...st.groups[sel], members: st.groups[sel].members.filter((x) => x !== k) } }, gmError: null }));
              this.showToast(PEOPLE[k].name + ' aus „' + g.name + '“ entfernt');
              this.focusLater('#gm-add');
            }
          };
        }),
        // Hinzufügen: Personen aus dem Workspace (Gäste markiert), ↑↓ und Enter wie im Rechte-Dialog
        addQ: s.gmAddQ,
        onAddQ: (e) => set({ gmAddQ: e.target.value, gmAddOpen: true, gmAddActive: 0 }),
        onAddFocus: () => set({ gmAddOpen: true }),
        onAddBlur: () => setTimeout(() => { if (this.state.dialog === 'groups') set({ gmAddOpen: false }); }, 120),
        keep: (e) => this.prevent(e),
        onAddKey: (e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            this.prevent(e);
            if (candidates.length) set({ gmAddOpen: true, gmAddActive: (active + (e.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length });
          } else if (e.key === 'Enter') {
            this.prevent(e);
            if (candidates.length) addMember(candidates[active].key);
          } else if (e.key === 'Escape' && suggestOpen) {
            this.prevent(e);
            this.stop(e);
            set({ gmAddOpen: false });
          }
        },
        suggestOpen,
        suggestExpanded: suggestOpen ? 'true' : 'false',
        activeId: suggestOpen && candidates.length ? 'gm-opt-' + active : '',
        suggestions: candidates.map((c, i) => ({
          ...c, initials: initials(c.name), domId: 'gm-opt-' + i, selected: i === active ? 'true' : 'false',
          add: () => addMember(c.key)
        })),
        noSuggest: suggestOpen && candidates.length === 0,
        noSuggestText: s.gmAddQ.trim() ? 'Niemand mit „' + s.gmAddQ.trim() + '“ im Workspace, oder schon in der Gruppe' : 'Alle im Workspace sind schon in der Gruppe',
        // Wo die Gruppe Rechte hat; Klick öffnet den Rechte-Dialog dort
        uses: uses.map((u) => ({ ...u, roleLabel: ROLE_LABEL[u.role], open: () => this.openRightsOf(u.src) })),
        hasUses: uses.length > 0,
        noUses: uses.length === 0 && hidden === 0,
        hasHidden: hidden > 0,
        hiddenText: (hidden === 1 ? 'Dazu eine Seite' : 'Dazu ' + hidden + ' Seiten') + ' mit eigenen Rechten, die du nicht siehst.',
        askDelete: () => {
          const grants = {};
          Object.entries(s.grants).forEach(([src, l]) => { grants[src] = l.filter((x) => x.key !== sel); });
          const lost = this.adminLoss(s.groups, grants);
          if (lost.length) { set({ gmError: { text: lossText(lost, 'Löschen'), src: lost[0] } }); return; }
          this.setState({ dialog: 'confirm', confirm: { kind: 'deleteGroup', key: sel, back: 'groups' }, gmError: null });
          this.focusLater('#nf-confirm-cancel');
        }
      };
    }
    const err = s.gmError;
    return {
      groupsOpen: true,
      groupCount: Object.keys(s.groups).length,
      gm: {
        isList: !sel,
        isOne: !!sel,
        list,
        one,
        hasError: !!err,
        errorText: err ? (typeof err === 'string' ? err : err.text) : '',
        hasErrorLink: !!err && typeof err === 'object' && !!err.src && (err.src.startsWith('space:') || !!this.role(err.src)),
        errorLink: () => { if (err && err.src) this.openRightsOf(err.src); }
      }
    };
  }
