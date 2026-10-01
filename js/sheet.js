// Spreadsheet reader: .xlsx/.xlsm, .xls (BIFF5/8), .ods, .csv/.tsv. No dependencies.
// open(file) only reads the sheet list; read(i) streams one sheet and stops at MAX_CELLS,
// so a workbook with a 400 MB sheet opens without loading that sheet whole.
const Sheet = (() => {
  const MAX_CELLS = 500000, MAX_ROWS = 300000;
  const abortErr = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
  const checkAbort = signal => { if (signal && signal.aborted) throw abortErr(); };

  // ---------- values ----------
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const decode = s => s.indexOf('&') < 0 && s.indexOf('_x') < 0 ? s : s
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => e[0] !== '#' ? ENT[e] ?? m : String.fromCodePoint(/x/i.test(e[1]) ? parseInt(e.slice(2), 16) : +e.slice(1)))
    .replace(/_x([\da-f]{4})_/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
  const colIndex = s => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

  const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  const isDateFmt = (id, code) => DATE_IDS.has(id) || (code != null && /[dmyhs]/i.test(code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '')));
  function date(n, d1904) {
    const t = new Date(Math.round(((d1904 ? n + 1462 : n) - 25569) * 864e5));
    if (isNaN(t)) return n;
    const s = t.toISOString();
    return n >= 0 && n < 1 ? s.slice(11, 19) : Number.isInteger(n) ? s.slice(0, 10) : s.slice(0, 19).replace('T', ' ');
  }

  // collects parsed rows; returns false once the sheet is too large to keep
  function sink() {
    const d = { rows: [], ncols: 0, total: 0, truncated: false, cells: 0 };
    d.put = (r, row) => {
      if (!row.length) return true;
      if (r >= MAX_ROWS || d.cells >= MAX_CELLS) { d.truncated = true; return false; }
      d.rows[r] = row;
      d.cells += row.length;
      if (row.length > d.ncols) d.ncols = row.length;
      return true;
    };
    return d;
  }
  const done = d => ({ rows: d.rows, ncols: d.ncols, total: Math.max(d.total, d.rows.length), truncated: d.truncated });

  // ---------- zip ----------
  async function unzip(file) {
    const tailLen = Math.min(file.size, 65557 + 20);
    const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
    let e = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('not a valid zip archive');
    let n = tail.getUint16(e + 10, true), size = tail.getUint32(e + 12, true), off = tail.getUint32(e + 16, true);
    if ((off === 0xFFFFFFFF || n === 0xFFFF) && e >= 20 && tail.getUint32(e - 20, true) === 0x07064b50) {
      const at = Number(tail.getBigUint64(e - 12, true));
      const z = new DataView(await file.slice(at, at + 56).arrayBuffer());
      n = Number(z.getBigUint64(32, true)); size = Number(z.getBigUint64(40, true)); off = Number(z.getBigUint64(48, true));
    }
    const cd = new DataView(await file.slice(off, off + size).arrayBuffer());
    const dec = new TextDecoder(), out = new Map();
    for (let p = 0, k = 0; k < n && p + 46 <= cd.byteLength && cd.getUint32(p, true) === 0x02014b50; k++) {
      const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true);
      let csize = cd.getUint32(p + 20, true), usize = cd.getUint32(p + 24, true), loc = cd.getUint32(p + 42, true);
      for (let q = p + 46 + nl, end = q + xl; q + 4 <= end; q += 4 + cd.getUint16(q + 2, true)) {
        if (cd.getUint16(q, true) !== 1) continue;
        let r = q + 4;
        if (usize === 0xFFFFFFFF) { usize = Number(cd.getBigUint64(r, true)); r += 8; }
        if (csize === 0xFFFFFFFF) { csize = Number(cd.getBigUint64(r, true)); r += 8; }
        if (loc === 0xFFFFFFFF) loc = Number(cd.getBigUint64(r, true));
      }
      const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nl)).replace(/^\//, '').toLowerCase();
      out.set(name, { method: cd.getUint16(p + 10, true), csize, usize, loc });
      p += 46 + nl + xl + cl;
    }
    return out;
  }

  async function entryBytes(file, e) {
    const h = new DataView(await file.slice(e.loc, e.loc + 30).arrayBuffer());
    const start = e.loc + 30 + h.getUint16(26, true) + h.getUint16(28, true);
    const s = file.slice(start, start + e.csize).stream();
    if (e.method === 0) return s;
    if (e.method === 8) return s.pipeThrough(new DecompressionStream('deflate-raw'));
    throw new Error(`unsupported zip compression (${e.method})`);
  }
  const entryText = async (file, e) => new Response(await entryBytes(file, e)).text();
  const entryXml = async (file, e) => new DOMParser().parseFromString(await entryText(file, e), 'application/xml');

  // feeds the decoded text to eat(buf) chunk by chunk; eat returns how much of buf it used, or -1 to stop
  async function scan(file, e, eat, signal) {
    const rd = (await entryBytes(file, e)).pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    try {
      for (;;) {
        const { done, value } = await rd.read();
        checkAbort(signal);
        if (value) buf += value;
        const used = eat(buf);
        if (used < 0 || done) break;
        buf = buf.slice(used);
      }
    } finally { rd.cancel().catch(() => { }); }
  }

  // ---------- xlsx ----------
  const tag = n => `<(?:\\w+:)?${n}\\b[^>]*?(?:\\/>|>([\\s\\S]*?)<\\/(?:\\w+:)?${n}>)`;
  const RE_ROW = new RegExp(tag('row'), 'g'), RE_C = new RegExp(tag('c'), 'g'), RE_SI = new RegExp(tag('si'), 'g'), RE_T = new RegExp(tag('t'), 'g');
  const RE_V = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/, RE_RPH = /<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g;
  const attr = (s, n) => { const m = s.match(new RegExp(`\\s${n}="([^"]*)"`)); return m ? m[1] : null; };
  const texts = s => decode([...s.replace(RE_RPH, '').matchAll(RE_T)].map(m => m[1] || '').join(''));
  const byLocal = (doc, n) => [...doc.getElementsByTagNameNS('*', n)];
  const relId = el => { const a = [...el.attributes].find(x => x.localName === 'id' && x.prefix); return a ? a.value : null; };
  function resolve(base, target) {
    const parts = (target.startsWith('/') ? target.slice(1) : base + target).split('/'), out = [];
    parts.forEach(p => p === '..' ? out.pop() : p && p !== '.' && out.push(p));
    return out.join('/').toLowerCase();
  }

  async function xlsx(file, z) {
    const rels = async path => {
      const e = z.get(path.replace(/([^/]*)$/, '_rels/$1.rels'));
      return e ? byLocal(await entryXml(file, e), 'Relationship').map(r => ({ id: r.getAttribute('Id'), type: r.getAttribute('Type') || '', target: r.getAttribute('Target') || '' })) : [];
    };
    const main = (await rels('')).find(r => /\/officeDocument$/.test(r.type));
    const wbPath = main ? resolve('', main.target) : 'xl/workbook.xml';
    const base = wbPath.replace(/[^/]*$/, '');
    if (!z.get(wbPath)) throw new Error(z.has('xl/workbook.bin') ? 'binary .xlsb workbooks are not supported; save as .xlsx' : 'no workbook found in the file');
    const wb = await entryXml(file, z.get(wbPath));
    const wrels = await rels(wbPath);
    const target = type => { const r = wrels.find(x => x.type.endsWith('/' + type)); return r && z.get(resolve(base, r.target)); };
    const pr = byLocal(wb, 'workbookPr')[0], d1904 = !!pr && /^(1|true)$/.test(pr.getAttribute('date1904') || '');
    const sheets = byLocal(wb, 'sheet').map(s => {
      const r = wrels.find(x => x.id === relId(s));
      return { name: s.getAttribute('name') || '', hidden: /hidden/i.test(s.getAttribute('state') || ''), entry: r && /\/worksheet$/.test(r.type) ? z.get(resolve(base, r.target)) : null };
    }).filter(s => s.entry);

    let shared = null;
    const prepare = () => shared || (shared = (async () => {
      const sst = [], se = target('sharedStrings'), te = target('styles');
      if (se) await scan(file, se, buf => {
        let used = 0, m;
        RE_SI.lastIndex = 0;
        while ((m = RE_SI.exec(buf))) { sst.push(m[1] ? texts(m[1]) : ''); used = RE_SI.lastIndex; }
        return used;
      });
      const dates = [];
      if (te) {
        const doc = await entryXml(file, te);
        const codes = Object.fromEntries(byLocal(doc, 'numFmt').map(f => [+f.getAttribute('numFmtId'), f.getAttribute('formatCode')]));
        const xfs = byLocal(doc, 'cellXfs')[0];
        if (xfs) byLocal(xfs, 'xf').forEach((x, i) => { const id = +x.getAttribute('numFmtId') || 0; dates[i] = isDateFmt(id, codes[id]); });
      }
      return { sst, dates };
    })().catch(e => { shared = null; throw e; }));

    async function read(i, { signal, progress } = {}) {
      const { sst, dates } = await prepare();
      const d = sink();
      let next = 0;
      const value = (a, inner) => {
        const t = attr(a, 't') || 'n';
        if (t === 'inlineStr') return texts(inner);
        const m = inner.match(RE_V);
        if (!m || !m[1]) return '';
        const v = m[1];
        if (t === 's') return sst[+v] ?? '';
        if (t === 'b') return v === '1' ? 'TRUE' : 'FALSE';
        if (t !== 'n') return decode(v);
        const n = +v, s = attr(a, 's');
        return s && dates[+s] ? date(n, d1904) : n;
      };
      await scan(file, sheets[i].entry, buf => {
        if (!d.total) { const m = buf.match(/<(?:\w+:)?dimension\s+ref="[A-Z]*\d*:?[A-Z]*(\d+)"/); if (m) d.total = +m[1]; }
        let used = 0, m;
        RE_ROW.lastIndex = 0;
        while ((m = RE_ROW.exec(buf))) {
          used = RE_ROW.lastIndex;
          const rr = attr(m[0].slice(0, m[0].indexOf('>')), 'r'), r = rr ? rr - 1 : next;
          next = r + 1;
          if (!m[1]) continue;
          const row = [];
          let c = 0;
          for (const cm of m[1].matchAll(RE_C)) {
            const a = cm[0].slice(0, cm[0].indexOf('>')), ref = attr(a, 'r');
            if (ref) c = colIndex(ref.replace(/\d+$/, ''));
            if (cm[1]) { const v = value(a, cm[1]); if (v !== '') row[c] = v; }
            c++;
          }
          if (!d.put(r, row)) return -1;
        }
        if (progress) progress(d.rows.length);
        return used;
      }, signal);
      return done(d);
    }
    return { sheets: sheets.map(({ name, hidden }) => ({ name, hidden })), read };
  }

  // ---------- ods ----------
  async function ods(file, z) {
    const e = z.get('content.xml');
    if (!e) throw new Error('no content.xml in the file');
    if (e.usize > 120e6) throw new Error('this .ods is too large to open here; save it as .xlsx');
    const doc = await entryXml(file, e);
    const T = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0', O = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
    const tables = [...doc.getElementsByTagNameNS(T, 'table')];
    const value = td => {
      const t = td.getAttributeNS(O, 'value-type');
      if (t === 'float' || t === 'percentage' || t === 'currency') return +td.getAttributeNS(O, 'value');
      if (t === 'date') return td.getAttributeNS(O, 'date-value').replace('T', ' ');
      if (t === 'boolean') return td.getAttributeNS(O, 'boolean-value') === 'true' ? 'TRUE' : 'FALSE';
      return [...td.children].filter(p => p.localName === 'p').map(p => p.textContent).join('\n');
    };
    async function read(i) {
      const d = sink();
      let r = 0;
      for (const tr of tables[i].getElementsByTagNameNS(T, 'table-row')) {
        const rep = +tr.getAttributeNS(T, 'number-rows-repeated') || 1, row = [];
        let c = 0;
        for (const td of tr.children) {
          if (td.localName !== 'table-cell' && td.localName !== 'covered-table-cell') continue;
          const crep = +td.getAttributeNS(T, 'number-columns-repeated') || 1, v = value(td);
          if (v !== '') for (let k = 0; k < Math.min(crep, 1024); k++) row[c + k] = v;
          c += crep;
        }
        for (let k = 0; k < (row.length ? Math.min(rep, 1000) : 0); k++) if (!d.put(r + k, row)) return done(d);
        r += rep;
      }
      return done(d);
    }
    return { sheets: tables.map(t => ({ name: t.getAttributeNS(T, 'name') || 'Sheet', hidden: false })), read };
  }

  // ---------- xls (BIFF5/8 in an OLE compound file) ----------
  function cfbStream(buf, names) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    const ss = 1 << dv.getUint16(30, true), ms = 1 << dv.getUint16(32, true), cutoff = dv.getUint32(56, true);
    const at = s => (s + 1) * ss;
    const u32s = b => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength), o = []; for (let i = 0; i + 4 <= b.length; i += 4) o.push(v.getUint32(i, true)); return o; };
    const difat = [];
    for (let i = 0; i < 109; i++) difat.push(dv.getUint32(76 + 4 * i, true));
    for (let s = dv.getUint32(68, true), k = dv.getUint32(72, true); k-- > 0 && s < 0xFFFFFFFA && at(s) + ss <= buf.byteLength;) {
      for (let i = 0; i < ss / 4 - 1; i++) difat.push(dv.getUint32(at(s) + 4 * i, true));
      s = dv.getUint32(at(s) + ss - 4, true);
    }
    const fat = [];
    difat.forEach(s => { if (s < 0xFFFFFFFA && at(s) + ss <= buf.byteLength) fat.push(...u32s(u8.subarray(at(s), at(s) + ss))); });
    const chain = (s, next) => { const o = []; while (s < 0xFFFFFFFA && s < next.length && o.length <= next.length) { o.push(s); s = next[s]; } return o; };
    const read = (src, s, size, next, unit, off) => {
      const out = new Uint8Array(size);
      let o = 0;
      for (const x of chain(s, next)) { if (o >= size) break; const n = Math.min(unit, size - o); out.set(src.subarray(off(x), off(x) + n), o); o += n; }
      return out;
    };
    const dir0 = dv.getUint32(48, true), dir = read(u8, dir0, chain(dir0, fat).length * ss, fat, ss, at);
    const dd = new DataView(dir.buffer), ents = [];
    for (let p = 0; p + 128 <= dir.length; p += 128) {
      const nl = Math.min(64, dd.getUint16(p + 64, true));
      ents.push({ name: String.fromCharCode(...new Uint16Array(dir.buffer.slice(p, p + Math.max(0, nl - 2)))), type: dir[p + 66], start: dd.getUint32(p + 116, true), size: dd.getUint32(p + 120, true) });
    }
    const e = ents.find(x => x.type === 2 && names.includes(x.name.toLowerCase()));
    if (!e) throw new Error(ents.some(x => /encrypt/i.test(x.name)) ? 'the workbook is password-protected' : 'no workbook stream found');
    if (e.size >= cutoff) return read(u8, e.start, e.size, fat, ss, at);
    const mini = read(u8, ents[0].start, ents[0].size, fat, ss, at), m0 = dv.getUint32(60, true);
    const mfat = u32s(read(u8, m0, chain(m0, fat).length * ss, fat, ss, at));
    return read(mini, e.start, e.size, mfat, ms, x => x * ms);
  }

  const ERR = { 0: '#NULL!', 7: '#DIV/0!', 15: '#VALUE!', 23: '#REF!', 29: '#NAME?', 36: '#NUM!', 42: '#N/A' };
  function xls(buf) {
    const b = cfbStream(buf, ['workbook', 'book']);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const u16 = p => dv.getUint16(p, true), u32 = p => dv.getUint32(p, true);
    const latin = (p, n) => { let s = ''; for (let i = 0; i < n; i += 8192) s += String.fromCharCode.apply(null, b.subarray(p + i, p + Math.min(n, i + 8192))); return s; };
    const utf16 = (p, n) => new TextDecoder('utf-16le').decode(b.subarray(p, p + 2 * n));
    const ustr = (p, n) => b[p] & 1 ? utf16(p + 1, n) : latin(p + 1, n);   // option byte at p, then chars
    const rkv = new DataView(new ArrayBuffer(8));
    const rk = v => { let n; if (v & 2) n = v >> 2; else { rkv.setUint32(0, 0, true); rkv.setUint32(4, v & 0xFFFFFFFC, true); n = rkv.getFloat64(0, true); } return v & 1 ? n / 100 : n; };
    if (u16(0) !== 0x0809) throw new Error('Excel 2.x–4.x files are not supported; save as .xlsx');
    let v8 = u16(4) === 0x0600, d1904 = false, sst = [];
    const sheets = [], xf = [], fmts = {};

    // shared strings run on through CONTINUE records, with an option byte wherever a string is split
    function readSst(segs) {
      let si = 0, p = segs[0][0];
      const take = () => { if (p < segs[si][1]) return false; if (++si >= segs.length) throw new RangeError(); p = segs[si][0]; return true; };
      const byte = () => { take(); return b[p++]; };
      const word = () => byte() | byte() << 8;
      const dword = () => (word() | word() << 16) >>> 0;
      const skip = n => { while (n > 0) { take(); const k = Math.min(n, segs[si][1] - p); p += k; n -= k; } };
      const out = [];
      try {
        dword();
        for (let i = 0, count = dword(); i < count; i++) {
          const cch = word(), fl = byte(), runs = fl & 8 ? word() : 0, ext = fl & 4 ? dword() : 0;
          let hi = fl & 1, left = cch, s = '';
          while (left > 0) {
            if (take()) hi = b[p++] & 1;
            const room = segs[si][1] - p, k = Math.min(left, hi ? room >> 1 : room);
            if (!k) break;
            s += hi ? utf16(p, k) : latin(p, k);
            p += hi ? 2 * k : k; left -= k;
          }
          skip(4 * runs + ext);
          out.push(s);
        }
      } catch (e) { if (!(e instanceof RangeError)) throw e; }
      return out;
    }

    for (let p = 0; p + 4 <= b.length;) {
      const t = u16(p), n = u16(p + 2), d = p + 4;
      p = d + n;
      if (t === 0x000A) break;
      if (t === 0x002F) throw new Error('the workbook is password-protected');
      if (t === 0x0022) d1904 = u16(d) === 1;
      else if (t === 0x041E) fmts[u16(d)] = v8 ? ustr(d + 4, u16(d + 2)) : latin(d + 3, b[d + 2]);
      else if (t === 0x00E0) xf.push(u16(d + 2));
      else if (t === 0x0085 && b[d + 5] === 0) sheets.push({ pos: u32(d), hidden: (b[d + 4] & 3) > 0, name: v8 ? ustr(d + 7, b[d + 6]) : latin(d + 7, b[d + 6]) });
      else if (t === 0x00FC) {
        const segs = [[d, d + n]];
        while (p + 4 <= b.length && u16(p) === 0x003C) { segs.push([p + 4, p + 4 + u16(p + 2)]); p += 4 + u16(p + 2); }
        sst = readSst(segs);
      }
    }
    const isDate = i => { const id = xf[i]; return id != null && isDateFmt(id, fmts[id]); };

    function read(i) {
      const d = sink(), rows = [];
      let pending = null;
      const set = (r, c, v) => { if (v !== '' && v != null) (rows[r] || (rows[r] = []))[c] = v; };
      const num = (r, c, x, n) => set(r, c, isDate(x) ? date(n, d1904) : n);
      for (let p = sheets[i].pos; p + 4 <= b.length;) {
        const t = u16(p), n = u16(p + 2), q = p + 4, r = n >= 4 ? u16(q) : 0, c = n >= 4 ? u16(q + 2) : 0;
        p = q + n;
        if (t === 0x000A) break;
        if (t === 0x0200) d.total = v8 ? u32(q + 4) : u16(q + 2);
        else if (t === 0x00FD) set(r, c, sst[u32(q + 6)]);
        else if (t === 0x0203) num(r, c, u16(q + 4), dv.getFloat64(q + 6, true));
        else if (t === 0x027E) num(r, c, u16(q + 4), rk(u32(q + 6)));
        else if (t === 0x00BD) for (let k = 0, o = q + 4; o + 6 <= q + n - 2; k++, o += 6) num(r, c + k, u16(o), rk(u32(o + 2)));
        else if (t === 0x0204 || t === 0x00D6) set(r, c, v8 ? ustr(q + 8, u16(q + 6)) : latin(q + 8, u16(q + 6)));
        else if (t === 0x0205) set(r, c, b[q + 7] ? ERR[b[q + 6]] || '#ERR' : b[q + 6] ? 'TRUE' : 'FALSE');
        else if (t === 0x0006) {
          if (u16(q + 12) !== 0xFFFF) num(r, c, u16(q + 4), dv.getFloat64(q + 6, true));
          else if (b[q + 6] === 0) pending = [r, c];
          else if (b[q + 6] === 1) set(r, c, b[q + 8] ? 'TRUE' : 'FALSE');
          else if (b[q + 6] === 2) set(r, c, ERR[b[q + 8]] || '#ERR');
        }
        else if (t === 0x0207 && pending) { set(pending[0], pending[1], v8 ? ustr(q + 2, u16(q)) : latin(q + 2, u16(q))); pending = null; }
      }
      rows.forEach((row, r) => d.put(r, row));
      return done(d);
    }
    return { sheets: sheets.map(({ name, hidden }) => ({ name, hidden })), read: async i => read(i) };
  }

  // ---------- csv / tsv ----------
  async function csv(file, ext) {
    const head = await file.slice(0, 65536).text();
    if (/^\s*</.test(head)) throw new Error('this is an HTML/XML table, not a spreadsheet; open it in Excel and save as .xlsx');
    let delim = ',';
    if (ext === 'tsv' || ext === 'tab') delim = '\t';
    else {
      const line = head.replace(/"[^"]*"/g, '').split(/\r?\n/)[0];
      const counts = [',', '\t', ';', '|'].map(x => [x, line.split(x).length]);
      delim = counts.sort((a, b) => b[1] - a[1])[0][1] > 1 ? counts[0][0] : ',';
    }
    async function read(_, { signal, progress } = {}) {
      const d = sink(), rd = file.stream().pipeThrough(new TextDecoderStream()).getReader();
      let row = [], f = '', c = 0, r = 0, q = false, closed = false;
      const endField = () => { if (f !== '') row[c] = f; f = ''; c++; };
      try {
        for (;;) {
          const { done: end, value } = await rd.read();
          checkAbort(signal);
          if (end) break;
          for (let i = 0; i < value.length; i++) {
            const ch = value[i];
            if (q) { if (ch === '"') { q = false; closed = true; } else f += ch; continue; }
            if (ch === '"') {   // opening quote, "" inside a quoted field, or a stray quote kept as text
              if (closed) { f += '"'; q = true; } else if (f === '') q = true; else f += '"';
              closed = false;
              continue;
            }
            closed = false;
            if (ch === delim) endField();
            else if (ch === '\n') { endField(); if (!d.put(r++, row)) return done(d); row = []; c = 0; }
            else if (ch !== '\r') f += ch;
          }
          if (progress) progress(r);
        }
        if (f !== '' || c) { endField(); d.put(r, row); }
      } finally { rd.cancel().catch(() => { }); }
      return done(d);
    }
    return { sheets: [{ name: file.name.replace(/\.\w+$/, ''), hidden: false }], read };
  }

  async function open(file) {
    const ext = (file.name.match(/\.(\w+)$/) || [, ''])[1].toLowerCase();
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (head[0] === 0x50 && head[1] === 0x4B) {
      const z = await unzip(file);
      return z.has('content.xml') && !z.has('[content_types].xml') ? ods(file, z) : xlsx(file, z);
    }
    if (head[0] === 0xD0 && head[1] === 0xCF && head[2] === 0x11 && head[3] === 0xE0) return xls(await file.arrayBuffer());
    if (/^xls/.test(ext) || ext === 'ods') throw new Error(`not a readable .${ext} file`);
    return csv(file, ext);
  }

  return { open };
})();
