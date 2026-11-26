  // ---------- Laden (Prototyp): beim ersten Öffnen kurz Platzhalter ----------
  scheduleLoad(key, ms, done) {
    if (this._timers[key]) return;
    this._timers[key] = setTimeout(() => {
      done();
      delete this._timers[key];
      this.setState((st) => ({ loadTick: (st.loadTick || 0) + 1 }));
    }, ms);
  }
