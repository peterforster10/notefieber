  // ---------- Übersicht und „Neuer Space“ ----------
  overviewVals() {
    const s = this.state;
    const P = s.pages;
    const shown = (t) => t || 'Ohne Titel';
    const inTrash = (id) => s.trash.some((t) => t.id === id) || this.chain(id).some((x) => s.trash.some((t) => t.id === x));
    const restricted = (id) => this.chain(id).some((x) => s.grants[x]);
    const sub = (x) => [x, ...P[x].kids.flatMap(sub)];
    const hour = new Date().getHours();
    const cards = this.favFirst(Object.values(s.spaces), (x) => x.key).map((x) => {
      const role = this.role(x.home);
      const count = sub(x.home).length;
      const fav = s.favs.includes(x.key);
      return {
        fav,
        favPressed: fav ? 'true' : 'false',
        favLabel: fav ? '„' + x.name + '“ aus den Favoriten entfernen' : '„' + x.name + '“ als Favorit markieren',
        toggleFav: (e) => { this.stop(e); this.prevent(e); this.toggleFav(x.key); },
        key: x.key,
        name: x.name,
        badge: x.key.slice(0, 2),
        color: x.color || '#1F5FD6',
        description: x.description || 'Ohne Beschreibung',
        archived: x.archived,
        chip: x.archived ? 'Archiviert' : role ? ROLE_LABEL[role] : '–',
        chipCls: x.archived ? 'nf-chip-archived' : role === 'admin' ? 'nf-chip-admin' : '',
        tileCls: x.archived ? 'nf-archived' : '',
        sideCls: x.archived ? 'nf-side-archived' : '',
        meta: count + (count === 1 ? ' Seite' : ' Seiten') + ' · zuletzt geändert ' + (x.lastChange || 'gerade eben'),
        // „⋯“ in der linken Liste: Einstellungen, Link kopieren, Archivieren bzw. Zurückholen
        actionsLabel: 'Aktionen für ' + x.name,
        menuOpen: s.sideMenu === x.key,
        menuExpanded: s.sideMenu === x.key ? 'true' : 'false',
        moreCls: s.sideMenu === x.key ? 'nf-open' : '',
        toggleMenu: (e) => { this.stop(e); this.setState((st) => ({ sideMenu: st.sideMenu === x.key ? null : x.key, userMenu: false, settingsMenu: false })); },
        settings: () => this.openSpaceSettings(x.key),
        copyLink: () => {
          try { navigator.clipboard.writeText(location.origin + '/s/' + x.key.toLowerCase()).catch(() => {}); } catch (err) { /* nur Rückmeldung */ }
          this.setState({ sideMenu: null });
          this.showToast('Link kopiert');
        },
        archiveLabel: x.archived ? 'Zurückholen' : 'Archivieren',
        archivePopup: x.archived ? 'false' : 'dialog',
        archive: () => this.archiveFromMenu(x.key),
        go: (e) => { this.prevent(e); this.setState({ space: x.key, current: x.home, view: 'page', drawer: false }); }
      };
    });
    const excerpt = { dm: 'Jede Tabelle trägt tenant_id. Row Level Security trennt die Mandanten in der Datenbank selbst.' };
    // Seiten-Favoriten nach Space (Favoriten-Spaces zuerst); nur lesbare Seiten, nicht im Papierkorb
    const favGroups = this.favFirst(Object.values(s.spaces), (x) => x.key).map((x) => {
      const ids = (s.pageFavs[x.key] || []).filter((id) => P[id] && P[id].space === x.key && this.role(id) && !inTrash(id));
      if (!ids.length) return null;
      const MAX = 5;
      return {
        name: x.name, badge: x.key.slice(0, 2), color: x.color || '#1F5FD6',
        count: ids.length,
        goLabel: x.name + ' öffnen, ' + ids.length + (ids.length === 1 ? ' Favorit' : ' Favoriten'),
        go: (e) => { this.prevent(e); this.go(x.home); },
        hasMore: ids.length > MAX,
        moreLabel: '+ ' + (ids.length - MAX) + ' weitere in der Seitenleiste',
        items: ids.slice(0, MAX).map((id) => {
          const ch = this.chain(id).slice(1, -1);
          return {
            title: shown(P[id].title), titleCls: P[id].title ? '' : 'nf-untitled',
            icon: s.pageIcons[id] || '', hasIcon: !!s.pageIcons[id], noIcon: !s.pageIcons[id],
            restricted: restricted(id),
            path: ch.map((y) => shown(P[y].title)).join(' / '), hasPath: ch.length > 0,
            go: (e) => { this.prevent(e); this.go(id); },
            unfavLabel: '„' + shown(P[id].title) + '“ aus den Favoriten entfernen',
            unfav: (e) => { this.stop(e); this.toggleFavPage(id); }
          };
        })
      };
    }).filter(Boolean);
    const recent = ['dm', 'personal', 'kampagne', 'release'].filter((id) => P[id] && !inTrash(id)).map((id) => {
      const x = s.spaces[P[id].space];
      return {
        title: shown(P[id].title),
        spaceName: x.name,
        badge: x.key.slice(0, 2),
        color: x.color || '#1F5FD6',
        restricted: restricted(id),
        excerpt: excerpt[id] || P[id].text[0] || '',
        meta: PEOPLE[P[id].editor].name + ' · ' + P[id].when,
        go: (e) => { this.prevent(e); this.go(id); }
      };
    });
    const ACT = [
      { who: 'sophie', what: 'Bearbeitet', id: 'dm', when: 'vor 2 Min.' },
      { who: 'lukas', what: 'Kommentiert', id: 'dm', when: 'vor 40 Min.' },
      { who: 'max', what: 'Angelegt', id: 'kampagne', when: '3. Nov.' },
      { who: 'lukas', what: 'Bearbeitet', id: 'betrieb', when: '2. Nov.' },
      { who: 'peter', what: 'Rechte geändert', id: 'personal', when: '1. Nov.' }
    ];
    const activity = ACT.filter((a) => P[a.id] && !inTrash(a.id)).map((a) => ({
      who: a.who === 'peter' ? 'Du' : PEOPLE[a.who].name,
      color: PEOPLE[a.who].color,
      initials: initials(PEOPLE[a.who].name),
      title: shown(P[a.id].title),
      what: a.what,
      where: s.spaces[P[a.id].space].name,
      when: a.when,
      go: (e) => { this.prevent(e); this.go(a.id); }
    }));

    // Neuer Space: Schlüssel aus dem Namen vorschlagen, bis man ihn selbst ändert
    const ns = s.ns || { name: '', key: '', keyTouched: false, description: '', access: 'viewer' };
    const suggest = (name) => {
      const base = name.toUpperCase().replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ß/g, 'SS').replace(/[^A-Z0-9]/g, '').replace(/^[0-9]+/, '').slice(0, 4);
      if (!base || !s.spaces[base]) return base;
      for (let i = 2; i < 100; i++) if (!s.spaces[base + i]) return base + i; // belegt: ENTW → ENTW2
      return base;
    };
    const keyValid = /^[A-Z][A-Z0-9]{1,31}$/.test(ns.key);
    const keyTaken = !!s.spaces[ns.key];
    const setNs = (patch) => this.setState((st) => ({ ns: { ...(st.ns || ns), ...patch } }));
    return {
      greeting: (hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend') + ', Peter',
      spaceCount: cards.length,
      spaceCards: cards,
      // Linke Liste: „Favoriten“ (nur wenn es welche gibt) und „Spaces“ (die übrigen)
      sideGroups: [
        ...(cards.some((c) => c.fav) ? [{ label: 'Favorisierte Spaces', showNew: false, items: cards.filter((c) => c.fav) }] : []),
        { label: cards.some((c) => c.fav) ? 'Weitere Spaces' : 'Spaces', showNew: true, items: cards.filter((c) => !c.fav) }
      ],
      spaceCardsShown: cards.filter((c) => s.showArchived || !c.archived),
      showArchived: s.showArchived,
      toggleArchived: () => this.setState((st) => ({ showArchived: !st.showArchived })),
      recent,
      favGroups,
      favPageCount: favGroups.reduce((n, g) => n + g.count, 0),
      hasFavPages: favGroups.length > 0,
      favLead: favGroups.length ? 'Seiten, die du mit dem Stern markiert hast, nach Space. Markieren und entfernen über den Stern über einer Seite.' : 'Noch keine favorisierten Seiten.',
      hasFavGroups: favGroups.length > 0,
      noFavGroups: favGroups.length === 0,
      activity,
      openNewSpace: (e) => { this.stop(e); this.setState({ dialog: 'newSpace', ns: null, drawer: false }); this.focusLater('#ns-name'); },
      newSpaceOpen: s.dialog === 'newSpace',
      ns: {
        name: ns.name,
        key: ns.key,
        description: ns.description,
        access: ns.access,
        onName: (e) => { const v = e.target.value; setNs(ns.keyTouched ? { name: v } : { name: v, key: suggest(v) }); },
        onKey: (e) => setNs({ key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''), keyTouched: true }),
        onDescription: (e) => setNs({ description: e.target.value }),
        onAccess: (e) => setNs({ access: e.target.value }),
        keyHint: !ns.key ? 'Großbuchstaben und Ziffern, 2 bis 32 Zeichen, wie in Confluence. Er steht in den Adressen und bleibt fest.'
          : keyTaken ? 'Diesen Schlüssel gibt es schon.'
          : !keyValid ? 'Beginnt mit einem Buchstaben, 2 bis 32 Zeichen.'
          : 'Adresse: /s/' + ns.key.toLowerCase() + ' · bleibt fest',
        keyHintCls: ns.key && (keyTaken || !keyValid) ? 'nf-field-error' : 'nf-field-hint',
        submit: (e) => {
          this.prevent(e);
          const name = ns.name.trim();
          if (!name || !keyValid || keyTaken) { this.focusLater(!name ? '#ns-name' : '#ns-key'); return; }
          const home = 'home_' + ns.key.toLowerCase();
          const palette = ['#B45309', '#BE185D', '#1E5135', '#4D7C0F', '#0E7490', '#7C3AED'];
          this.setState((st) => ({
            spaces: { ...st.spaces, [ns.key]: { key: ns.key, name, description: ns.description.trim(), home, archived: false, color: palette[Object.keys(st.spaces).length % palette.length], lastChange: 'gerade eben' } },
            pages: { ...st.pages, [home]: pg(ns.key, name, null, [], 'peter', 'gerade eben', []) },
            grants: { ...st.grants, ['space:' + ns.key]: [{ key: 'peter', role: 'admin' }, ...(ns.access === 'none' ? [] : [{ key: 'ws', role: ns.access }])] },
            dialog: null, ns: null, space: ns.key, current: home, view: 'page'
          }));
          this.showToast('Space „' + name + '“ angelegt');
        }
      }
    };
  }

