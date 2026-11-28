  // ---------- Benachrichtigungen (Ausblick, E16) ----------
  notifVals() {
    const s = this.state, P = s.pages;
    // Arten, die in den persönlichen Einstellungen für „Im Wiki“ abgeschaltet sind, fehlen
    const allowed = (n) => !s.prefs.notif[n.kind] || s.prefs.notif[n.kind].app;
    const visible = s.notifs.filter((n) => allowed(n) && P[n.page] && this.role(n.page) && !s.trash.some((t) => this.chain(n.page).includes(t.id)));
    const unread = visible.filter((n) => n.unread).length;
    const list = s.notifFilter === 'unread' ? visible.filter((n) => n.unread) : visible;
    const markRead = (ids) => this.setState((st) => ({ notifs: st.notifs.map((n) => (ids.includes(n.id) ? { ...n, unread: false } : n)) }));
    return {
      open: !!s.notifOpen,
      expanded: s.notifOpen ? 'true' : 'false',
      label: 'Benachrichtigungen' + (unread ? ', ' + unread + ' ungelesen' : ''),
      unread, hasUnread: unread > 0, noneUnread: unread === 0,
      toggle: (e) => {
        this.stop(e);
        const open = !s.notifOpen;
        this.setState({ notifOpen: open, userMenu: false, settingsMenu: false, menu: null, spaceMenu: false, spaceSub: null, pageMenu: false });
        if (open) this.focusLater('.nf-notif');
      },
      keep: (e) => e.stopPropagation(),
      tabAll: s.notifFilter !== 'unread' ? 'true' : 'false',
      tabUnread: s.notifFilter === 'unread' ? 'true' : 'false',
      showAll: () => this.setState({ notifFilter: 'all' }),
      showUnread: () => this.setState({ notifFilter: 'unread' }),
      readAll: () => markRead(visible.map((n) => n.id)),
      hasItems: list.length > 0,
      empty: list.length === 0,
      emptyTitle: s.notifFilter === 'unread' ? 'Alles gelesen' : 'Keine Benachrichtigungen',
      items: list.map((n) => {
        const who = PEOPLE[n.who];
        const target = P[n.page].title || 'Ohne Titel';
        return {
          kind: n.kind, isMention: n.kind === 'mention', isReply: n.kind === 'reply', isShare: n.kind === 'share', isComment: n.kind === 'comment',
          who: who.name, color: who.color, initials: initials(who.name),
          pre: n.pre, target, post: n.post,
          snippet: n.snippet, hasSnippet: !!n.snippet,
          space: s.spaces[P[n.page].space].name, when: n.when,
          role: n.role || '', hasRole: !!n.role,
          unread: n.unread, unreadAttr: n.unread ? 'true' : 'false',
          aria: (n.unread ? 'Ungelesen: ' : '') + who.name + ' ' + n.pre + ' „' + target + '“ ' + n.post + ', ' + n.when,
          open: () => {
            markRead([n.id]);
            this.setState({ notifOpen: false });
            this.go(n.page);
            if (n.thread) setTimeout(() => this.openThread(n.thread, { tab: 'open' }), 0);
          }
        };
      }),
      settings: () => this.openUserSettings('us-notif')
    };
  }
