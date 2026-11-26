  // ---------- Fuß der Seite (Prototyp) ----------
  // Anfang des Inhalts einer Seite (Karten und Liste der Unterseiten)
  excerptOf(id) {
    const s = this.state, p = s.pages[id];
    const first = (blocks) => { const b = blocks.find((x) => x.t === 'p' && x.text); return b ? b.text : ''; };
    let text = s.restoredBody[id] ? first(s.restoredBody[id])
      : p.body === 'dm' ? first(DM_VERSIONS[DM_VERSIONS.length - 1].blocks)
      : p.body === 'home' ? first(HOME_BLOCKS)
      : p.text[0] || '';
    if (!text && this._drafts[id]) { const d = document.createElement('div'); d.innerHTML = this._drafts[id]; text = d.textContent.trim(); }
    return text.length > 160 ? text.slice(0, 157).trimEnd() + ' …' : text;
  }
  footVals(pid, editable, sp, homeId) {
    const s = this.state, P = s.pages;
    const shown = (t) => t || 'Ohne Titel';
    const trashed = new Set(s.trash.map((t) => t.id));
    const visible = (id) => P[id] && this.role(id) && !this.chain(id).some((x) => trashed.has(x));
    const kids = P[pid].kids.filter(visible).map((id) => {
      const k = P[id];
      const ed = PEOPLE[k.editor];
      const n = k.kids.filter(visible).length;
      const excerpt = this.excerptOf(id);
      return {
        title: shown(k.title), titleCls: k.title ? '' : 'nf-untitled',
        icon: s.pageIcons[id] || '', hasIcon: !!s.pageIcons[id], noIcon: !s.pageIcons[id],
        restricted: !!s.grants[id],
        excerpt, hasExcerpt: !!excerpt,
        color: ed.color, initials: initials(ed.name),
        meta: ed.name + ' · ' + k.when,
        hasKids: n > 0, kidsLabel: n + (n === 1 ? ' Unterseite' : ' Unterseiten'),
        go: (e) => { this.prevent(e); this.go(id); }
      };
    });
    // Rückverweise: feste Seitenlinks aus LINKS und Seitenlinks, die in dieser Sitzung im Editor eingefügt wurden
    const sources = new Map();
    Object.keys(LINKS).forEach((src) => { if (LINKS[src].includes(pid)) sources.set(src, LINK_CTX[src + '>' + pid] || ''); });
    Object.entries(this._drafts || {}).forEach(([src, html]) => {
      if (src === pid || !html || html.indexOf('data-page-id="' + pid + '"') < 0) return;
      const d = document.createElement('div');
      d.innerHTML = html;
      const a = d.querySelector('[data-page-id="' + pid + '"]');
      const block = a && (a.closest('p,li,h1,h2,h3,blockquote,div') || a);
      if (!sources.has(src)) sources.set(src, block ? block.textContent.replace(/\s+/g, ' ').trim() : '');
    });
    const target = shown(P[pid].title);
    const links = [...sources.entries()].filter(([src]) => visible(src)).map(([src, ctx]) => {
      const i = ctx.indexOf(target);
      const ch = this.chain(src);
      return {
        title: src === s.spaces[P[src].space].home ? 'Startseite' : shown(P[src].title),
        restricted: ch.some((x) => s.grants[x]),
        path: src === s.spaces[P[src].space].home ? s.spaces[P[src].space].name : ch.slice(0, -1).map((x) => shown(P[x].title)).join(' / '),
        hasSnippet: !!ctx,
        pre: i >= 0 ? ctx.slice(0, i) : ctx, hit: i >= 0 ? target : '', post: i >= 0 ? ctx.slice(i + target.length) : '',
        go: (e) => { this.prevent(e); this.go(src); }
      };
    });
    const setView = (v) => {
      try { localStorage.setItem('nf-proto-subview', v); } catch (err) { /* nur diese Sitzung */ }
      this.setState({ subView: v });
    };
    const canCreate = editable && !sp.archived;
    return {
      show: kids.length > 0 || links.length > 0 || canCreate,
      hasKids: kids.length > 0,
      kidCount: kids.length,
      kids,
      cards: s.subView !== 'list', list: s.subView === 'list',
      cardsPressed: s.subView !== 'list' ? 'true' : 'false', listPressed: s.subView === 'list' ? 'true' : 'false',
      showCards: () => setView('cards'), showList: () => setView('list'),
      canCreate,
      onlyCreate: canCreate && kids.length === 0,
      create: () => this.createPage(pid),
      hasLinks: links.length > 0,
      linkCount: links.length,
      links
    };
  }
