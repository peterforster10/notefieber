  // ---------- Benutzerprofil und persönliche Einstellungen (M2: Profil aus E02, Einstellungen aus E15) ----------
  // Profil: users.display_name, avatar_file_id, locale, time_zone (eigene Zeile, wiki_app darf sie ändern).
  // E-Mail und Anmeldung gehören dem Login-Dienst. Einstellungen: im Prototyp im Browser (nf-proto-prefs);
  // im Produkt pro Person in der Datenbank (Vorschlag: users.settings als JSON, eigene Zeile).
  openProfile() {
    this.setState({ dialog: 'profile', profDraft: null, userMenu: false, settingsMenu: false });
    this.focusLater('#prof-name');
  }
  openUserSettings(section) {
    this.setState({ dialog: 'userSettings', userMenu: false, settingsMenu: false, notifOpen: false, prefsSaved: null });
    if (section) setTimeout(() => { const el = document.getElementById(section); if (el) { el.scrollIntoView({ block: 'start' }); const f = el.querySelector('input, select, button'); if (f) f.focus(); } }, 60);
  }
  setPrefs(patch) {
    this.setState((st) => {
      const prefs = { ...st.prefs, ...patch };
      try { localStorage.setItem('nf-proto-prefs', JSON.stringify(prefs)); } catch (err) { /* nur diese Sitzung */ }
      return { prefs, prefsSaved: Date.now() };
    });
  }
  profileVals() {
    const s = this.state, me = s.me;
    const d = s.profDraft || { name: me.name, avatar: me.avatar, tz: me.tz, locale: s.locale || 'de' };
    const set = (patch) => this.setState((st) => ({ profDraft: { ...(st.profDraft || d), ...patch } }));
    const name = d.name.trim();
    const dirty = name !== me.name || d.avatar !== me.avatar || d.tz !== me.tz || d.locale !== (s.locale || 'de');
    const TZ = [
      ['Europe/Vienna', 'Wien'], ['Europe/Berlin', 'Berlin'], ['Europe/Zurich', 'Zürich'], ['Europe/Amsterdam', 'Amsterdam'],
      ['Europe/Paris', 'Paris'], ['Europe/Warsaw', 'Warschau'], ['Europe/Helsinki', 'Helsinki'], ['Europe/Lisbon', 'Lissabon'],
      ['Europe/London', 'London'], ['UTC', 'UTC'], ['America/New_York', 'New York']
    ];
    const fmt = (tz) => { try { return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date()); } catch (err) { return ''; } };
    const off = (tz) => { try { const p = new Intl.DateTimeFormat('de-DE', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName'); return p ? p.value.replace('GMT', 'UTC') : ''; } catch (err) { return ''; } };
    return {
      open: s.dialog === 'profile',
      name: d.name,
      onName: (e) => set({ name: e.target.value }),
      nameEmpty: !name,
      initials: initials(name || me.name),
      color: '#1F5FD6',
      avatar: d.avatar || '',
      avatarBg: d.avatar ? 'url("' + d.avatar + '")' : 'none',
      hasAvatar: !!d.avatar, noAvatar: !d.avatar,
      pickFile: () => { const f = document.getElementById('prof-file'); if (f) f.click(); },
      onFile: (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { this.showToast('Nur PNG, JPEG, GIF oder WebP'); return; }
        if (file.size > 5 * 1024 * 1024) { this.showToast('Höchstens 5 MB'); return; }
        // Im Prototyp nur im Browser (blob:); im Frontend über die Datei-API, eingetragen als avatar_file_id
        set({ avatar: URL.createObjectURL(file) });
      },
      removeAvatar: () => set({ avatar: null }),
      email: me.email,
      locale: d.locale,
      onLocale: (e) => set({ locale: e.target.value }),
      tz: d.tz,
      onTz: (e) => set({ tz: e.target.value }),
      tzOptions: TZ.map(([key, label]) => ({ key, label: label + ' (' + off(key) + ')' })),
      tzNow: 'Bei dir ist es jetzt ' + fmt(d.tz) + ' Uhr.',
      emailToast: () => this.showToast('E-Mail und Passwort änderst du im Login-Dienst (Ausblick)'),
      cantSave: !dirty || !name,
      submit: (e) => {
        this.prevent(e);
        if (!name) return;
        PEOPLE.peter.name = name;
        this.setState({ me: { ...me, name, avatar: d.avatar, tz: d.tz }, locale: d.locale, profDraft: null, dialog: null });
        this.showToast('Profil gespeichert');
      }
    };
  }
  settingsVals() {
    const s = this.state, p = s.prefs;
    const sw = (key) => ({ pressed: p[key] ? 'true' : 'false', toggle: () => this.setPrefs({ [key]: !p[key] }) });
    const NOTIF = [
      ['mention', 'Erwähnungen', 'Jemand erwähnt dich mit @ auf einer Seite oder in einem Kommentar.'],
      ['reply', 'Antworten', 'In Threads, in denen du geschrieben hast oder denen du folgst.'],
      ['comment', 'Kommentare an deinen Seiten', 'Neue Kommentare an Seiten, die du angelegt hast.'],
      ['share', 'Geteilte Seiten', 'Jemand gibt dir Zugriff auf eine Seite oder einen Space.']
    ];
    const setNotif = (k, ch) => this.setPrefs({ notif: { ...p.notif, [k]: { ...p.notif[k], [ch]: !p.notif[k][ch] } } });
    const views = (key, storeKey) => ({
      value: s[key],
      change: (e) => {
        const v = e.target.value;
        try { localStorage.setItem(storeKey, v); } catch (err) { /* nur diese Sitzung */ }
        this.setState({ [key]: v, prefsSaved: Date.now() });
      }
    });
    return {
      open: s.dialog === 'userSettings',
      saved: !!s.prefsSaved,
      themeValue: s.theme,
      onTheme: (e) => {
        const v = e.target.value;
        try { localStorage.setItem('nf-proto-theme', v); } catch (err) { /* nur diese Sitzung */ }
        this.setState({ theme: v, prefsSaved: Date.now() });
      },
      subView: views('subView', 'nf-proto-subview'),
      favView: views('favView', 'nf-proto-favview'),
      commentsAuto: sw('commentsAuto'),
      markdown: sw('markdown'),
      spellcheck: sw('spellcheck'),
      notif: NOTIF.map(([key, label, hint]) => ({
        label, hint,
        app: !!p.notif[key].app, mail: !!p.notif[key].mail,
        appLabel: label + ': im Wiki', mailLabel: label + ': per E-Mail',
        toggleApp: () => setNotif(key, 'app'),
        toggleMail: () => setNotif(key, 'mail')
      })),
      digest: p.digest,
      onDigest: (e) => this.setPrefs({ digest: e.target.value }),
      openShortcuts: () => this.setState({ dialog: 'shortcuts' })
    };
  }
