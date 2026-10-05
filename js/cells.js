// Cell references in a finding's text (AB21:AB29, cell AI19, Fig.5e!B2, AO9 = AO11), and the colours
// that show which of the cited cells hold the same values.
const Cells = (() => {
  const colIndex = s => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const colName = i => { let s = ''; for (i++; i > 0; i = (i - 1) / 26 | 0) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
  const ref = ([r0, c0, r1, c1]) => `${colName(c0)}${r0 + 1}` + (r1 !== r0 || c1 !== c0 ? `:${colName(c1)}${r1 + 1}` : '');

  // a bare "B9" is a cell only with something around it that says so: a range, a sheet prefix,
  // "cell(s)" before it, "= B10" after it, or a list that started with an accepted reference
  const TOK = /(?:(?:'([^'\n]{1,40})'|([\w.\-][\w.\- ]{0,39}))!)?\$?\b([A-Z]{1,3})\$?([1-9]\d{0,6})(?:\s?:\s?\$?([A-Z]{1,3})\$?([1-9]\d{0,6}))?(?![\w'’])/g;
  const CELL_WORD = /\bcells?\s*$/i;
  const EQ_AFTER = /^\s*(?:=|==|≡)\s*\$?[A-Z]{1,3}\$?\d/;
  const LIST_SEP = /^\s*(?:,|;|\/|&|=|==|≡|\band\b|\bor\b|\bvs\.?)?\s*(?:\band\b\s*)?$/i;

  function scan(text) {
    const out = [];
    let prevEnd = -1;
    for (const m of text.matchAll(TOK)) {
      const [all, qs, us, a, b, c, d] = m;
      const end = m.index + all.length;
      const ok = c || qs || us || CELL_WORD.test(text.slice(Math.max(0, m.index - 12), m.index)) ||
        EQ_AFTER.test(text.slice(end, end + 16)) || (prevEnd >= 0 && LIST_SEP.test(text.slice(prevEnd, m.index)));
      if (!ok) continue;
      prevEnd = end;
      let r0 = +b - 1, c0 = colIndex(a), r1 = c ? +d - 1 : r0, c1 = c ? colIndex(c) : c0;
      if (r1 < r0) [r0, r1] = [r1, r0];
      if (c1 < c0) [c0, c1] = [c1, c0];
      // pre: characters before the cell itself; an unquoted prefix may carry words before the sheet name
      out.push({ index: m.index, length: all.length, sheet: qs || us || null, quoted: !!qs, pre: all.indexOf('!') + 1, range: [r0, c0, r1, c1] });
    }
    return out;
  }

  // ---------- colouring ----------
  const PAL = 6;                 // distinct colours for groups of identical values; the rest share one
  // the same hues as .h0–.h5, .hr and .mk in app.css (exports and plots use these)
  const HUE = { h0: '#2f6fe4', h1: '#c2329c', h2: '#0f9a7c', h3: '#e0680f', h4: '#7650dd', h5: '#6b9512', hr: '#8a7454', mk: '#d99a00' };
  const MAX_VEC = 5000;          // ranges larger than this are marked but not compared
  const MIN_SHARE = 0.2;         // two ranges pair up when at least this share of their positions match
  const val = (d, r, c) => (d.rows[r] || [])[c];
  const filled = v => v !== undefined && v !== null && v !== '';
  const sig = v => Math.abs(v).toExponential().split('e')[0].replace('.', '').replace(/0+$/, '').length;
  // a match worth showing: not a small integer or a zero that coincides by chance
  const telling = v => typeof v === 'number' ? v !== 0 && sig(v) >= 3 : String(v).trim().length >= 3;
  const same = (x, y) => filled(x) && (x === y || (typeof x === 'number' && typeof y === 'number' && Math.abs(x - y) <= 1e-12 * Math.max(1, Math.abs(x))));
  const short = v => typeof v === 'number' ? String(+v.toPrecision(10)) : String(v).length > 18 ? String(v).slice(0, 17) + '…' : String(v);

  // ranges: [[r0, c0, r1, c1]] analysed; rects: marked only (may be whole rows or columns);
  // external: [{ sheet, range, vals }] cited ranges on other sheets, compared but not drawn
  // returns { cells: Map(key -> class), rects, rows, cols, legend: [{ cls, label, note, at: [r, c] }] }
  // here: this sheet's name, so a pair gets the same colour whichever of its two sheets is shown
  function paint(d, ranges, rects, external, here) {
    const nr = d.rows.length, nc = d.ncols;
    const seen = new Set();
    const R = ranges.filter(x => { const k = x.join(); if (seen.has(k) || x[0] >= nr || x[1] >= nc) return false; seen.add(k); return true; })
      .map(([r0, c0, r1, c1]) => [r0, c0, Math.min(r1, nr - 1), Math.min(c1, nc - 1)]);
    const area = x => (x[2] - x[0] + 1) * (x[3] - x[1] + 1);
    const cellsOf = x => { const o = []; for (let r = x[0]; r <= x[2]; r++) for (let c = x[1]; c <= x[3]; c++) o.push([r, c]); return o; };
    const vecs = R.map(x => area(x) <= MAX_VEC ? cellsOf(x) : null);
    const cells = new Map(), legend = [];
    const K = (r, c) => r * 16384 + c;

    // 1. pairs of cited ranges with the same values in the same positions; each pair (or chain of pairs sharing
    // cells) gets its own colour, strongest pair first. A range on another sheet can pair with one here.
    const E = R.map((x, i) => vecs[i] && { label: ref(x), id: `${here || ''}!${ref(x)}`, at: [x[0], x[1]], cells: vecs[i], n: vecs[i].length, get: k => val(d, ...vecs[i][k]) })
      .concat((external || []).filter(x => x.vals.length <= MAX_VEC).map(x => ({ label: `${x.sheet}!${ref(x.range)}`, id: `${x.sheet}!${ref(x.range)}`, n: x.vals.length, get: k => x.vals[k] })));
    const pairs = [];
    for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
      const a = E[i], b = E[j];
      if (!a || !b || a.n !== b.n || (!a.cells && !b.cells)) continue;
      const hit = [];
      let tell = 0;
      for (let k = 0; k < a.n; k++) { const v = a.get(k); if (same(v, b.get(k))) { hit.push(k); if (telling(v)) tell++; } }
      if (tell >= (a.n === 1 ? 1 : 2) && hit.length >= a.n * MIN_SHARE) pairs.push({ i, j, hit, n: a.n, id: [a.id, b.id].sort().join('|') });
    }
    pairs.sort((x, y) => y.hit.length / y.n - x.hit.length / x.n || y.hit.length - x.hit.length || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    let g = 0;
    const cls = () => g < PAL ? `h${g++}` : 'hr';
    const groups = new Map();   // class -> { members: Set of entry index, m, n }
    pairs.forEach(p => {
      const local = p.hit.flatMap(k => [E[p.i], E[p.j]].filter(e => e.cells).map(e => K(...e.cells[k])));
      if (local.every(k => cells.has(k))) return;
      const c = local.map(k => cells.get(k)).find(Boolean) || cls();
      local.forEach(k => { if (!cells.has(k)) cells.set(k, c); });
      const grp = groups.get(c) || groups.set(c, { members: new Set(), m: 0, n: 0 }).get(c);
      grp.members.add(p.i); grp.members.add(p.j); grp.m += p.hit.length; grp.n += p.n;
    });
    groups.forEach((grp, c) => {
      const members = [...grp.members].sort((x, y) => x - y);
      legend.push({ cls: c, label: members.map(i => E[i].label).join(' = '), note: grp.m === grp.n ? 'identical' : `${grp.m} of ${grp.n} positions identical`, at: E[members[0]].at });
    });

    // 2. the same value in several of the remaining cited cells; scattered repeats need more digits than paired ones
    const rest = vecs.flatMap(v => v || []).filter(([r, c]) => !cells.has(K(r, c)));
    if (rest.length <= MAX_VEC) {
      const by = new Map();
      const done = new Set();
      rest.forEach(([r, c]) => {
        const k = K(r, c), v = val(d, r, c);
        if (done.has(k) || typeof v !== 'number' || v === 0 || sig(v) < 4) return;
        done.add(k);
        const key = String(v);
        (by.get(key) || by.set(key, []).get(key)).push([r, c]);
      });
      const ties = [...by.entries()].filter(([, cs]) => cs.length > 1).sort((x, y) => y[1].length - x[1].length);
      let other = 0, otherAt = null;
      ties.forEach(([, cs]) => {
        const c = cls();
        cs.forEach(([r, cc]) => cells.set(K(r, cc), c));
        if (c === 'hr') { other += cs.length; otherAt = otherAt || cs[0]; return; }
        const v = val(d, cs[0][0], cs[0][1]);
        legend.push({ cls: c, label: `${short(v)} ×${cs.length}`, note: cs.slice(0, 4).map(([r, cc]) => ref([r, cc, r, cc])).join(', ') + (cs.length > 4 ? ` +${cs.length - 4}` : ''), at: cs[0] });
      });
      if (other) legend.push({ cls: 'hr', label: 'Other repeated values', note: `${other} cells`, at: otherAt });
    }

    const marks = R.concat(rects || []);
    const plain = (rects || []).length || R.some((x, i) => !vecs[i] || vecs[i].some(([r, c]) => !cells.has(K(r, c))));
    if (plain) legend.push({ cls: 'mk', label: 'Cited', note: marks.slice(0, 4).map(x => x[2] >= 1e6 ? `column ${colName(x[1])}` : x[3] >= 16383 ? `row ${x[0] + 1}` : ref(x)).join(', ') + (marks.length > 4 ? ` +${marks.length - 4}` : ''), at: [marks[0][0], marks[0][1]] });
    const rows = new Set(), cols = new Set();
    cells.forEach((_, k) => { rows.add(Math.floor(k / 16384)); cols.add(k % 16384); });
    return { cells, rects: marks, rows, cols, legend };
  }

  return { scan, paint, ref, colIndex, colName, HUE };
})();

if (typeof module !== 'undefined') module.exports = Cells;
