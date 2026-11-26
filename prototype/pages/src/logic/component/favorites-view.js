  // ---------- Favoriten (Ausblick): eigene Ansicht mit Seiten als Karten oder Liste und favorisierten Spaces ----------
  favoritesVals() {
    const s = this.state, P = s.pages;
    const shown = (t) => t || 'Ohne Titel';
    const trashed = new Set(s.trash.map((t) => t.id));
    const visible = (id) => P[id] && this.role(id) && !this.chain(id).some((x) => trashed.has(x));
    const spaces = this.favFirst(Object.values(s.spaces), (x) => x.key);
    const all = [];
    spaces.forEach((sp) => (s.pageFavs[sp.key] || []).forEach((id) => { if (visible(id) && P[id].space === sp.key) all.push(id); }));
    const q = (s.favQ || '').trim();
    const words = fold(q).split(/\s+/).filter(Boolean);
    const ids = all.filter((id) => words.every((w) => fold(shown(P[id].title) + ' ' + this.excerptOf(id) + ' ' + s.spaces[P[id].space].name).includes(w)));
    const item = (id) => {
      const p = P[id], sp = s.spaces[p.space], ed = PEOPLE[p.editor];
      const ch = this.chain(id).slice(1, -1);
      const excerpt = this.excerptOf(id);
      return {
        title: shown(p.title), titleCls: p.title ? '' : 'nf-untitled',
        icon: s.pageIcons[id] || '', hasIcon: !!s.pageIcons[id], noIcon: !s.pageIcons[id],
        restricted: this.chain(id).some((x) => s.grants[x]),
        excerpt, hasExcerpt: !!excerpt,
        spaceName: sp.name, spaceBadge: sp.key.slice(0, 2), spaceColor: sp.color || '#1F5FD6',
        path: ch.map((y) => shown(P[y].title)).join(' / '), hasPath: ch.length > 0,
        editorColor: ed.color, editorInitials: initials(ed.name),
        meta: ed.name + ' · ' + p.when,
        go: (e) => { this.prevent(e); this.go(id); },
        unfavLabel: '„' + shown(p.title) + '“ aus den Favoriten entfernen',
        unfav: (e) => { this.stop(e); this.toggleFavPage(id); }
      };
    };
    const grouped = !!s.favGroup;
    const groups = grouped
      ? spaces.map((sp) => {
        const list = ids.filter((id) => P[id].space === sp.key);
        return {
          hasHead: true, name: sp.name, badge: sp.key.slice(0, 2), color: sp.color || '#1F5FD6', count: list.length,
          goLabel: sp.name + ' öffnen',
          go: (e) => { this.prevent(e); this.go(sp.home); },
          items: list.map(item)
        };
      }).filter((g) => g.items.length)
      : [{ hasHead: false, items: ids.slice().sort((a, b) => shown(P[a].title).localeCompare(shown(P[b].title), 'de')).map(item) }].filter((g) => g.items.length);
    const sub = (x) => [x, ...P[x].kids.flatMap(sub)];
    const favSpaces = spaces.filter((x) => s.favs.includes(x.key)).map((x) => {
      const n = sub(x.home).filter((id) => !trashed.has(id)).length;
      const role = this.role(x.home);
      return {
        name: x.name, badge: x.key.slice(0, 2), color: x.color || '#1F5FD6',
        description: x.description || 'Ohne Beschreibung',
        meta: n + (n === 1 ? ' Seite' : ' Seiten') + (x.archived ? ' · archiviert' : role ? ' · ' + ROLE_LABEL[role] : ''),
        go: (e) => { this.prevent(e); this.go(x.home); },
        unfavLabel: '„' + x.name + '“ aus den Favoriten entfernen',
        unfav: (e) => { this.stop(e); this.prevent(e); this.toggleFav(x.key); }
      };
    });
    const setView = (v) => {
      try { localStorage.setItem('nf-proto-favview', v); } catch (err) { /* nur diese Sitzung */ }
      this.setState({ favView: v });
    };
    const cards = s.favView !== 'list';
    return {
      lead: all.length || favSpaces.length
        ? 'Was du mit dem Stern markiert hast: ' + all.length + (all.length === 1 ? ' Seite' : ' Seiten') + ' und ' + favSpaces.length + (favSpaces.length === 1 ? ' Space.' : ' Spaces.')
        : 'Markiere Seiten und Spaces mit dem Stern, dann stehen sie hier.',
      q: s.favQ || '',
      onQ: (e) => this.setState({ favQ: e.target.value }),
      grouped,
      toggleGroup: () => this.setState({ favGroup: !grouped }),
      cards, list: !cards,
      cardsPressed: cards ? 'true' : 'false', listPressed: cards ? 'false' : 'true',
      showCards: () => setView('cards'), showList: () => setView('list'),
      pageCount: ids.length,
      groups,
      hasPages: ids.length > 0,
      noPages: ids.length === 0,
      emptyTitle: q ? 'Keine Treffer' : 'Noch keine Seiten',
      emptyText: q ? 'Keine favorisierte Seite passt zu „' + q + '“.' : 'Markiere eine Seite mit dem Stern oben rechts über der Seite, dann steht sie hier und in der Seitenleiste ihres Spaces.',
      spaces: favSpaces,
      spaceCount: favSpaces.length,
      hasSpaces: favSpaces.length > 0,
      spacesCards: favSpaces.length > 0 && cards,
      spacesList: favSpaces.length > 0 && !cards,
      noSpaces: favSpaces.length === 0
    };
  }
