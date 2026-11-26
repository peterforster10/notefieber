  // ---------- Kommentare ----------
  setThreads(pid, fn) {
    this.setState((st) => ({ threads: { ...st.threads, [pid]: fn(st.threads[pid] || []) } }));
  }
  /** Spalte öffnen und einen Thread aktiv machen; mit focusReply das Antwortfeld */
  openThread(id, { reply = false, tab } = {}) {
    this.setState((st) => ({ commentsOpen: true, activeThread: id, replying: reply ? id : st.replying, commentTab: tab || st.commentTab }));
    setTimeout(() => {
      const card = document.querySelector('.nf-thread[data-active="true"]');
      if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (reply) { const t = document.getElementById('nf-reply-' + id); if (t) t.focus(); }
    }, 60);
  }
  /** Markierte Textstellen nach dem Rendern: Klassen setzen (außer der festen in der Vorlage) und Sprechblasen messen */
  commentSync(pid) {
    setTimeout(() => {
      const art = document.querySelector('.nf-main-inner > article');
      const s = this.state;
      if (!art) { if (s.pins.length) this.setState({ pins: [] }); return; }
      const threads = s.threads[pid] || [];
      const ar = art.getBoundingClientRect();
      const pins = [];
      document.querySelectorAll('.nf-editor mark[data-thread]').forEach((m) => {
        const t = threads.find((x) => x.id === m.dataset.thread);
        const open = !!t && !t.resolved;
        if (!m.dataset.static) {
          m.classList.add('nf-comment-mark');
          m.classList.toggle('nf-on', open);
          m.classList.toggle('nf-active', open && s.activeThread === t.id && s.commentsOpen);
        }
        if (open && !pins.some((p) => p.id === t.id)) pins.push({ id: t.id, top: Math.round(m.getBoundingClientRect().top - ar.top), count: t.comments.length });
      });
      pins.sort((a, b) => a.top - b.top);
      for (let i = 1; i < pins.length; i++) if (pins[i].top < pins[i - 1].top + 30) pins[i].top = pins[i - 1].top + 30;
      const key = JSON.stringify(pins);
      if (key !== this._pinsKey) { this._pinsKey = key; this.setState({ pins }); }
    }, 0);
  }
  /** Markierung im bearbeitbaren Bereich entfernen (z. B. wenn ein neuer Kommentar verworfen wird) */
  unwrapMark(id) {
    document.querySelectorAll('.nf-editable mark[data-thread="' + id + '"]').forEach((m) => {
      while (m.firstChild) m.parentNode.insertBefore(m.firstChild, m);
      m.remove();
    });
    this.edSave();
  }
  /** Neuer Kommentar: aus einer Markierung (quote) oder zur Seite (ohne quote) */
  newThread(pid, quote, range, inEditable) {
    const id = 'c' + Date.now().toString(36);
    if (range && inEditable) {
      try {
        const m = document.createElement('mark');
        m.className = 'nf-comment-mark nf-on nf-active';
        m.dataset.thread = id;
        range.surroundContents(m);
        this.edSave();
      } catch (err) { /* über Blockgrenzen: Kommentar ohne Markierung, mit Zitat */ }
    }
    this.setThreads(pid, (list) => [...list, { id, quote: quote || '', resolved: false, comments: [] }]);
    this.openThread(id, { reply: true, tab: 'open' });
  }

  cmVals(pid, role, archived, isPage) {
    const s = this.state;
    const all = isPage ? (s.threads[pid] || []) : [];
    const canComment = isPage && !archived && !!role && role !== 'viewer';
    const open = all.filter((t) => !t.resolved);
    const resolved = all.filter((t) => t.resolved);
    const list = s.commentTab === 'resolved' ? resolved : open;
    const threads = list.map((t) => {
      const active = s.activeThread === t.id;
      const replyOpen = canComment && !t.resolved && (s.replying === t.id || t.comments.length === 0);
      const draft = s.replyDraft[t.id] || '';
      const isNew = t.comments.length === 0;
      const send = (e) => {
        this.prevent(e);
        const text = (this.state.replyDraft[t.id] || '').trim();
        if (!text) return;
        this.setThreads(pid, (l) => l.map((x) => (x.id === t.id ? { ...x, comments: [...x.comments, { who: 'peter', when: 'gerade eben', text }] } : x)));
        this.setState((st) => ({ replyDraft: { ...st.replyDraft, [t.id]: '' }, replying: null }));
        this.showToast(isNew ? 'Kommentar gespeichert' : 'Antwort gespeichert');
      };
      return {
        id: t.id,
        label: (t.quote ? 'Kommentar zu „' + t.quote + '“' : 'Kommentar zur Seite') + (t.resolved ? ', erledigt' : ''),
        quote: t.quote,
        hasQuote: !!t.quote,
        pageLevel: !t.quote,
        active: active ? 'true' : 'false',
        resolvedAttr: t.resolved ? 'true' : 'false',
        comments: t.comments.map((c) => ({
          name: c.who === 'peter' ? 'Peter Forster (du)' : PEOPLE[c.who].name,
          initials: initials(PEOPLE[c.who].name), color: PEOPLE[c.who].color, when: c.when, text: c.text
        })),
        replyOpen,
        replyId: 'nf-reply-' + t.id,
        replyLabel: isNew ? 'Kommentar schreiben' : 'Antwort schreiben',
        replyPlaceholder: isNew ? 'Kommentar schreiben … (@ erwähnt jemanden)' : 'Antworten …',
        draft,
        sendDisabled: !draft.trim(),
        sendLabel: isNew ? 'Kommentieren' : 'Antworten',
        onDraft: (e) => { const v = e.target.value; this.setState((st) => ({ replyDraft: { ...st.replyDraft, [t.id]: v } })); },
        replyKey: (e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(e);
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancelReply(pid, t); }
        },
        send,
        cancel: (e) => { this.stop(e); this.cancelReply(pid, t); },
        footer: !replyOpen && (canComment || t.resolved),
        canReply: canComment && !t.resolved,
        startReply: (e) => { this.stop(e); this.openThread(t.id, { reply: true }); },
        canResolve: canComment && !isNew,
        resolveLabel: t.resolved ? 'Wieder öffnen' : 'Erledigt',
        toggleResolved: (e) => {
          this.stop(e);
          this.setThreads(pid, (l) => l.map((x) => (x.id === t.id ? { ...x, resolved: !x.resolved } : x)));
          this.setState({ activeThread: null, replying: null });
          this.showToast(t.resolved ? 'Wieder geöffnet' : 'Als erledigt markiert');
        },
        activate: () => { if (s.activeThread !== t.id) this.setState({ activeThread: t.id }); },
        jump: (e) => {
          this.stop(e);
          this.setState({ activeThread: t.id });
          const m = document.querySelector('.nf-editor mark[data-thread="' + t.id + '"]');
          if (m) m.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      };
    });
    if (isPage) this.commentSync(pid);
    const openCount = open.length;
    return {
      canComment,
      tabOpen: s.commentTab === 'open' ? 'true' : 'false',
      tabResolved: s.commentTab === 'resolved' ? 'true' : 'false',
      openCount, resolvedCount: resolved.length,
      showOpen: () => this.setState({ commentTab: 'open' }),
      showResolved: () => this.setState({ commentTab: 'resolved', replying: null }),
      threads,
      empty: threads.length === 0,
      emptyTitle: s.commentTab === 'resolved' ? 'Nichts erledigt' : openCount + resolved.length === 0 ? 'Noch keine Kommentare' : 'Keine offenen Kommentare',
      emptyText: s.commentTab === 'resolved'
        ? 'Erledigte Threads landen hier und lassen sich wieder öffnen.'
        : canComment ? 'Markiere Text und wähle „Kommentieren“ oder schreib unten einen Kommentar zur ganzen Seite.' : 'Mit deiner Rolle kannst du Kommentare lesen, aber keine schreiben.',
      newPageComment: () => this.newThread(pid, '', null, false),
      // Nur im Reiter „Offen“ und solange kein neuer Kommentar zur Seite gerade geschrieben wird
      showPageComposer: canComment && s.commentTab === 'open' && !open.some((t) => !t.quote && t.comments.length === 0),
      pins: s.pins.map((p) => ({
        top: p.top, count: p.count, active: s.commentsOpen && s.activeThread === p.id ? 'true' : 'false',
        label: p.count + (p.count === 1 ? ' Kommentar' : ' Kommentare') + ' an dieser Stelle',
        open: () => this.openThread(p.id, { tab: 'open' })
      })),
      onEditorClick: (e) => {
        const m = e.target.closest && e.target.closest('mark[data-thread]');
        if (!m) return;
        const t = all.find((x) => x.id === m.dataset.thread);
        if (t && !t.resolved) this.openThread(t.id, { tab: 'open' });
      },
      onKey: (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { this.stop(e); this.setState({ commentsOpen: false, activeThread: null }); } },
      // Für den Knopf in der Leiste
      openCountForButton: openCount
    };
  }
  cancelReply(pid, t) {
    if (t.comments.length === 0) {
      this.setThreads(pid, (l) => l.filter((x) => x.id !== t.id));
      this.unwrapMark(t.id);
      this.setState({ activeThread: null, replying: null });
    } else {
      this.setState((st) => ({ replying: null, replyDraft: { ...st.replyDraft, [t.id]: '' } }));
    }
  }

