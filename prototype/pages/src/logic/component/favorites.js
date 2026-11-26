  /** Space als Favorit markieren oder nicht mehr */
  toggleFav(key) {
    const favs = this.state.favs;
    const on = !favs.includes(key);
    const next = on ? [...favs, key] : favs.filter((k) => k !== key);
    try { localStorage.setItem('nf-proto-favs', JSON.stringify(next)); } catch (err) { /* nur diese Sitzung */ }
    this.setState({ favs: next, sideMenu: null, spaceSub: null });
    this.showToast('„' + this.state.spaces[key].name + '“ ' + (on ? 'zu den Favoriten hinzugefügt' : 'aus den Favoriten entfernt'));
  }
  /** Seite als Favorit ihres Spaces markieren oder nicht mehr */
  toggleFavPage(id) {
    const P = this.state.pages;
    const key = P[id].space;
    const list = this.state.pageFavs[key] || [];
    const on = !list.includes(id);
    const next = { ...this.state.pageFavs, [key]: on ? [...list, id] : list.filter((x) => x !== id) };
    try { localStorage.setItem('nf-proto-page-favs', JSON.stringify(next)); } catch (err) { /* nur diese Sitzung */ }
    this.setState({ pageFavs: next, menu: null, pageFavsOpen: on ? true : this.state.pageFavsOpen });
    this.showToast('„' + (P[id].title || 'Ohne Titel') + '“ ' + (on ? 'zu den Favoriten hinzugefügt' : 'aus den Favoriten entfernt'));
  }
  /** Favoriten zuerst, sonst Reihenfolge wie bisher (nach Name) */
  favFirst(list, keyOf) {
    const favs = this.state.favs;
    return [...list].sort((a, b) => (favs.includes(keyOf(b)) ? 1 : 0) - (favs.includes(keyOf(a)) ? 1 : 0));
  }

  /** Archivieren aus einem Menü: mit Rückfrage; Zurückholen sofort (umkehrbar) */
  archiveFromMenu(key) {
    const x = this.state.spaces[key];
    const closed = { sideMenu: null, spaceMenu: false, spaceSub: null };
    if (x.archived) {
      this.setState((st) => ({ ...closed, spaces: { ...st.spaces, [key]: { ...st.spaces[key], archived: false } } }));
      this.showToast('„' + x.name + '“ zurückgeholt');
    } else {
      this.setState({ ...closed, dialog: 'confirm', confirm: { kind: 'archive', key } });
      this.focusLater('#nf-confirm-cancel');
    }
  }

