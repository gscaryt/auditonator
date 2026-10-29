// A workbook of the cells one finding cites, coloured as in the viewer. A sheet small enough is written whole;
// a larger one keeps its first rows and the rows around the marked cells, at their original row and column
// numbers, with the rows in between hidden. Values only: formulas and the workbook's own formatting are not read.
const Export = (() => {
  const FULL_ROWS = 5000, FULL_CELLS = 300000, HEAD = 5, CONTEXT = 5, MAX_ROWS = 20000;
  const CLS = Object.keys(Cells.HUE);
  const tint = (h, a) => 'FF' + [1, 3, 5].map(i => Math.round(255 - (255 - parseInt(h.substr(i, 2), 16)) * a).toString(16).padStart(2, '0')).join('').toUpperCase();
  // style ids: 1 heading, 2 wrapped text, 3 note, then one per highlight class
  const STYLES = [
    { bold: true, fill: 'FFE8EAF0', wrap: true },
    { wrap: true },
    { italic: true, color: 'FF6A7385', wrap: true },
    ...CLS.map(k => ({ bold: k !== 'mk', fill: tint(Cells.HUE[k], k === 'mk' ? 0.32 : 0.38), border: 'FF' + Cells.HUE[k].slice(1).toUpperCase() }))
  ];
  const sid = k => 4 + CLS.indexOf(k);
  const spans = rows => {
    const out = [];
    rows.forEach(r => { const l = out[out.length - 1]; if (l && r === l[1] + 1) l[1] = r; else out.push([r, r]); });
    return out.map(([a, b]) => a === b ? `${a + 1}` : `${a + 1}–${b + 1}`).join(', ');
  };
  const safe = (name, used) => {
    let n = name.replace(/[[\]:*?/\\]/g, '_').slice(0, 31) || 'Sheet', k = 2;
    while (used.has(n.toLowerCase())) n = `${name.slice(0, 27)} (${k++})`;
    used.add(n.toLowerCase());
    return n;
  };

  function sheet(d, paint) {
    const n = d.rows.length;
    const inRect = (r, c) => paint.rects.some(x => r >= x[0] && r <= x[2] && c >= x[1] && c <= x[3]);
    const full = !d.truncated && n <= FULL_ROWS && n * d.ncols <= FULL_CELLS;
    let keep;
    if (full) keep = Array.from({ length: n }, (_, i) => i);
    else {
      const s = new Set();
      const add = (a, b) => { for (let r = Math.max(0, a); r <= Math.min(n - 1, b) && s.size < MAX_ROWS; r++) s.add(r); };
      add(0, HEAD - 1);
      paint.rows.forEach(r => add(r - CONTEXT, r + CONTEXT));
      paint.rects.forEach(x => add(x[0] - CONTEXT, Math.min(x[2], n - 1) + CONTEXT));
      keep = [...s].sort((a, b) => a - b);
    }
    const w = [];
    const rows = keep.map(r => {
      const row = d.rows[r] || [], cs = [];
      for (let c = 0; c < d.ncols; c++) {
        const v = row[c], k = paint.cells.get(r * 16384 + c) || (inRect(r, c) ? 'mk' : null);
        if ((v === undefined || v === null || v === '') && !k) continue;
        cs.push([c, v, k ? sid(k) : 0]);
        const len = Math.min(40, String(v ?? '').length);
        if (!(w[c] >= len)) w[c] = len;
      }
      return [r, cs];
    });
    return { rows, widths: Array.from({ length: d.ncols }, (_, c) => Math.max(8, (w[c] || 0) + 2)), hideRest: !full, scope: full ? 'whole sheet' : `rows ${spans(keep)}${d.truncated ? ` (the sheet is too large to read whole; nothing after row ${n.toLocaleString()} was read)` : ''}` };
  }

  // parts: [{ book: file name, sheet: name, d, paint }]; head: { title, msid, finding }
  function workbook(parts, head) {
    const used = new Set(['key']);
    const out = parts.map(p => ({ ...p, ...sheet(p.d, p.paint), name: safe(p.sheet, used) }));
    const key = [];
    const line = (...cells) => key.push([key.length, cells.map((c, i) => Array.isArray(c) ? [i, ...c] : [i, c, 0]).filter(x => x[1] !== '' || x[2])]);
    line(['Finding', 1], [head.finding, 2]);
    line(['Manuscript', 1], [head.msid, 2]);
    line(['Exported', 1], [new Date().toISOString().slice(0, 16).replace('T', ' '), 2]);
    line();
    line(['Tab', 1], ['Source', 1], ['Rows included', 1]);
    out.forEach(p => line(p.name, `${p.book} · sheet “${p.sheet}”`, [p.scope, 2]));
    line();
    line(['Colour', 1], ['Means', 1], ['Tab', 1]);
    out.forEach(p => p.paint.legend.forEach(x => line([x.label, sid(x.cls)], [x.cls === 'mk' ? 'cited by the finding; no identical counterpart among the cited cells' : x.note, 2], p.name)));
    line();
    [
      'Cells with the same colour hold identical values in the same positions (or the same value, where a value is listed).',
      'Amber cells are cited by the finding but have no identical counterpart among the cited cells.',
      'Every cell keeps its original address. In a partial tab, the rows that were not exported are hidden, so the row numbers jump.',
      'Values only: formulas, number formats and the workbook’s own formatting are not carried over.'
    ].forEach(t => line([t, 3]));
    return XLSX.cells([{ name: 'Key', rows: key, widths: [42, 60, 40] }, ...out.map(p => ({ name: p.name, rows: p.rows, widths: p.widths, hideRest: p.hideRest }))], STYLES);
  }

  return { workbook };
})();
