  constructor(props) {
    super(props);
    this.state = {
      space: 'ENTW',
      // Mit #uebersicht in der Adresse startet der Prototyp in der Übersicht
      view: typeof location === 'undefined' ? 'page' : location.hash === '#uebersicht' ? 'overview' : location.hash === '#import' ? 'import' : location.hash === '#favoriten' ? 'favorites' : 'page',
      current: 'dm',
      expanded: { arch: true, betrieb: true },
      pages: JSON.parse(JSON.stringify(PAGES)),
      spaces: JSON.parse(JSON.stringify(SPACES)),
      grants: JSON.parse(JSON.stringify(GRANTS)),
      // Papierkorb: wer wann gelöscht hat und wie viele Tage bis zum endgültigen Löschen bleiben
      trash: [
        { id: 'notizen', index: 3, by: 'lukas', when: 'am 12. November', daysLeft: 17 },
        { id: 'skizzen', index: 2, by: 'sophie', when: 'am 30. Oktober', daysLeft: 4 }
      ],
      trashQ: '',
      trashKids: {},
      trashOpen: false,
      menu: null,
      spaceMenu: false,
      spaceSub: null,
      renaming: null,
      draft: '',
      dialog: null,
      confirm: null,
      rightsDraft: null,
      // Kommentare: Spalte standardmäßig zu; Threads pro Seite (quote = markierte Stelle, ohne = zur Seite)
      commentsOpen: false,
      // Versionen: offene Ansicht (pid, gewählte Version, Vergleich), neue Versionen und wiederhergestellter Inhalt (nur diese Sitzung)
      versions: null,
      vextra: {},
      restoredBody: {},
      vName: '',
      // Benachrichtigungen (Glocke oben rechts)
      notifs: NOTIFS.map((n) => ({ ...n })),
      notifOpen: false,
      // Vorlagen: Liste (mitgeliefert und eigene), Suche, Filter, Zielseite beim Einfügen, offene Dialoge
      templates: TEMPLATES.map((t) => ({ ...t })),
      tplQ: '',
      tplFilter: 'all',
      tplTarget: null,
      tplUse: null,
      tplSaveDraft: null,
      // Favoriten-Ansicht: Suche, nach Space gruppieren, Karten oder Liste (gemerkt im Browser)
      favQ: '',
      favGroup: false,
      favView: (() => { try { return localStorage.getItem('nf-proto-favview') === 'list' ? 'list' : 'cards'; } catch (err) { return 'cards'; } })(),
      // Confluence-Import: Schritt (1 Hochladen, 2 Probelauf, 3 läuft, 4 fertig), Ziel, Zuordnungen, angelegte Seiten
      imp: { step: 1, space: 'ENTW', file: false, groups: { users: 'ws', team: 'grp', admins: '', extern: 'skip' }, invite: true, progress: 0, phase: 0, created: null },
      // Reaktionen pro Seite: Emoji → Personen (Reihenfolge wie REACTIONS)
      reactions: { dm: { '👍': ['sophie', 'lukas', 'markus'], '🎉': ['lukas'] }, home: { '👍': ['max', 'elena'], '❤️': ['sophie'] }, arch: { '👀': ['markus'] } },
      reactPicker: false,
      // Emoji und Titelbild pro Seite; offenes Auswahlfenster ({ pid, kind: 'emoji' | 'cover' })
      pageIcons: { dm: '🗂️', release: '🚀', backup: '💾', personal: '👥' },
      covers: { home: { kind: 'preset', key: 'blau' } },
      lookPop: null,
      emojiQ: '',
      notifFilter: 'all',
      // Unterseiten im Fuß als Karten oder Liste (pro Person; im Prototyp im Browser gemerkt)
      subView: (() => { try { return localStorage.getItem('nf-proto-subview') === 'list' ? 'list' : 'cards'; } catch (err) { return 'cards'; } })(),
      threads: {
        dm: [
          { id: 't1', quote: 'Jede Tabelle trägt tenant_id', resolved: false, comments: [
            { who: 'sophie', when: 'vor 1 Std.', text: 'Gilt das auch für page_links? Dort hängen zwei Seiten dran.' },
            { who: 'lukas', when: 'vor 40 Min.', text: 'Ja, ergänzt. Der Schematest prüft jetzt alle Tabellen.' }
          ] },
          { id: 't2', quote: '', resolved: false, comments: [
            { who: 'markus', when: 'gestern', text: 'Sollten files und comments nicht auch in die Liste der Kerntabellen?' },
            { who: 'sophie', when: 'vor 12 Min.', text: '@Peter Forster, nimmst du files und comments mit in die Liste?' }
          ] },
          { id: 't3', quote: '', resolved: true, comments: [
            { who: 'lukas', when: 'am 30. Oktober', text: 'Bitte das Rechte-Konzept verlinken.' },
            { who: 'sophie', when: 'am 30. Oktober', text: 'Ist drin, ganz unten.' }
          ] }
        ],
        rechte: [
          { id: 't4', quote: '', resolved: false, comments: [
            { who: 'sophie', when: 'am 21. November', text: 'Gilt die Kappung auch für Unterseiten, die später dazukommen?' }
          ] }
        ]
      },
      activeThread: null,
      commentTab: 'open',
      replying: null,
      replyDraft: {},
      pins: [],
      tasks: { t1: true, t2: false },
      callouts: { dm: 'info', home: 'note' },
      drawer: false,
      settingsDraft: null,
      saved: false,
      seq: 1,
      showArchived: false,
      // Seiten-Favoriten pro Space (Seiten-IDs in der Reihenfolge des Markierens), pro Person; im Prototyp im Browser
      pageFavs: (() => { try { const v = JSON.parse(localStorage.getItem('nf-proto-page-favs')); return v && typeof v === 'object' ? v : { ENTW: ['dm', 'backup'], VERT: ['kampagne'] }; } catch (err) { return { ENTW: ['dm', 'backup'], VERT: ['kampagne'] }; } })(),
      pageFavsOpen: (() => { try { return localStorage.getItem('nf-proto-page-favs-open') !== 'false'; } catch (err) { return true; } })(),
      // Favoriten (Space-Schlüssel), pro Person; im Prototyp im Browser gemerkt
      favs: (() => { try { const v = JSON.parse(localStorage.getItem('nf-proto-favs')); return Array.isArray(v) ? v : ['ENTW']; } catch (err) { return ['ENTW']; } })(),
      ns: null,
      // Darstellung: 'light' | 'dark' | 'system'; im Browser gemerkt (nur Komfort, darf fehlen)
      theme: (() => { try { return localStorage.getItem('nf-proto-theme') || 'light'; } catch (e) { return 'light'; } })(),
      osDark: typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
      save: 'saved',
      online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
      toast: null,
      moveTarget: null,
      wsName: 'Alpenwerk',
      wsDraft: null,
      members: MEMBERS.map((m) => ({ ...m })),
      invites: INVITES.map((i) => ({ ...i })),
      inviteEmail: '',
      inviteRole: 'member',
      inviteLink: null,
      inviteCopied: false
    };
    // „System“ folgt einem Wechsel im Betriebssystem auch bei offener Seite
    if (typeof matchMedia === 'function') {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => this.setState({ osDark: mq.matches });
      if (mq.addEventListener) mq.addEventListener('change', onChange);
    }
    // Offline wie im Frontend erkennen (im Browser z. B. über die Entwicklerwerkzeuge auslösen)
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.setState({ online: true }));
      window.addEventListener('offline', () => this.setState({ online: false }));
    }
    // Editor: Entwürfe pro Seite, Formatleiste und Platzhalter folgen der Auswahl
    this._drafts = {};
    // Laden: Seiten und Spaces, die in dieser Sitzung schon geladen sind (danach aus dem Zwischenspeicher)
    this._loaded = new Set();
    this._loadedSpaces = new Set();
    this._timers = {};
    // Dialoge: Fokus merken (für die Rückgabe) und im offenen Dialog halten
    document.addEventListener('focusin', (e) => { if (!e.target.closest || !e.target.closest('.nf-overlay, .nf-cmd-overlay')) this._lastFocus = e.target; });
    document.addEventListener('click', (e) => {
      if (!e.target.closest) return;
      const t = e.target.closest('[aria-haspopup="menu"]');
      if (t) this._menuTrigger = t;
      // Auslöser auch ohne Fokus-Ereignis merken (z. B. Klick in einem Fenster ohne Fokus)
      const c = e.target.closest('button, a[href], [tabindex]');
      if (c && !c.closest('.nf-overlay, .nf-cmd-overlay')) this._lastFocus = c;
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const dlg = this.topDialog();
      if (!dlg) return;
      const f = this.focusablesIn(dlg);
      if (!f.length) { e.preventDefault(); return; }
      const i = f.indexOf(document.activeElement);
      if (i < 0) { e.preventDefault(); (e.shiftKey ? f[f.length - 1] : f[0]).focus(); }
      else if (e.shiftKey && i === 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }, true);
    this.state.ed = { slash: null, picker: null, bar: null, side: null, blockMenu: null, drop: null };
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (err) { /* älterer Browser */ }
    document.addEventListener('selectionchange', () => {
      if (this._selRaf) return;
      this._selRaf = setTimeout(() => { this._selRaf = null; this.edUpdatePlaceholder(); this.edUpdateBar(); }, 16);
    });
    window.addEventListener('scroll', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('.nf-slash,.nf-cmd-list')) return;
      const ed = this.state.ed;
      if (ed.slash || ed.picker) this.setEd({ slash: null, picker: null });
      if (ed.bar) { this.setEd({ bar: null }); this.edUpdateBar(); }
    }, true);
  }

