  // ---------- Werte für die Vorlage ----------
  renderVals() {
    const s = this.state;
    this.dialogSync();
    // Farbschema an <html>, damit auch body und alles außerhalb der Vorlage folgen
    // Systemwert bei jedem Rendern frisch lesen; der Listener im Konstruktor sorgt nur für das Neurendern
    const osDark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : s.osDark;
    const effectiveTheme = s.theme === 'system' ? (osDark ? 'dark' : 'light') : s.theme;
    if (document.documentElement.dataset.theme !== effectiveTheme) document.documentElement.dataset.theme = effectiveTheme;
    const P = s.pages;
    const sp = s.spaces[s.space];
    const homeId = sp.home;
    const isPage = s.view === 'page';
    const cur = isPage ? s.current : null;
    // Versionsansicht der aktuellen Seite (ersetzt Seite und Knöpfe im Kopfbereich)
    const vmode = isPage && !!s.versions && s.versions.pid === cur;
    // Erstes Öffnen eines Spaces: Platzhalter im Seitenbaum
    // Übersicht und Vorlagen: Navigation ohne Space (Liste aller Spaces statt Seitenbaum)
    const ovNav = s.view === 'overview' || s.view === 'templates';
    const treeLoading = !ovNav && !this._loadedSpaces.has(s.space);
    if (treeLoading) { const key = s.space; this.scheduleLoad('s:' + key, 450, () => this._loadedSpaces.add(key)); }
    const spaceEditable = !sp.archived && this.canEdit(homeId);
    const shown = (t) => t || 'Ohne Titel';

    // Seitenbaum: wie im Frontend ohne die Startseite selbst, er beginnt mit ihren Unterseiten
    const rows = [];
    const walk = (id, depth, siblings, index) => {
      const p = P[id];
      const open = !!s.expanded[id] && p.kids.length > 0;
      const editable = !sp.archived && this.canEdit(id);
      const prev = siblings[index - 1];
      const next = siblings[index + 1];
      const parentIsHome = p.parent === homeId;
      rows.push({
        title: shown(p.title),
        titleCls: p.title ? '' : 'nf-untitled',
        icon: s.pageIcons[id] || '', hasIcon: !!s.pageIcons[id], noIcon: !s.pageIcons[id],
        pad: depth * 16,
        cls: (cur === id ? 'nf-selected' : ''),
        current: cur === id ? 'page' : 'false',
        twisty: p.kids.length ? 'visible' : 'hidden',
        openAttr: open ? 'true' : 'false',
        toggleLabel: shown(p.title) + (open ? ' zuklappen' : ' aufklappen'),
        restricted: !!s.grants[id],
        editable,
        actionsCls: s.menu === id ? 'nf-open' : '',
        actionsLabel: 'Aktionen für ' + shown(p.title),
        menuOpen: s.menu === id,
        menuExpanded: s.menu === id ? 'true' : 'false',
        upDisabled: prev ? 'false' : 'true',
        downDisabled: next ? 'false' : 'true',
        outdentDisabled: parentIsHome ? 'true' : 'false',
        renaming: s.renaming === id,
        favLabel: (s.pageFavs[p.space] || []).includes(id) ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen',
        toggleFav: () => this.toggleFavPage(id),
        draft: s.draft,
        toggle: (e) => { this.stop(e); this.setState((st) => ({ expanded: { ...st.expanded, [id]: !st.expanded[id] } })); },
        go: (e) => { this.prevent(e); this.go(id); },
        create: (e) => { this.stop(e); this.createPage(id); },
        toggleMenu: (e) => { this.stop(e); this.setState((st) => ({ menu: st.menu === id ? null : id, spaceMenu: false, pageMenu: false, userMenu: false, settingsMenu: false })); },
        rename: () => this.setState({ renaming: id, draft: p.title, menu: null }),
        up: () => prev && this.movePage(id, p.parent, index - 1),
        down: () => next && this.movePage(id, p.parent, index + 1),
        indent: () => prev && this.movePage(id, prev, P[prev].kids.length),
        outdent: () => {
          if (parentIsHome) return;
          const gp = P[p.parent].parent;
          this.movePage(id, gp, P[gp].kids.indexOf(p.parent) + 1);
        },
        trash: () => { this.setState({ menu: null, dialog: 'confirm', confirm: { kind: 'trash', id } }); this.focusLater('#nf-confirm-cancel'); },
        onDraft: (e) => this.setState({ draft: e.target.value }),
        submitRename: (e) => {
          this.prevent(e);
          const v = s.draft.trim();
          if (v) this.setTitle(id, v);
          this.setState({ renaming: null });
        },
        cancelRename: () => this.setState({ renaming: null })
      });
      if (open) p.kids.forEach((k, i) => walk(k, depth + 1, p.kids, i));
    };
    P[homeId].kids.forEach((k, i) => walk(k, 0, P[homeId].kids, i));
    if (treeLoading) rows.length = 0;

    // Space-Umschalter (Organisations-Admins dürfen jeden Space verwalten)
    const spaceItems = this.favFirst(Object.values(s.spaces), (x) => x.key).map((x) => ({
      fav: s.favs.includes(x.key),
      favPressed: s.favs.includes(x.key) ? 'true' : 'false',
      favAria: s.favs.includes(x.key) ? '„' + x.name + '“ aus den Favoriten entfernen' : '„' + x.name + '“ als Favorit markieren',
      favLabel: s.favs.includes(x.key) ? 'Aus Favoriten entfernen' : 'Als Favorit markieren',
      toggleFav: (e) => { this.stop(e); this.toggleFav(x.key); },
      badge: x.key.slice(0, 2),
      color: x.color || '#1F5FD6',
      label: x.archived ? x.name + ' (archiviert)' : x.name,
      current: x.key === s.space ? 'true' : 'false',
      manage: true,
      actionsLabel: 'Aktionen für ' + x.name,
      subOpen: s.spaceSub === x.key,
      subExpanded: s.spaceSub === x.key ? 'true' : 'false',
      go: (e) => { this.prevent(e); this.setState({ space: x.key, current: x.home, view: 'page', spaceMenu: false, spaceSub: null, drawer: false }); },
      toggleSub: (e) => { this.stop(e); this.setState((st) => ({ spaceSub: st.spaceSub === x.key ? null : x.key })); },
      settings: (e) => {
        this.prevent(e);
        this.openSpaceSettings(x.key);
      },
      // Archivieren direkt im Menü (mit Rückfrage), archivierte Spaces direkt zurückholen
      archiveLabel: x.archived ? 'Zurückholen' : 'Archivieren',
      archivePopup: x.archived ? 'false' : 'dialog',
      archive: () => this.archiveFromMenu(x.key)
    }));

    // Brotkrume
    let crumbs = [];
    let crumbCurrent = '';
    if (isPage) {
      const ch = this.chain(cur);
      crumbs = (vmode ? ch : ch.slice(0, -1)).map((id) => ({ title: shown(P[id].title), go: (e) => { this.prevent(e); this.go(id); } }));
      crumbCurrent = vmode ? 'Versionen' : shown(P[cur].title);
    } else {
      crumbs = [{ title: sp.name, go: (e) => { this.prevent(e); this.go(homeId); } }];
      crumbCurrent = s.view === 'import' ? 'Confluence-Import' : 'Einstellungen';
    }

    // Seite
    const p = isPage ? P[cur] : P[homeId];
    const pid = isPage ? cur : homeId;
    // Erstes Öffnen einer Seite: Platzhalter statt Inhalt (neu angelegte Seiten sind sofort da)
    const pageLoading = isPage && !vmode && !this._loaded.has(pid) && !String(pid).startsWith('neu');
    if (pageLoading) this.scheduleLoad('p:' + pid, this._loaded.size ? 380 : 650, () => this._loaded.add(pid));
    const myRole = this.role(pid);
    const editable = !sp.archived && this.canEdit(pid);
    const restricted = this.chain(pid).some((x) => s.grants[x]);
    const author = PEOPLE[p.author];
    const editor = PEOPLE[p.editor];
    const restoredBody = s.restoredBody[pid];
    const body = {
      restored: !!restoredBody,
      home: !restoredBody && p.body === 'home',
      dm: !restoredBody && p.body === 'dm',
      plain: !restoredBody && !p.body && p.text.length > 0,
      empty: !restoredBody && !p.body && p.text.length === 0,
      emptyReadonly: !editable && (restoredBody ? restoredBody.length === 0 : !p.body && p.text.length === 0)
    };
    // Bearbeitbaren Bereich mit dem Entwurf dieser Seite füllen (nach dem Rendern)
    if (isPage && editable && !vmode && !pageLoading) this.edSync(pid);
    // Leerer Space: Startseite ohne Inhalt und ohne lesbare Unterseiten
    const welcomeShow = isPage && pid === homeId && body.empty && !P[homeId].kids.some((k) => this.role(k));
    const tplSave = this.tplSaveVals(pid, sp);
    const link = (id, text) => ({
      title: shown(P[id].title),
      text,
      cls: s.trash.some((t) => t.id === id) ? 'nf-page-link nf-page-link-trashed' : 'nf-page-link',
      go: (e) => { this.prevent(e); this.go(id); }
    });
    // Anwesenheit: nur die anderen; bis drei Avatare, ab vier „+N“
    const others = (PRESENCE[pid] || []).filter((k) => k !== 'peter');
    const shownOthers = others.length > 3 ? others.slice(0, 2) : others;
    const presence = shownOthers.map((k) => ({ name: PEOPLE[k].name, color: PEOPLE[k].color, initials: initials(PEOPLE[k].name) }));
    const callout = (key) => ({
      variant: s.callouts[key],
      icon: CALLOUT[s.callouts[key]].icon,
      label: CALLOUT[s.callouts[key]].label,
      change: (e) => { const v = e.target.value; this.setState((st) => ({ callouts: { ...st.callouts, [key]: v } })); this.markSaving(); }
    });
    const tasks = [
      { id: 't1', text: 'RLS-Tests für alle Lesepfade' },
      { id: 't2', text: 'Tabelle mit effektiven Rechten für große Seitenbäume' }
    ].map((t) => ({
      ...t,
      done: !!s.tasks[t.id],
      checkedAttr: s.tasks[t.id] ? 'true' : 'false',
      disabled: !editable,
      toggle: () => { if (!editable) return; this.setState((st) => ({ tasks: { ...st.tasks, [t.id]: !st.tasks[t.id] } })); this.markSaving(); }
    }));

    // Kommentare (Ausblick)
    const cm = this.cmVals(pid, myRole, sp.archived, isPage);
    const t1 = (s.threads[pid] || []).find((t) => t.id === 't1');
    const t1Open = !!t1 && !t1.resolved;
    const openN = cm.openCountForButton;

    // Rechte-Dialog (Ausblick M3)
    let rights = {};
    if (s.dialog === 'rights' && s.rightsDraft) {
      const d = s.rightsDraft;
      const locked = myRole !== 'admin';
      const srcId = this.source(pid, false);
      const from = srcId.startsWith('space:') ? 'vom Space „' + sp.name + '“' : 'von „' + shown(P[srcId].title) + '“';
      const editableGrants = d.own && !locked;
      const setDraft = (patch) => this.setState((st) => ({ rightsDraft: { ...st.rightsDraft, ...patch } }));
      const initialsOf = (key) => (key === 'grp' ? 'GE' : key === 'ws' ? 'AW' : initials(SUBJECTS[key].name));
      const subOf = (key) => {
        if (key === 'grp') return 'Gruppe · ' + GROUPS.grp.length + ' Mitglieder';
        if (key === 'ws') return 'Alle Mitglieder von ' + s.wsName + ', ohne Gäste';
        const m = s.members.find((x) => x.key === key);
        return key === 'peter' ? 'Du' : m ? m.email + (m.role === 'guest' ? ' · Gast' : '') : 'Person';
      };

      // Zusammenfassung: wirksame Rolle jeder Person im Workspace mit dem Entwurf
      const byRole = { admin: [], editor: [], commenter: [], viewer: [], none: [] };
      s.members.forEach((m) => { byRole[this.effRole(d.grants, m.key, sp.archived) || 'none'].push(PEOPLE[m.key].name); });
      const summary = ['admin', 'editor', 'commenter', 'viewer', 'none']
        .filter((r) => byRole[r].length > 0)
        .map((r) => ({ role: r, count: byRole[r].length, label: r === 'none' ? 'ohne Zugriff' : ROLE_LABEL[r], names: byRole[r].join(', ') }));

      // Absicherungen: eigene Admin-Rechte und mindestens ein wirksamer Admin
      const meNow = this.effRole(d.grants, 'peter', false);
      const selfWarn = editableGrants && meNow !== 'admin';
      const noAdmin = editableGrants && byRole.admin.length === 0;

      // Vorschläge zum Hinzufügen
      const taken = new Set(d.grants.map((g) => g.key));
      const words = fold(d.query.trim()).split(/\s+/).filter(Boolean);
      const candidates = [
        ...s.members.map((m) => ({ key: m.key, name: PEOPLE[m.key].name, sub: subOf(m.key), hay: PEOPLE[m.key].name + ' ' + m.email, bg: PEOPLE[m.key].color })),
        { key: 'grp', name: SUBJECTS.grp.name, sub: subOf('grp'), hay: SUBJECTS.grp.name + ' gruppe', bg: SUBJECTS.grp.bg },
        { key: 'ws', name: SUBJECTS.ws.name, sub: subOf('ws'), hay: SUBJECTS.ws.name + ' workspace alle', bg: SUBJECTS.ws.bg }
      ].filter((c) => !taken.has(c.key) && words.every((w) => fold(c.hay).includes(w))).slice(0, 8);
      const roleFor = (key) => (key === 'ws' && d.addRole === 'admin' ? 'editor' : d.addRole);
      const active = Math.min(d.addActive || 0, Math.max(0, candidates.length - 1));
      const addKey = (key) => {
        setDraft({ grants: [...this.state.rightsDraft.grants, { key, role: roleFor(key) }], query: '', addActive: 0, addOpen: false });
        this.showToast(SUBJECTS[key].name + ' hinzugefügt als ' + ROLE_LABEL[roleFor(key)]);
      };
      const suggestOpen = !!d.addOpen && (words.length > 0 || candidates.length > 0);

      rights = {
        locked,
        ownPressed: d.own ? 'true' : 'false',
        inheritText: d.own ? 'Gilt für diese Seite und ihre Unterseiten.' : 'Erbt die Rechte ' + from + '.',
        summary,
        viewAs: () => this.openViewAs(true),
        grants: d.grants.map((g, i) => {
          const subj = SUBJECTS[g.key];
          return {
            name: subj.name, sub: subOf(g.key), bg: subj.bg, initials: initialsOf(g.key),
            role: g.role, roleLabel: ROLE_LABEL[g.role],
            selectLabel: 'Rolle für ' + subj.name,
            selectAdmin: editableGrants && g.key !== 'ws',
            selectNoAdmin: editableGrants && g.key === 'ws',
            readonly: !editableGrants,
            removable: editableGrants,
            removeLabel: subj.name + ' entfernen',
            remove: () => setDraft({ grants: this.state.rightsDraft.grants.filter((x, j) => j !== i) }),
            change: (e) => {
              const v = e.target.value;
              setDraft({ grants: this.state.rightsDraft.grants.map((x, j) => (j === i ? { ...x, role: v } : x)) });
            }
          };
        }),
        canAdd: editableGrants,
        query: d.query,
        addRole: d.addRole,
        onAddRole: (e) => setDraft({ addRole: e.target.value }),
        onQuery: (e) => setDraft({ query: e.target.value, addOpen: true, addActive: 0 }),
        onFocus: () => setDraft({ addOpen: true }),
        onBlur: () => setTimeout(() => { if (this.state.rightsDraft) setDraft({ addOpen: false }); }, 120),
        keep: (e) => this.prevent(e),
        onKey: (e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            this.prevent(e);
            if (!candidates.length) return;
            setDraft({ addOpen: true, addActive: (active + (e.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length });
          } else if (e.key === 'Enter') {
            this.prevent(e);
            if (candidates.length) addKey(candidates[active].key);
          } else if (e.key === 'Escape' && suggestOpen) {
            this.prevent(e);
            this.stop(e);
            setDraft({ addOpen: false });
          }
        },
        suggestOpen,
        suggestExpanded: suggestOpen ? 'true' : 'false',
        activeId: suggestOpen && candidates.length ? 'nf-grant-opt-' + active : '',
        suggestions: candidates.map((c, i) => ({
          ...c, initials: initialsOf(c.key), roleLabel: ROLE_LABEL[roleFor(c.key)],
          domId: 'nf-grant-opt-' + i, selected: i === active ? 'true' : 'false',
          add: () => addKey(c.key)
        })),
        noSuggest: suggestOpen && candidates.length === 0,
        noSuggestText: 'Niemand mit „' + d.query.trim() + '“ im Workspace, oder schon in der Liste',
        selfWarn: selfWarn && !noAdmin,
        noAdmin,
        hint: !editableGrants,
        hintText: locked
          ? 'Rechte ändern nur Admins dieser Seite bzw. dieses Spaces. Deine Rolle: ' + (myRole ? ROLE_LABEL[myRole] : '–') + '.'
          : 'Um nur einzelnen Personen Zugriff zu geben, schalte „Eigene Rechte“ ein. Die bisherigen Rechte werden übernommen und lassen sich dann einschränken.',
        canSave: !locked,
        saveDisabled: noAdmin,
        saveCls: selfWarn && !noAdmin ? 'nf-btn-attention' : 'nf-btn-primary',
        saveLabel: selfWarn && !noAdmin ? 'Trotzdem speichern' : 'Speichern',
        toggleOwn: () => {
          if (locked) return;
          this.setState((st) => {
            const own = !st.rightsDraft.own;
            const inherited = (st.grants[this.source(pid, false)] || []).map((g) => ({ ...g }));
            // Vererbung kappen übernimmt die bisherigen Rechte und macht die handelnde Person zum Admin
            if (own && !inherited.some((g) => g.key === 'peter')) inherited.unshift({ key: 'peter', role: 'admin' });
            if (own) inherited.forEach((g) => { if (g.key === 'peter') g.role = 'admin'; });
            return { rightsDraft: { ...st.rightsDraft, own, grants: inherited } };
          });
        },
        save: () => {
          if (noAdmin) return;
          this.setState((st) => {
            const grants = { ...st.grants };
            if (st.rightsDraft.own) grants[pid] = st.rightsDraft.grants.filter((g) => g.role !== 'none');
            else delete grants[pid];
            return { grants, dialog: null, rightsDraft: null };
          });
          this.showToast('Rechte gespeichert');
        }
      };
    }

    // „Ansehen als …“: Rolle einer Person auf jeder Seite des Spaces (gespeicherter Stand)
    let viewAs = { open: false };
    if (s.dialog === 'viewAs') {
      const who = s.viewAsWho || 'max';
      const trashed = new Set(s.trash.map((t) => t.id));
      const rows = [];
      const walkVa = (id, depth) => {
        if (trashed.has(id)) return;
        const r = this.roleFor(id, who);
        rows.push({
          title: id === homeId ? shown(P[id].title) + ' (Startseite)' : shown(P[id].title),
          pad: 10 + depth * 18,
          restricted: !!s.grants[id],
          role: r || 'none', roleLabel: r ? ROLE_LABEL[r] : 'Kein Zugriff', none: r ? 'false' : 'true'
        });
        P[id].kids.forEach((k) => walkVa(k, depth + 1));
      };
      walkVa(homeId, 0);
      const seen = rows.filter((r) => r.none === 'false').length;
      const m = s.members.find((x) => x.key === who);
      viewAs = {
        open: true,
        spaceName: sp.name,
        who,
        people: s.members.filter((x) => x.key !== 'peter').map((x) => ({ key: x.key, label: PEOPLE[x.key].name + (x.role === 'guest' ? ' (Gast)' : '') })),
        onWho: (e) => this.setState({ viewAsWho: e.target.value }),
        summary: PEOPLE[who].name + (m && m.role === 'guest' ? ' (Gast)' : '') + ' sieht ' + seen + ' von ' + rows.length + ' Seiten.',
        rows,
        back: !!s.viewAsBack,
        goBack: () => this.openRights()
      };
    }

    // Rückfrage
    let confirm = {};
    if (s.dialog === 'confirm' && s.confirm) {
      if (s.confirm.kind === 'trash') {
        const t = P[s.confirm.id];
        confirm = {
          title: t.kids.length ? '„' + shown(t.title) + '“ und alle Unterseiten in den Papierkorb?' : '„' + shown(t.title) + '“ in den Papierkorb?',
          text: 'Aus dem Papierkorb unten in der Seitenleiste lässt sie sich wiederherstellen.',
          label: 'In den Papierkorb', cls: 'nf-btn-danger',
          ok: () => this.trashPage(s.confirm.id)
        };
      } else if (s.confirm.kind === 'restoreVersion') {
        const v = this.versionList(s.confirm.pid).find((x) => x.n === s.confirm.n);
        const next = this.versionList(s.confirm.pid).length + 1;
        confirm = {
          title: 'Version ' + v.n + ' wiederherstellen?',
          text: 'Titel und Inhalt vom ' + vLong(v.at).replace(/^Heute, /, 'heute, ').replace(/^Gestern, /, 'gestern, ') + ' werden zum aktuellen Stand. Daraus entsteht Version ' + next + '; alle bisherigen Versionen bleiben erhalten. Wer die Seite offen hat, sieht die Änderung sofort.',
          label: 'Wiederherstellen', cls: 'nf-btn-primary',
          ok: () => this.restoreVersion(s.confirm.pid, s.confirm.n)
        };
      } else if (s.confirm.kind === 'removeMember') {
        const m = s.members.find((x) => x.key === s.confirm.key);
        confirm = {
          title: PEOPLE[m.key].name + ' aus „' + s.wsName + '“ entfernen?',
          text: 'Die Person verliert sofort den Zugriff auf alle Spaces dieses Workspaces; offene Editoren werden getrennt. Ihre Seiten und Kommentare bleiben.',
          label: 'Entfernen', cls: 'nf-btn-danger',
          ok: () => {
            this.setState((st) => ({ members: st.members.filter((x) => x.key !== m.key), dialog: 'workspace', confirm: null }));
            this.showToast(PEOPLE[m.key].name + ' entfernt');
          }
        };
      } else {
        confirm = {
          title: '„' + s.spaces[s.confirm.key || s.space].name + '“ archivieren?',
          text: 'Danach können ihn alle nur noch lesen. Zurückholen geht jederzeit in den Einstellungen des Spaces.',
          label: 'Space archivieren', cls: 'nf-btn-attention',
          ok: () => {
            const key = s.confirm.key || s.space;
            this.setState((st) => ({ spaces: { ...st.spaces, [key]: { ...st.spaces[key], archived: true } }, dialog: s.confirm.back || null, confirm: null, settingsDraft: null }));
            this.showToast('„' + s.spaces[key].name + '“ archiviert');
          }
        };
      }
    }

    // Einstellungen eines Spaces (Dialog); welcher Space, sagt settingsKey (aus Umschalter oder Übersicht)
    const stKey = s.settingsKey || s.space;
    const stSpace = s.spaces[stKey];
    const sd = s.settingsDraft || { name: stSpace.name, description: stSpace.description || '', color: stSpace.color || '#1F5FD6' };
    const settingsEditable = !stSpace.archived && this.role(stSpace.home) === 'admin';
    const setSd = (patch) => this.setState((st) => ({ settingsDraft: { ...(st.settingsDraft || sd), ...patch } }));
    const stCount = ((x) => { const sub = (y) => [y, ...P[y].kids.flatMap(sub)]; return sub(x).length; })(stSpace.home);
    const settings = {
      key: stKey,
      title: stSpace.name,
      badge: stKey.slice(0, 2),
      color: sd.color,
      pageCount: stCount + (stCount === 1 ? ' Seite' : ' Seiten'),
      address: '/s/' + stKey.toLowerCase(),
      name: sd.name, description: sd.description,
      editable: settingsEditable, locked: !settingsEditable,
      cancelLabel: settingsEditable ? 'Abbrechen' : 'Schließen',
      lockedText: stSpace.archived ? 'Der Space ist archiviert. Name, Beschreibung und Farbe lassen sich erst nach dem Zurückholen ändern.' : 'Name, Beschreibung und Farbe ändern nur Admins dieses Spaces.',
      onName: (e) => setSd({ name: e.target.value }),
      onDescription: (e) => setSd({ description: e.target.value }),
      colors: SPACE_COLORS.map((c) => ({
        color: c.color, label: c.label,
        on: sd.color === c.color, checked: sd.color === c.color ? 'true' : 'false',
        choose: () => settingsEditable && setSd({ color: c.color })
      })),
      archived: stSpace.archived,
      active: !stSpace.archived,
      zoneTitle: stSpace.archived ? 'Archiviert' : 'Archivieren',
      zoneText: stSpace.archived
        ? 'Alle können diesen Space nur noch lesen. Zurückgeholt gelten wieder die bisherigen Rechte.'
        : 'Ein archivierter Space bleibt sichtbar, lässt sich aber von niemandem mehr bearbeiten.',
      save: (e) => {
        this.prevent(e);
        if (!settingsEditable) return;
        this.setState((st) => ({ spaces: { ...st.spaces, [stKey]: { ...st.spaces[stKey], name: sd.name.trim() || st.spaces[stKey].name, description: sd.description.trim(), color: sd.color } }, dialog: null, settingsDraft: null }));
        this.showToast('Gespeichert');
      },
      askArchive: () => { this.setState({ dialog: 'confirm', confirm: { kind: 'archive', key: stKey, back: 'spaceSettings' } }); this.focusLater('#nf-confirm-cancel'); },
      unarchive: () => { this.setState((st) => ({ spaces: { ...st.spaces, [stKey]: { ...st.spaces[stKey], archived: false } }, settingsDraft: null })); this.showToast('„' + stSpace.name + '“ zurückgeholt'); }
    };

    const anyMenu = s.menu || s.spaceMenu || s.pageMenu || s.userMenu || s.settingsMenu || s.sideMenu || s.notifOpen || s.reactPicker || s.lookPop;
    const trashItems = s.trash.filter((t) => P[t.id].space === s.space).map((t) => ({
      title: shown(P[t.id].title),
      canRestore: !sp.archived && this.canEdit(P[t.id].parent),
      restoreLabel: '„' + shown(P[t.id].title) + '“ wiederherstellen',
      restore: () => this.restorePage(t.id)
    }));

    return {
      drawerAttr: s.drawer ? 'open' : 'closed',
      drawerExpanded: s.drawer ? 'true' : 'false',
      openDrawer: (e) => { this.stop(e); this.setState({ drawer: true }); },
      closeDrawer: () => this.setState({ drawer: false }),
      closeMenus: () => { if (anyMenu) this.setState({ menu: null, spaceMenu: false, spaceSub: null, pageMenu: false, userMenu: false, settingsMenu: false, sideMenu: null, notifOpen: false, reactPicker: false, lookPop: null }); },
      onKey: (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
          this.prevent(e);
          if (s.palette) this.closePalette(); else this.openPalette();
          return;
        }
        if (e.key !== 'Escape') return;
        if (s.dialog) this.setState({ dialog: null, confirm: null, rightsDraft: null });
        else if (s.notifOpen) { this.setState({ notifOpen: false }); this.focusLater('.nf-bell-btn'); }
        else if (s.reactPicker) { this.setState({ reactPicker: false }); this.focusLater('.nf-reaction-add'); }
        else if (s.lookPop) { const k = s.lookPop.kind; this.setState({ lookPop: null }); this.focusLater(k === 'emoji' && s.pageIcons[s.lookPop.pid] ? '.nf-page-emoji' : '.nf-title-tool'); }
        else if (anyMenu) this.setState({ menu: null, spaceMenu: false, spaceSub: null, pageMenu: false, userMenu: false, settingsMenu: false, sideMenu: null });
        else if (s.renaming) this.setState({ renaming: null });
        else if (s.drawer) this.setState({ drawer: false });
        else if (vmode) this.setState({ versions: null });
      },
      goOverview: (e) => { this.prevent(e); this.setState({ view: 'overview', spaceMenu: false, spaceSub: null, drawer: false, menu: null }); },

      space: { ...sp, badge: sp.key.slice(0, 2), color: sp.color || '#1F5FD6', active: !sp.archived },
      spaceMenuOpen: s.spaceMenu,
      spaceMenuExpanded: s.spaceMenu ? 'true' : 'false',
      toggleSpaceMenu: (e) => { this.stop(e); this.setState((st) => ({ spaceMenu: !st.spaceMenu, notifOpen: false, spaceSub: null, menu: null, pageMenu: false, userMenu: false, settingsMenu: false })); },
      spaceItems,
      spaceEditable,
      createTop: (e) => { this.stop(e); this.createPage(homeId); },
      treeLabel: 'Seiten in ' + sp.name,
      homeCls: cur === homeId ? 'nf-selected' : '',
      homeCurrent: cur === homeId ? 'page' : 'false',
      goHome: (e) => { this.prevent(e); this.go(homeId); },
      rows,

      openTrash: () => { this.setState({ dialog: 'trash', trashQ: '', drawer: false }); this.focusLater('#nf-trash-q'); },
      trashDlg: (() => {
        if (s.dialog !== 'trash') return { open: false };
        const words = fold(s.trashQ.trim()).split(/\s+/).filter(Boolean);
        const sub = (x) => [x, ...P[x].kids.flatMap(sub)];
        const mine = s.trash.filter((t) => P[t.id].space === s.space && this.role(t.id));
        const items = mine
          .filter((t) => words.every((w) => fold(sub(t.id).map((x) => shown(P[x].title)).join(' ')).includes(w)))
          .map((t) => {
            const kids = [];
            const walkK = (x, depth) => P[x].kids.forEach((k) => { kids.push({ title: shown(P[k].title), pad: 8 + depth * 16 }); walkK(k, depth + 1); });
            walkK(t.id, 0);
            const open = !!s.trashKids[t.id];
            const parent = P[t.id].parent;
            return {
              title: shown(P[t.id].title),
              restricted: this.chain(t.id).some((x) => s.grants[x]),
              by: t.by === 'peter' ? 'dir' : PEOPLE[t.by].name,
              when: t.when,
              from: parent === homeId ? 'Startseite' : shown(P[parent].title),
              hasKids: kids.length > 0,
              kids,
              kidsOpen: open,
              kidsExpanded: open ? 'true' : 'false',
              kidsRot: open ? 90 : 0,
              kidsLabel: kids.length + (kids.length === 1 ? ' Unterseite' : ' Unterseiten') + ' mit gelöscht',
              toggleKids: () => this.setState((st) => ({ trashKids: { ...st.trashKids, [t.id]: !st.trashKids[t.id] } })),
              daysLabel: 'noch ' + t.daysLeft + (t.daysLeft === 1 ? ' Tag' : ' Tage'),
              daysTitle: 'Wird in ' + t.daysLeft + (t.daysLeft === 1 ? ' Tag' : ' Tagen') + ' endgültig gelöscht',
              soon: t.daysLeft <= 7 ? 'true' : 'false',
              canRestore: !sp.archived && this.canEdit(parent),
              restore: () => { this.restorePage(t.id); this.showToast('„' + shown(P[t.id].title) + '“ wiederhergestellt'); }
            };
          });
        return {
          open: true,
          spaceName: sp.name,
          q: s.trashQ,
          onQ: (e) => this.setState({ trashQ: e.target.value }),
          hasItems: mine.length > 0,
          items,
          empty: items.length === 0,
          emptyText: mine.length === 0 ? 'Der Papierkorb ist leer.' : 'Nichts im Papierkorb passt zu „' + s.trashQ.trim() + '“.'
        };
      })(),
      trashCount: trashItems.length,
      trashItems,
      trashEmpty: trashItems.length === 0,

      crumbs,
      crumbCurrent,
      isPage,
      isSettings: s.view === 'settings',
      isOverview: s.view === 'overview',
      isTemplates: s.view === 'templates',
      isImport: s.view === 'import',
      impNavCls: s.view === 'import' ? 'nf-nav-current' : '',
      impNavCurrent: s.view === 'import' ? 'page' : 'false',
      goImport: (e) => { this.prevent(e); this.openImport(); },
      imp: s.view === 'import' ? this.importVals() : {},
      ovNav,
      ovNavCls: s.view === 'overview' ? 'nf-nav-current' : '',
      ovNavCurrent: s.view === 'overview' ? 'page' : 'false',
      tplNavCls: s.view === 'templates' ? 'nf-nav-current' : '',
      tplNavCurrent: s.view === 'templates' ? 'page' : 'false',
      goTemplates: (e) => { this.prevent(e); this.openTemplates(null); },
      inSpace: !ovNav,
      ...this.overviewVals(),
      cmd: this.paletteVals(),
      ed: this.edVals(),
      openPalette: (e) => { this.stop(e); this.openPalette(); },
      presence,
      hasPresence: others.length > 0,
      presenceMore: others.length > shownOthers.length,
      presenceMoreLabel: '+' + (others.length - shownOthers.length),
      presenceLabel: 'Gerade auch auf dieser Seite: ' + others.map((k) => PEOPLE[k].name).join(', '),
      openVersions: () => this.openVersions(pid),
      vmode,
      showPage: isPage && !vmode && !pageLoading,
      pageLoading,
      treeLoading,
      treeEmpty: !treeLoading && !ovNav && rows.length === 0,
      treeEmptyText: spaceEditable ? 'Noch keine Seiten unter der Startseite.' : 'Hier gibt es noch keine Seiten.',
      welcome: {
        show: welcomeShow,
        title: 'Willkommen in „' + sp.name + '“',
        text: editable ? 'Dieser Space ist noch leer. So geht es los:' : 'Dieser Space ist noch leer. Sobald jemand Seiten anlegt, erscheinen sie hier und in der Seitenleiste.',
        canEdit: editable,
        create: () => this.createPage(homeId),
        invite: () => this.setState({ dialog: 'invites', inviteLink: null })
      },
      notif: this.notifVals(),
      tpl: s.view === 'templates' ? this.templatesVals() : {},
      tplDlg: this.tplDialogVals(),
      tplSave: tplSave,
      openTplSave: tplSave.open_,
      // Leere Seite: die häufigsten Vorlagen dieses Spaces als Einstieg
      tplSuggest: (() => {
        const draft = this._drafts[pid] || '';
        const draftEmpty = !draft.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim();
        const show = isPage && editable && !vmode && !pageLoading && pid !== homeId && body.empty && draftEmpty;
        if (!show) return { show: false };
        const items = this.templatesFor(null).filter((t) => !t.scope || t.scope === sp.key).sort((a, b) => b.uses - a.uses).slice(0, 4);
        return {
          show: true,
          items: items.map((t) => ({ name: t.name, icon: t.icon, desc: t.desc, apply: () => this.applyTemplate(pid, t.id) })),
          all: () => this.openTemplates(pid)
        };
      })(),
      reactions: this.reactionVals(pid, myRole, sp.archived),
      look: this.lookVals(pid, editable),
      foot: (() => {
        const f = isPage && !vmode ? this.footVals(pid, editable, sp, homeId) : { show: false };
        if (welcomeShow) { f.onlyCreate = false; f.show = !!(f.hasKids || f.hasLinks); }
        return f;
      })(),
      vv: vmode ? this.versionVals(pid, editable, sp.archived) : {},
      restoredBlocks: restoredBody ? vPlain(restoredBody).map(vTpl) : [],
      vSave: {
        open: s.dialog === 'saveVersion',
        name: s.vName,
        onName: (e) => this.setState({ vName: e.target.value }),
        submit: (e) => { this.prevent(e); this.saveVersion(pid, s.vName); }
      },
      openExport: () => this.setState({ dialog: 'export', pageMenu: false }),
      pageMenuOpen: !!s.pageMenu,
      pageMenuExpanded: s.pageMenu ? 'true' : 'false',
      togglePageMenu: (e) => { this.stop(e); this.setState((st) => ({ pageMenu: !st.pageMenu, notifOpen: false, menu: null, spaceMenu: false, spaceSub: null, userMenu: false, settingsMenu: false })); },
      openRights: () => this.openRights(),
      commentsPressed: s.commentsOpen ? 'true' : 'false',
      toggleComments: () => this.setState((st) => ({ commentsOpen: !st.commentsOpen, activeThread: st.commentsOpen ? null : st.activeThread, replying: null })),
      // Kommentare mit Zahl der offenen Threads
      cm,
      // Seiten-Favoriten dieses Spaces (nur lesbare, nicht im Papierkorb)
      pageFavs: (() => {
        const trashed = new Set(s.trash.map((t) => t.id));
        const ids = (s.pageFavs[s.space] || []).filter((id) => P[id] && this.role(id) && !this.chain(id).some((x) => trashed.has(x)));
        return {
          show: !ovNav && ids.length > 0,
          count: ids.length,
          open: s.pageFavsOpen,
          expanded: s.pageFavsOpen ? 'true' : 'false',
          toggle: () => {
            const next = !s.pageFavsOpen;
            try { localStorage.setItem('nf-proto-page-favs-open', String(next)); } catch (err) { /* nur diese Sitzung */ }
            this.setState({ pageFavsOpen: next });
          },
          items: ids.map((id) => ({
            icon: s.pageIcons[id] || '', hasIcon: !!s.pageIcons[id], noIcon: !s.pageIcons[id],
            title: P[id].title || 'Ohne Titel',
            titleCls: P[id].title ? '' : 'nf-untitled',
            cls: isPage && cur === id ? 'nf-selected' : '',
            current: isPage && cur === id ? 'page' : 'false',
            restricted: this.chain(id).some((x) => s.grants[x]),
            go: (e) => { this.prevent(e); this.go(id); },
            unfavLabel: '„' + (P[id].title || 'Ohne Titel') + '“ aus den Favoriten entfernen',
            unfav: (e) => { this.stop(e); this.toggleFavPage(id); }
          }))
        };
      })(),
      pageFav: (() => {
        const on = isPage && (s.pageFavs[s.space] || []).includes(pid);
        return {
          pressed: on ? 'true' : 'false',
          label: on ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen',
          toggle: () => this.toggleFavPage(pid)
        };
      })(),
      openComments: openN,
      hasOpenComments: openN > 0,
      commentsCls: openN > 0 ? 'nf-has-count' : '',
      commentsLabel: 'Kommentare ' + (s.commentsOpen ? 'ausblenden' : 'anzeigen') + ' (' + (openN === 0 ? 'keine offenen' : openN + (openN === 1 ? ' offener' : ' offene')) + ')',
      // Teilen und Rechte: zeigt eigene Rechte direkt im Knopf
      share: restricted
        ? { cls: 'nf-share-restricted', restricted: true, open: false, label: 'Eingeschränkt', aria: 'Teilen und Rechte: eingeschränkt, eigene Rechte' }
        : { cls: '', restricted: false, open: true, label: 'Teilen', aria: 'Teilen und Rechte' },
      // Speicherstatus: Offline vor Nur lesen vor Speichert vor Gespeichert
      save: (() => {
        const state = !s.online ? 'offline' : !editable ? 'readonly' : s.save;
        const T = {
          offline: { text: 'Offline', hint: 'Offline. Änderungen werden übertragen, sobald die Verbindung zurück ist.' },
          readonly: { text: sp.archived ? 'Archiviert' : 'Nur lesen', hint: sp.archived ? 'Der Space ist archiviert und nur lesbar.' : 'Deine Rolle erlaubt keine Änderungen am Inhalt.' },
          saving: { text: 'Speichert …', hint: 'Änderungen werden gespeichert.' },
          saved: { text: 'Gespeichert', hint: 'Alle Änderungen sind gespeichert.' }
        }[state];
        return { state, ...T, isSaved: state === 'saved', isSaving: state === 'saving', isOffline: state === 'offline', isReadonly: state === 'readonly' };
      })(),
      copyLink: () => {
        const url = location.origin + location.pathname + '#' + pid;
        try { navigator.clipboard.writeText(url).catch(() => {}); } catch (err) { /* ohne Zwischenablage nur die Rückmeldung */ }
        this.setState({ pageMenu: false });
        this.showToast('Link kopiert');
      },
      openInfo: () => this.setState({ dialog: 'info', pageMenu: false }),
      pageActions: {
        moveDisabled: editable && pid !== homeId ? 'false' : 'true',
        trashDisabled: editable && pid !== homeId ? 'false' : 'true',
        move: () => { if (editable && pid !== homeId) this.setState({ dialog: 'move', pageMenu: false, moveTarget: P[pid].parent }); },
        trash: () => {
          if (!editable || pid === homeId) return;
          this.setState({ dialog: 'confirm', confirm: { kind: 'trash', id: pid }, pageMenu: false });
          this.focusLater('#nf-confirm-cancel');
        }
      },
      moveOpen: s.dialog === 'move',
      move: (() => {
        if (s.dialog !== 'move') return {};
        const sub = (x) => [x, ...P[x].kids.flatMap(sub)];
        const excluded = new Set(sub(pid));
        const options = [];
        const walkOpts = (id, depth) => {
          if (excluded.has(id)) return;
          if (this.canEdit(id)) options.push({ id, label: '   '.repeat(depth) + (id === homeId ? 'Startseite' : shown(P[id].title)) });
          P[id].kids.forEach((k) => walkOpts(k, depth + 1));
        };
        walkOpts(homeId, 0);
        return {
          target: s.moveTarget,
          options,
          change: (e) => this.setState({ moveTarget: e.target.value }),
          submit: (e) => {
            this.prevent(e);
            const target = s.moveTarget;
            if (target && target !== P[pid].parent) this.movePage(pid, target, P[target].kids.length);
            this.setState({ dialog: null });
            this.showToast('Verschoben nach „' + (target === homeId ? 'Startseite' : shown(P[target].title)) + '“');
          }
        };
      })(),
      infoOpen: s.dialog === 'info',
      info: (() => {
        const backlinks = Object.keys(LINKS).filter((src) => LINKS[src].includes(pid) && P[src].space === sp.key)
          .map((src) => ({ title: shown(P[src].title), go: (e) => { this.prevent(e); this.setState({ dialog: null }); this.go(src); } }));
        return {
          rights: s.grants[pid] ? 'Eigene Rechte (Vererbung gekappt)' : restricted ? 'Erbt eigene Rechte einer übergeordneten Seite' : 'Erbt die Rechte vom Space',
          versions: (() => { const l = this.versionList(pid); return l.length + ' Versionen, die letzte ' + vLong(l[l.length - 1].at).replace(/^Heute, /, 'heute um ').replace(/^Gestern, /, 'gestern um '); })(),
          backlinks,
          hasBacklinks: backlinks.length > 0,
          noBacklinks: backlinks.length === 0
        };
      })(),
      hasToast: !!s.toast,
      toast: s.toast,

      innerCls: s.commentsOpen ? 'nf-with-comments' : '',
      page: {
        title: p.title,
        shownTitle: shown(p.title),
        editable,
        readonly: !editable,
        restricted,
        authorName: author.name,
        authorInitials: initials(author.name),
        authorColor: author.color,
        editorName: editor.name,
        when: p.when,
        editedAt: p.when === 'gerade eben' || p.when.startsWith('vor') ? '25. Nov. 2026, 15:40' : p.when.replace(/^am /, ''),
        roleLabel: myRole ? ROLE_LABEL[myRole] : '–',
        paragraphs: p.text.map((text) => ({ text }))
      },
      onTitle: (e) => this.setTitle(pid, e.target.value),
      // Enter im Titel: weiter in den Inhalt (wie im Frontend)
      onTitleKey: (e) => {
        if (e.key !== 'Enter') return;
        this.prevent(e);
        const el = this.edEl();
        if (el) { this.edFocusInto(el.firstElementChild || el); this.edUpdatePlaceholder(); }
      },
      body,
      homeLinks: [
        link('arch', 'Frontend, API, Datenmodell und Rechte'),
        link('release', 'vom Merge bis zum Pilot'),
        link('betrieb', 'Cluster, Backups und Bereitschaft')
      ],
      rechteLink: link('rechte'),
      calloutHome: callout('home'),
      calloutDm: callout('dm'),
      // Die feste Markierung in der Vorlage (Thread t1): offen dezent, aktiv kräftiger, erledigt unsichtbar
      markCls: t1Open ? 'nf-on' + (s.commentsOpen && s.activeThread === 't1' ? ' nf-active' : '') : '',
      tasks,

      commentsOpen: s.commentsOpen && isPage && !vmode,

      settings,
      spaceSettingsOpen: s.dialog === 'spaceSettings',

      rightsOpen: s.dialog === 'rights',
      rights,
      viewAs,
      soonOpen: !!SOON[s.dialog],
      soon: SOON[s.dialog] ? SOON[s.dialog](shown(p.title)) : {},

      userMenuOpen: !!s.userMenu,
      userMenuExpanded: s.userMenu ? 'true' : 'false',
      toggleUserMenu: (e) => { this.stop(e); this.setState((st) => ({ userMenu: !st.userMenu, notifOpen: false, settingsMenu: false, menu: null, spaceMenu: false, spaceSub: null, pageMenu: false })); },
      settingsMenuOpen: !!s.settingsMenu,
      settingsMenuExpanded: s.settingsMenu ? 'true' : 'false',
      toggleSettingsMenu: (e) => { this.stop(e); this.setState((st) => ({ settingsMenu: !st.settingsMenu, notifOpen: false, userMenu: false, menu: null, spaceMenu: false, spaceSub: null, pageMenu: false })); },
      closeUserMenu: () => this.setState({ userMenu: false, settingsMenu: false }),
      openProfile: () => this.setState({ dialog: 'profile', userMenu: false, settingsMenu: false }),
      openUserSettings: () => this.setState({ dialog: 'userSettings', userMenu: false, settingsMenu: false }),
      openShortcuts: () => this.setState({ dialog: 'shortcuts', userMenu: false, settingsMenu: false }),
      // Workspace und Einladungen (nur Owner und Admins; Peter ist Owner)
      openWorkspace: () => this.setState({ dialog: 'workspace', userMenu: false, settingsMenu: false, wsDraft: null }),
      openInvites: () => this.setState({ dialog: 'invites', userMenu: false, settingsMenu: false, inviteLink: null }),
      workspaceOpen: s.dialog === 'workspace',
      invitesOpen: s.dialog === 'invites',
      ws: (() => {
        const openCount = s.invites.filter((i) => i.status === 'open').length;
        return {
          name: s.wsName,
          draftName: s.wsDraft === null ? s.wsName : s.wsDraft,
          onName: (e) => this.setState({ wsDraft: e.target.value }),
          saveName: (e) => {
            this.prevent(e);
            const v = (s.wsDraft === null ? s.wsName : s.wsDraft).trim();
            if (v) { this.setState({ wsName: v, wsDraft: null }); this.showToast('Gespeichert'); }
          },
          openInvites: openCount,
          hasOpenInvites: openCount > 0,
          openInvitesLabel: openCount + ' offen',
          statLine: s.members.length + (s.members.length === 1 ? ' Mitglied' : ' Mitglieder') + ' · '
            + (openCount === 0 ? 'keine offene Einladung' : openCount + (openCount === 1 ? ' offene Einladung' : ' offene Einladungen')),
          memberCount: s.members.length,
          members: s.members.map((m) => {
            const fixed = m.role === 'owner' || m.key === 'peter';
            const name = PEOPLE[m.key].name;
            return {
              name: m.key === 'peter' ? name + ' (du)' : name,
              email: m.email,
              color: PEOPLE[m.key].color,
              initials: initials(name),
              role: m.role,
              roleText: WS_ROLE[m.role],
              roleLabel: 'Rolle von ' + name,
              removeLabel: name + ' entfernen',
              editable: !fixed,
              fixed,
              change: (e) => {
                const v = e.target.value;
                this.setState((st) => ({ members: st.members.map((x) => (x.key === m.key ? { ...x, role: v } : x)) }));
                this.showToast(name + ': ' + WS_ROLE[v]);
              },
              remove: () => { this.setState({ dialog: 'confirm', confirm: { kind: 'removeMember', key: m.key } }); this.focusLater('#nf-confirm-cancel'); }
            };
          })
        };
      })(),
      inv: {
        email: s.inviteEmail,
        role: s.inviteRole,
        onEmail: (e) => this.setState({ inviteEmail: e.target.value }),
        onRole: (e) => this.setState({ inviteRole: e.target.value }),
        submit: (e) => {
          this.prevent(e);
          const email = s.inviteEmail.trim();
          if (!email) return;
          const token = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
          this.setState((st) => ({
            invites: [{ id: 'n' + st.seq, email, role: st.inviteRole, status: 'open', until: '2. Dez. 2026', by: 'Peter Forster' }, ...st.invites],
            seq: st.seq + 1,
            inviteEmail: '',
            inviteLink: { email, link: location.origin + '/invite/' + token },
            inviteCopied: false
          }));
        },
        hasLink: !!s.inviteLink,
        linkEmail: s.inviteLink ? s.inviteLink.email : '',
        link: s.inviteLink ? s.inviteLink.link : '',
        copyLabel: s.inviteCopied ? 'Kopiert' : 'Kopieren',
        copy: () => {
          try { navigator.clipboard.writeText(s.inviteLink.link).catch(() => {}); } catch (err) { /* nur Rückmeldung */ }
          this.setState({ inviteCopied: true });
        },
        count: s.invites.length,
        items: s.invites.map((i) => ({
          email: i.email,
          meta: WS_ROLE[i.role] + ' · gültig bis ' + i.until + ' · von ' + i.by,
          status: i.status,
          statusText: INVITE_STATUS[i.status],
          open: i.status === 'open',
          revokeLabel: 'Einladung für ' + i.email + ' zurücknehmen',
          revoke: () => {
            this.setState((st) => ({ invites: st.invites.map((x) => (x.id === i.id ? { ...x, status: 'revoked' } : x)) }));
            this.showToast('Einladung zurückgenommen');
          }
        }))
      },
      locales: [{ key: 'de', label: 'Deutsch' }, { key: 'en', label: 'English' }].map((l) => ({
        ...l,
        lang: l.key,
        on: (s.locale || 'de') === l.key,
        checked: (s.locale || 'de') === l.key ? 'true' : 'false',
        choose: () => this.setState({ locale: l.key, userMenu: false, settingsMenu: false })
      })),
      // Menü bleibt offen, damit man den Wechsel gleich sieht
      themes: [{ key: 'light', label: 'Hell' }, { key: 'dark', label: 'Dunkel' }, { key: 'system', label: 'System' }].map((t) => ({
        ...t,
        isLight: t.key === 'light',
        isDark: t.key === 'dark',
        isSystem: t.key === 'system',
        checked: s.theme === t.key ? 'true' : 'false',
        choose: (e) => {
          this.stop(e);
          try { localStorage.setItem('nf-proto-theme', t.key); } catch (err) { /* ohne Speicher nur für diese Sitzung */ }
          this.setState({ theme: t.key });
        }
      })),
      confirmOpen: s.dialog === 'confirm',
      confirm,
      closeDialog: () => this.setState({ dialog: null, confirm: null, rightsDraft: null }),
      closeDialogOnBackdrop: (e) => { if (e.target === e.currentTarget) this.setState({ dialog: null, confirm: null, rightsDraft: null }); }
    };
  }
