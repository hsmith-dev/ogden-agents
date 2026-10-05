// SPIKE 16.1 (TEMPORARY): the browser side of a pane: xterm.js, the fit addon and a WebSocket on the gated route.
/* global Terminal, FitAddon, Unicode11Addon */
(function () {
  const token = sessionStorage.getItem('ogden-agents.tab-token');
  const panes = {};
  const enc = new TextEncoder();
  function mount(id, opts) {
    opts = opts || {};
    const el = document.createElement('div');
    el.id = 'pane-' + id;
    el.style.cssText = 'width:' + (opts.width || 640) + 'px;height:' + (opts.height || 360) + 'px;float:left';
    document.getElementById('panes').appendChild(el);
    const term = new Terminal({ scrollback: opts.scrollback || 1000, fontSize: 13, allowProposedApi: true });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    if (opts.unicode11) { term.loadAddon(new Unicode11Addon.Unicode11Addon()); term.unicode.activeVersion = '11'; }
    term.open(el);
    fit.fit();
    const p = { id, term, fit, el, ws: null, replaying: false, bytes: 0, opened: false, closeCode: null, markers: {}, data: [] };
    panes[id] = p;
    p.connect = () => new Promise((resolve) => {
      const ws = new WebSocket('ws://' + location.host + '/ws/pane/' + id, ['ogden.v1', 'ogden.auth.' + token]);
      ws.binaryType = 'arraybuffer';
      p.ws = ws;
      ws.onopen = () => { p.opened = true; ws.send(JSON.stringify({ type: 'attach', cols: term.cols, rows: term.rows, scrollback: opts.scrollback || 1000 })); };
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          const f = JSON.parse(ev.data);
          if (f.type === 'replay-start') { p.replaying = true; term.reset(); }
          if (f.type === 'replay-end') { p.replaying = false; resolve(); }
          return;
        }
        p.bytes += ev.data.byteLength;
        term.write(new Uint8Array(ev.data));
        if (p.onBytes) p.onBytes(ev.data);
      };
      ws.onclose = (ev) => { p.closeCode = ev.code; resolve(); };
    });
    term.onData((d) => { if (p.ws && p.ws.readyState === 1) p.ws.send(enc.encode(d)); });
    return p.connect().then(() => p);
  }
  function screen(id, withScrollback) {
    const buf = panes[id].term.buffer.active;
    const out = [];
    for (let i = withScrollback ? 0 : buf.baseY; i < buf.length; i++) out.push(buf.getLine(i).translateToString(true));
    return out;
  }
  window.spike = {
    mount, panes, screen,
    size: (id) => ({ cols: panes[id].term.cols, rows: panes[id].term.rows }),
    type: (id, s) => panes[id].term.input ? panes[id].term.input(s, true) : panes[id].ws.send(enc.encode(s)),
    paste: (id, s) => panes[id].term.paste(s),
    fit: (id) => { panes[id].fit.fit(); const t = panes[id].term; if (panes[id].ws.readyState === 1) panes[id].ws.send(JSON.stringify({ type: 'resize', cols: t.cols, rows: t.rows })); return { cols: t.cols, rows: t.rows }; },
    setBox: (id, w, h) => { panes[id].el.style.width = w + 'px'; panes[id].el.style.height = h + 'px'; },
    scrollLen: (id) => panes[id].term.buffer.active.length,
    select: (id, line, col, len) => { panes[id].term.select(col, line, len); return panes[id].term.getSelection(); },
    selectAll: (id) => { panes[id].term.selectAll(); return panes[id].term.getSelection(); },
    bracketed: (id) => panes[id].term.modes.bracketedPasteMode,
    cell: (id, line, col) => { const c = panes[id].term.buffer.active.getLine(line).getCell(col); return { ch: c.getChars(), width: c.getWidth(), fgRgb: c.isFgRGB(), fg: c.getFgColor(), bgRgb: c.isBgRGB(), bg: c.getBgColor(), bold: c.isBold() }; },
    title: null,
    state: (id) => ({ opened: panes[id].opened, closeCode: panes[id].closeCode, bytes: panes[id].bytes, replaying: panes[id].replaying }),
  };
})();
