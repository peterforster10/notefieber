  // ---------- Reaktionen (Ausblick) ----------
  reactionVals(pid, myRole, archived) {
    const s = this.state;
    const mine = s.reactions[pid] || {};
    const canReact = !archived && !!myRole && RANK[myRole] >= RANK.commenter;
    const label = Object.fromEntries(REACTIONS);
    const toggle = (emoji) => this.setState((st) => {
      const cur = { ...(st.reactions[pid] || {}) };
      const who = cur[emoji] || [];
      const next = who.includes('peter') ? who.filter((k) => k !== 'peter') : [...who, 'peter'];
      if (next.length) cur[emoji] = next; else delete cur[emoji];
      return { reactions: { ...st.reactions, [pid]: cur }, reactPicker: false };
    });
    const names = (who) => {
      const list = who.filter((k) => k !== 'peter').map((k) => PEOPLE[k].name);
      if (who.includes('peter')) list.push('du');
      return list.length > 1 ? list.slice(0, -1).join(', ') + ' und ' + list[list.length - 1] : list[0];
    };
    const items = REACTIONS.filter(([e]) => (mine[e] || []).length).map(([emoji, name]) => {
      const who = mine[emoji];
      const pressed = who.includes('peter');
      return {
        emoji, count: who.length,
        pressed: pressed ? 'true' : 'false',
        title: names(who) + ' ' + (who.length === 1 && !pressed ? 'hat' : 'haben') + ' mit ' + emoji + ' reagiert',
        aria: name + ', ' + who.length + (who.length === 1 ? ' Reaktion' : ' Reaktionen') + (pressed ? ', auch von dir. Zurücknehmen' : ''),
        toggle: () => canReact && toggle(emoji)
      };
    });
    return {
      items,
      canReact,
      locked: !canReact,
      pickerOpen: !!s.reactPicker,
      expanded: s.reactPicker ? 'true' : 'false',
      togglePicker: (e) => {
        this.stop(e);
        const open = !s.reactPicker;
        this.setState({ reactPicker: open, notifOpen: false, userMenu: false, settingsMenu: false, menu: null, spaceMenu: false, spaceSub: null, pageMenu: false });
        if (open) this.focusLater('.nf-reaction-choice');
      },
      keep: (e) => e.stopPropagation(),
      choices: REACTIONS.map(([emoji, name]) => ({
        emoji, label: name + ((mine[emoji] || []).includes('peter') ? ' (zurücknehmen)' : ''),
        pressed: (mine[emoji] || []).includes('peter') ? 'true' : 'false',
        choose: () => { toggle(emoji); this.focusLater('.nf-reaction-add'); }
      }))
    };
  }
