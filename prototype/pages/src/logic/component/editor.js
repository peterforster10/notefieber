  // ---------- Editor (Prototyp) ----------
  // Der bearbeitbare Bereich gehört nicht React: Sein Inhalt wird direkt im DOM bearbeitet und pro Seite
  // in this._drafts gemerkt. React verwaltet nur die schwebenden Elemente (Menüs, Leiste) über state.ed.
  setEd(patch) { this.setState((st) => ({ ed: { ...st.ed, ...patch } })); }
  edEl() { return document.getElementById('nf-editable'); }
  edSave() { const el = this.edEl(); if (el && this._edPid) this._drafts[this._edPid] = el.innerHTML; }
  edSync(pid) {
    setTimeout(() => {
      const el = this.edEl();
      if (!el) { this._edPid = null; this._edElRef = null; return; }
      if (this._edPid !== pid || this._edElRef !== el) {
        el.innerHTML = this._drafts[pid] || '<p><br></p>';
        this._edPid = pid;
        this._edElRef = el;
        this._hoverBlock = null;
        this.setEd({ slash: null, picker: null, bar: null, side: null, blockMenu: null, drop: null });
        this.edUpdatePlaceholder();
      } else if (!el.firstElementChild) {
        el.innerHTML = '<p><br></p>';
      }
    }, 0);
  }
  /** Oberster Block im bearbeitbaren Bereich, in dem ein Knoten liegt */
  edBlockOf(node) {
    const el = this.edEl();
    if (!el || !node) return null;
    let n = node.nodeType === 3 ? node.parentNode : node;
    while (n && n.parentNode !== el) { if (n === el || n === document.body) return null; n = n.parentNode; }
    return n;
  }
  edFocusInto(node, atEnd = false) {
    const el = this.edEl();
    if (!el || !node) return;
    el.focus({ preventScroll: true });
    const r = document.createRange();
    r.selectNodeContents(node);
    r.collapse(!atEnd);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
  edCaretRect() {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0).cloneRange();
    r.collapse(true);
    const rects = r.getClientRects();
    if (rects.length) return rects[0];
    const b = this.edBlockOf(r.startContainer) || (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement);
    return b ? b.getBoundingClientRect() : null;
  }
  edPopupPos(rect, h = 380, w = 330) {
    if (!rect) return { x: 100, y: 100 };
    const x = Math.max(12, Math.min(rect.left, innerWidth - w - 12));
    let y = rect.bottom + 6;
    if (y + h > innerHeight - 8) y = Math.max(8, rect.top - h - 6);
    return { x: Math.round(x), y: Math.round(y) };
  }
  /** „/“, „[“ oder „@“ vor dem Cursor? Dann Menü bzw. Auswahl öffnen und mit dem Text danach filtern */
  edCheckTrigger() {
    const ed = this.state.ed;
    const close = () => { if (ed.slash || ed.picker) this.setEd({ slash: null, picker: null }); };
    const sel = getSelection();
    const el = this.edEl();
    if (!el || !sel.rangeCount || !sel.isCollapsed) return close();
    const r = sel.getRangeAt(0);
    const node = r.startContainer;
    if (node.nodeType !== 3 || !el.contains(node)) return close();
    if (node.parentElement && node.parentElement.closest('code')) return close();
    const before = node.textContent.slice(0, r.startOffset);
    let m = null;
    let kind = null;
    if ((m = before.match(/(?:^|[\s ])\/([^\s /]{0,24})$/))) kind = 'slash';
    else if ((m = before.match(/\[([^\][]{0,40})$/))) kind = 'page';
    else if ((m = before.match(/(?:^|[\s ])@([^\s @]{0,30})$/))) kind = 'person';
    if (!kind) return close();
    const q = m[1];
    this._trigger = { node, end: r.startOffset, len: q.length + 1 };
    const pos = this.edPopupPos(this.edCaretRect());
    if (kind === 'slash') this.setEd({ slash: { q, active: ed.slash && ed.slash.q === q ? ed.slash.active : 0, ...pos }, picker: null, bar: null });
    else this.setEd({ picker: { kind, q, active: ed.picker && ed.picker.q === q ? ed.picker.active : 0, ...pos }, slash: null, bar: null });
  }
  edRemoveTrigger() {
    const t = this._trigger;
    this._trigger = null;
    if (!t || !t.node.isConnected) return null;
    const start = Math.max(0, t.end - t.len);
    const block = this.edBlockOf(t.node);
    const r = document.createRange();
    r.setStart(t.node, start);
    r.setEnd(t.node, Math.min(t.end, t.node.length));
    r.deleteContents();
    const sel = getSelection();
    const c = document.createRange();
    c.setStart(t.node, start);
    c.collapse(true);
    sel.removeAllRanges();
    sel.addRange(c);
    return block;
  }
  edMakeBlock(key) {
    const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
    switch (key) {
      case 'h1': case 'h2': case 'h3': case 'p': { const e = mk(key, '', '<br>'); return { el: e, focus: e }; }
      case 'ul': case 'ol': { const e = mk(key, '', '<li><br></li>'); return { el: e, focus: e.firstChild }; }
      case 'quote': { const e = mk('blockquote', '', '<br>'); return { el: e, focus: e }; }
      case 'todo': { const e = mk('div', 'nf-check', '<input type="checkbox" contenteditable="false" aria-label="Erledigt"><span><br></span>'); e.dataset.checked = 'false'; return { el: e, focus: e.querySelector('span') }; }
      case 'callout': {
        const e = mk('div', 'nf-callout', '<span class="nf-callout-icon" contenteditable="false">ℹ Info</span><div class="nf-callout-content"><p><br></p></div>');
        e.dataset.variant = 'info';
        return { el: e, focus: e.querySelector('p') };
      }
      case 'code': { const e = mk('div', 'nf-code', '<span class="nf-code-lang" contenteditable="false">Text</span><pre><code><br></code></pre>'); return { el: e, focus: e.querySelector('code') }; }
      case 'table': {
        const row = (c) => '<tr>' + [1, 2, 3].map(() => '<' + c + '><br></' + c + '>').join('') + '</tr>';
        const e = mk('div', 'nf-table-block', '<table><thead>' + row('th') + '</thead><tbody>' + row('td') + row('td') + '</tbody></table>');
        return { el: e, focus: e.querySelector('th') };
      }
      case 'hr': { const e = mk('hr'); e.contentEditable = 'false'; return { el: e, after: true }; }
      case 'img': {
        const e = mk('div', 'nf-img-upload', '<svg class="nf-icon" width="22" height="22" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5"></rect><circle cx="6" cy="6.5" r="1.2"></circle><path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3"></path></svg><strong>Bild hierher ziehen</strong><span>PNG, JPEG, GIF oder WebP</span><button type="button" class="nf-btn">Datei auswählen</button>');
        e.contentEditable = 'false';
        return { el: e, after: true };
      }
      case 'toc': {
        const heads = [...document.querySelectorAll('.nf-editor h2, .nf-editable h1, .nf-editable h2, .nf-editable h3')].map((h) => h.textContent.trim()).filter(Boolean);
        const list = heads.length ? '<ol>' + heads.map((h) => '<li><a href="#">' + esc(h) + '</a></li>').join('') + '</ol>' : '<p class="nf-muted">Noch keine Überschriften auf dieser Seite.</p>';
        const e = mk('nav', 'nf-toc', '<p class="nf-toc-title">Inhalt</p>' + list);
        e.contentEditable = 'false';
        return { el: e, after: true };
      }
      default: return this.edMakeBlock('p');
    }
  }
  /** Block an die Stelle eines leeren Absatzes setzen, sonst dahinter; Cursor hinein bzw. in den Absatz danach */
  edPlace(cur, b) {
    const el = this.edEl();
    const empty = cur && cur.tagName === 'P' && !cur.textContent.replace(/[​ ]/g, '').trim() && !cur.querySelector('.nf-page-link,.nf-mention');
    if (cur && empty) cur.replaceWith(b.el); else if (cur) cur.after(b.el); else el.appendChild(b.el);
    let focus = b.focus;
    if (b.after || !focus) {
      let next = b.el.nextElementSibling;
      if (!next || next.tagName !== 'P' || next.textContent.trim()) { next = document.createElement('p'); next.innerHTML = '<br>'; b.el.after(next); }
      focus = next;
    }
    this.edFocusInto(focus);
    this.edSave();
    this.edUpdatePlaceholder();
    this.markSaving();
  }
  edApplyBlock(key) {
    if (key === 'pagelink' || key === 'mention') {
      this.edRemoveTrigger();
      document.execCommand('insertText', false, key === 'pagelink' ? '[' : '@');
      this.edCheckTrigger();
      return;
    }
    this.setEd({ slash: null });
    const cur = this.edRemoveTrigger() || this.edBlockOf(getSelection().anchorNode);
    if (cur && !cur.firstChild) cur.innerHTML = '<br>';
    this.edPlace(cur, this.edMakeBlock(key));
  }
  edInsertChip(kind, item) {
    this.edRemoveTrigger();
    const chip = kind === 'page'
      ? '<a class="nf-page-link" contenteditable="false" data-page-id="' + item.id + '" href="#">' + esc(item.title) + '</a>'
      : '<span class="nf-mention" contenteditable="false" data-user-id="' + item.id + '">@' + esc(item.name) + '</span>';
    // Direkt am Cursor einsetzen (insertHTML setzt ihn am Zeilenende in Chrome hinter den Absatz)
    const tmp = document.createElement('div');
    tmp.innerHTML = chip;
    const chipEl = tmp.firstChild;
    const space = document.createTextNode(' ');
    const sel = getSelection();
    if (sel.rangeCount) {
      const r = sel.getRangeAt(0);
      r.insertNode(space);
      r.insertNode(chipEl);
      const c = document.createRange();
      c.setStartAfter(space);
      c.collapse(true);
      sel.removeAllRanges();
      sel.addRange(c);
    }
    this.setEd({ picker: null });
    this.edSave();
    this.markSaving();
  }
  /** Markdown-Kürzel am Anfang eines Absatzes: #, ##, ###, -, 1., [], >, ```, --- und Leerzeichen */
  edMarkdown() {
    const sel = getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return false;
    const blk = this.edBlockOf(sel.anchorNode);
    if (!blk || blk.tagName !== 'P') return false;
    const m = blk.textContent.match(/^(#{1,3}|[-*]|1\.|\[\]|>|```|---)[\s ]$/);
    if (!m) return false;
    const map = { '#': 'h1', '##': 'h2', '###': 'h3', '-': 'ul', '*': 'ul', '1.': 'ol', '[]': 'todo', '>': 'quote', '```': 'code', '---': 'hr' };
    blk.innerHTML = '<br>';
    this._trigger = null;
    this.edPlace(blk, this.edMakeBlock(map[m[1]]));
    return true;
  }
  /** Platzhalter nur im Block mit dem Cursor (wie BlockNote); eine ganz leere Seite zeigt ihn immer */
  edUpdatePlaceholder() {
    const el = this.edEl();
    if (!el) return;
    el.querySelectorAll('[data-ph]').forEach((n) => n.removeAttribute('data-ph'));
    const sel = getSelection();
    let target = null;
    if (document.activeElement === el && sel.rangeCount && sel.isCollapsed) {
      const n = sel.anchorNode;
      const start = n && (n.nodeType === 3 ? n.parentElement : n);
      target = start && start.closest && start.closest('p,h1,h2,h3,li,blockquote');
      if (target && !el.contains(target)) target = null;
    } else if (el.children.length === 1) {
      target = el.firstElementChild;
    }
    if (target && !target.textContent && !target.querySelector('img,.nf-page-link,.nf-mention')) {
      target.setAttribute('data-ph', BLOCK_PH[target.tagName] || BLOCK_PH.P);
    }
  }
  edOnInput() {
    const el = this.edEl();
    if (!el) return;
    if (!el.firstElementChild) el.innerHTML = '<p><br></p>';
    if (!this.edMarkdown()) this.edCheckTrigger();
    this.edUpdatePlaceholder();
    this.edSave();
    this.markSaving();
  }
  edScrollOpt(prefix, i) {
    setTimeout(() => { const o = document.getElementById(prefix + i); if (o) o.scrollIntoView({ block: 'nearest' }); }, 20);
  }
  edOnKey(e) {
    const ed = this.state.ed;
    const pop = ed.slash ? 'slash' : ed.picker ? 'picker' : null;
    if (pop) {
      const list = (pop === 'slash' ? this._slashFlat : this._pickerFlat) || [];
      const n = list.length;
      const cur = Math.min(ed[pop].active, Math.max(0, n - 1));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!n) return;
        const next = (cur + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        this.setEd({ [pop]: { ...ed[pop], active: next } });
        this.edScrollOpt('nf-' + pop + '-opt-', next);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && n) { e.preventDefault(); list[cur].run(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this._trigger = null; this.setEd({ slash: null, picker: null }); return; }
    }
    if (e.key === 'Escape') { e.stopPropagation(); if (ed.blockMenu) this.setEd({ blockMenu: null }); return; }
    const sel = getSelection();
    const blk = sel.rangeCount ? this.edBlockOf(sel.anchorNode) : null;
    if (!blk) return;
    const atEnd = () => {
      const r = sel.getRangeAt(0);
      const tail = document.createRange();
      tail.selectNodeContents(blk);
      tail.setStart(r.endContainer, r.endOffset);
      return tail.toString() === '';
    };
    const para = () => { const p = document.createElement('p'); p.innerHTML = '<br>'; return p; };
    if (e.key === 'Enter' && !e.shiftKey) {
      if (blk.classList.contains('nf-check')) {
        e.preventDefault();
        if (!blk.textContent.trim()) { const p = para(); blk.replaceWith(p); this.edFocusInto(p); }
        else { const b = this.edMakeBlock('todo'); blk.after(b.el); this.edFocusInto(b.focus); }
        this.edSave();
        return;
      }
      if (blk.classList.contains('nf-code')) { e.preventDefault(); document.execCommand('insertText', false, '\n'); return; }
      if (/^(H1|H2|H3|BLOCKQUOTE)$/.test(blk.tagName) && atEnd()) { e.preventDefault(); const p = para(); blk.after(p); this.edFocusInto(p); this.edSave(); return; }
    }
    // Rücktaste in einem leeren besonderen Block: zurück zum Absatz
    if (e.key === 'Backspace' && blk.tagName !== 'P' && !blk.textContent && !/^(UL|OL|HR|NAV|DIV)$/.test(blk.tagName)) {
      e.preventDefault();
      const p = para();
      blk.replaceWith(p);
      this.edFocusInto(p);
      this.edSave();
    }
  }
  edOnClick(e) {
    const t = e.target;
    const link = t.closest && t.closest('.nf-page-link[data-page-id]');
    if (link) { e.preventDefault(); if (this.state.pages[link.dataset.pageId]) this.go(link.dataset.pageId); return; }
    if (t.matches && t.matches('.nf-check input[type=checkbox]')) {
      const box = t.closest('.nf-check');
      box.dataset.checked = t.checked ? 'true' : 'false';
      if (t.checked) t.setAttribute('checked', ''); else t.removeAttribute('checked');
      this.edSave();
      this.markSaving();
      return;
    }
    if (this.state.ed.blockMenu) this.setEd({ blockMenu: null });
  }
  /** Formatleiste: zeigt sich bei markiertem Text in der Seite; voll nur im bearbeitbaren Bereich */
  edUpdateBar() {
    const ed = this.state.ed;
    const active = document.activeElement;
    if (active && active.closest && active.closest('.nf-format-bar')) return;
    const sel = getSelection();
    const close = () => { if (ed.bar) this.setEd({ bar: null }); };
    if (!sel.rangeCount || sel.isCollapsed || !sel.toString().trim()) return close();
    const r = sel.getRangeAt(0);
    const article = document.querySelector('.nf-editor');
    if (!article || !article.contains(r.commonAncestorContainer)) return close();
    if (ed.slash || ed.picker) return close();
    const rect = r.getBoundingClientRect();
    const el = this.edEl();
    const full = !!el && el.contains(r.startContainer) && el.contains(r.endContainer);
    const blk = full ? this.edBlockOf(r.startContainer) : null;
    const state = (c) => { try { return document.queryCommandState(c); } catch (err) { return false; } };
    const pe = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
    this._savedRange = r.cloneRange();
    const bar = {
      x: Math.round(Math.min(Math.max(rect.left + rect.width / 2, 200), innerWidth - 200)),
      y: Math.round(Math.max(rect.top, 120)),
      full,
      block: blk ? ({ H1: 'h1', H2: 'h2', H3: 'h3', BLOCKQUOTE: 'blockquote' })[blk.tagName] || 'p' : 'p',
      b: full && state('bold'), i: full && state('italic'), u: full && state('underline'), s: full && state('strikeThrough'),
      c: !!(pe && pe.closest && pe.closest('code')),
      linkMode: false, url: ''
    };
    const old = ed.bar;
    if (old && !old.linkMode && ['x', 'y', 'full', 'block', 'b', 'i', 'u', 's', 'c'].every((k) => old[k] === bar[k])) return;
    this.setEd({ bar });
  }
  edRestore() {
    const el = this.edEl();
    if (!this._savedRange || !el) return;
    el.focus({ preventScroll: true });
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(this._savedRange);
  }
  edCmd(cmd, val) {
    this.edRestore();
    document.execCommand(cmd, false, val);
    this.edSave();
    this.markSaving();
    this.setEd({ bar: null });
    setTimeout(() => this.edUpdateBar(), 0);
  }

  edVals() {
    const s = this.state;
    const ed = s.ed;
    const P = s.pages;
    const shown = (t) => t || 'Ohne Titel';
    const keepFocus = (e) => { const t = e.target; if (t.closest && t.closest('select,input')) return; e.preventDefault(); };

    // „/“-Menü
    let slash = { open: false };
    this._slashFlat = [];
    if (ed.slash) {
      const words = fold(ed.slash.q).split(/\s+/).filter(Boolean);
      const items = SLASH.filter((b) => words.every((w) => fold(b.title + ' ' + b.alias).includes(w)));
      const active = Math.min(ed.slash.active, Math.max(0, items.length - 1));
      const groups = [];
      items.forEach((b, i) => {
        let g = groups.find((x) => x.label === b.group);
        if (!g) { g = { label: b.group, items: [] }; groups.push(g); }
        g.items.push({
          ...b, hasMd: !!b.md, domId: 'nf-slash-opt-' + i, selected: i === active ? 'true' : 'false',
          run: () => this.edApplyBlock(b.key),
          hover: () => { if (this.state.ed.slash && this.state.ed.slash.active !== i) this.setEd({ slash: { ...this.state.ed.slash, active: i } }); }
        });
      });
      this._slashFlat = groups.flatMap((g) => g.items);
      slash = { open: true, x: ed.slash.x, y: ed.slash.y, q: ed.slash.q, groups, empty: items.length === 0 };
    }

    // Auswahl hinter „[“ und „@“
    let picker = { open: false };
    this._pickerFlat = [];
    if (ed.picker) {
      const words = fold(ed.picker.q).split(/\s+/).filter(Boolean);
      let list = [];
      if (ed.picker.kind === 'page') {
        const trashed = new Set(s.trash.map((t) => t.id));
        list = Object.keys(P)
          .filter((id) => this.role(id) && !this.chain(id).some((x) => trashed.has(x)) && id !== this._edPid)
          .filter((id) => words.every((w) => fold(shown(P[id].title)).includes(w)))
          .sort((a, b) => (P[b].space === s.space) - (P[a].space === s.space) || shown(P[a].title).localeCompare(shown(P[b].title), 'de'))
          .slice(0, 10)
          .map((id) => {
            const sp = s.spaces[P[id].space];
            return {
              glyph: sp.key.slice(0, 2), iconStyle: 'background:' + (sp.color || '#1F5FD6') + ';color:#fff;font-size:10px',
              title: shown(P[id].title), hint: [sp.name, ...this.chain(id).slice(1, -1).map((x) => shown(P[x].title))].join(' / '),
              pick: () => this.edInsertChip('page', { id, title: shown(P[id].title) })
            };
          });
      } else {
        list = s.members
          .filter((m) => words.every((w) => fold(PEOPLE[m.key].name + ' ' + m.email).includes(w)))
          .slice(0, 8)
          .map((m) => ({
            glyph: initials(PEOPLE[m.key].name), iconStyle: 'background:' + PEOPLE[m.key].color + ';color:#fff;border-radius:50%;font-size:11px',
            title: PEOPLE[m.key].name + (m.key === 'peter' ? ' (du)' : ''), hint: m.email + (m.role === 'guest' ? ' · Gast' : ''),
            pick: () => this.edInsertChip('person', { id: m.key, name: PEOPLE[m.key].name })
          }));
      }
      const active = Math.min(ed.picker.active, Math.max(0, list.length - 1));
      const items = list.map((it, i) => ({
        ...it, domId: 'nf-picker-opt-' + i, selected: i === active ? 'true' : 'false', run: it.pick,
        hover: () => { if (this.state.ed.picker && this.state.ed.picker.active !== i) this.setEd({ picker: { ...this.state.ed.picker, active: i } }); }
      }));
      this._pickerFlat = items;
      picker = {
        open: true, x: ed.picker.x, y: ed.picker.y, items, empty: items.length === 0,
        label: ed.picker.kind === 'page' ? 'Seite verlinken' : 'Person erwähnen',
        emptyText: ed.picker.kind === 'page' ? 'Keine lesbare Seite mit „' + ed.picker.q + '“ im Titel' : 'Niemand im Workspace heißt „' + ed.picker.q + '“'
      };
    }

    // Formatleiste
    let bar = { open: false };
    if (ed.bar) {
      const b = ed.bar;
      const mark = (key, cmd, glyph, cls, label, keys) => ({
        glyph, cls, label, title: label + (keys ? ' (' + keys + ')' : ''), pressed: b[key] ? 'true' : 'false',
        run: () => {
          if (cmd === 'code') {
            this.edRestore();
            const sel = getSelection();
            const pe = sel.anchorNode && (sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode);
            const code = pe && pe.closest && pe.closest('code');
            if (code && !code.closest('pre')) code.replaceWith(document.createTextNode(code.textContent));
            else document.execCommand('insertHTML', false, '<code>' + esc(sel.toString()) + '</code>');
            this.edSave();
            this.setEd({ bar: null });
            setTimeout(() => this.edUpdateBar(), 0);
          } else this.edCmd(cmd);
        }
      });
      bar = {
        open: true, x: b.x, y: b.y, full: b.full, block: b.block,
        linkMode: !!b.linkMode, normal: !b.linkMode, url: b.url,
        marks: [
          mark('b', 'bold', 'B', 'nf-fb-b', 'Fett', 'Strg B'),
          mark('i', 'italic', 'I', 'nf-fb-i', 'Kursiv', 'Strg I'),
          mark('u', 'underline', 'U', 'nf-fb-u', 'Unterstrichen', 'Strg U'),
          mark('s', 'strikeThrough', 'S', 'nf-fb-s', 'Durchgestrichen', ''),
          mark('c', 'code', '<>', 'nf-fb-c', 'Code', '')
        ],
        setBlock: (e) => { const v = e.target.value; this.edCmd('formatBlock', v === 'p' ? 'P' : v.toUpperCase()); },
        startLink: () => { this.setEd({ bar: { ...b, linkMode: true, url: '' } }); this.focusLater('#nf-fb-url'); },
        onUrl: (e) => this.setEd({ bar: { ...this.state.ed.bar, url: e.target.value } }),
        urlKey: (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.setEd({ bar: null }); this.edRestore(); } },
        applyLink: (e) => {
          this.prevent(e);
          const url = (this.state.ed.bar.url || '').trim();
          if (url) this.edCmd('createLink', /^[a-z]+:/i.test(url) ? url : 'https://' + url);
          else this.setEd({ bar: null });
        },
        comment: () => {
          // Neuer Thread mit der markierten Stelle; im bearbeitbaren Bereich wird sie als <mark> umschlossen,
          // im festen Inhalt der Vorlage nur zitiert. Danach Spalte auf, Cursor im Kommentarfeld.
          const text = this._savedRange ? this._savedRange.toString().replace(/\s+/g, ' ').trim() : '';
          const range = this._savedRange;
          this.setEd({ bar: null });
          getSelection().removeAllRanges();
          this.newThread(this.state.current, text.length > 80 ? text.slice(0, 80) + ' …' : text, range, b.full);
        }
      };
    }

    // Seitenmenü links am Block und Blockmenü
    const blockMenu = ed.blockMenu ? {
      open: true, top: ed.blockMenu.top, expanded: 'true',
      items: [
        ['Nach oben', 'Strg ⇧ ↑', () => { const b = this._menuBlock; if (b && b.previousElementSibling) b.previousElementSibling.before(b); }],
        ['Nach unten', 'Strg ⇧ ↓', () => { const b = this._menuBlock; if (b && b.nextElementSibling) b.nextElementSibling.after(b); }],
        ['Duplizieren', '', () => { const b = this._menuBlock; if (b) b.after(b.cloneNode(true)); }],
        ['Löschen', 'Entf', () => {
          const b = this._menuBlock;
          if (!b) return;
          if (b.parentNode.children.length === 1) b.replaceWith(Object.assign(document.createElement('p'), { innerHTML: '<br>' }));
          else b.remove();
        }, 'nf-menu-item-danger']
      ].map(([label, keys, fn, cls]) => ({
        label, keys, cls: cls || '', disabled: 'false',
        run: () => { fn(); this.edSave(); this.markSaving(); this.setEd({ blockMenu: null, side: null }); this._hoverBlock = null; }
      }))
    } : { open: false, expanded: 'false', items: [] };

    const blockAt = (y) => {
      const el = this.edEl();
      if (!el) return null;
      for (const c of el.children) { const r = c.getBoundingClientRect(); if (y >= r.top - 6 && y <= r.bottom + 6) return c; }
      return null;
    };
    return {
      keepFocus,
      slash, picker, bar, blockMenu,
      side: ed.side ? {
        show: true, top: ed.side.top,
        plus: () => {
          const b = this._hoverBlock;
          if (!b) return;
          let p = b;
          if (!(b.tagName === 'P' && !b.textContent)) { p = document.createElement('p'); b.after(p); }
          p.textContent = '/';
          // Cursor in den Textknoten hinter „/“, sonst erkennt edCheckTrigger den Auslöser nicht
          const el = this.edEl();
          el.focus({ preventScroll: true });
          const r = document.createRange();
          r.setStart(p.firstChild, 1);
          r.collapse(true);
          getSelection().removeAllRanges();
          getSelection().addRange(r);
          this.setEd({ side: null, blockMenu: null });
          this.edCheckTrigger();
          this.edSave();
        },
        handle: (e) => {
          this.stop(e);
          this._menuBlock = this._hoverBlock;
          this.setEd({ blockMenu: ed.blockMenu ? null : { top: ed.side.top } });
        },
        dragStart: (e) => {
          this._dragBlock = this._hoverBlock;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', '');
          try { e.dataTransfer.setDragImage(this._dragBlock, 0, 0); } catch (err) { /* ohne Vorschau */ }
          this.setEd({ blockMenu: null });
        },
        dragEnd: () => { this._dragBlock = null; this.setEd({ drop: null }); }
      } : { show: false },
      drop: ed.drop ? { show: true, top: ed.drop.top } : { show: false },
      onInput: () => this.edOnInput(),
      onKey: (e) => this.edOnKey(e),
      onClick: (e) => this.edOnClick(e),
      onMove: (e) => {
        if (ed.blockMenu || this._dragBlock) return;
        const t = e.target;
        if (t.closest && t.closest('.nf-side-menu')) return;
        const b = blockAt(e.clientY);
        if (!b || (b === this._hoverBlock && ed.side)) return;
        this._hoverBlock = b;
        const top = b.offsetTop + (/^H[1-3]$/.test(b.tagName) ? Math.max(0, (b.offsetHeight - 26) / 2) : 0);
        this.setEd({ side: { top: Math.round(top) } });
      },
      onLeave: () => { if (!ed.blockMenu && ed.side) this.setEd({ side: null }); },
      onDragOver: (e) => {
        if (!this._dragBlock) return;
        e.preventDefault();
        const b = blockAt(e.clientY);
        if (!b) return;
        const r = b.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2;
        this._dropTarget = { b, before };
        const top = Math.round(before ? b.offsetTop - 5 : b.offsetTop + b.offsetHeight + 4);
        if (!ed.drop || ed.drop.top !== top) this.setEd({ drop: { top } });
      },
      onDrop: (e) => {
        if (!this._dragBlock) return;
        e.preventDefault();
        const t = this._dropTarget;
        if (t && t.b !== this._dragBlock) { if (t.before) t.b.before(this._dragBlock); else t.b.after(this._dragBlock); }
        this._dragBlock = null;
        this._dropTarget = null;
        this.edSave();
        this.markSaving();
        this.setEd({ drop: null, side: null });
      }
    };
  }

