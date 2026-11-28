  // ---------- Personen deaktivieren (M3: E02; nur Organisations-Admins, app.set_user_active) ----------
  // Gilt für den ganzen Mandanten (users.deactivated_at): Sitzungen gelöscht, offene Editoren getrennt
  // (user.deactivated), kein Zugriff mehr (app.page_rank verlangt aktive Personen), zählt nicht als
  // Admin (app.has_admin). Grants, Gruppen und Mitgliedschaften bleiben und gelten nach dem
  // Reaktivieren wieder. Die Datenbank lehnt das Deaktivieren nicht ab, wenn danach irgendwo kein
  // Admin mehr bleibt; der Dialog warnt vorher.
  isActive(key) { return !this.state.deactivated[key]; }
  /** Name mit Zusatz für Listen, in denen Deaktivierte stehen bleiben */
  personLabel(key) { return PEOPLE[key].name + (this.isActive(key) ? '' : ' (deaktiviert)'); }

  askDeactivate(key) {
    this.setState({ dialog: 'confirm', confirm: { kind: 'deactivate', key, back: 'workspace' } });
    this.focusLater('#nf-confirm-cancel');
  }
  deactivateConfirm() {
    const s = this.state;
    const key = s.confirm.key;
    const name = PEOPLE[key].name;
    const lost = this.adminLoss(s.groups, s.grants, { ...s.deactivated, [key]: true });
    const warn = lost.length
      ? 'Danach hat ' + lost.map((src) => this.sourceLabel(src)).join(', ') + ' keinen Admin mehr. Ein Organisations-Admin kann dort einen neuen setzen.'
      : '';
    return {
      title: name + ' deaktivieren?',
      text: 'Gilt für die ganze Organisation: ' + name + ' wird sofort abgemeldet, offene Editoren werden getrennt, und eine neue Anmeldung ist nicht mehr möglich. '
        + 'Rechte, Gruppen und Mitgliedschaften bleiben gespeichert und gelten nach dem Reaktivieren wieder; Seiten und Kommentare bleiben. Das Konto beim Login-Dienst ändert sich nicht.',
      warn,
      hasWarn: !!warn,
      label: warn ? 'Trotzdem deaktivieren' : 'Deaktivieren',
      cls: 'nf-btn-attention',
      ok: () => {
        this.setState((st) => ({ deactivated: { ...st.deactivated, [key]: { by: 'peter', when: 'am 28. November' } }, dialog: 'workspace', confirm: null }));
        this.showToast(name + ' deaktiviert');
      }
    };
  }
  reactivate(key) {
    this.setState((st) => {
      const deactivated = { ...st.deactivated };
      delete deactivated[key];
      return { deactivated };
    });
    this.showToast(PEOPLE[key].name + ' wieder aktiv');
  }
