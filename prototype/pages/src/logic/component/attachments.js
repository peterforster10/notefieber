  // ---------- Anhänge und Virenscan (M3: E11) ----------
  // Datei-Block und Bild-Block zeigen den Zustand aus files: wird geprüft (Download gesperrt, die API
  // liefert ungeprüfte Dateien nicht aus), geprüft, blockiert (Schadsoftware gefunden, nie
  // auslieferbar). Im Prototyp lädt „Datei auswählen“ eine echte Datei aus dem Browser (bleibt lokal),
  // der Scan dauert 3 s; ein Name mit „eicar“ wird blockiert.
  attTypeOf(name, kind) {
    const ext = (name.match(/\.([a-z0-9]{1,5})$/i) || [])[1] || '';
    const T = { pdf: 'PDF', zip: 'ZIP-Archiv', docx: 'Word', docm: 'Word mit Makros', xlsx: 'Excel', xlsm: 'Excel mit Makros', pptx: 'PowerPoint', odt: 'ODT', csv: 'CSV', txt: 'Text', md: 'Markdown', json: 'JSON', png: 'PNG-Bild', jpg: 'JPEG-Bild', jpeg: 'JPEG-Bild', gif: 'GIF-Bild', webp: 'WebP-Bild' };
    return { ext: (ext || (kind === 'image' ? 'img' : 'datei')).toUpperCase().slice(0, 4), label: T[ext.toLowerCase()] || (ext ? ext.toUpperCase() + '-Datei' : 'Datei') };
  }
  attSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' MB';
  }
  attMeta(a) {
    const t = this.attTypeOf(a.name, a.kind);
    return t.label + ' · ' + this.attSize(a.size) + ' · ' + PEOPLE[a.by].name + ' ' + a.when;
  }
  attStateText(a) {
    if (a.state === 'scanning') return 'Wird auf Viren geprüft … Herunterladen geht danach.';
    if (a.state === 'blocked') return 'Blockiert: Schadsoftware gefunden (' + a.finding + '). Herunterladen ist gesperrt.';
    return '';
  }
  attFind(id) {
    for (const [pid, list] of Object.entries(this.state.attachments)) {
      const a = list.find((x) => x.id === id);
      if (a) return { pid, a };
    }
    return null;
  }
  attDownload(id) {
    const hit = this.attFind(id);
    if (!hit || hit.a.state !== 'clean') return;
    if (hit.a.url) {
      const link = document.createElement('a');
      link.href = hit.a.url;
      link.download = hit.a.name;
      link.click();
    } else this.showToast('Herunterladen: ' + hit.a.name + ' (im Prototyp ohne Inhalt)');
  }
  attRemove(id) {
    const hit = this.attFind(id);
    if (!hit) return;
    this.setState((st) => ({ attachments: { ...st.attachments, [hit.pid]: st.attachments[hit.pid].filter((x) => x.id !== id) } }));
    document.querySelectorAll('.nf-editable [data-att-id="' + id + '"]').forEach((el) => el.remove());
    this.edSave();
    this.markSaving();
    this.showToast('„' + hit.a.name + '“ entfernt');
  }

  /** Markup für Blöcke im bearbeitbaren Bereich (gleiche Klassen wie die Vorlage) */
  attIcon(a) {
    if (a.state === 'scanning') return '<span class="nf-file-icon" data-state="scanning" aria-hidden="true"><svg class="nf-icon nf-spin" width="18" height="18" viewBox="0 0 16 16"><path d="M8 2a6 6 0 105.2 3"></path></svg></span>';
    if (a.state === 'blocked') return '<span class="nf-file-icon" data-state="blocked" aria-hidden="true"><svg class="nf-icon" width="18" height="18" viewBox="0 0 16 16"><path d="M8 1.8l5 2v4c0 3.2-2.2 5.4-5 6.4-2.8-1-5-3.2-5-6.4v-4z"></path><path d="M6 6l4 4M10 6l-4 4"></path></svg></span>';
    return '<span class="nf-file-icon" aria-hidden="true">' + esc(this.attTypeOf(a.name, a.kind).ext) + '</span>';
  }
  attBlockHtml(a) {
    if (a.kind === 'image') {
      if (a.state === 'clean') return '<figure class="nf-img-block" contenteditable="false" data-att-id="' + a.id + '"><img src="' + a.url + '" alt="' + esc(a.name) + '"></figure>';
      return '<div class="nf-img-state" contenteditable="false" data-att-id="' + a.id + '" data-state="' + a.state + '"' + (a.state === 'scanning' ? ' aria-busy="true"' : '') + '>'
        + this.attIcon(a)
        + '<strong>' + (a.state === 'scanning' ? 'Bild wird auf Viren geprüft …' : 'Bild blockiert') + '</strong>'
        + '<span>' + esc(a.name) + (a.state === 'blocked' ? ' · Schadsoftware gefunden (' + esc(a.finding) + ')' : '') + '</span>'
        + (a.state === 'blocked' ? '<button type="button" class="nf-btn nf-att-remove">Entfernen</button>' : '')
        + '</div>';
    }
    const st = this.attStateText(a);
    return '<div class="nf-file" contenteditable="false" data-att-id="' + a.id + '" data-state="' + a.state + '"' + (a.state === 'scanning' ? ' aria-busy="true"' : '') + '>'
      + this.attIcon(a)
      + '<span class="nf-file-names"><span class="nf-file-name">' + esc(a.name) + '</span><span>' + esc(st || this.attMeta(a)) + '</span></span>'
      + (a.state === 'blocked'
        ? '<button type="button" class="nf-btn nf-att-remove">Entfernen</button>'
        : '<button type="button" class="nf-btn nf-btn-icon nf-att-dl" aria-label="' + esc(a.name) + ' herunterladen" title="Herunterladen"' + (a.state === 'clean' ? '' : ' disabled') + '><svg class="nf-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10"></path></svg></button>')
      + '</div>';
  }
  /** Klicks in Anhang-Blöcken des bearbeitbaren Bereichs; true, wenn behandelt */
  attOnEditorClick(t) {
    const pick = t.closest('.nf-upload-pick');
    if (pick) { this.attPick(pick.closest('.nf-img-upload, .nf-file-upload')); return true; }
    const block = t.closest('[data-att-id]');
    if (!block) return false;
    if (t.closest('.nf-att-dl')) { this.attDownload(block.dataset.attId); return true; }
    if (t.closest('.nf-att-remove')) { this.attRemove(block.dataset.attId); return true; }
    return false;
  }
  /** Datei wählen: echte Datei aus dem Browser, bleibt lokal (Object-URL) */
  attPick(holder) {
    if (!holder) return;
    const isImage = holder.classList.contains('nf-img-upload');
    const input = document.createElement('input');
    input.type = 'file';
    if (isImage) input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      // Bild-Block: nur PNG, JPEG, GIF und WebP (die API prüft die ersten Bytes, nicht die Endung)
      if (isImage && !/^image\/(png|jpeg|gif|webp)$/.test(f.type)) {
        const err = holder.querySelector('.nf-upload-error') || holder.appendChild(document.createElement('span'));
        err.className = 'nf-upload-error';
        err.setAttribute('role', 'alert');
        err.textContent = '„' + f.name + '“ ist kein PNG, JPEG, GIF oder WebP. Andere Dateien über „/Datei“ anhängen.';
        return;
      }
      const pid = this._edPid;
      const a = { id: 'u' + Date.now(), kind: isImage ? 'image' : 'file', name: f.name, size: f.size, state: 'scanning', by: 'peter', when: 'gerade eben', url: URL.createObjectURL(f) };
      this.setState((st) => ({ attachments: { ...st.attachments, [pid]: [...(st.attachments[pid] || []), a] } }));
      const tmp = document.createElement('div');
      tmp.innerHTML = this.attBlockHtml(a);
      holder.replaceWith(tmp.firstChild);
      this.edSave();
      this.markSaving();
      this.attScan(a.id, 3000);
    };
    input.click();
  }
  /** Virenscan (Worker, M3): nach der Prüfung geprüft oder blockiert; Blöcke im Editor ziehen nach */
  attScan(id, ms) {
    setTimeout(() => {
      const hit = this.attFind(id);
      if (!hit || hit.a.state !== 'scanning') return;
      const blocked = /eicar/i.test(hit.a.name);
      const next = { ...hit.a, state: blocked ? 'blocked' : 'clean', finding: blocked ? 'EICAR-Test-File' : undefined };
      this.setState((st) => ({ attachments: { ...st.attachments, [hit.pid]: st.attachments[hit.pid].map((x) => (x.id === id ? next : x)) } }));
      document.querySelectorAll('.nf-editable [data-att-id="' + id + '"]').forEach((el) => {
        const tmp = document.createElement('div');
        tmp.innerHTML = this.attBlockHtml(next);
        el.replaceWith(tmp.firstChild);
      });
      if (this._edPid) this.edSave();
      this.showToast(blocked ? '„' + next.name + '“ blockiert: Schadsoftware gefunden' : '„' + next.name + '“ geprüft');
    }, ms);
  }

  /** Werte für die Vorlage: Blöcke der Seite Datenmodell und die Liste in der Seiteninfo */
  attachmentsVals(pid, canEdit) {
    const s = this.state;
    const list = s.attachments[pid] || [];
    // Der Scan der Datei aus den Testdaten endet einmal, ein paar Sekunden nach dem ersten Anzeigen
    if (!this._scanStarted && list.some((a) => a.state === 'scanning' && !a.url)) {
      this._scanStarted = true;
      list.filter((a) => a.state === 'scanning' && !a.url).forEach((a) => this.attScan(a.id, 12000));
    }
    const row = (a) => ({
      id: a.id,
      name: a.name,
      ext: this.attTypeOf(a.name, a.kind).ext,
      meta: this.attStateText(a) || this.attMeta(a),
      infoMeta: this.attMeta(a),
      state: a.state,
      isClean: a.state === 'clean',
      isScanning: a.state === 'scanning',
      isBlocked: a.state === 'blocked',
      busy: a.state === 'scanning' ? 'true' : 'false',
      chip: a.state === 'scanning' ? 'Wird geprüft' : a.state === 'blocked' ? 'Blockiert' : '',
      hasChip: a.state !== 'clean',
      dlDisabled: a.state !== 'clean',
      dlShown: a.state !== 'blocked',
      dlLabel: a.name + ' herunterladen',
      download: () => this.attDownload(a.id),
      canRemove: canEdit && a.state === 'blocked',
      remove: () => this.attRemove(a.id),
      // Als Hintergrund statt <img src>, damit der Browser den Platzhalter der Vorlage nicht lädt
      bg: a.kind === 'image' && a.state === 'clean' ? 'url("' + (a.url || ER_DIAGRAM_SVG) + '")' : 'none'
    });
    const blocks = (s.attachments.dm || []).filter((a) => !a.url);
    const img = blocks.find((a) => a.kind === 'image');
    return {
      att: {
        image: img ? row(img) : { isClean: false, isScanning: false, isBlocked: false },
        hasImage: !!img,
        files: blocks.filter((a) => a.kind === 'file').map(row),
        hasFiles: blocks.some((a) => a.kind === 'file'),
        info: list.map(row),
        hasInfo: list.length > 0,
        noInfo: list.length === 0,
        infoCount: list.length
      }
    };
  }
