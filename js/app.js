// Auditonator — review of a manuscript consistency audit. By Gustavo Tontini.
(() => {
  const $ = s => document.querySelector(s);
  const { inline, esc } = MD;
  const COLOURS = ['black', 'red', 'yellow', 'green', 'none'];
  const CNAME = { black: 'Black', red: 'Red', yellow: 'Yellow', green: 'Green', none: 'Unranked' };
  const CDESC = {
    black: 'central claim cannot stand as written',
    red: 'must be resolved before the claim can be accepted',
    yellow: 'robustness or quality in question',
    green: 'minor; correct version evident',
    none: 'not in the triage'
  };
  const KEY = 'auditonator:last';
  // label colours: calm hues kept clear of the triage colours
  const LCOL = ['#3563d9', '#0e8f8a', '#7a4fd6', '#c03b8f', '#8a6239', '#5b6678', '#0a87b5', '#4c4fbf'];
  const CE = (() => { try { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true'; } catch (e) { return 'true'; } })();

  let src = { audit: '', auditName: '', critical: '', criticalName: '' };
  // pdfs: everything the viewer pane shows, PDFs and Word files ({ kind: 'docx' }) first, then spreadsheets ({ kind: 'sheet' })
  let st = null, model = null, pdfs = [], pdfIdx = 0, dirty = false, fileHandle = null, autosaveT = 0, docSeq = 0;
  // plots: the audit's finding plots, PNGs named F<finding numbers>_<panel>.png (F03_Fig3F.png, F03+07_Fig2A.png)
  let plots = [];
  const PLOT_NAME = /^F(\d+(?:\+\d+)*)_.+\.png$/i;
  const plotsOf = id => plots.filter(p => p.ids.includes(String(id)));
  const dropPlots = () => { plots.forEach(p => URL.revokeObjectURL(p.url)); plots = []; };
  const SHEET_EXT = /\.(xlsx|xlsm|xls|ods|csv|tsv)$/i;
  const DOCX_EXT = /\.docx$/i;
  const isText = p => p.kind === 'pdf' || p.kind === 'docx';
  const freeDoc = p => { if (p.url) URL.revokeObjectURL(p.url); if (p.doc) p.doc.then(d => d.urls.forEach(u => URL.revokeObjectURL(u)), () => { }); };
  const VIEW_ACCEPT = '.pdf,.docx,.xlsx,.xlsm,.xls,.ods,.csv,.tsv';
  const ui = { tab: 'findings', sel: null, colours: new Set(), status: 'all', q: '', ents: new Set(), entMode: 'any', types: new Set(), labels: new Set(), pop: null, open: false, edit: null, pdf: false, claimOpen: false };

  const plain = s => s.replace(/<[^>]+>/g, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1$2').replace(/`([^`]+)`/g, '$1');
  const fstate = id => st.findings[id] || (st.findings[id] = {});
  const status = id => (st.findings[id] || {}).s || null;
  const fname = f => f.pseudo ? 'Typos' : `#${f.id}`;
  const labelsOf = id => (st.findings[id] || {}).labels || [];
  const lcol = name => { const d = st.labels.find(l => l.name === name); return LCOL[d ? d.c % LCOL.length : 0]; };
  const custom = id => (st.custom || []).find(u => u.id === id);

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2200);
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- state ----------
  function freshState(A) {
    if (A) Parse.match(A.findings, A.queries, A.groups);
    return { msid: A ? A.msid : '', findings: {}, queries: A ? A.queries.map(q => ({ ...q, include: true })) : [], groups: A ? A.groups : {}, labels: [], custom: [] };
  }

  function build() {
    const A = src.audit ? Parse.parseAudit(src.audit) : null;
    const C = src.critical ? Parse.parseCritical(src.critical) : null;
    const map = new Map();
    (A ? A.findings : []).forEach((f, i) => map.set(f.id, { ...f, doc: i, colour: f.colour || 'none', brief: '', head: '', rank: 1e4, with: [] }));
    if (C) C.entries.forEach((e, r) => e.ids.forEach(id => {
      const f = map.get(id) || { id, title: e.head || e.brief, location: '', section: '', body: '', doc: 1e3 + r };
      map.set(id, Object.assign(f, { colour: e.colour, brief: e.brief, head: e.head, rank: r, with: e.ids.filter(x => x !== id), conditional: f.conditional || e.conditional }));
    }));
    st.labels = st.labels || []; st.custom = st.custom || [];
    // findings added in the app: kept in the saved work, never in the audit file
    st.custom.forEach((u, i) => map.set(u.id, {
      id: u.id, custom: true, title: u.title.trim() || 'Untitled finding', location: '', section: 'Added', body: u.body || '',
      doc: 2e5 + i, rank: 2e4 + i, with: [], colour: u.colour || 'none', head: '', brief: plain(u.body || '').replace(/^[#>*\-\s]+/gm, '').replace(/\s+/g, ' ').trim().slice(0, 300)
    }));
    if (st.queries.some(q => q.finding === 'T') || (C && C.typo)) {
      map.set('T', {
        id: 'T', pseudo: true, title: 'Typographical issues', location: '', section: '', body: '', doc: 1e5, rank: 1e4 - 1, with: [],
        colour: C && C.typo ? C.typo.colour : 'green', head: '', brief: C && C.typo ? C.typo.text.replace(/^[^—]*—\s*/, '') : ''
      });
    }
    const all = [...map.values()];
    all.forEach(f => {
      f.colour0 = f.colour;
      const o = (st.findings[f.id] || {}).colour;
      if (o && COLOURS.includes(o)) f.colour = o;
      const qs = st.queries.filter(q => q.finding === f.id).map(q => q.text);
      const u = f.custom && custom(f.id);
      const types = u ? u.types : f.meta ? f.meta.types.map(Facets.typeOf).filter(Boolean) : [];
      f.types = types.length ? [...new Set(types)] : u ? ['other'] : [Facets.type(f)];
      f.type = f.types[0];
      f.ents = Facets.entities(u ? u.ents || [u.title, u.body].join('\n') : f.meta && f.meta.ents ? f.meta.ents : [f.title, f.location, f.head, f.brief, f.body, ...qs].join('\n'));
    });
    model = {
      A, C, map,
      msid: (A && A.msid) || (C && C.msid) || st.msid || '',
      title: (C && C.title) || (A && A.manuscript) || '',
      order: all.slice().sort((a, b) => COLOURS.indexOf(a.colour) - COLOURS.indexOf(b.colour) || a.rank - b.rank || a.doc - b.doc),
      doc: all.slice().sort((a, b) => a.doc - b.doc)
    };
    if (!map.has(ui.sel)) ui.sel = model.order.length ? model.order[0].id : null;
    if (build.msid !== model.msid) { ui.ents.clear(); ui.types.clear(); ui.labels.clear(); ui.open = false; ui.edit = null; build.msid = model.msid; }
    [...ui.labels].forEach(l => { if (!st.labels.some(d => d.name === l)) ui.labels.delete(l); });
  }

  function changed() {
    dirty = true;
    clearTimeout(autosaveT);
    autosaveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(snapshot())); } catch (e) { } }, 400);
  }

  function snapshot() {
    return {
      app: 'auditonator', v: 1, savedAt: new Date().toISOString(), msid: model ? model.msid : '',
      audit: { name: src.auditName, text: src.audit }, critical: { name: src.criticalName, text: src.critical },
      pdfs: pdfs.map(p => ({ name: p.name, offset: p.offset })),
      state: st, ui: { sel: ui.sel }
    };
  }

  function restore(s) {
    if (!s || s.app !== 'auditonator') return toast('Not an Auditonator save file');
    src = { audit: s.audit.text || '', auditName: s.audit.name || '', critical: s.critical.text || '', criticalName: s.critical.name || '' };
    st = s.state;
    pdfs.forEach(freeDoc);
    pdfs = []; fileHandle = null; dropPlots();
    const want = (s.pdfs || []).map(p => p.name);
    restore.offsets = Object.fromEntries((s.pdfs || []).map(p => [p.name, p.offset || 0]));
    ui.sel = s.ui && s.ui.sel;
    build(); render();
    dirty = false;
    toast(want.length ? `Restored ${model.msid}. Load again: ${want.join(', ')}` : `Restored ${model.msid}`);
  }

  // ---------- loading ----------
  function roleOf(name) { return /supp|(^|[_\-. ])si([_\-. ]|$)|supplement/i.test(name) ? 'si' : /article|main|manuscript|paper/i.test(name) ? 'main' : 'other'; }

  // a package is an audited/<MSID>/ folder, or a zip of one: only what the app shows is taken from it.
  // items: [{ path, get }], get returning the File
  const MIME = { pdf: 'application/pdf', png: 'image/png' };
  const PKG_SKIP = /(^|\/)(__MACOSX|[^/]*_dump(_[^/]*)?)\//i;
  async function pickPackage(items) {
    const named = items.map(it => ({ ...it, name: it.path.split('/').pop() })).filter(it => it.name && !it.name.startsWith('.') && !PKG_SKIP.test(it.path));
    const stems = new Set(named.map(it => it.name.toLowerCase()));
    return Promise.all(named.filter(({ name }) => {
      if (/\.(md|markdown)$/i.test(name)) return /audit/i.test(name);
      if (/\.json$/i.test(name)) return /auditonator/i.test(name);
      if (/\.png$/i.test(name)) return PLOT_NAME.test(name);
      if (!/\.pdf$/i.test(name) && !DOCX_EXT.test(name) && !SHEET_EXT.test(name)) return false;
      // the audit's own Word copy and the correspondence are not what the findings cite
      if (/-Audit_|rebuttal|cover_letter|reviewer_reports|response/i.test(name)) return false;
      return !(/\.xls$/i.test(name) && stems.has(name.toLowerCase() + 'x'));
    }).map(it => it.get()));
  }

  async function zipItems(zip) {
    const z = await Sheet.unzip(zip);
    return [...z.values()].filter(e => !e.name.endsWith('/')).map(e => ({
      path: e.name,
      get: async () => {
        const name = e.name.split('/').pop();
        return new File([await new Response(await Sheet.entryBytes(zip, e)).blob()], name, { type: MIME[name.split('.').pop().toLowerCase()] || '' });
      }
    }));
  }

  // a drop can carry folders: walk them, leaving out the working dumps
  async function loadDrop(dt) {
    const loose = [], dirs = [], pkg = [];
    for (const it of dt.items || []) {
      if (it.kind !== 'file') continue;
      const en = it.webkitGetAsEntry && it.webkitGetAsEntry();
      if (en && en.isDirectory) dirs.push(en);
      else { const f = it.getAsFile(); if (f) loose.push(f); }
    }
    const walk = async dir => {
      const r = dir.createReader();
      for (;;) {
        const batch = await new Promise((ok, no) => r.readEntries(ok, no));
        if (!batch.length) break;
        for (const en of batch) {
          if (en.isDirectory) { if (!PKG_SKIP.test(en.fullPath + '/')) await walk(en); }
          else pkg.push({ path: en.fullPath.slice(1), get: () => new Promise((ok, no) => en.file(ok, no)) });
        }
      }
    };
    try { for (const d of dirs) await walk(d); } catch (e) { return toast('Could not read the dropped folder. Use Load folder instead'); }
    loadFiles(loose, pkg);
  }

  async function loadFiles(list, pkg = []) {
    const all = [...list];
    let files = all.filter(f => !/\.zip$/i.test(f.name));
    try {
      for (const f of all) if (/\.zip$/i.test(f.name)) pkg = pkg.concat(await zipItems(f));
      const picked = await pickPackage(pkg);
      if (pkg.length && !picked.length) toast('No audit files found in the package');
      files = files.concat(picked);
    } catch (e) { return toast(`Could not read the package: ${e.message || e.name}`); }
    const md = [], saves = [], docFiles = [], pngs = [];
    for (const f of files) {
      if (/\.json$/i.test(f.name)) saves.push(f);
      else if (/\.pdf$/i.test(f.name) || DOCX_EXT.test(f.name) || SHEET_EXT.test(f.name)) docFiles.push(f);
      else if (/\.png$/i.test(f.name)) pngs.push(f);
      else if (/\.(md|markdown|txt)$/i.test(f.name)) md.push({ name: f.name, text: await f.text() });
      else toast(`Skipped ${f.name}`);
    }
    for (const f of saves) {
      if (dirty && !confirm(`Discard unsaved changes on ${model.msid}?`)) return;
      try { restore(JSON.parse(await f.text())); } catch (e) { toast(`Could not read ${f.name}`); }
    }
    const added = docFiles.map(addDoc);
    if (added.length) pdfIdx = pdfs.indexOf(added.find(p => isText(p) && p.role === 'main') || added.find(isText) || added[0]);
    const isCrit = m => /critical/i.test(m.name) || /^#\s*Critical triage/m.test(m.text);
    for (const m of md.sort((a, b) => isCrit(a) - isCrit(b))) {
      if (isCrit(m)) { src.critical = m.text; src.criticalName = m.name; }
      else if (!setAudit(m)) return;
    }
    pngs.forEach(addPlot);
    if (md.length) {
      if (!st) st = freshState(null);
      build();
      if (model.A && model.C && model.A.msid && model.C.msid && model.A.msid !== model.C.msid) toast(`Audit is ${model.A.msid}, triage is ${model.C.msid}`);
      changed();
    }
    render();
  }

  function setAudit(m) {
    const A = Parse.parseAudit(m.text);
    if (!A.findings.length) { toast(`No findings found in ${m.name}`); return true; }
    if (st && src.audit === m.text) return true;
    const progress = st && (Object.values(st.findings).some(v => v.s || v.note || v.colour || (v.labels || []).length) || (st.custom || []).length);
    if (progress && !confirm(`Replace the current work on ${model.msid} with ${A.msid || m.name}?`)) return false;
    if (st && st.msid && st.msid !== A.msid) {
      src.critical = ''; src.criticalName = ''; fileHandle = null; dropPlots();
      pdfs = pdfs.filter(p => !p.name.includes(st.msid) || (freeDoc(p), false));
      pdfIdx = 0;
    }
    src.audit = m.text; src.auditName = m.name;
    st = freshState(A);
    return true;
  }

  function addPlot(file) {
    const m = file.name.match(PLOT_NAME);
    if (!m) return toast(`Skipped ${file.name}: a plot is named F<finding>_<panel>.png`);
    const i = plots.findIndex(p => p.name === file.name);
    if (i >= 0) { URL.revokeObjectURL(plots[i].url); plots.splice(i, 1); }
    plots.push({ name: file.name, url: URL.createObjectURL(file), ids: m[1].split('+').map(n => String(+n)) });
    plots.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  function addDoc(file) {
    const i = pdfs.findIndex(p => p.name === file.name);
    const p = SHEET_EXT.test(file.name)
      ? { id: ++docSeq, name: file.name, kind: 'sheet', sheet: 0, book: Sheet.open(file) }
      : { id: ++docSeq, name: file.name, kind: DOCX_EXT.test(file.name) ? 'docx' : 'pdf', role: roleOf(file.name), offset: (restore.offsets || {})[file.name] || 0 };
    if (p.kind === 'docx') { p.doc = Docx.open(file); p.doc.catch(() => { }); }
    else if (p.kind === 'pdf') p.url = URL.createObjectURL(file);
    if (p.book) p.book.then(b => { p.sheets = b.sheets; if (ui.open) renderDetail(); }, () => { });
    if (i >= 0) { freeDoc(pdfs[i]); pdfs[i] = p; } else pdfs.push(p);
    const rank = x => isText(x) ? ['main', 'si', 'other'].indexOf(x.role) : 3;
    pdfs.sort((a, b) => rank(a) - rank(b) || (a.kind === 'sheet' ? a.name.localeCompare(b.name, undefined, { numeric: true }) : 0));
    ui.pdf = true;
    return p;
  }

  // ---------- saving & export ----------
  async function save(asNew) {
    if (!model) return;
    const data = JSON.stringify(snapshot());
    const name = `${model.msid || 'audit'}-Auditonator.json`;
    if (window.showSaveFilePicker) {
      try {
        if (!fileHandle || asNew) fileHandle = await showSaveFilePicker({ suggestedName: name, types: [{ description: 'Auditonator work', accept: { 'application/json': ['.json'] } }] });
        const w = await fileHandle.createWritable(); await w.write(data); await w.close();
      } catch (e) {
        if (e.name === 'AbortError') return;
        fileHandle = null; download(new Blob([data], { type: 'application/json' }), name);
      }
    } else download(new Blob([data], { type: 'application/json' }), name);
    dirty = false;
    toast(`Saved ${fileHandle ? fileHandle.name : name}`);
  }

  function exportItems() {
    const out = [], groups = {};
    st.queries.forEach(q => {
      if (!q.include || !q.text.trim() || status(q.finding) !== 'confirmed') return;
      if (!q.group) return out.push({ items: [q] });
      if (!groups[q.group]) out.push(groups[q.group] = { header: st.groups[q.group].header, items: [] });
      groups[q.group].items.push(q);
    });
    return out;
  }

  async function copyQueries() {
    const items = exportItems();
    if (!items.length) return toast('No queries: confirm findings first');
    const text = items.map(o => o.header
      ? `• ${plain(o.header)}\n${o.items.map(q => `    – ${plain(q.text)}`).join('\n')}`
      : `• ${plain(o.items[0].text)}`).join('\n');
    const html = `<ul>${items.map(o => o.header
      ? `<li>${inline(o.header)}<ul>${o.items.map(q => `<li>${inline(q.text)}</li>`).join('')}</ul></li>`
      : `<li>${inline(o.items[0].text)}</li>`).join('')}</ul>`;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
    } catch (e) {
      try { await navigator.clipboard.writeText(text); } catch (e2) { return toast('Clipboard unavailable'); }
    }
    toast(`Copied ${items.length} queries`);
  }

  const STATUS = { confirmed: 'Confirmed', dismissed: 'Dismissed' };
  const reranked = f => f.colour !== f.colour0;

  function exportXlsx() {
    const items = exportItems();
    const notes = model.order.filter(f => ((st.findings[f.id] || {}).note || '').trim() || reranked(f) || labelsOf(f.id).length);
    const added = model.order.filter(f => f.custom);
    if (!items.length && !notes.length && !added.length) return toast('Nothing to export: confirm findings or add notes first');
    const rows = items.map((o, i) => {
      const ids = [...new Set(o.items.map(q => q.finding))];
      const fs = ids.map(id => model.map.get(id)).filter(Boolean);
      return [
        i + 1,
        o.header ? `${plain(o.header)}\n${o.items.map(q => `• ${plain(q.text)}`).join('\n')}` : plain(o.items[0].text),
        fs.map(fname).join(', '),
        [...new Set(fs.map(f => CNAME[f.colour]))].join(', ')
      ];
    });
    const nrows = notes.map(f => [
      fname(f),
      plain(f.head || f.title),
      reranked(f) ? { v: CNAME[f.colour], hl: true } : CNAME[f.colour],
      f.custom ? 'Added' : CNAME[f.colour0],
      STATUS[status(f.id)] || 'Open',
      labelsOf(f.id).join(', '),
      ((st.findings[f.id] || {}).note || '').trim()
    ]);
    const arows = added.map(f => [
      fname(f), plain(f.title), CNAME[f.colour], f.types.map(t => Facets.TYPE_LABEL[t]).join(', '),
      f.ents.map(k => k.startsWith('src:') ? 'Source Data ' + Facets.label(k.slice(4)) : Facets.label(k)).join('; '),
      plain(f.body), STATUS[status(f.id)] || 'Open'
    ]);
    download(XLSX.build([
      { name: 'Author queries', header: ['No.', 'Author query', 'Finding', 'Triage'], rows, widths: [6, 110, 12, 10] },
      { name: 'Internal notes', header: ['Finding', 'Title', 'Severity', 'Triage', 'Status', 'Labels', 'Note'], rows: nrows, widths: [9, 50, 10, 10, 11, 22, 80] },
      ...(arows.length ? [{ name: 'Added findings', header: ['Finding', 'Title', 'Severity', 'Issue type', 'Related entities', 'Description', 'Status'], rows: arows, widths: [9, 50, 10, 20, 30, 90, 11] }] : [])
    ]), `${model.msid || 'audit'}-Author_Queries.xlsx`);
    toast(`Exported ${items.length} quer${items.length === 1 ? 'y' : 'ies'} · ${notes.length} note${notes.length === 1 ? '' : 's'}${added.length ? ` · ${added.length} added finding${added.length === 1 ? '' : 's'}` : ''}`);
  }

  // ---------- actions ----------
  function setStatus(id, s) {
    const f = fstate(id);
    f.s = f.s === s ? null : s;
    changed(); render();
  }

  function confirmAll() {
    const ids = visible().filter(f => !status(f.id)).map(f => f.id);
    if (!ids.length) return toast('No open findings to confirm');
    if (!confirm(`Confirm ${ids.length} open finding${ids.length === 1 ? '' : 's'}${filtering() ? ' shown by the current filters' : ''}?`)) return;
    ids.forEach(id => { fstate(id).s = 'confirmed'; });
    st.bulk = ids;
    changed(); render();
    toast(`Confirmed ${ids.length} finding${ids.length === 1 ? '' : 's'}`);
  }

  // findings the last "Confirm all" confirmed and that are still confirmed
  const bulkIds = () => (st.bulk || []).filter(id => model.map.has(id) && status(id) === 'confirmed');

  function undoConfirmAll() {
    const ids = bulkIds();
    delete st.bulk;
    ids.forEach(id => { fstate(id).s = null; });
    changed(); render();
    toast(ids.length ? `Reopened ${ids.length} finding${ids.length === 1 ? '' : 's'}` : 'Nothing to undo');
  }

  function setColour(id, c) {
    const f = model.map.get(id);
    if (!f || !COLOURS.includes(c)) return;
    const fs = fstate(id), u = f.custom && custom(id);
    if (u) u.colour = c;
    else if (c === f.colour0) delete fs.colour; else fs.colour = c;
    changed(); build(); render();
    const el = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
    else toast(`${fname(f)} moved to ${CNAME[c]} (hidden by filters)`);
  }

  // ---------- labels ----------
  function addLabel(id, raw) {
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!id || !name) return;
    let d = st.labels.find(l => l.name.toLowerCase() === name.toLowerCase());
    if (!d) {
      const used = st.labels.map(l => l.c);
      const c = LCOL.findIndex((_, i) => !used.includes(i));
      st.labels.push(d = { name, c: c < 0 ? st.labels.length % LCOL.length : c });
    }
    const f = fstate(id);
    f.labels = f.labels || [];
    if (!f.labels.includes(d.name)) f.labels.push(d.name);
    changed(); renderCards(); renderDetail();
    const inp = document.querySelector('#detail .lin'); if (inp) inp.focus();
  }

  function removeLabel(id, name) {
    const f = fstate(id);
    f.labels = (f.labels || []).filter(l => l !== name);
    changed(); renderCards(); renderDetail();
  }

  function deleteLabel(name) {
    const n = model.order.filter(f => labelsOf(f.id).includes(name)).length;
    if (n && !confirm(`Delete the label “${name}” from ${n} finding${n === 1 ? '' : 's'}?`)) return;
    st.labels = st.labels.filter(l => l.name !== name);
    Object.values(st.findings).forEach(v => { if (v.labels) v.labels = v.labels.filter(l => l !== name); });
    ui.labels.delete(name);
    changed(); renderCards(); renderDetail();
  }

  // ---------- added findings ----------
  function addFinding() {
    let n = 1;
    while (model.map.has('U' + n) || custom('U' + n)) n++;
    const id = 'U' + n;
    st.custom.push({ id, title: '', body: '', colour: 'none', types: [], ents: '' });
    fstate(id).s = 'confirmed';
    if (ui.edit) finishEdit();
    ui.edit = id;
    changed(); build(); render();
    openDetail(id);
    const t = document.querySelector('#detail [data-ed="title"]'); if (t) t.focus();
  }

  // leaving the form; an added finding left with no title and no description is dropped
  function finishEdit() {
    const u = custom(ui.edit);
    ui.edit = null;
    if (u && !u.title.trim() && !u.body.trim()) { dropFinding(u.id); toast('Empty finding discarded'); }
    build();
  }

  function dropFinding(id) {
    st.custom = st.custom.filter(u => u.id !== id);
    delete st.findings[id];
    st.queries = st.queries.filter(q => q.finding !== id);
    if (ui.sel === id) { ui.sel = null; ui.open = false; }
    changed();
  }

  function mdTool(kind) {
    const ta = document.querySelector('#detail .ed-body');
    if (!ta) return;
    const a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
    const mark = { b: '**', i: '*', code: '`' }[kind];
    if (mark) {
      const sel = v.slice(a, b) || 'text';
      ta.setRangeText(mark + sel + mark, a, b, 'end');
      ta.setSelectionRange(a + mark.length, a + mark.length + sel.length);
    } else {
      const s0 = v.lastIndexOf('\n', a - 1) + 1;
      const lines = v.slice(s0, b).split('\n').map((l, i) => (kind === 'ul' ? '- ' : kind === 'ol' ? `${i + 1}. ` : '> ') + l.replace(/^(?:[-*+]|\d+[.)]|>)\s+/, ''));
      ta.setRangeText(lines.join('\n'), s0, b, 'end');
    }
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // skip: leave one filter dimension out, for the counts shown on that dimension's own controls
  function passes(f, skip) {
    const q = ui.q.trim().toLowerCase();
    const ents = [...ui.ents];
    return (skip === 'colour' || !ui.colours.size || ui.colours.has(f.colour)) &&
      (ui.status === 'all' || (ui.status === 'open' ? !status(f.id) : status(f.id) === ui.status)) &&
      (skip === 'type' || !ui.types.size || f.types.some(t => ui.types.has(t))) &&
      (skip === 'entity' || !ents.length || (ui.entMode === 'all' ? ents.every(k => f.ents.includes(k)) : ents.some(k => f.ents.includes(k)))) &&
      (skip === 'label' || !ui.labels.size || labelsOf(f.id).some(l => ui.labels.has(l))) &&
      (!q || `${f.id} ${f.title} ${f.head} ${f.brief} ${f.location} ${f.body}`.toLowerCase().includes(q));
  }
  const visible = () => model.order.filter(f => passes(f));
  const filtering = () => ui.ents.size || ui.types.size || ui.labels.size || ui.colours.size || ui.status !== 'all' || ui.q.trim();

  function select(id, scroll = true) {
    if (ui.edit && ui.edit !== id) finishEdit();
    ui.sel = id;
    renderCards(); renderDetail();
    const el = scroll && document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    if (el.offsetTop === document.querySelector('.card').offsetTop) $('#cards').scrollTop = 0;
    el.scrollIntoView({ block: 'nearest' });
  }

  function openDetail(id) {
    if (id) ui.sel = id;
    ui.open = !!ui.sel;
    closePop();
    select(ui.sel);
    const d = $('#detail'); if (d && ui.open) d.focus();
  }

  function closeDetail() {
    if (ui.edit) { finishEdit(); renderCards(); renderHeader(); renderQueries(); }
    ui.open = false;
    renderDetail();
    const el = document.querySelector(`.card[data-id="${CSS.escape(ui.sel || '')}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function toggle(set, v) { set.has(v) ? set.delete(v) : set.add(v); }
  toggle.arr = (a, v) => { const i = a.indexOf(v); i < 0 ? a.push(v) : a.splice(i, 1); };

  function openPop(dim) {
    ui.pop = ui.pop === dim ? null : dim;
    renderFilters();
  }
  function closePop() { if (ui.pop) { ui.pop = null; renderFilters(); } }

  function step(d) {
    const v = visible();
    if (!v.length) return;
    const i = v.findIndex(f => f.id === ui.sel);
    select(v[Math.max(0, Math.min(v.length - 1, i < 0 ? 0 : i + d))].id);
  }

  function gotoPage(role, n) {
    ui.pdf = true;
    const docs = pdfs.filter(isText), cur = pdfs[pdfIdx];
    const p = docs.find(x => x.role === role) || (role === 'si' && cur && isText(cur) && cur) || docs.find(x => x.role === 'main') || docs[0];
    if (p) { pdfIdx = pdfs.indexOf(p); p.page = Math.max(1, n - (p.offset || 0)); }
    renderHeader();
    renderPdf(true);
  }

  function gotoSheet(a) {
    const p = pdfs.find(x => x.id === +a.dataset.doc);
    if (!p || !p.sheets) return;
    p.sheet = Math.max(0, p.sheets.findIndex(s => s.name.trim() === a.dataset.sheet));
    pdfIdx = pdfs.indexOf(p); ui.pdf = true;
    renderHeader();
    renderPdf(false, JSON.parse(a.dataset.target));
  }

  // ---------- rendering ----------
  function render() {
    const has = !!(model && model.map.size);
    $('#empty').hidden = has;
    $('#main').hidden = !has;
    renderHeader();
    if (!has) return renderEmpty();
    renderCards(); renderDetail(); renderQueries(); renderPdf();
  }

  function renderEmpty() {
    let last = null;
    try { last = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { }
    $('#resume').innerHTML = last && last.msid
      ? `<button class="btn" data-act="resume">Resume ${esc(last.msid)} <span>autosaved ${new Date(last.savedAt).toLocaleString()}</span></button>` : '';
  }

  function renderHeader() {
    $('#msid').textContent = model ? model.msid : '';
    $('#mstitle').innerHTML = model ? inline(model.title) : '';
    const chip = (ok, label, name) => `<span class="fchip ${ok ? 'ok' : ''}" title="${esc(name || 'not loaded')}">${label}</span>`;
    const pdfOnly = pdfs.filter(isText), word = pdfOnly.some(p => p.kind === 'docx') ? 'Docs' : 'PDF', sheets = pdfs.filter(p => p.kind === 'sheet');
    $('#files').innerHTML = model ? chip(src.audit, 'Audit', src.auditName) + chip(src.critical, 'Triage', src.criticalName)
      + chip(pdfOnly.length, pdfOnly.length > 1 ? `${word} ×${pdfOnly.length}` : word, pdfOnly.map(p => p.name).join(', '))
      + (sheets.length ? chip(1, sheets.length > 1 ? `Sheets ×${sheets.length}` : 'Sheet', sheets.map(p => p.name).join(', ')) : '')
      + chip(plots.length, plots.length > 1 ? `Plots ×${plots.length}` : 'Plots', plots.map(p => p.name).join(', ') || 'not loaded; findings read the same without them')
      // an audit written before the "Related entities / Issue type / Queries" lines: those are inferred from the wording
      + (model.A && !model.A.findings.some(f => f.meta) ? '<span class="fchip warn" title="This audit predates the Related entities, Issue type and Queries lines. Entities, issue types and the query of each finding are inferred from the wording and may be off.">Older audit format</span>' : '') : '';
    $('#btnPdf').classList.toggle('on', ui.pdf);
    $('#main').classList.toggle('with-pdf', ui.pdf);
    ['#btnSave', '#btnCopy', '#btnXlsx', '#btnPdf'].forEach(s => $(s).disabled = !model || !model.map.size);
    const n = model ? model.order.length : 0;
    const c = model ? model.order.filter(f => status(f.id) === 'confirmed').length : 0;
    const d = model ? model.order.filter(f => status(f.id) === 'dismissed').length : 0;
    $('#progress').innerHTML = n ? `<i class="p-c" style="width:${100 * c / n}%"></i><i class="p-d" style="width:${100 * d / n}%"></i>` : '';
    $('#progress').title = n ? `${c} confirmed · ${d} dismissed · ${n - c - d} open` : '';
    const r = model ? model.order.filter(reranked).length : 0;
    $('#stat').innerHTML = n ? `<b>${c}</b> ✓ · <b>${d}</b> ✕ · <b>${n - c - d}</b> open${r ? ` · <b>${r}</b> re-ranked` : ''}` : '';
    const nq = model ? exportItems().length : 0;
    $('#nQ').textContent = nq;
    $('#nFind').textContent = n;
  }

  const typeChips = f => f.types.map(t => `<button class="ty ${ui.types.has(t) ? 'on' : ''}" data-type="${t}" title="Filter by type">${Facets.TYPE_LABEL[t]}</button>`).join('');
  const entLabel = k => k.startsWith('src:') ? `Source data · ${Facets.label(k.slice(4))}` : Facets.label(k);

  // chips on a card: objects only (sections are in the details), source data folded into its object
  function cardEnts(f) {
    const objs = f.ents.filter(k => !k.startsWith('x:') && !k.startsWith('src:'));
    const extra = f.ents.filter(k => k.startsWith('src:') && !objs.includes(k.slice(4))).map(k => k.slice(4));
    const keys = objs.concat(extra).sort((a, b) => Facets.sortKey(a) - Facets.sortKey(b));
    const on = keys.filter(k => ui.ents.has(k) || ui.ents.has('src:' + k));
    const shown = on.concat(keys.filter(k => !on.includes(k))).slice(0, Math.max(4, on.length));
    const chip = k => {
      const src = f.ents.includes('src:' + k);
      const target = src && !objs.includes(k) ? 'src:' + k : k;
      return `<button class="ent ${ui.ents.has(k) || ui.ents.has('src:' + k) ? 'on' : ''}" data-ent="${target}" title="Filter: ${esc(entLabel(target))}">${esc(Facets.label(k))}${src ? '<sup>SD</sup>' : ''}</button>`;
    };
    return shown.map(chip).join('') + (keys.length > shown.length ? `<span class="ent more" title="${esc(keys.slice(shown.length).map(Facets.label).join(', '))}">+${keys.length - shown.length}</span>` : '');
  }

  function renderFilters() {
    $('#btnConfirmAll').disabled = !visible().some(f => !status(f.id));
    const nb = bulkIds().length, ub = $('#btnUndoConfirmAll');
    ub.hidden = !nb;
    ub.title = `Reopen the ${nb} finding${nb === 1 ? '' : 's'} the last "Confirm all" confirmed (ones you confirmed yourself stay confirmed)`;
    const counts = {};
    model.order.filter(f => passes(f, 'colour')).forEach(f => counts[f.colour] = (counts[f.colour] || 0) + 1);
    const present = new Set(model.order.map(f => f.colour));
    $('#colourFilter').innerHTML = COLOURS.filter(c => present.has(c) || c !== 'none').map(c =>
      `<button class="cf c-${c} ${ui.colours.has(c) ? 'on' : ''} ${counts[c] ? '' : 'zero'}" data-colour="${c}" title="${CNAME[c]} — ${CDESC[c]}"><i></i>${counts[c] || 0}</button>`).join('');
    document.querySelectorAll('#statusFilter button').forEach(b => b.classList.toggle('on', b.dataset.status === ui.status));

    const btn = (dim, name, set, lab) => {
      const b = document.querySelector(`.fbtn[data-pop="${dim}"]`);
      b.classList.toggle('on', set.size > 0);
      b.classList.toggle('open', ui.pop === dim);
      b.innerHTML = `${set.size === 1 ? esc(lab([...set][0])) : name}${set.size > 1 ? ` <b>${set.size}</b>` : ''}<span class="car">▾</span>`;
      const pop = b.nextElementSibling;
      pop.hidden = ui.pop !== dim;
      if (ui.pop === dim) {
        const pb = pop.querySelector('.pb'), sc = pb ? pb.scrollTop : 0;
        pop.innerHTML = dim === 'entity' ? entityPop() : dim === 'label' ? labelPop() : typePop();
        pop.querySelector('.pb').scrollTop = sc;
        pop.style.left = '0px';
        const r = pop.getBoundingClientRect(), over = r.right - (document.documentElement.clientWidth - 8);
        if (over > 0) pop.style.left = `${-Math.min(over, r.left - 8)}px`;
      }
    };
    btn('entity', 'Entity', ui.ents, entLabel);
    btn('type', 'Type', ui.types, t => Facets.TYPE_LABEL[t]);
    btn('label', 'Label', ui.labels, l => l);

    const act = $('#activeFilters');
    const chips = [...ui.ents].sort((a, b) => Facets.sortKey(a) - Facets.sortKey(b)).map(k => `<button class="af" data-ent="${k}" title="Remove">${esc(entLabel(k))}<i>✕</i></button>`)
      .concat([...ui.types].map(t => `<button class="af ty" data-type="${t}" title="Remove">${Facets.TYPE_LABEL[t]}<i>✕</i></button>`))
      .concat([...ui.labels].map(l => `<button class="af lbf" data-label="${esc(l)}" style="--lc:${lcol(l)}" title="Remove"><b></b>${esc(l)}<i>✕</i></button>`));
    act.hidden = !filtering();
    if (!act.hidden) {
      const n = visible().length;
      const join = ui.ents.size > 1 ? `<span class="aj">${ui.entMode === 'all' ? 'all of' : 'any of'}</span>` : '';
      act.innerHTML = `<span class="an"><b>${n}</b> of ${model.order.length}</span>${join}${chips.join('')}<button class="aclr" data-act="clearfilters">Clear filters</button>`;
    }
  }

  function entityPop() {
    let base = model.order.filter(f => passes(f, 'entity'));
    const sel = [...ui.ents];
    if (ui.entMode === 'all' && sel.length) base = base.filter(f => sel.every(k => f.ents.includes(k)));
    const all = new Set(model.order.flatMap(f => f.ents));
    const count = k => base.filter(f => f.ents.includes(k)).length;
    const rows = Facets.GROUPS.map(([g, name]) => {
      const keys = [...all].filter(k => Facets.group(k) === g).sort((a, b) => Facets.sortKey(a) - Facets.sortKey(b));
      if (!keys.length) return '';
      const short = k => g === 'src' ? Facets.label(k.slice(4)) : g === 'x' ? Facets.label(k) : Facets.label(k).replace(/^.*\s/, '');
      return `<div class="pr"><span class="pl">${name}</span><div class="pc">${keys.map(k => {
        const n = count(k);
        return `<button class="pk ${ui.ents.has(k) ? 'on' : ''} ${n ? '' : 'zero'} ${g === 'x' || g === 'src' ? 'wide' : ''}" data-ent="${k}" title="${esc(entLabel(k))} — ${n} finding${n === 1 ? '' : 's'}">${esc(short(k))}<em>${n}</em></button>`;
      }).join('')}</div></div>`;
    }).join('');
    return `<div class="ph"><b>Involves</b><span class="seg sm" title="With several selected: findings involving any of them, or all of them"><button class="${ui.entMode === 'any' ? 'on' : ''}" data-entmode="any">any</button><button class="${ui.entMode === 'all' ? 'on' : ''}" data-entmode="all">all</button></span><span class="grow"></span>${ui.ents.size ? '<button class="lnk" data-act="clearents">Clear</button>' : ''}</div><div class="pb">${rows || '<p class="muted">No figures, tables or sections recognised.</p>'}</div>`;
  }

  function labelPop() {
    const base = model.order.filter(f => passes(f, 'label'));
    const rows = st.labels.map(d => {
      const n = base.filter(f => labelsOf(f.id).includes(d.name)).length;
      return `<div class="lr ${ui.labels.has(d.name) ? 'on' : ''} ${n ? '' : 'zero'}"><button class="ld" data-lcol="${esc(d.name)}" style="--lc:${LCOL[d.c % LCOL.length]}" title="Change colour"></button><button class="tr" data-label="${esc(d.name)}"><i></i><span>${esc(d.name)}</span><em>${n}</em></button><button class="x" data-ldel="${esc(d.name)}" title="Delete this label from every finding">✕</button></div>`;
    }).join('');
    return `<div class="ph"><b>Label</b><span class="grow"></span>${ui.labels.size ? '<button class="lnk" data-act="clearlabels">Clear</button>' : ''}</div><div class="pb tl">${rows || '<p class="muted">No labels yet.</p>'}</div><p class="pn">Add labels in a finding’s details (L). Findings with any of the chosen labels are shown.</p>`;
  }

  const labelChips = (id, rm) => labelsOf(id).map(l => `<span class="lb ${ui.labels.has(l) ? 'on' : ''}" style="--lc:${lcol(l)}"><button data-label="${esc(l)}" title="Filter by label"><i></i>${esc(l)}</button>${rm ? `<button class="lx" data-lrm="${esc(l)}" title="Remove label">✕</button>` : ''}</span>`).join('');

  function typePop() {
    const base = model.order.filter(f => passes(f, 'type'));
    const present = new Set(model.order.flatMap(f => f.types));
    const rows = Facets.TYPES.filter(t => present.has(t)).map(t => {
      const n = base.filter(f => f.types.includes(t)).length;
      return `<button class="tr ${ui.types.has(t) ? 'on' : ''} ${n ? '' : 'zero'}" data-type="${t}"><i></i><span>${Facets.TYPE_LABEL[t]}</span><em>${n}</em></button>`;
    }).join('');
    return `<div class="ph"><b>Type of issue</b><span class="grow"></span>${ui.types.size ? '<button class="lnk" data-act="cleartypes">Clear</button>' : ''}</div><div class="pb tl">${rows}</div><p class="pn">${model.A && model.A.findings.some(f => f.meta) ? 'As given in the audit.' : 'Assigned automatically from each finding\'s wording.'}</p>`;
  }

  function renderCards() {
    renderFilters();
    const C = model.C;
    let html = '';
    if (C && (C.claim || C.pattern)) html += `<details class="claim" ${ui.claimOpen ? 'open' : ''}><summary>Central claim</summary><div class="md">${MD.render(C.claim)}${C.pattern ? MD.render(C.pattern) : ''}</div></details>`;
    const v = visible();
    let colour = null;
    v.forEach(f => {
      if (f.colour !== colour) {
        colour = f.colour;
        html += `<div class="grp c-${colour}"><i></i><b>${CNAME[colour]}</b><span>${CDESC[colour]}</span><em>${v.filter(x => x.colour === colour).length}</em></div>`;
      }
      const s = status(f.id);
      const nq = st.queries.filter(q => q.finding === f.id).length;
      const brief = f.brief || (f.head ? '' : f.location);
      html += `<article class="card c-${f.colour} ${s ? 'is-' + s : ''} ${ui.sel === f.id ? 'is-sel' : ''}" data-id="${esc(f.id)}">
        <div class="cm"><label class="chk" title="Confirm (C)"><input type="checkbox" data-act="confirm" ${s === 'confirmed' ? 'checked' : ''}></label><span class="fid">${fname(f)}</span>${f.conditional ? '<span class="tag">Conditional</span>' : ''}${f.with.length ? `<span class="tag">with #${f.with.join(', #')}</span>` : ''}${reranked(f) ? `<span class="tag sev" title="Severity changed from the triage">${CNAME[f.colour0]}→${CNAME[f.colour]}</span>` : ''}${f.custom ? '<span class="tag add" title="Added in the Auditonator; not in the audit">Added</span>' : ''}${(st.findings[f.id] || {}).note ? '<span class="tag note">Note</span>' : ''}<span class="qn" title="Author queries">${nq}&thinsp;Q</span><button class="x" data-act="dismiss" title="Dismiss (X)">✕</button></div>
        <h3>${inline(f.head || f.title)}</h3>
        ${brief ? `<p>${inline(brief)}</p>` : ''}
        <div class="cf-row">${labelChips(f.id)}${typeChips(f)}${cardEnts(f)}</div>
      </article>`;
    });
    if (!v.length) html += `<div class="none">No findings match the filters.${filtering() ? ' <button class="lnk" data-act="clearfilters">Clear filters</button>' : ''}</div>`;
    if (model.A && model.A.checked) html += `<details class="claim checked"><summary>Checked but not raised</summary><div class="md">${MD.render(model.A.checked)}</div></details>`;
    $('#cards').innerHTML = html;
  }

  function queryEditor(q, i, qs) {
    const opts = model.doc.map(f => `<option value="${esc(f.id)}" ${f.id === q.finding ? 'selected' : ''}>${fname(f)} ${esc(plain(f.head || f.title).slice(0, 60))}</option>`).join('');
    const g = q.group && st.groups[q.group];
    return `<div class="q ${q.include ? '' : 'off'}" data-q="${esc(q.id)}">
      <input type="checkbox" data-act="qinc" ${q.include ? 'checked' : ''} title="Include in export">
      <div class="qm">
        ${g && (!i || qs[i - 1].group !== q.group) ? `<div class="qg">${inline(g.header)}</div>` : ''}
        <div class="qt" contenteditable="${CE}" spellcheck="true" data-act="qtext">${esc(q.text)}</div>
        <div class="qa">
          ${q.num ? `<span class="qno" title="Query number in the audit">Q${esc(q.num)}</span>` : ''}
          <select data-act="qmove" title="Linked finding">${opts}</select>
          ${q.orig && q.text !== q.orig ? '<button data-act="qreset">Revert</button>' : ''}
          ${q.custom ? '<button data-act="qdel">Delete</button>' : ''}
        </div>
      </div>
    </div>`;
  }

  function renderDetail() {
    const el = $('#detail');
    const f = ui.open && model.map.get(ui.sel);
    $('#modal').hidden = !f;
    if (!f) { renderDetail.id = null; el.innerHTML = ''; return; }
    const s = status(f.id), note = (st.findings[f.id] || {}).note || '';
    const qs = st.queries.filter(q => q.finding === f.id);
    const v = visible(), i = v.findIndex(x => x.id === f.id);
    const prev = el.querySelector('.d-scroll');
    const keep = prev && renderDetail.id === f.id ? prev.scrollTop : 0;
    renderDetail.id = f.id;
    el.className = `dialog c-${f.colour}`;
    el.tabIndex = -1;
    el.innerHTML = `
      <div class="d-bar c-${f.colour}">
        <select class="pill" data-act="sev" title="Severity (1–4 · 0 reverts to the triage)">${COLOURS.filter(c => c !== 'none' || f.colour0 === 'none').map(c => `<option value="${c}" ${c === f.colour ? 'selected' : ''}>${CNAME[c]}</option>`).join('')}</select>
        ${reranked(f) ? `<button class="rev" data-act="sevreset" title="Revert to the triage colour (0)">was ${CNAME[f.colour0]} ↺</button>` : ''}<span class="fid">${fname(f)}</span>
        ${f.conditional ? '<span class="tag">Conditional</span>' : ''}
        <span class="sec">${inline(f.section || '')}</span>
        <span class="grow"></span>
        <span class="d-xp"></span>
        ${f.custom ? `<button data-act="${ui.edit === f.id ? 'eddone' : 'edit'}" title="Edit this added finding">${ui.edit === f.id ? 'Done' : 'Edit'}</button>` : ''}
        <button class="act-c ${s === 'confirmed' ? 'on' : ''}" data-act="confirm" title="C">${s === 'confirmed' ? '✓ Confirmed' : 'Confirm'}</button>
        <button class="act-d ${s === 'dismissed' ? 'on' : ''}" data-act="dismiss" title="X">${s === 'dismissed' ? 'Dismissed' : 'Dismiss'}</button>
        <span class="nav"><button data-act="prev" ${i <= 0 ? 'disabled' : ''} title="Previous (↑)">↑</button><button data-act="next" ${i < 0 || i >= v.length - 1 ? 'disabled' : ''} title="Next (↓)">↓</button></span>
        <button class="close" data-act="closedetail" title="Close (Esc)">✕</button>
      </div>
      <div class="d-scroll">
        ${ui.edit === f.id ? editor(f) : `<h2>${inline(f.title)}</h2>
        ${f.location ? `<div class="d-loc">${inline(f.location)}</div>` : ''}
        <div class="d-ents">${typeChips(f)}${detailEnts(f)}</div>`}
        <div class="d-labels">${labelChips(f.id, true)}<input class="lin" data-act="labelin" list="labelList" placeholder="+ Label" title="Type a label and press Enter (L)" autocomplete="off"><datalist id="labelList">${st.labels.filter(d => !labelsOf(f.id).includes(d.name)).map(d => `<option value="${esc(d.name)}"></option>`).join('')}</datalist></div>
        ${!f.custom && (f.head || f.brief) ? `<div class="d-tri c-${f.colour}">${f.head ? `<b>${inline(f.head)}</b> ` : ''}${inline(f.brief)}${f.with.length ? ` <span class="tag">ranked with #${f.with.join(', #')}</span>` : ''}</div>` : ''}
        ${f.body && ui.edit !== f.id ? `<div class="md d-body">${MD.render(f.body)}</div>` : ''}
        ${plotsOf(f.id).length ? `<section class="d-plots"><h4>Plots <span>${plotsOf(f.id).length}</span></h4>${plotsOf(f.id).map(p => `<a href="${p.url}" target="_blank" title="${esc(p.name)} — open full size"><img src="${p.url}" alt="${esc(p.name)}"></a>`).join('')}</section>` : ''}
        <section class="d-q">
          <h4>Author queries <span>${qs.length}</span></h4>
          ${qs.map(queryEditor).join('') || '<p class="muted">No query linked to this finding.</p>'}
          <button class="add" data-act="addq">+ Add query</button>
        </section>
        <section class="d-note"><h4>Note</h4><textarea data-act="note" rows="3" placeholder="Private note — never in copied queries; exported on the Excel tab ‘Internal notes’">${esc(note)}</textarea></section>
      </div>`;
    const roots = [...el.querySelectorAll('.d-scroll > h2, .d-loc, .d-tri, .d-body')];
    roots.forEach(linkPages);
    slotsOf.delete(f.id);
    linkSheets(roots);
    const xp = el.querySelector('.d-xp');
    if (xp && (slotsOf.get(f.id) || []).length) xp.innerHTML = `<button data-act="exportcells" data-fid="${esc(f.id)}" title="Excel file of the sheets this finding cites, with its cells highlighted">⤓ Cells</button>`;
    el.querySelector('.d-scroll').scrollTop = keep;
  }

  const detailEnts = f => f.ents.map(k => `<button class="ent ${ui.ents.has(k) ? 'on' : ''} ${k.startsWith('x:') ? 'sec' : ''}" data-ent="${k}" title="Filter: ${esc(entLabel(k))}">${esc(k.startsWith('src:') ? 'SD · ' + Facets.label(k.slice(4)) : Facets.label(k))}</button>`).join('');

  // the form for a finding added in the app; the description is Markdown, like the audit's own findings
  function editor(f) {
    const u = custom(f.id);
    return `<div class="ed">
      <label class="ed-l">Title<input class="ed-in" data-ed="title" value="${esc(u.title)}" placeholder="One-line statement of the problem — location"></label>
      <div class="ed-l">Issue type<div class="ed-types">${Facets.TYPES.map(t => `<button class="ty ${u.types.includes(t) ? 'on' : ''}" data-edtype="${t}">${Facets.TYPE_LABEL[t]}</button>`).join('')}</div></div>
      <label class="ed-l">Related entities<input class="ed-in" data-ed="ents" value="${esc(u.ents)}" placeholder="Fig. 2c; Supplementary Table 3; Source Data Fig. 4; Methods"></label>
      <div class="d-ents ed-ents">${detailEnts(f)}</div>
      <div class="ed-l">Description
        <div class="ed-tools">${[['b', '<b>B</b>', 'Bold'], ['i', '<i>I</i>', 'Italic'], ['code', '<code>x</code>', 'Code (cells, sheet names)'], ['ul', '• List', 'Bulleted list'], ['ol', '1. List', 'Numbered list'], ['q', '❝ Quote', 'Quotation']].map(([k, h, t]) => `<button data-md="${k}" title="${t}">${h}</button>`).join('')}</div>
        <textarea class="ed-body" data-ed="body" rows="9" placeholder="What the files show: quotes, values, cells (e.g. \`Fig.5e\` AB21:AB29)…">${esc(u.body)}</textarea>
      </div>
      <div class="ed-foot"><button class="btn" data-act="eddone">Done</button><span class="grow"></span><button class="lnk danger" data-act="eddel">Delete this finding</button></div>
    </div>`;
  }

  const PAGE_RE = /\b(SI\s+|Supplementary Information,?\s+|main(?:\s+text)?,?\s+)?(pp?\.\s?|pages?\s+)(\d{1,4})|\[p(\d{1,4})\]/g;
  function linkPages(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (w.nextNode()) if (PAGE_RE.test(w.currentNode.nodeValue)) nodes.push(w.currentNode), PAGE_RE.lastIndex = 0;
    PAGE_RE.lastIndex = 0;
    nodes.forEach(n => {
      const frag = document.createDocumentFragment();
      let last = 0;
      n.nodeValue.replace(PAGE_RE, (m, pre, _p, num, br, off) => {
        frag.append(n.nodeValue.slice(last, off));
        const a = document.createElement('a');
        a.className = 'pg'; a.textContent = m;
        a.dataset.role = pre && /SI|Supp/i.test(pre) ? 'si' : 'main';
        a.dataset.page = num || br;
        a.title = 'Show in PDF';
        frag.append(a);
        last = off + m.length;
      });
      frag.append(n.nodeValue.slice(last));
      n.replaceWith(frag);
    });
  }

  // a sheet name of a loaded workbook, in backticks or quoted after "sheet" (sheet 'Fig. 3'), becomes a link;
  // "rows 21–29" / "columns AB and AN" after it, and cell references (AB21:AB29, cell B9, AO9 = AO11), mark cells.
  // Every link to a sheet carries all the cells the finding cites on that sheet, so copies can be paired by colour.
  const ROWS_RE = /\brows?\s+(\d+(?:\s*(?:–|-|to)\s*\d+)?(?:\s*(?:,|and|&)\s*\d+(?:\s*(?:–|-|to)\s*\d+)?)*)/;
  const COLS_RE = /\bcol(?:umn)?s?\s+([A-Z]{1,3}(?:\s*(?:–|-)\s*[A-Z]{1,3})?(?:\s*(?:,|and|&)\s*[A-Z]{1,3}(?:\s*(?:–|-)\s*[A-Z]{1,3})?)*)\b/;
  const ranges = (re, s) => { const m = s.match(re); return m ? m[1].split(/\s*(?:,|and|&)\s*/).map(x => x.split(/\s*(?:–|-|to)\s*/)) : []; };
  const stem = name => name.replace(/\.\w+$/, '').replace(/^.*?-(?=[A-Z])/, '').replace(/_v\d+$/, '').replace(/[_\s]+/g, ' ').toLowerCase();
  // prose rows × columns -> [r0, c0, r1, c1] (0-based); with only one of the two, whole rows or columns
  function proseRects(after) {
    const rows = ranges(ROWS_RE, after).map(([a, b]) => [+a - 1, +(b || a) - 1]);
    const cols = ranges(COLS_RE, after).map(([a, b]) => [Cells.colIndex(a), Cells.colIndex(b || a)]);
    if (rows.length && cols.length) return { ranges: rows.flatMap(([r0, r1]) => cols.map(([c0, c1]) => [r0, c0, r1, c1])), rects: [] };
    return { ranges: [], rects: rows.map(([r0, r1]) => [r0, 0, r1, 16383]).concat(cols.map(([c0, c1]) => [0, c0, 1e7, c1])) };
  }
  const slotsOf = new Map();   // finding id -> the cells it cites, per sheet (filled when its details render)
  function linkSheets(roots) {
    const books = pdfs.filter(p => p.sheets && p.sheets.length);
    if (!books.length) return;
    const text = roots.map(r => r.textContent).join(' ').replace(/[_\s]+/g, ' ').toLowerCase();
    const has = name => books.some(p => p.sheets.some(s => s.name.trim() === name));
    const named = h => new RegExp('\\b' + stem(h.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(text);
    const bookOf = name => { const hits = books.filter(p => p.sheets.some(s => s.name.trim() === name)); return hits.find(named) || hits[0]; };
    const slots = new Map();
    const slot = (doc, sheet) => { const k = `${doc}\u0000${sheet}`; return slots.get(k) || slots.set(k, { doc, sheet, ranges: [], rects: [], links: [] }).get(k); };
    roots.forEach(root => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
      while (w.nextNode()) if (/sheet/i.test(w.currentNode.nodeValue) && !w.currentNode.parentNode.closest('code, a')) nodes.push(w.currentNode);
      nodes.forEach(n => {
        const v = n.nodeValue, frag = document.createDocumentFragment();
        let last = 0;
        for (const m of v.matchAll(/['‘"“]([^'’"”\n]{1,40})['’"”]/g)) {
          if (!has(m[1].trim()) || !/\bsheets?\b/i.test(v.slice(Math.max(0, m.index - 80), m.index))) continue;
          const q = document.createElement('span');
          q.textContent = m[0]; q.dataset.sheet = m[1].trim();
          frag.append(v.slice(last, m.index), q);
          last = m.index + m[0].length;
        }
        if (last) { frag.append(v.slice(last)); n.replaceWith(frag); }
      });
      root.querySelectorAll('code, span[data-sheet]').forEach(code => {
        const name = code.dataset.sheet || code.textContent.trim();
        const p = has(name) && bookOf(name);
        if (!p) return;
        const r = document.createRange();
        r.setStartAfter(code); r.setEnd(root, root.childNodes.length);
        const own = proseRects(r.toString().slice(0, 160).split(/\bsheets?\b/i)[0]);
        const s = slot(p.id, name);
        s.ranges.push(...own.ranges); s.rects.push(...own.rects);
        const a = document.createElement('a');
        a.className = 'pg'; a.title = `Show in ${p.name}`;
        a.dataset.doc = p.id; a.dataset.sheet = name;
        const f0 = own.ranges[0] || own.rects[0];
        s.links.push({ a, focus: f0 && [Math.min(f0[0], 1e6), f0[1]] });
        code.replaceWith(a); a.append(code);
      });
    });
    // cell references belong to the sheet named before them: a sheet link, their own Sheet! prefix, or a figure
    // reference ("Source Data Fig. 3") when exactly one loaded sheet is named for that figure; else the first sheet named
    const bySheet = new Map();
    books.forEach(p => p.sheets.forEach(sh => {
      const ks = Facets.entities(sh.name).filter(k => !/^(x|src):/.test(k));
      if (ks.length === 1) bySheet.set(ks[0], bySheet.has(ks[0]) ? null : { doc: String(p.id), sheet: sh.name.trim() });
    }));
    // "SI 12b" in a table row is shorthand for Supplementary Fig. 12b
    const figsIn = v => bySheet.size ? Facets.refs(v).concat([...v.matchAll(/\b(?:SI|Suppl?\.?)\s+(\d{1,3})[a-z]{0,2}\b(?!\s*(?:Tables?|Notes?|Data)\b)/g)].map(m => ({ key: 'sf' + m[1], index: m.index })))
      .filter(r => bySheet.get(r.key)).sort((x, y) => x.index - y.index) : [];
    let cur = null, first = null;
    const found = [];
    roots.forEach(root => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const n = w.currentNode;
        if (n.nodeType === 1) { if (n.matches('a.pg[data-sheet]')) { cur = n.dataset; first = first || cur; } continue; }
        if (n.parentNode.closest('a')) continue;
        const v = n.nodeValue;
        // in a table, a reference takes its sheet from its own cell, else the column header, else the row's first cell
        const td = n.parentNode.closest('td, th');
        let ctx = cur;
        if (td) {
          const tr = td.parentNode, head = td.closest('table').querySelector('thead tr');
          [tr.cells[0] !== td && tr.cells[0], head && head.cells[td.cellIndex]].forEach(x => { const f = x && figsIn(x.textContent).pop(); if (f) ctx = bySheet.get(f.key); });
        }
        const figs = figsIn(v);
        const ms = Cells.scan(v).map(m => {
          figs.forEach(r => { if (r.index < m.index) ctx = bySheet.get(r.key); });
          return Object.assign(m, { cur: ctx });
        });
        figs.forEach(r => { first = first || bySheet.get(r.key); if (!td) cur = bySheet.get(r.key); });
        if (ms.length) found.push({ n, ms });
      }
    });
    found.forEach(({ n, ms }) => {
      const v = n.nodeValue, frag = document.createDocumentFragment();
      let last = 0;
      ms.forEach(m => {
        // the longest tail of an unquoted prefix that names a loaded sheet ("the source Figure 2I!B7" -> "Figure 2I")
        let name = null, start = m.index + m.pre;
        if (m.sheet) {
          const w = m.quoted ? [m.sheet] : m.sheet.split(' ');
          for (let i = 0; i < w.length && !name; i++) if (has(w.slice(i).join(' '))) name = w.slice(i).join(' ');
          if (name) start = m.index + m.pre - name.length - 1 - (m.quoted ? 2 : 0);
        }
        const own = name && bookOf(name);
        const at = own ? { doc: own.id, sheet: name } : m.cur || first;
        if (!at || start < last) return;
        const s = slot(+at.doc, at.sheet);
        s.ranges.push(m.range);
        const a = document.createElement('a');
        a.className = 'pg cell'; a.title = `Show in ${at.sheet}`; a.textContent = v.slice(start, m.index + m.length);
        a.dataset.doc = at.doc; a.dataset.sheet = at.sheet;
        s.links.push({ a, focus: [m.range[0], m.range[1]] });
        frag.append(v.slice(last, start), a);
        last = m.index + m.length;
      });
      if (last) { frag.append(v.slice(last)); n.replaceWith(frag); }
    });
    const all = [...slots.values()];
    slotsOf.set(ui.sel, all.filter(s => s.ranges.length || s.rects.length).map(({ doc, sheet, ranges, rects }) => ({ doc, sheet, ranges, rects })));
    all.forEach(s => {
      const others = all.filter(o => o !== s && o.ranges.length).map(o => ({ doc: o.doc, sheet: o.sheet, ranges: o.ranges }));
      s.links.forEach(({ a, focus }) => { a.dataset.target = JSON.stringify({ sheet: s.sheet, ranges: s.ranges, rects: s.rects, focus, others }); });
    });
  }

  function renderQueries() {
    const items = exportItems();
    const nf = new Set(items.flatMap(o => o.items.map(q => q.finding))).size;
    $('#qCount').innerHTML = `<b>${items.length}</b> queries from <b>${nf}</b> confirmed finding${nf === 1 ? '' : 's'}`;
    const qno = q => q.num ? `<span class="qno" title="Query number in the audit">Q${esc(q.num)}</span>` : '';
    const chip = id => { const f = model.map.get(id); return f ? `<button class="fchip c-${f.colour}" data-goto="${esc(id)}">${fname(f)}</button>` : ''; };
    $('#qList').innerHTML = items.length ? items.map(o => o.header
      ? `<li><div class="qx">${inline(o.header)}</div><ul>${o.items.map((q, i) => `<li><span>${inline(q.text)}</span>${qno(q)}${i && o.items[i - 1].finding === q.finding ? '' : chip(q.finding)}</li>`).join('')}</ul></li>`
      : `<li><span>${inline(o.items[0].text)}</span>${qno(o.items[0])}${chip(o.items[0].finding)}</li>`).join('')
      : '<p class="muted">Confirm findings to build the query list.</p>';
  }

  function renderPdf(reload, target) {
    const pane = $('#pdfPane');
    pane.hidden = !ui.pdf;
    if (!ui.pdf) return;
    const p = pdfs[pdfIdx];
    $('#pdfTabs').innerHTML = pdfs.map((x, i) => `<button class="${i === pdfIdx ? 'on' : ''} ${x.kind === 'sheet' ? 'sh' : ''}" data-pdf="${i}" title="${esc(x.name)}">${esc(x.name.replace(/\.\w+$/, '').replace(/^.*?-(?=[A-Z])/, ''))}</button>`).join('')
      + '<button data-act="loadpdf" title="Load PDF, Word file or spreadsheet">+</button>';
    $('#pdfOffset').value = p ? p.offset || 0 : 0;
    $('#pdfOffsetWrap').hidden = !p || !isText(p);
    $('#docView').hidden = !p || p.kind !== 'docx';
    $('#sheetView').hidden = !p || p.kind !== 'sheet';
    const frame = $('#pdfFrame');
    if (!p) { frame.hidden = true; $('#pdfEmpty').hidden = false; return; }
    $('#pdfEmpty').hidden = true;
    frame.hidden = p.kind !== 'pdf';
    if (p.kind === 'sheet') return showSheet(p, target);
    if (p.kind === 'docx') return showDocx(p, reload);
    // navpanes=0 (Chrome, Acrobat) and pagemode=none (Firefox) keep the thumbnail sidebar closed
    const want = `${p.url}#page=${p.page || 1}&navpanes=0&pagemode=none&view=FitH`;
    if (reload || frame.dataset.src !== want) {
      const nf = frame.cloneNode(false);
      nf.src = want; nf.dataset.src = want;
      nf.addEventListener('load', () => setTimeout(() => { if (document.activeElement === nf) nf.blur(); }, 150));
      frame.replaceWith(nf);
    }
  }

  // ---------- Word files ----------
  let shownDocx = null, dxHits = [], dxAt = -1;

  async function showDocx(p, jump) {
    const box = $('#dxDoc'), note = t => { $('#dxNote').textContent = t; };
    if (shownDocx !== p.id) {
      shownDocx = null; box.innerHTML = ''; note('Reading…'); clearDocFind();
      let d;
      try { d = await p.doc; } catch (e) { if (pdfs[pdfIdx] === p) note(`Could not open ${p.name}: ${e.message}`); return; }
      if (pdfs[pdfIdx] !== p) return;
      box.innerHTML = d.html; box.scrollTop = 0; shownDocx = p.id;
      note(d.pages > 1 ? `${d.pages} pages at Word's last layout · text view, not the printed layout` : 'Text view, not the printed layout · no page breaks saved in this file');
      jump = jump || p.page > 1;
    }
    if (jump && p.page > 1) {
      const m = box.querySelector(`.dx-pg[data-page="${p.page}"]`);
      if (m) m.scrollIntoView({ block: 'start' });
    }
  }

  function clearDocFind() {
    dxHits = []; dxAt = -1; $('#dxFindN').textContent = '';
    if (window.CSS && CSS.highlights) { CSS.highlights.delete('dx-hit'); CSS.highlights.delete('dx-cur'); }
  }

  function findInDoc(back) {
    if (!dxHits.length) {
      dxHits = Docx.find($('#dxDoc'), $('#dxFind').value); dxAt = -1;
      if (dxHits.length && window.Highlight && CSS.highlights) CSS.highlights.set('dx-hit', new Highlight(...dxHits));
    }
    const n = dxHits.length;
    if (!n) { $('#dxFindN').textContent = $('#dxFind').value.trim() ? 'none' : ''; return; }
    dxAt = dxAt < 0 ? 0 : (dxAt + (back ? n - 1 : 1)) % n;
    const r = dxHits[dxAt];
    if (window.Highlight && CSS.highlights) CSS.highlights.set('dx-cur', new Highlight(r));
    r.startContainer.parentElement.scrollIntoView({ block: 'center' });
    $('#dxFindN').textContent = `${dxAt + 1} of ${n.toLocaleString()}`;
  }

  // ---------- spreadsheets ----------
  // parsed sheets are kept for the last few viewed; reading one sheet aborts an unfinished read of another
  const sheetCache = new Map();
  let grid = null, shownSheet = null, reading = null;

  async function showSheet(p, target) {
    const note = t => { $('#shNote').textContent = t; };
    grid = grid || Grid.create($('#shGrid'), (addr, v) => { $('#shCell').innerHTML = addr ? `<b>${addr}</b>${esc(v)}` : ''; });
    let book;
    try { book = await p.book; } catch (e) {
      shownSheet = null; $('#shTabs').innerHTML = ''; grid.clear(); renderKey([]);
      return note(`Could not open ${p.name}: ${e.message}`);
    }
    if (pdfs[pdfIdx] !== p) return;
    const si = Math.min(p.sheet || 0, book.sheets.length - 1);
    $('#shTabs').innerHTML = book.sheets.map((s, i) => `<button class="${i === si ? 'on' : ''} ${s.hidden ? 'hid' : ''}" data-sheet-i="${i}" title="${esc(s.name)}${s.hidden ? ' (hidden in the workbook)' : ''}">${esc(s.name)}</button>`).join('');
    if (si < 0) { grid.clear(); return note('No worksheets in this file'); }
    const key = `${p.id}:${si}`;
    if (shownSheet === key) { if (target) applyHl(key, target); return; }
    if (reading && reading.key !== key) { reading.signal.aborted = true; sheetCache.delete(reading.key); }
    let job = sheetCache.get(key);
    if (!job) {
      const signal = { aborted: false };
      job = { key, signal, data: book.read(si, { signal, progress: n => { if (shownSheet === key) note(`Reading… ${n.toLocaleString()} rows`); } }) };
    }
    sheetCache.delete(key); sheetCache.set(key, job);
    for (const k of sheetCache.keys()) if (sheetCache.size > 4 && k !== key) sheetCache.delete(k);
    reading = job; shownSheet = key;
    grid.clear(); renderKey([]); note('Reading…'); $('#shFindN').textContent = '';
    let d;
    try { d = await job.data; } catch (e) {
      sheetCache.delete(key);
      if (shownSheet === key) { shownSheet = null; if (e.name !== 'AbortError') note(`Could not read this sheet: ${e.message}`); }
      return;
    } finally { if (reading === job) reading = null; }
    if (shownSheet !== key) return;
    grid.show(d);
    const nr = d.rows.length.toLocaleString();
    note(d.truncated ? `First ${nr} of ${d.total > d.rows.length ? d.total.toLocaleString() : 'more'} rows: too large to show whole` : `${nr} rows × ${d.ncols} columns`);
    applyHl(key, target);
  }

  // the cells one finding cites on one sheet; kept so they show again when that sheet is revisited
  let hl = null;
  function applyHl(key, target) {
    if (target) hl = { key, target, fid: ui.sel };
    if (!hl || hl.key !== key) return renderKey([]);
    const h = hl;
    renderKey(grid.highlight(h.target));
    if (!(h.target.others || []).length) return;
    // the finding's ranges on other sheets, so a copy across sheets shows in colour here too
    if (!h.external) h.external = otherRanges(h.target.others);
    h.external.then(ext => { if (hl === h && shownSheet === key && ext.length) { renderKey(grid.highlight({ ...h.target, external: ext }, true)); } });
  }

  async function otherRanges(others) {
    const out = [];
    for (const o of others) {
      const p = pdfs.find(x => x.id === +o.doc), si = p && p.sheets ? p.sheets.findIndex(s => s.name.trim() === o.sheet) : -1;
      if (si < 0) continue;
      let d;
      try { d = await readSheet(p, si); } catch (e) { continue; }
      o.ranges.forEach(([r0, c0, r1, c1]) => {
        if ((r1 - r0 + 1) * (c1 - c0 + 1) > 5000) return;
        const vals = [];
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) vals.push((d.rows[r] || [])[c]);
        out.push({ sheet: o.sheet, range: [r0, c0, r1, c1], vals });
      });
    }
    return out;
  }

  // the cited sheets with their highlights, as an Excel file
  async function exportCells(fid) {
    const f = model.map.get(fid), slots = slotsOf.get(fid) || [];
    if (!f || !slots.length) return toast('This finding cites no cells on a loaded sheet');
    toast('Preparing the Excel file…');
    const parts = [];
    for (const s of slots) {
      const p = pdfs.find(x => x.id === +s.doc), si = p && p.sheets ? p.sheets.findIndex(x => x.name.trim() === s.sheet) : -1;
      if (si < 0) continue;
      try { parts.push({ p, s, d: await readSheet(p, si) }); } catch (e) { toast(`Could not read ${s.sheet}`); }
    }
    if (!parts.length) return toast('Could not read the cited sheets');
    const vals = (d, [r0, c0, r1, c1]) => { const v = []; for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) v.push((d.rows[r] || [])[c]); return v; };
    const out = parts.map(({ p, s, d }) => {
      const external = parts.filter(o => o.s !== s).flatMap(o => o.s.ranges.filter(([r0, c0, r1, c1]) => (r1 - r0 + 1) * (c1 - c0 + 1) <= 5000).map(r => ({ sheet: o.s.sheet, range: r, vals: vals(o.d, r) })));
      return { book: p.name, sheet: s.sheet, d, paint: Cells.paint(d, s.ranges, s.rects, external, s.sheet) };
    });
    const tag = f.pseudo ? 'Typos' : `F${f.id}`;
    download(Export.workbook(out, { finding: `${fname(f)} — ${plain(f.head || f.title)}`, msid: model.msid }), `${model.msid || 'audit'}-${tag}-Highlighted_cells.xlsx`);
    toast(`Exported ${out.length} sheet${out.length === 1 ? '' : 's'} for ${fname(f)}`);
  }

  // a sheet's cells without showing it; shares the cache with the viewer
  function readSheet(p, si) {
    const key = `${p.id}:${si}`;
    let job = sheetCache.get(key);
    if (!job) {
      const signal = { aborted: false };
      job = { key, signal, data: p.book.then(b => b.read(si, { signal })) };
      sheetCache.set(key, job);
      job.data.catch(() => sheetCache.delete(key));
    }
    return job.data;
  }

  function renderKey(legend) {
    const k = $('#shKey');
    k.hidden = !legend.length;
    if (!legend.length) { k.innerHTML = ''; return; }
    const f = model && model.map.get(hl.fid);
    k.innerHTML = `${f ? `<button class="kf c-${f.colour}" data-goto="${esc(f.id)}" title="Open finding">${fname(f)}</button>` : ''}${legend.map(x =>
      `<button class="kk ${x.cls}" data-jump="${x.at.join(',')}" title="${esc(x.label)} — ${esc(x.note)}"><i></i>${esc(x.label)}${x.cls !== 'mk' ? ` <em>${esc(x.note)}</em>` : ''}</button>`).join('')}<span class="grow"></span><button class="kx" data-act="exportcells" data-fid="${esc(hl.fid)}" title="Excel file of the sheets this finding cites, with these highlights">⤓ Excel</button><button class="lnk" data-act="clearhl" title="Remove the highlights">Clear</button>`;
  }

  function findInSheet(back) {
    const r = grid && grid.find($('#shFind').value, back);
    $('#shFindN').textContent = r ? r.n ? `${r.i} of ${r.n.toLocaleString()}` : 'none' : '';
  }

  // ---------- events ----------
  const fileInput = $('#fileInput');
  fileInput.addEventListener('change', () => { loadFiles(fileInput.files); fileInput.value = ''; });
  const dirInput = $('#dirInput');
  dirInput.addEventListener('change', () => { loadFiles([], [...dirInput.files].map(f => ({ path: f.webkitRelativePath, get: () => f }))); dirInput.value = ''; });

  document.addEventListener('click', e => {
    if (e.target.closest('.chk') && e.target.tagName !== 'INPUT') return;
    if (ui.pop && !e.target.closest('.fdrop')) closePop();
    if (e.target.id === 'modal') return closeDetail();
    const t = e.target.closest('[data-act],[data-colour],[data-status],[data-tab],[data-goto],[data-pdf],[data-sheet-i],[data-jump],[data-pop],[data-ent],[data-type],[data-entmode],[data-label],[data-lcol],[data-ldel],[data-lrm],[data-edtype],[data-md],a.pg,.card');
    if (!t) return;
    const act = t.dataset.act;
    const card = t.closest('.card');
    const qEl = t.closest('.q');
    const q = qEl && st.queries.find(x => x.id === qEl.dataset.q);
    if (act === 'load') return fileInput.click();
    if (act === 'loadfolder') return dirInput.click();
    if (act === 'loadpdf') { const all = fileInput.accept; fileInput.accept = VIEW_ACCEPT; fileInput.click(); fileInput.accept = all; return; }
    if (act === 'resume') { try { restore(JSON.parse(localStorage.getItem(KEY))); } catch (err) { toast('Autosave unreadable'); } return; }
    if (act === 'save') return save(e.shiftKey);
    if (act === 'copy') return copyQueries();
    if (act === 'xlsx') return exportXlsx();
    if (act === 'pdf') { ui.pdf = !ui.pdf; renderHeader(); return renderPdf(); }
    if (act === 'closepdf') { ui.pdf = false; renderHeader(); return renderPdf(); }
    if (!model) return;
    if (t.matches('a.pg')) { e.preventDefault(); return t.dataset.doc ? gotoSheet(t) : gotoPage(t.dataset.role, +t.dataset.page); }
    if (t.dataset.pdf) { pdfIdx = +t.dataset.pdf; return renderPdf(); }
    if (t.dataset.sheetI) { pdfs[pdfIdx].sheet = +t.dataset.sheetI; return renderPdf(); }
    if (t.dataset.jump) return grid && grid.jump(...t.dataset.jump.split(',').map(Number));
    if (act === 'exportcells') return exportCells(t.dataset.fid);
    if (act === 'clearhl') { hl = null; if (grid) grid.unmark(); return renderKey([]); }
    if (t.dataset.pop) return openPop(t.dataset.pop);
    if (t.dataset.ent) { toggle(ui.ents, t.dataset.ent); renderCards(); return renderDetail(); }
    if (t.dataset.type) { toggle(ui.types, t.dataset.type); renderCards(); return renderDetail(); }
    if (t.dataset.entmode) { ui.entMode = t.dataset.entmode; renderCards(); return renderDetail(); }
    if (act === 'clearents') { ui.ents.clear(); renderCards(); return renderDetail(); }
    if (t.dataset.label) { toggle(ui.labels, t.dataset.label); renderCards(); return renderDetail(); }
    if (t.dataset.lcol) { const d = st.labels.find(l => l.name === t.dataset.lcol); if (d) d.c = (d.c + 1) % LCOL.length; changed(); renderCards(); return renderDetail(); }
    if (t.dataset.ldel) return deleteLabel(t.dataset.ldel);
    if (t.dataset.lrm) return removeLabel(ui.sel, t.dataset.lrm);
    if (act === 'clearlabels') { ui.labels.clear(); renderCards(); return renderDetail(); }
    if (act === 'addfinding') return addFinding();
    if (act === 'edit') { ui.edit = ui.sel; return renderDetail(); }
    if (act === 'eddone') { finishEdit(); return render(); }
    if (act === 'eddel') { const f = model.map.get(ui.sel); if (f && confirm(`Delete ${fname(f)} and its queries?`)) { ui.edit = null; dropFinding(f.id); build(); render(); } return; }
    if (t.dataset.edtype) { const u = custom(ui.sel); if (u) { toggle.arr(u.types, t.dataset.edtype); changed(); build(); renderCards(); renderDetail(); } return; }
    if (t.dataset.md) return mdTool(t.dataset.md);
    if (act === 'cleartypes') { ui.types.clear(); renderCards(); return renderDetail(); }
    if (act === 'confirmall') return confirmAll();
    if (act === 'undoconfirmall') return undoConfirmAll();
    if (act === 'clearfilters') {
      ui.ents.clear(); ui.types.clear(); ui.labels.clear(); ui.colours.clear(); ui.status = 'all'; ui.q = ''; $('#search').value = '';
      renderCards(); return renderDetail();
    }
    if (act === 'closedetail') return closeDetail();
    if (t.dataset.colour) { toggle(ui.colours, t.dataset.colour); renderCards(); return renderDetail(); }
    if (t.dataset.status) { ui.status = t.dataset.status; renderCards(); return renderDetail(); }
    if (t.dataset.tab) {
      ui.tab = t.dataset.tab;
      document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
      $('#findingsView').hidden = ui.tab !== 'findings'; $('#queriesView').hidden = ui.tab !== 'queries';
      return;
    }
    if (t.dataset.goto) return openDetail(t.dataset.goto);
    if (act === 'confirm' || act === 'dismiss') { e.stopPropagation(); return setStatus(card ? card.dataset.id : ui.sel, act === 'confirm' ? 'confirmed' : 'dismissed'); }
    if (act === 'sevreset') { const f = model.map.get(ui.sel); return f && setColour(f.id, f.colour0); }
    if (act === 'prev') return step(-1);
    if (act === 'next') return step(1);
    if (act === 'qinc' && q) { q.include = t.checked; qEl.classList.toggle('off', !q.include); changed(); renderHeader(); return renderQueries(); }
    if (act === 'qreset' && q) { q.text = q.orig; changed(); renderDetail(); return renderQueries(); }
    if (act === 'qdel' && q) { st.queries.splice(st.queries.indexOf(q), 1); changed(); return render(); }
    if (act === 'addq') {
      const f = model.map.get(ui.sel);
      const nq = { id: `u${Date.now()}`, text: '', orig: '', finding: f.id, include: true, custom: true };
      let at = -1;
      st.queries.forEach((x, i) => { if (x.finding === f.id) at = i; });
      if (at < 0) { const after = st.queries.findIndex(x => !x.group && (model.map.get(x.finding) || {}).doc > f.doc); at = (after < 0 ? st.queries.findIndex(x => x.group) : after) - 1; if (at < -1) at = st.queries.length - 1; }
      st.queries.splice(at + 1, 0, nq);
      changed(); renderCards(); renderDetail();
      const ed = document.querySelector(`.q[data-q="${nq.id}"] .qt`); if (ed) ed.focus();
      return;
    }
    if (card && !t.closest('[data-act]')) openDetail(card.dataset.id);
  });

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.act === 'qmove') {
      const q = st.queries.find(x => x.id === t.closest('.q').dataset.q);
      q.finding = t.value; changed(); render();
    }
    if (t.dataset.act === 'sev' && ui.sel) setColour(ui.sel, t.value);
    if (t.id === 'pdfOffset' && pdfs[pdfIdx]) { pdfs[pdfIdx].offset = +t.value || 0; changed(); }
  });

  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'search') { ui.q = t.value; return renderCards(); }
    if (t.id === 'shFind') { $('#shFindN').textContent = ''; return; }
    if (t.id === 'dxFind') return clearDocFind();
    if (t.dataset.act === 'note') { fstate(ui.sel).note = t.value; return changed(); }
    if (t.dataset.ed) {
      const u = custom(ui.sel);
      if (!u) return;
      u[t.dataset.ed] = t.value; changed(); build(); renderCards(); renderHeader(); renderQueries();
      if (t.dataset.ed === 'ents') { const box = document.querySelector('#detail .ed-ents'); if (box) box.innerHTML = detailEnts(model.map.get(ui.sel)); }
      return;
    }
    // a label picked from the suggestions
    if (t.dataset.act === 'labelin' && (!e.inputType || e.inputType === 'insertReplacementText') && st.labels.some(l => l.name === t.value)) return addLabel(ui.sel, t.value);
    if (t.dataset.act === 'qtext') {
      const q = st.queries.find(x => x.id === t.closest('.q').dataset.q);
      q.text = t.innerText.replace(/\s*\n\s*/g, ' ').trim(); changed(); renderHeader(); renderQueries();
    }
  });

  document.addEventListener('toggle', e => { if (e.target.matches('details.claim:not(.checked)')) ui.claimOpen = e.target.open; }, true);

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); return save(e.shiftKey); }
    if (e.target.id === 'shFind' && e.key === 'Enter') { e.preventDefault(); return findInSheet(e.shiftKey); }
    if (e.target.id === 'dxFind' && e.key === 'Enter') { e.preventDefault(); return findInDoc(e.shiftKey); }
    if (e.target.matches('.lin') && e.key === 'Enter') { e.preventDefault(); return addLabel(ui.sel, e.target.value); }
    if (e.target.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey || !model || !model.map.size) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'escape') { if (ui.pop) closePop(); else if (ui.open) closeDetail(); return; }
    if ((k === 'enter' || k === ' ') && e.target.closest('button, a, summary')) return;
    if (k === 'enter' || k === 'o') { e.preventDefault(); if (ui.open) closeDetail(); else if (ui.sel) openDetail(ui.sel); return; }
    if (k === 'e' || k === 't') { e.preventDefault(); if (ui.tab !== 'findings') document.querySelector('[data-tab="findings"]').click(); return openPop(k === 'e' ? 'entity' : 'type'); }
    if (k === 'arrowdown' || k === 'j') { e.preventDefault(); step(1); }
    else if (k === 'arrowup' || k === 'k') { e.preventDefault(); step(-1); }
    else if (k === 'c' || k === ' ') { e.preventDefault(); if (ui.sel) setStatus(ui.sel, 'confirmed'); }
    else if (k === 'x') { if (ui.sel) setStatus(ui.sel, 'dismissed'); }
    else if (/^[0-4]$/.test(k)) { const f = ui.sel && model.map.get(ui.sel); if (f) setColour(f.id, k === '0' ? f.colour0 : COLOURS[+k - 1]); }
    else if (k === 'p') { ui.pdf = !ui.pdf; renderHeader(); renderPdf(); }
    else if (k === 'l') { e.preventDefault(); if (ui.sel) { if (!ui.open) openDetail(ui.sel); const i = document.querySelector('#detail .lin'); if (i) i.focus(); } }
    else if (k === 'n') { e.preventDefault(); addFinding(); }
    else if (k === 'q') document.querySelector(`[data-tab="${ui.tab === 'findings' ? 'queries' : 'findings'}"]`).click();
    else if (k === '/') { e.preventDefault(); $('#search').focus(); }
  });

  let dragDepth = 0;
  window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); loadDrop(e.dataTransfer); });
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  render();
})();
