  // ---------- Rechte wiederherstellen (M3: E09; nur Organisations-Admins) ----------
  // Ein Space oder eine Seite mit eigenen Rechten kann ihren letzten wirksamen Admin verlieren, ohne dass
  // die Datenbank es verhindert: beim Deaktivieren einer Person oder wenn der Login-Dienst (idp, scim) die
  // letzte Person aus einer Admin-Gruppe nimmt (app.has_admin greift nur bei Grants und Mitgliedschaften
  // im Wiki). Organisations-Admins sehen solche Bereiche hier mit Titel und Ort, ohne Inhalt, und tragen
  // einen neuen Admin ein (app.set_grant, für Organisations-Admins auf jedem Space und jeder Seite erlaubt).
  // Jeder Eintrag steht mit Grund im Audit-Log. Vorschlag: eine Funktion wie app.sources_without_admin()
  // (SECURITY DEFINER, nur für Organisations-Admins, nur Struktur), eine Schemaänderung.
  openRecovery() {
    this.setState({ dialog: 'recovery', rcError: null, rcDone: null, userMenu: false, settingsMenu: false });
  }
  /** Quellen ohne wirksamen Admin: Spaces zuerst, dann Seiten */
  orphans() {
    const s = this.state;
    return this.sourcesWithoutAdmin(s.groups, s.grants)
      .filter((src) => src.startsWith('space:') ? !!s.spaces[src.slice(6)] : !!s.pages[src])
      .sort((a, b) => (a.startsWith('space:') ? 0 : 1) - (b.startsWith('space:') ? 0 : 1));
  }
  /** Warum kein Admin wirkt, aus den Admin-Grants der Quelle */
  orphanReasons(src) {
    const s = this.state;
    const admins = (s.grants[src] || []).filter((g) => g.role === 'admin');
    if (!admins.length) return ['Kein Admin eingetragen.'];
    const inWs = (k) => s.members.some((m) => m.key === k);
    return admins.map((g) => {
      const grp = s.groups[g.key];
      if (grp) return 'Admin-Gruppe „' + grp.name + '“ hat kein aktives Mitglied im Workspace.';
      const name = PEOPLE[g.key] ? PEOPLE[g.key].name : 'Eine gelöschte Person';
      if (s.deactivated[g.key]) return 'Admin ' + name + ' ist deaktiviert (' + s.deactivated[g.key].when + ').';
      if (!inWs(g.key)) return 'Admin ' + name + ' ist nicht mehr im Workspace.';
      return 'Admin ' + name + ' hat keinen Zugriff mehr.';
    });
  }
  /** Ort einer Quelle für Organisations-Admins: Titel und Pfad, kein Inhalt */
  orphanPlace(src) {
    const s = this.state;
    if (src.startsWith('space:')) {
      const sp = s.spaces[src.slice(6)];
      return { kind: 'space', label: 'Space „' + sp.name + '“', meta: 'Space · ' + sp.key + (sp.archived ? ' · archiviert' : '') };
    }
    const p = s.pages[src];
    const sp = s.spaces[p.space];
    const path = this.chain(src).slice(0, -1).map((x) => (x === sp.home ? 'Startseite' : s.pages[x].title || 'Ohne Titel'));
    return { kind: 'page', label: 'Seite „' + (p.title || 'Ohne Titel') + '“', meta: 'Eigene Rechte · ' + sp.name + ' · unter ' + path.join(' / ') };
  }

  recoveryVals() {
    const s = this.state;
    const list = this.orphans();
    const base = { recoveryCount: list.length, hasRecovery: list.length > 0, recoveryMeta: list.length ? '' : 'keine', recoveryCountLabel: list.length + (list.length === 1 ? ' Bereich ohne Admin' : ' Bereiche ohne Admin') };
    if (s.dialog !== 'recovery') return { ...base, rc: { open: false } };
    const active = s.members.filter((m) => this.isActive(m.key) && m.role !== 'guest');
    const items = list.map((src) => {
      const place = this.orphanPlace(src);
      const sp = src.startsWith('space:') ? s.spaces[src.slice(6)] : s.spaces[s.pages[src].space];
      const grants = s.grants[src] || [];
      // Wer noch Zugriff hat (wirksame Rolle wie app.page_rank), als Vorschlag für den neuen Admin
      const access = active.map((m) => ({ key: m.key, role: this.effRole(grants, m.key, sp.archived) })).filter((x) => x.role);
      const accessText = access.length
        ? 'Zugriff haben noch: ' + access.map((x) => PEOPLE[x.key].name + ' (' + ROLE_LABEL[x.role] + ')').join(', ') + '.'
        : 'Niemand im Workspace hat noch Zugriff.';
      const suggested = (access.find((x) => x.role === 'editor') || access[0] || { key: 'peter' }).key;
      const who = s.rcWho[src] || suggested;
      const roleOf = (k) => (access.find((x) => x.key === k) || {}).role;
      const people = [...active].sort((a, b) => (roleOf(b.key) ? RANK[roleOf(b.key)] : 0) - (roleOf(a.key) ? RANK[roleOf(a.key)] : 0))
        .map((m) => ({ key: m.key, label: PEOPLE[m.key].name + (m.key === 'peter' ? ' (du)' : '') + (roleOf(m.key) ? ' · ' + ROLE_LABEL[roleOf(m.key)] : '') }));
      const id = src.replace(/[^a-z0-9]/gi, '-');
      const err = s.rcError && s.rcError.src === src ? s.rcError.text : '';
      return {
        src, id: 'rc-' + id, reasonId: 'rc-reason-' + id, whoId: 'rc-who-' + id, errId: 'rc-err-' + id,
        isSpace: place.kind === 'space', isPage: place.kind === 'page',
        label: place.label, meta: place.meta,
        reasons: this.orphanReasons(src).join(' '),
        accessText,
        who, people,
        onWho: (e) => this.setState((st) => ({ rcWho: { ...st.rcWho, [src]: e.target.value } })),
        reason: s.rcReason[src] || '',
        onReason: (e) => this.setState((st) => ({ rcReason: { ...st.rcReason, [src]: e.target.value }, rcError: null })),
        hasError: !!err, error: err, invalid: err ? 'true' : 'false',
        submit: (e) => {
          this.prevent(e);
          const reason = (s.rcReason[src] || '').trim();
          if (reason.length < 5) { this.setState({ rcError: { src, text: 'Bitte kurz begründen, warum du hier einen Admin einträgst (steht im Audit-Log).' } }); this.focusLater('#rc-reason-' + id); return; }
          this.setState({ dialog: 'confirm', confirm: { kind: 'recover', src, who, reason, back: 'recovery' } });
          this.focusLater('#nf-confirm-cancel');
        }
      };
    });
    const done = s.rcDone && (s.rcDone.src.startsWith('space:') ? s.spaces[s.rcDone.src.slice(6)] : s.pages[s.rcDone.src]) ? s.rcDone : null;
    const doneSelf = !!done && done.who === 'peter';
    return {
      ...base,
      rc: {
        open: true,
        items, hasItems: items.length > 0, noItems: items.length === 0,
        intro: 'Spaces und Seiten mit eigenen Rechten, für die kein Admin mehr wirkt, etwa weil die Person mit Admin-Recht deaktiviert ist oder der Login-Dienst eine Admin-Gruppe geleert hat. Du siehst Titel und Ort, nicht den Inhalt.',
        hasDone: !!done,
        doneText: done ? PEOPLE[done.who].name + (doneSelf ? ' (du) ist' : ' ist') + ' jetzt Admin von ' + done.label + '.' + (doneSelf ? ' Prüfe die Rechte und trage dort, wenn möglich, eine zuständige Person ein.' : ' Sie kann jetzt selbst weitere Admins setzen.') : '',
        doneCanOpen: doneSelf,
        openDone: () => { if (done) this.openRightsOf(done.src); },
        log: s.audit.map((a) => ({
          id: a.id, when: a.when,
          text: PEOPLE[a.actor].name + ' hat ' + (a.who === a.actor ? 'sich selbst' : PEOPLE[a.who].name) + ' als Admin von ' + a.label + ' eingetragen.',
          reason: 'Grund: ' + a.reason
        })),
        hasLog: s.audit.length > 0
      }
    };
  }

  recoverConfirm() {
    const s = this.state;
    const { src, who, reason } = s.confirm;
    const place = this.orphanPlace(src);
    const self = who === 'peter';
    return {
      title: (self ? 'Dich' : PEOPLE[who].name) + ' als Admin eintragen?',
      text: (self ? 'Du wirst' : PEOPLE[who].name + ' wird') + ' Admin von ' + place.label + '. '
        + (self ? 'Danach siehst du auch den Inhalt. ' : 'Du selbst bekommst dadurch keinen Zugriff. ')
        + 'Der Eintrag steht mit deinem Namen und dem Grund im Audit-Log, lesbar für alle Organisations-Admins.',
      label: 'Als Admin eintragen', cls: 'nf-btn-primary',
      ok: () => {
        this.setState((st) => {
          const list = st.grants[src] || [];
          const has = list.some((g) => g.key === who);
          const grants = { ...st.grants, [src]: has ? list.map((g) => (g.key === who ? { ...g, role: 'admin' } : g)) : [...list, { key: who, role: 'admin' }] };
          const entry = { id: 'a' + Date.now(), when: 'gerade eben', actor: 'peter', who, label: place.label, reason };
          const rcReason = { ...st.rcReason };
          delete rcReason[src];
          return { grants, audit: [entry, ...st.audit], rcReason, rcDone: { src, who, label: place.label }, dialog: 'recovery', confirm: null };
        });
        this.showToast((self ? 'Du bist' : PEOPLE[who].name + ' ist') + ' jetzt Admin von ' + place.label);
      }
    };
  }
