const MD = (() => {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = esc(s)
      .replace(/&lt;(\/?)(sub|sup|br|i|b|em|strong)\s*\/?&gt;/gi, '<$1$2>')
      .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
  }

  const cells = l => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim());
  const isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const listRe = /^(\s*)([*+-]|\d+[.)])\s+(.*)$/;

  function list(lines, i) {
    const root = { items: [], ordered: /\d/.test(lines[i].match(listRe)[2]) };
    const stack = [{ indent: lines[i].match(listRe)[1].length, node: root }];
    for (; i < lines.length; i++) {
      const l = lines[i];
      const m = l.match(listRe);
      if (m) {
        const ind = m[1].length;
        while (stack.length > 1 && ind < stack[stack.length - 1].indent) stack.pop();
        let top = stack[stack.length - 1];
        if (ind > top.indent) {
          const parent = top.node.items[top.node.items.length - 1];
          if (!parent) break;
          parent.sub = { items: [], ordered: /\d/.test(m[2]) };
          stack.push(top = { indent: ind, node: parent.sub });
        }
        top.node.items.push({ text: m[3] });
      } else if (l.trim() && /^\s+/.test(l) && root.items.length) {
        const top = stack[stack.length - 1].node;
        top.items[top.items.length - 1].text += ' ' + l.trim();
      } else break;
    }
    const out = n => `<${n.ordered ? 'ol' : 'ul'}>${n.items.map(it => `<li>${inline(it.text)}${it.sub ? out(it.sub) : ''}</li>`).join('')}</${n.ordered ? 'ol' : 'ul'}>`;
    return [out(root), i];
  }

  function render(src) {
    const lines = (src || '').split(/\r?\n/);
    let html = '', para = [];
    const flush = () => { if (para.length) html += `<p>${inline(para.join(' '))}</p>`; para = []; };
    for (let i = 0; i < lines.length;) {
      const l = lines[i];
      if (!l.trim()) { flush(); i++; continue; }
      let m;
      if ((m = l.match(/^(#{1,6})\s+(.*)$/))) {
        flush(); const n = Math.min(6, m[1].length + 2);
        html += `<h${n}>${inline(m[2])}</h${n}>`; i++;
      } else if (/^\s*(---+|\*\*\*+)\s*$/.test(l)) {
        flush(); html += '<hr>'; i++;
      } else if (/^\s*>/.test(l)) {
        flush(); const q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
        html += `<blockquote>${render(q.join('\n'))}</blockquote>`;
      } else if (/^\s*\|/.test(l) && i + 1 < lines.length && isSep(lines[i + 1])) {
        flush(); const head = cells(l); i += 2; const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
        html += `<div class="tbl"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      } else if (listRe.test(l)) {
        flush(); const [h, j] = list(lines, i); html += h; i = j;
      } else { para.push(l.trim()); i++; }
    }
    flush();
    return html;
  }

  return { render, inline, esc };
})();
