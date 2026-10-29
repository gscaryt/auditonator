// Read-only sheet grid. Only the rows and columns in view (plus a margin) are in the DOM,
// so a sheet of several hundred thousand cells scrolls like a small one.
const Grid = (() => {
  const RH = 22, OVER = 40;
  const colName = i => { let s = ''; for (i++; i > 0; i = (i - 1) / 26 | 0) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
  const fmt = v => typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(+v.toPrecision(15))) : v == null ? '' : String(v);
  const exact = v => typeof v === 'number' ? String(v) : fmt(v);   // full stored precision
  const NUM = /^\s*[-+]?(\d[\d,]*\.?\d*|\.\d+)(e[-+]?\d+)?%?\s*$/i;
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function create(host, onSelect) {
    let d = null, widths = [], lefts = [0], RW = 40, win = null, sel = null, paint = null, hits = null, raf = 0;
    host.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); });
    new ResizeObserver(() => draw()).observe(host);
    host.addEventListener('click', e => {
      const td = e.target.closest('td[data-c]');
      if (td) select(+td.parentNode.dataset.r, +td.dataset.c, false);
    });

    // rects: [r0, c0, r1, c1], 0-based, inclusive
    const inRect = (r, c) => paint.rects.some(x => r >= x[0] && r <= x[2] && c >= x[1] && c <= x[3]);
    const markCls = (r, c) => paint ? paint.cells.get(r * 16384 + c) || (inRect(r, c) ? 'mk' : '') : '';
    const rowMarked = r => paint && (paint.rows.has(r) || paint.rects.some(x => r >= x[0] && r <= x[2] && x[3] < 16383));
    const colMarked = c => paint && (paint.cols.has(c) || paint.rects.some(x => c >= x[1] && c <= x[3] && x[2] < 1e6));

    function show(data) {
      d = data; sel = null; paint = null; hits = null; win = null;
      const w = [];
      const sample = d.rows.length > 600 ? d.rows.slice(0, 400).concat(d.rows.slice(-200)) : d.rows;
      sample.forEach(row => row && row.forEach((v, c) => { const n = Math.min(40, fmt(v).length); if (!(w[c] >= n)) w[c] = n; }));
      widths = Array.from({ length: d.ncols }, (_, c) => Math.max(52, Math.min(280, (w[c] || 0) * 7 + 16)));
      lefts = [0];
      widths.forEach(x => lefts.push(lefts[lefts.length - 1] + x));
      RW = Math.max(40, String(d.rows.length).length * 8 + 16);
      host.scrollTop = 0; host.scrollLeft = 0;
      onSelect('', '');
      draw(true);
    }

    function clear() { d = null; host.innerHTML = ''; onSelect('', ''); }

    function draw(force) {
      if (!d) return;
      const H = host.clientHeight, W = host.clientWidth, nr = d.rows.length, nc = d.ncols;
      const r0 = Math.floor(host.scrollTop / RH), r1 = r0 + Math.ceil(H / RH) + 1;
      const x0 = Math.max(0, host.scrollLeft - RW), x1 = x0 + W;
      if (!force && win && r0 >= win.a && (r1 <= win.b || win.b === nr) && x0 >= lefts[win.ca] && (x1 <= lefts[win.cb] || win.cb === nc)) return;
      const a = Math.max(0, r0 - OVER), b = Math.min(nr, r1 + OVER);
      let ca = 0, cb;
      while (ca < nc && lefts[ca + 1] <= x0 - W) ca++;
      for (cb = ca; cb < nc && lefts[cb] < x1 + W; cb++);
      win = { a, b, ca, cb };
      const cols = [];
      for (let c = ca; c < cb; c++) cols.push(c);
      const hit = hits && hits.set;
      let h = `<table style="width:${RW + lefts[nc]}px"><colgroup><col style="width:${RW}px"><col style="width:${lefts[ca]}px">${cols.map(c => `<col style="width:${widths[c]}px">`).join('')}<col style="width:${lefts[nc] - lefts[cb]}px"></colgroup>`;
      h += `<thead><tr><th class="cr"></th><th class="gap"></th>${cols.map(c => `<th${colMarked(c) ? ' class="mk"' : ''}>${colName(c)}</th>`).join('')}<th class="gap"></th></tr></thead><tbody>`;
      if (a) h += `<tr class="gap"><td colspan="${cols.length + 3}" style="height:${a * RH}px"></td></tr>`;
      for (let r = a; r < b; r++) {
        const row = d.rows[r] || [];
        h += `<tr data-r="${r}"><th${rowMarked(r) ? ' class="mk"' : ''}>${r + 1}</th><td class="gap"></td>`;
        for (const c of cols) {
          const v = row[c], s = fmt(v);
          const m = markCls(r, c);
          const cls = (typeof v === 'number' || NUM.test(s) ? 'n ' : '') + (m ? m + ' ' : '') + (hit && hit.has(r * 16384 + c) ? 'hit ' : '') + (sel && sel.r === r && sel.c === c ? 'sel' : '');
          h += `<td data-c="${c}"${cls ? ` class="${cls.trim()}"` : ''}${s.length > 30 ? ` title="${esc(s.slice(0, 500))}"` : ''}>${esc(s)}</td>`;
        }
        h += '<td class="gap"></td></tr>';
      }
      if (b < nr) h += `<tr class="gap"><td colspan="${cols.length + 3}" style="height:${(nr - b) * RH}px"></td></tr>`;
      host.innerHTML = h + '</tbody></table>';
    }

    function select(r, c, scroll) {
      if (!d) return;
      sel = { r, c };
      onSelect(`${colName(c)}${r + 1}`, exact((d.rows[r] || [])[c]));
      if (scroll) {
        const H = host.clientHeight, W = host.clientWidth - RW;
        if (r * RH < host.scrollTop || (r + 2) * RH > host.scrollTop + H) host.scrollTop = Math.max(0, r * RH - H / 3);
        if (lefts[c] < host.scrollLeft || lefts[c + 1] > host.scrollLeft + W) host.scrollLeft = Math.max(0, lefts[c] - 40);
      }
      draw(true);
    }

    // target: { ranges: [[r0, c0, r1, c1]] compared for identical values, rects: [...] marked only,
    // focus: [r, c] } — all 0-based. Returns the colour key.
    // external: cited ranges on other sheets with their values; still: repaint without moving the view
    function highlight(t, still) {
      if (!d) return [];
      paint = Cells.paint(d, t.ranges || [], t.rects || [], t.external, t.sheet);
      if (!paint.cells.size && !paint.rects.length) { paint = null; draw(true); return []; }
      if (still) { draw(true); return paint.legend; }
      const at = t.focus || (paint.legend[0] && paint.legend[0].at) || [0, 0];
      select(Math.min(at[0], d.rows.length - 1), Math.min(at[1], d.ncols - 1), true);
      return paint.legend;
    }

    function unmark() { paint = null; draw(true); }
    const jump = (r, c) => d && select(Math.min(r, d.rows.length - 1), Math.min(c, d.ncols - 1), true);

    function find(q, back) {
      if (!d) return null;
      q = q.trim().toLowerCase();
      if (!q) { hits = null; draw(true); return null; }
      if (!hits || hits.q !== q) {
        const list = [];
        d.rows.forEach((row, r) => row && row.forEach((v, c) => { if (list.length < 50000 && exact(v).toLowerCase().includes(q)) list.push(r * 16384 + c); }));
        hits = { q, list, set: new Set(list) };
      }
      const L = hits.list;
      if (!L.length) { draw(true); return { i: 0, n: 0 }; }
      const cur = sel ? sel.r * 16384 + sel.c : -1;
      let i = back ? L.findLastIndex(k => k < cur) : L.findIndex(k => k > cur);
      if (i < 0) i = back ? L.length - 1 : 0;
      select(Math.floor(L[i] / 16384), L[i] % 16384, true);
      return { i: i + 1, n: L.length };
    }

    return { show, clear, highlight, unmark, jump, find, draw, data: () => d, painted: () => paint };
  }

  return { create };
})();
