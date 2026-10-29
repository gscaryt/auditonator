// Word reader: .docx to HTML for the viewer pane. No dependencies; uses the zip reader in sheet.js.
// Keeps text, headings, bold/italic/sub/superscript, tables, embedded images, footnotes and the page
// breaks Word saved at its last layout (so "p. 6" links can scroll there). Deleted tracked text is
// left out. Equations are shown as their text only; line numbers are not reproduced.
const Docx = (() => {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' };
  const kids = n => [...n.childNodes].filter(c => c.nodeType === 1);
  const child = (n, name) => kids(n).find(c => c.nodeName === name);
  const wval = n => n && n.getAttribute('w:val');
  const resolve = t => t.startsWith('/') ? t.slice(1) : `word/${t}`.replace(/[^/]+\/\.\.\//g, '');

  async function open(file) {
    const z = await Sheet.unzip(file);
    const xml = async name => { const e = z.get(name); return e ? new DOMParser().parseFromString(await Sheet.entryText(file, e), 'application/xml') : null; };
    const doc = await xml('word/document.xml');
    const body = doc && doc.getElementsByTagName('w:body')[0];
    if (!body) throw new Error('not a Word document');

    // style id -> heading level
    const levels = new Map(), sx = await xml('word/styles.xml');
    if (sx) for (const s of sx.getElementsByTagName('w:style')) {
      const m = (wval(child(s, 'w:name')) || '').match(/^(?:heading (\d)|(title))$/i);
      if (m) levels.set(s.getAttribute('w:styleId'), m[2] ? 1 : Math.min(6, +m[1] + 1));
    }

    // embedded images -> object URLs
    const urls = [], images = new Map(), rx = await xml('word/_rels/document.xml.rels');
    if (rx) for (const r of rx.getElementsByTagName('Relationship')) {
      if (!/\/image$/.test(r.getAttribute('Type')) || r.getAttribute('TargetMode') === 'External') continue;
      const target = resolve(r.getAttribute('Target')), ext = target.split('.').pop().toLowerCase(), e = z.get(target.toLowerCase());
      if (!e || !MIME[ext]) { images.set(r.getAttribute('Id'), { ext }); continue; }
      const url = URL.createObjectURL(new Blob([await new Response(await Sheet.entryBytes(file, e)).arrayBuffer()], { type: MIME[ext] }));
      urls.push(url); images.set(r.getAttribute('Id'), { url });
    }

    let page = 1;
    const pageMark = () => `<span class="dx-pg" data-page="${++page}">page ${page}</span>`;
    const image = n => [...n.getElementsByTagName('a:blip'), ...n.getElementsByTagName('v:imagedata')].map(b => {
      const im = images.get(b.getAttribute('r:embed') || b.getAttribute('r:id'));
      return !im ? '' : im.url ? `<img src="${im.url}" alt="">` : `<span class="dx-na">[image in .${esc(im.ext)} format, not shown]</span>`;
    }).join('');

    function run(r) {
      const pr = child(r, 'w:rPr');
      const on = name => { const c = pr && child(pr, name); return !!c && !/^(0|false|none)$/.test(wval(c) || ''); };
      let out = '';
      for (const c of kids(r)) {
        const k = c.nodeName;
        if (k === 'w:t') out += esc(c.textContent);
        else if (k === 'w:tab') out += '\t';
        else if (k === 'w:br' || k === 'w:cr') out += c.getAttribute('w:type') === 'page' ? pageMark() : '<br>';
        else if (k === 'w:lastRenderedPageBreak') out += pageMark();
        else if (k === 'w:noBreakHyphen') out += '‑';
        else if (k === 'w:sym') out += '<span class="dx-na" title="Symbol-font character, not shown">▯</span>';
        else if (k === 'w:drawing' || k === 'w:pict' || k === 'w:object') out += image(c);
        else if (k === 'w:footnoteReference') out += `<sup class="dx-fn">[${esc(c.getAttribute('w:id') || '')}]</sup>`;
        else if (k === 'mc:AlternateContent') out += image(child(c, 'mc:Fallback') || c);
      }
      if (!out) return '';
      const va = pr && wval(child(pr, 'w:vertAlign'));
      const tags = [on('w:b') && 'b', on('w:i') && 'i', on('w:u') && 'u', on('w:strike') && 's', va === 'superscript' && 'sup', va === 'subscript' && 'sub'].filter(Boolean);
      return tags.map(t => `<${t}>`).join('') + out + tags.reverse().map(t => `</${t}>`).join('');
    }

    function inline(n) {
      let out = '';
      for (const c of kids(n)) {
        const k = c.nodeName;
        if (k === 'w:r') out += run(c);
        else if (k === 'w:del' || k === 'w:moveFrom' || k === 'w:pPr') continue;
        else if (k === 'm:oMath' || k === 'm:oMathPara') out += `<span class="dx-math" title="Equation, shown as text only">${esc([...c.getElementsByTagName('m:t')].map(t => t.textContent).join(''))}</span>`;
        else out += inline(c);   // hyperlinks, insertions, fields, content controls
      }
      return out;
    }

    function para(p) {
      const pr = child(p, 'w:pPr'), html = inline(p);
      if (!html.trim()) return '';
      const lvl = pr && levels.get(wval(child(pr, 'w:pStyle')));
      if (lvl) return `<h${lvl}>${html}</h${lvl}>`;
      const cls = [pr && child(pr, 'w:numPr') && 'dx-li', pr && /^center$/.test(wval(child(pr, 'w:jc')) || '') && 'dx-c'].filter(Boolean).join(' ');
      return `<p${cls ? ` class="${cls}"` : ''}>${html}</p>`;
    }

    function table(t) {
      return `<div class="dx-tw"><table>${kids(t).filter(r => r.nodeName === 'w:tr').map(r => `<tr>${kids(r).filter(c => c.nodeName === 'w:tc').map(c => {
        const pr = child(c, 'w:tcPr'), span = +(wval(pr && child(pr, 'w:gridSpan')) || 1);
        return `<td${span > 1 ? ` colspan="${span}"` : ''}>${blocks(c)}</td>`;
      }).join('')}</tr>`).join('')}</table></div>`;
    }

    function blocks(n) {
      let out = '';
      for (const c of kids(n)) {
        const k = c.nodeName;
        if (k === 'w:p') out += para(c);
        else if (k === 'w:tbl') out += table(c);
        else if (k === 'w:sdt' || k === 'w:sdtContent' || k === 'w:ins' || k === 'w:customXml') out += blocks(c);
      }
      return out;
    }

    let html = blocks(body);
    const pages = page, fx = await xml('word/footnotes.xml');
    const notes = fx ? [...fx.getElementsByTagName('w:footnote')].filter(f => !f.getAttribute('w:type')) : [];
    if (notes.length) html += `<h2>Footnotes</h2>${notes.map(f => `<div class="dx-note"><sup class="dx-fn">[${esc(f.getAttribute('w:id') || '')}]</sup>${blocks(f)}</div>`).join('')}`;
    return { html, pages, urls };
  }

  // every match of q in root, as Ranges; a match may span the runs of one paragraph
  function find(root, q) {
    const out = [];
    q = q.trim().toLowerCase();
    if (!q) return out;
    for (const el of root.querySelectorAll('p, h1, h2, h3, h4, h5, h6')) {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [];
      let text = '';
      while (w.nextNode()) { nodes.push([w.currentNode, text.length]); text += w.currentNode.nodeValue; }
      const at = i => { let k = nodes.length - 1; while (k > 0 && nodes[k][1] > i) k--; return [nodes[k][0], i - nodes[k][1]]; };
      const low = text.toLowerCase();
      for (let i = low.indexOf(q); i >= 0; i = low.indexOf(q, i + q.length)) {
        const r = document.createRange();
        r.setStart(...at(i));
        const [n, o] = at(i + q.length - 1);
        r.setEnd(n, o + 1);
        out.push(r);
      }
    }
    return out;
  }

  return { open, find };
})();
