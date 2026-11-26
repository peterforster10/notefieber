  // ---------- Emoji und Titelbild (Ausblick) ----------
  lookVals(pid, editable) {
    const s = this.state;
    const icon = s.pageIcons[pid] || '';
    const cover = s.covers[pid] || null;
    const pop = s.lookPop && s.lookPop.pid === pid ? s.lookPop.kind : null;
    const names = Object.fromEntries(EMOJIS);
    const iconName = icon ? (names[icon] || 'Emoji').split(' ')[0] : '';
    const preset = cover && cover.kind === 'preset' ? COVERS.find((c) => c[0] === cover.key) : null;
    const coverBg = preset ? preset[2] : cover ? 'url("' + cover.url + '")' : '';
    const words = fold((s.emojiQ || '').trim()).split(/\s+/).filter(Boolean);
    const emojis = EMOJIS.filter(([, n]) => words.every((w) => fold(n).includes(w)));
    const closeOthers = { notifOpen: false, userMenu: false, settingsMenu: false, menu: null, spaceMenu: false, spaceSub: null, pageMenu: false, reactPicker: false };
    const open = (kind) => (e) => {
      this.stop(e);
      const on = pop !== kind;
      this.setState({ ...closeOthers, lookPop: on ? { pid, kind } : null, emojiQ: '' });
      if (on) this.focusLater(kind === 'emoji' ? '#nf-emoji-q' : '.nf-cover-choice');
    };
    const setIcon = (v) => { this.setState((st) => ({ pageIcons: { ...st.pageIcons, [pid]: v }, lookPop: null })); this.markSaving(); };
    const setCover = (v) => { this.setState((st) => ({ covers: { ...st.covers, [pid]: v }, lookPop: null })); this.markSaving(); };
    return {
      canEdit: editable,
      icon, hasIcon: !!icon, noIcon: !icon,
      editIcon: !!icon && editable, showIcon: !!icon && !editable,
      iconName, iconLabel: 'Emoji der Seite: ' + iconName + '. Ändern',
      hasCover: !!cover, noCover: !cover, coverBg,
      coverLabel: preset ? 'Titelbild: ' + preset[1] : 'Titelbild',
      emojiOpen: pop === 'emoji', coverOpen: pop === 'cover',
      emojiExpanded: pop === 'emoji' ? 'true' : 'false', coverExpanded: pop === 'cover' ? 'true' : 'false',
      openEmoji: open('emoji'), openCover: open('cover'),
      keep: (e) => e.stopPropagation(),
      emojiQ: s.emojiQ || '',
      onEmojiQ: (e) => this.setState({ emojiQ: e.target.value }),
      emojiEmpty: emojis.length === 0,
      emojis: emojis.map(([emoji, name]) => ({
        emoji, name: name.split(' ')[0],
        pressed: emoji === icon ? 'true' : 'false',
        choose: () => { setIcon(emoji); this.focusLater('.nf-page-emoji'); }
      })),
      // Pfeiltasten im Raster (8 Spalten), Enter wählt
      gridKey: (e) => {
        const all = [...document.querySelectorAll('.nf-emoji-choice')];
        const i = all.indexOf(document.activeElement);
        const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 }[e.key];
        if (e.key === 'ArrowDown' && e.target.id === 'nf-emoji-q' && all[0]) { this.prevent(e); all[0].focus(); return; }
        if (i < 0 || !step) return;
        this.prevent(e);
        const n = i + step;
        if (n < 0) { const q = document.getElementById('nf-emoji-q'); if (q) q.focus(); return; }
        if (all[n]) all[n].focus();
      },
      removeIcon: () => { setIcon(''); this.focusLater('.nf-title-tool'); },
      covers: COVERS.map(([key, name, bg]) => ({
        name, bg,
        pressed: preset && preset[0] === key ? 'true' : 'false',
        choose: () => setCover({ kind: 'preset', key })
      })),
      pickFile: () => { const f = document.getElementById('nf-cover-file'); if (f) f.click(); },
      onUpload: (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { this.showToast('Nur PNG, JPEG, GIF oder WebP'); return; }
        // Im Prototyp nur im Browser (blob:); im Frontend über POST /pages/:id/files wie Bilder im Text
        setCover({ kind: 'image', url: URL.createObjectURL(file) });
      },
      removeCover: () => { setCover(null); this.focusLater('.nf-title-tool'); }
    };
  }
