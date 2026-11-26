  // ---------- Dialoge (Prototyp): wie natives <dialog> im Frontend ----------
  // Fokus beim Öffnen hinein, Tab bleibt drin, Hintergrund inert, beim Schließen zurück zum Auslöser
  topDialog() {
    const cmd = document.querySelector('.nf-cmd-overlay .nf-cmd');
    if (cmd) return cmd;
    const all = document.querySelectorAll('.nf-overlay [role="dialog"], .nf-overlay [role="alertdialog"]');
    return all.length ? all[all.length - 1] : null;
  }
  focusablesIn(root) {
    return [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]')]
      .filter((el) => el.getClientRects().length > 0 && !el.closest('[inert]'));
  }
  dialogSync() {
    clearTimeout(this._dlgT);
    this._dlgT = setTimeout(() => {
      const dlg = this.topDialog();
      document.querySelectorAll('[data-nf-inert]').forEach((el) => {
        if (!dlg || el.contains(dlg)) { el.inert = false; el.removeAttribute('data-nf-inert'); }
      });
      if (dlg) {
        const layer = dlg.closest('.nf-overlay, .nf-cmd-overlay') || dlg;
        if (!this._dlgOpen) {
          this._dlgOpen = true;
          const cur = document.activeElement;
          const a = cur && cur !== document.body && !layer.contains(cur) ? cur : this._lastFocus;
          this._dlgReturn = a && a.isConnected && !a.closest('.nf-menu') ? a : this._menuTrigger || a;
        }
        [...(layer.parentElement ? layer.parentElement.children : [])].forEach((el) => {
          if (el === layer || el.contains(layer) || el.classList.contains('nf-toast') || el.inert) return;
          el.inert = true;
          el.setAttribute('data-nf-inert', '');
        });
        if (!dlg.contains(document.activeElement)) {
          const f = this.focusablesIn(dlg);
          const first = dlg.querySelector('[autofocus]') || f.find((el) => el.matches('input, select, textarea')) || f.find((el) => !el.classList.contains('nf-dialog-close')) || f[0];
          if (first) first.focus(); else { dlg.setAttribute('tabindex', '-1'); dlg.focus(); }
        }
      } else if (this._dlgOpen) {
        this._dlgOpen = false;
        const back = this._dlgReturn;
        this._dlgReturn = null;
        const act = document.activeElement;
        if (act && act !== document.body && act.isConnected) return;
        const target = [back, this._menuTrigger, document.getElementById('content')].find((el) => el && el.isConnected && !el.closest('[inert]'));
        if (!target) return;
        // Nur beim Darüberfahren sichtbare Knöpfe (z. B. „⋯“ einer Baumzeile) lassen sich nicht fokussieren: dann der Link der Zeile
        const row = !target.getClientRects().length && target.closest('.nf-tree-row, .nf-side-space-row, li');
        const alt = row && [...row.querySelectorAll('a[href]'), ...row.querySelectorAll('button')].find((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
        (alt || target).focus();
      }
    }, 0);
  }
