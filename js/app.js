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
  const CE = (() => { try { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true'; } catch (e) { return 'true'; } })();

  let src = { audit: '', auditName: '', critical: '', criticalName: '' };
  // pdfs: everything the viewer pane shows, PDFs first, then spreadsheets ({ kind: 'sheet' })
  let st = null, model = null, pdfs = [], pdfIdx = 0, dirty = false, fileHandle = null, autosaveT = 0, docSeq = 0;
  const SHEET_EXT = /\.(xlsx|xlsm|xls|ods|csv|tsv)$/i;
  const VIEW_ACCEPT = '.pdf,.xlsx,.xlsm,.xls,.ods,.csv,.tsv';
  const ui = { tab: 'findings', sel: null, colours: new Set(), status: 'all', q: '', ents: new Set(), entMode: 'any', types: new Set(), pop: null, open: false, pdf: false, claimOpen: false };

  const plain = s => s.replace(/<[^>]+>/g, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1$2').replace(/`([^`]+)`/g, '$1');
  const fstate = id => st.findings[id] || (st.findings[id] = {});
  const status = id => (st.findings[id] || {}).s || null;
  const fname = f => f.pseudo ? 'Typos' : `#${f.id}`;

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
    return { msid: A ? A.msid : '', findings: {}, queries: A ? A.queries.map(q => ({ ...q, include: true })) : [], groups: A ? A.groups : {} };
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
      const types = f.meta ? f.meta.types.map(Facets.typeOf).filter(Boolean) : [];
      f.types = types.length ? [...new Set(types)] : [Facets.type(f)];
      f.type = f.types[0];
      f.ents = Facets.entities(f.meta && f.meta.ents ? f.meta.ents : [f.title, f.location, f.head, f.brief, f.body, ...qs].join('\n'));
    });
    model = {
      A, C, map,
      msid: (A && A.msid) || (C && C.msid) || st.msid || '',
      title: (C && C.title) || (A && A.manuscript) || '',
      order: all.slice().sort((a, b) => COLOURS.indexOf(a.colour) - COLOURS.indexOf(b.colour) || a.rank - b.rank || a.doc - b.doc),
      doc: all.slice().sort((a, b) => a.doc - b.doc)
    };
    if (!map.has(ui.sel)) ui.sel = model.order.length ? model.order[0].id : null;
    if (build.msid !== model.msid) { ui.ents.clear(); ui.types.clear(); ui.open = false; build.msid = model.msid; }
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
    pdfs.forEach(p => p.url && URL.revokeObjectURL(p.url));
    pdfs = []; fileHandle = null;
    const want = (s.pdfs || []).map(p => p.name);
    restore.offsets = Object.fromEntries((s.pdfs || []).map(p => [p.name, p.offset || 0]));
    ui.sel = s.ui && s.ui.sel;
    build(); render();
    dirty = false;
    toast(want.length ? `Restored ${model.msid}. Load again: ${want.join(', ')}` : `Restored ${model.msid}`);
  }

  // ---------- loading ----------
  function roleOf(name) { return /supp|(^|[_\-. ])si([_\-. ]|$)|supplement/i.test(name) ? 'si' : /article|main|manuscript|paper/i.test(name) ? 'main' : 'other'; }

  async function loadFiles(list) {
    const files = [...list];
    const md = [], saves = [], docFiles = [];
    for (const f of files) {
      if (/\.json$/i.test(f.name)) saves.push(f);
      else if (/\.pdf$/i.test(f.name) || SHEET_EXT.test(f.name)) docFiles.push(f);
      else if (/\.(md|markdown|txt)$/i.test(f.name)) md.push({ name: f.name, text: await f.text() });
      else toast(`Skipped ${f.name}`);
    }
    for (const f of saves) {
      if (dirty && !confirm(`Discard unsaved changes on ${model.msid}?`)) return;
      try { restore(JSON.parse(await f.text())); } catch (e) { toast(`Could not read ${f.name}`); }
    }
    const added = docFiles.map(addDoc);
    if (added.length) pdfIdx = pdfs.indexOf(added.find(p => p.kind === 'pdf' && p.role === 'main') || added.find(p => p.kind === 'pdf') || added[0]);
    const isCrit = m => /critical/i.test(m.name) || /^#\s*Critical triage/m.test(m.text);
    for (const m of md.sort((a, b) => isCrit(a) - isCrit(b))) {
      if (isCrit(m)) { src.critical = m.text; src.criticalName = m.name; }
      else if (!setAudit(m)) return;
    }
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
    const progress = st && Object.values(st.findings).some(v => v.s || v.note || v.colour);
    if (progress && !confirm(`Replace the current work on ${model.msid} with ${A.msid || m.name}?`)) return false;
    if (st && st.msid && st.msid !== A.msid) {
      src.critical = ''; src.criticalName = ''; fileHandle = null;
      pdfs = pdfs.filter(p => !p.name.includes(st.msid) || (p.url && URL.revokeObjectURL(p.url), false));
      pdfIdx = 0;
    }
    src.audit = m.text; src.auditName = m.name;
    st = freshState(A);
    return true;
  }

  function addDoc(file) {
    const i = pdfs.findIndex(p => p.name === file.name);
    const p = SHEET_EXT.test(file.name)
      ? { id: ++docSeq, name: file.name, kind: 'sheet', sheet: 0, book: Sheet.open(file) }
      : { id: ++docSeq, name: file.name, kind: 'pdf', url: URL.createObjectURL(file), role: roleOf(file.name), offset: (restore.offsets || {})[file.name] || 0 };
    if (p.book) p.book.then(b => { p.sheets = b.sheets; if (ui.open) renderDetail(); }, () => { });
    if (i >= 0) { if (pdfs[i].url) URL.revokeObjectURL(pdfs[i].url); pdfs[i] = p; } else pdfs.push(p);
    const rank = x => x.kind === 'pdf' ? ['main', 'si', 'other'].indexOf(x.role) : 3;
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
    const notes = model.order.filter(f => ((st.findings[f.id] || {}).note || '').trim() || reranked(f));
    if (!items.length && !notes.length) return toast('Nothing to export: confirm findings or add notes first');
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
      CNAME[f.colour0],
      STATUS[status(f.id)] || 'Open',
      ((st.findings[f.id] || {}).note || '').trim()
    ]);
    download(XLSX.build([
      { name: 'Author queries', header: ['No.', 'Author query', 'Finding', 'Triage'], rows, widths: [6, 110, 12, 10] },
      { name: 'Internal notes', header: ['Finding', 'Title', 'Severity', 'Triage', 'Status', 'Note'], rows: nrows, widths: [9, 50, 10, 10, 11, 80] }
    ]), `${model.msid || 'audit'}-Author_Queries.xlsx`);
    toast(`Exported ${items.length} quer${items.length === 1 ? 'y' : 'ies'} · ${notes.length} note${notes.length === 1 ? '' : 's'}`);
  }

  // ---------- actions ----------
  function setStatus(id, s) {
    const f = fstate(id);
    f.s = f.s === s ? null : s;
    changed(); render();
  }

  function setColour(id, c) {
    const f = model.map.get(id);
    if (!f || !COLOURS.includes(c)) return;
    const fs = fstate(id);
    if (c === f.colour0) delete fs.colour; else fs.colour = c;
    changed(); build(); render();
    const el = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
    else toast(`${fname(f)} moved to ${CNAME[c]} (hidden by filters)`);
  }

  // skip: leave one filter dimension out, for the counts shown on that dimension's own controls
  function passes(f, skip) {
    const q = ui.q.trim().toLowerCase();
    const ents = [...ui.ents];
    return (skip === 'colour' || !ui.colours.size || ui.colours.has(f.colour)) &&
      (ui.status === 'all' || (ui.status === 'open' ? !status(f.id) : status(f.id) === ui.status)) &&
      (skip === 'type' || !ui.types.size || f.types.some(t => ui.types.has(t))) &&
      (skip === 'entity' || !ents.length || (ui.entMode === 'all' ? ents.every(k => f.ents.includes(k)) : ents.some(k => f.ents.includes(k)))) &&
      (!q || `${f.id} ${f.title} ${f.head} ${f.brief} ${f.location} ${f.body}`.toLowerCase().includes(q));
  }
  const visible = () => model.order.filter(f => passes(f));
  const filtering = () => ui.ents.size || ui.types.size || ui.colours.size || ui.status !== 'all' || ui.q.trim();

  function select(id, scroll = true) {
    ui.sel = id;
    renderCards(); renderDetail();
    if (scroll) { const el = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); }
  }

  function openDetail(id) {
    if (id) ui.sel = id;
    ui.open = !!ui.sel;
    closePop();
    select(ui.sel);
    const d = $('#detail'); if (d && ui.open) d.focus();
  }

  function closeDetail() {
    ui.open = false;
    renderDetail();
    const el = document.querySelector(`.card[data-id="${CSS.escape(ui.sel || '')}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function toggle(set, v) { set.has(v) ? set.delete(v) : set.add(v); }

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
    const docs = pdfs.filter(p => p.kind === 'pdf'), cur = pdfs[pdfIdx];
    const p = docs.find(x => x.role === role) || (role === 'si' && cur && cur.kind === 'pdf' && cur) || docs.find(x => x.role === 'main') || docs[0];
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
    const pdfOnly = pdfs.filter(p => p.kind === 'pdf'), sheets = pdfs.filter(p => p.kind === 'sheet');
    $('#files').innerHTML = model ? chip(src.audit, 'Audit', src.auditName) + chip(src.critical, 'Triage', src.criticalName)
      + chip(pdfOnly.length, pdfOnly.length > 1 ? `PDF ×${pdfOnly.length}` : 'PDF', pdfOnly.map(p => p.name).join(', '))
      + (sheets.length ? chip(1, sheets.length > 1 ? `Sheets ×${sheets.length}` : 'Sheet', sheets.map(p => p.name).join(', ')) : '') : '';
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
        pop.innerHTML = dim === 'entity' ? entityPop() : typePop();
        pop.querySelector('.pb').scrollTop = sc;
        pop.style.left = '0px';
        const r = pop.getBoundingClientRect(), over = r.right - (document.documentElement.clientWidth - 8);
        if (over > 0) pop.style.left = `${-Math.min(over, r.left - 8)}px`;
      }
    };
    btn('entity', 'Entity', ui.ents, entLabel);
    btn('type', 'Type', ui.types, t => Facets.TYPE_LABEL[t]);

    const act = $('#activeFilters');
    const chips = [...ui.ents].sort((a, b) => Facets.sortKey(a) - Facets.sortKey(b)).map(k => `<button class="af" data-ent="${k}" title="Remove">${esc(entLabel(k))}<i>✕</i></button>`)
      .concat([...ui.types].map(t => `<button class="af ty" data-type="${t}" title="Remove">${Facets.TYPE_LABEL[t]}<i>✕</i></button>`));
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
        <div class="cm"><label class="chk" title="Confirm (C)"><input type="checkbox" data-act="confirm" ${s === 'confirmed' ? 'checked' : ''}></label><span class="fid">${fname(f)}</span>${f.conditional ? '<span class="tag">Conditional</span>' : ''}${f.with.length ? `<span class="tag">with #${f.with.join(', #')}</span>` : ''}${reranked(f) ? `<span class="tag sev" title="Severity changed from the triage">${CNAME[f.colour0]}→${CNAME[f.colour]}</span>` : ''}${(st.findings[f.id] || {}).note ? '<span class="tag note">Note</span>' : ''}<span class="qn" title="Author queries">${nq}&thinsp;Q</span><button class="x" data-act="dismiss" title="Dismiss (X)">✕</button></div>
        <h3>${inline(f.head || f.title)}</h3>
        ${brief ? `<p>${inline(brief)}</p>` : ''}
        <div class="cf-row">${typeChips(f)}${cardEnts(f)}</div>
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
        <button class="act-c ${s === 'confirmed' ? 'on' : ''}" data-act="confirm" title="C">${s === 'confirmed' ? '✓ Confirmed' : 'Confirm'}</button>
        <button class="act-d ${s === 'dismissed' ? 'on' : ''}" data-act="dismiss" title="X">${s === 'dismissed' ? 'Dismissed' : 'Dismiss'}</button>
        <span class="nav"><button data-act="prev" ${i <= 0 ? 'disabled' : ''} title="Previous (↑)">↑</button><button data-act="next" ${i < 0 || i >= v.length - 1 ? 'disabled' : ''} title="Next (↓)">↓</button></span>
        <button class="close" data-act="closedetail" title="Close (Esc)">✕</button>
      </div>
      <div class="d-scroll">
        <h2>${inline(f.title)}</h2>
        ${f.location ? `<div class="d-loc">${inline(f.location)}</div>` : ''}
        <div class="d-ents">${typeChips(f)}${f.ents.map(k => `<button class="ent ${ui.ents.has(k) ? 'on' : ''} ${k.startsWith('x:') ? 'sec' : ''}" data-ent="${k}" title="Filter: ${esc(entLabel(k))}">${esc(k.startsWith('src:') ? 'SD · ' + Facets.label(k.slice(4)) : Facets.label(k))}</button>`).join('')}</div>
        ${f.head || f.brief ? `<div class="d-tri c-${f.colour}">${f.head ? `<b>${inline(f.head)}</b> ` : ''}${inline(f.brief)}${f.with.length ? ` <span class="tag">ranked with #${f.with.join(', #')}</span>` : ''}</div>` : ''}
        ${f.body ? `<div class="md d-body">${MD.render(f.body)}</div>` : ''}
        <section class="d-q">
          <h4>Author queries <span>${qs.length}</span></h4>
          ${qs.map(queryEditor).join('') || '<p class="muted">No query linked to this finding.</p>'}
          <button class="add" data-act="addq">+ Add query</button>
        </section>
        <section class="d-note"><h4>Note</h4><textarea data-act="note" rows="3" placeholder="Private note — never in copied queries; exported on the Excel tab ‘Internal notes’">${esc(note)}</textarea></section>
      </div>`;
    el.querySelectorAll('.d-loc, .d-body, .d-tri').forEach(linkPages);
    el.querySelectorAll('.d-loc, .d-body, .d-tri').forEach(linkSheets);
    el.querySelector('.d-scroll').scrollTop = keep;
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
  // "rows 21–29" / "columns AB and AN" after it mark those cells
  const ROWS_RE = /\brows?\s+(\d+(?:\s*(?:–|-|to)\s*\d+)?(?:\s*(?:,|and|&)\s*\d+(?:\s*(?:–|-|to)\s*\d+)?)*)/;
  const COLS_RE = /\bcol(?:umn)?s?\s+([A-Z]{1,3}(?:\s*(?:–|-)\s*[A-Z]{1,3})?(?:\s*(?:,|and|&)\s*[A-Z]{1,3}(?:\s*(?:–|-)\s*[A-Z]{1,3})?)*)\b/;
  const ranges = (re, s) => { const m = s.match(re); return m ? m[1].split(/\s*(?:,|and|&)\s*/).map(x => x.split(/\s*(?:–|-|to)\s*/)) : []; };
  const stem = name => name.replace(/\.\w+$/, '').replace(/^.*?-(?=[A-Z])/, '').replace(/_v\d+$/, '').replace(/[_\s]+/g, ' ').toLowerCase();
  function linkSheets(root) {
    const books = pdfs.filter(p => p.sheets && p.sheets.length);
    if (!books.length) return;
    const text = root.textContent.replace(/[_\s]+/g, ' ').toLowerCase();
    const has = name => books.some(p => p.sheets.some(s => s.name.trim() === name));
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
      const hits = books.filter(p => p.sheets.some(s => s.name.trim() === name));
      if (!hits.length) return;
      const named = h => new RegExp('\\b' + stem(h.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(text);
      const p = hits.find(named) || hits[0];
      const r = document.createRange();
      r.setStartAfter(code); r.setEnd(root, root.childNodes.length);
      const after = r.toString().slice(0, 160).split(/\bsheets?\b/i)[0];
      const a = document.createElement('a');
      a.className = 'pg'; a.title = `Show in ${p.name}`;
      a.dataset.doc = p.id; a.dataset.sheet = name;
      a.dataset.target = JSON.stringify({ rows: ranges(ROWS_RE, after).map(x => x.map(Number)), cols: ranges(COLS_RE, after) });
      code.replaceWith(a); a.append(code);
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
      + '<button data-act="loadpdf" title="Load PDF or spreadsheet">+</button>';
    $('#pdfOffset').value = p ? p.offset || 0 : 0;
    $('#pdfOffsetWrap').hidden = !p || p.kind !== 'pdf';
    $('#sheetView').hidden = !p || p.kind !== 'sheet';
    const frame = $('#pdfFrame');
    if (!p) { frame.hidden = true; $('#pdfEmpty').hidden = false; return; }
    $('#pdfEmpty').hidden = true;
    frame.hidden = p.kind !== 'pdf';
    if (p.kind === 'sheet') return showSheet(p, target);
    // navpanes=0 (Chrome, Acrobat) and pagemode=none (Firefox) keep the thumbnail sidebar closed
    const want = `${p.url}#page=${p.page || 1}&navpanes=0&pagemode=none&view=FitH`;
    if (reload || frame.dataset.src !== want) {
      const nf = frame.cloneNode(false);
      nf.src = want; nf.dataset.src = want;
      nf.addEventListener('load', () => setTimeout(() => { if (document.activeElement === nf) nf.blur(); }, 150));
      frame.replaceWith(nf);
    }
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
      shownSheet = null; $('#shTabs').innerHTML = ''; grid.clear();
      return note(`Could not open ${p.name}: ${e.message}`);
    }
    if (pdfs[pdfIdx] !== p) return;
    const si = Math.min(p.sheet || 0, book.sheets.length - 1);
    $('#shTabs').innerHTML = book.sheets.map((s, i) => `<button class="${i === si ? 'on' : ''} ${s.hidden ? 'hid' : ''}" data-sheet-i="${i}" title="${esc(s.name)}${s.hidden ? ' (hidden in the workbook)' : ''}">${esc(s.name)}</button>`).join('');
    if (si < 0) { grid.clear(); return note('No worksheets in this file'); }
    const key = `${p.id}:${si}`;
    if (shownSheet === key) { if (target) grid.highlight(target); return; }
    if (reading && reading.key !== key) { reading.signal.aborted = true; sheetCache.delete(reading.key); }
    let job = sheetCache.get(key);
    if (!job) {
      const signal = { aborted: false };
      job = { key, signal, data: book.read(si, { signal, progress: n => { if (shownSheet === key) note(`Reading… ${n.toLocaleString()} rows`); } }) };
    }
    sheetCache.delete(key); sheetCache.set(key, job);
    for (const k of sheetCache.keys()) if (sheetCache.size > 4 && k !== key) sheetCache.delete(k);
    reading = job; shownSheet = key;
    grid.clear(); note('Reading…'); $('#shFindN').textContent = '';
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
    if (target) grid.highlight(target);
  }

  function findInSheet(back) {
    const r = grid && grid.find($('#shFind').value, back);
    $('#shFindN').textContent = r ? r.n ? `${r.i} of ${r.n.toLocaleString()}` : 'none' : '';
  }

  // ---------- events ----------
  const fileInput = $('#fileInput');
  fileInput.addEventListener('change', () => { loadFiles(fileInput.files); fileInput.value = ''; });

  document.addEventListener('click', e => {
    if (e.target.closest('.chk') && e.target.tagName !== 'INPUT') return;
    if (ui.pop && !e.target.closest('.fdrop')) closePop();
    if (e.target.id === 'modal') return closeDetail();
    const t = e.target.closest('[data-act],[data-colour],[data-status],[data-tab],[data-goto],[data-pdf],[data-sheet-i],[data-pop],[data-ent],[data-type],[data-entmode],a.pg,.card');
    if (!t) return;
    const act = t.dataset.act;
    const card = t.closest('.card');
    const qEl = t.closest('.q');
    const q = qEl && st.queries.find(x => x.id === qEl.dataset.q);
    if (act === 'load') return fileInput.click();
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
    if (t.dataset.pop) return openPop(t.dataset.pop);
    if (t.dataset.ent) { toggle(ui.ents, t.dataset.ent); renderCards(); return renderDetail(); }
    if (t.dataset.type) { toggle(ui.types, t.dataset.type); renderCards(); return renderDetail(); }
    if (t.dataset.entmode) { ui.entMode = t.dataset.entmode; renderCards(); return renderDetail(); }
    if (act === 'clearents') { ui.ents.clear(); renderCards(); return renderDetail(); }
    if (act === 'cleartypes') { ui.types.clear(); renderCards(); return renderDetail(); }
    if (act === 'clearfilters') {
      ui.ents.clear(); ui.types.clear(); ui.colours.clear(); ui.status = 'all'; ui.q = ''; $('#search').value = '';
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
    if (t.dataset.act === 'note') { fstate(ui.sel).note = t.value; return changed(); }
    if (t.dataset.act === 'qtext') {
      const q = st.queries.find(x => x.id === t.closest('.q').dataset.q);
      q.text = t.innerText.replace(/\s*\n\s*/g, ' ').trim(); changed(); renderHeader(); renderQueries();
    }
  });

  document.addEventListener('toggle', e => { if (e.target.matches('details.claim:not(.checked)')) ui.claimOpen = e.target.open; }, true);

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); return save(e.shiftKey); }
    if (e.target.id === 'shFind' && e.key === 'Enter') { e.preventDefault(); return findInSheet(e.shiftKey); }
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
    else if (k === 'q') document.querySelector(`[data-tab="${ui.tab === 'findings' ? 'queries' : 'findings'}"]`).click();
    else if (k === '/') { e.preventDefault(); $('#search').focus(); }
  });

  let dragDepth = 0;
  window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); loadFiles(e.dataTransfer.files); });
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  render();
})();
