const Parse = (() => {
  const LIGHT = { '⬛': 'black', '🟥': 'red', '🟨': 'yellow', '🟩': 'green' };
  const HEAD_RE = /^(?:\*\*|#{2,5}\s+)\s*(⬛|🟥|🟨|🟩)?\s*(C?\d+)\.\s+(.+?)\s*(?:\*\*)?\s*$/u;
  const heading = l => { const m = l.match(/^(#{1,6})\s+(.*)$/); return m && { level: m[1].length, text: m[2].trim() }; };
  const CONDITIONAL = /\s*(?:—\s*)?\*Conditional\*\s*(?:—\s*)?/;

  function splitTitle(raw) {
    let conditional = false;
    let s = raw.replace(/\*\*$/, '').trim();
    if (CONDITIONAL.test(s)) { conditional = true; s = s.replace(CONDITIONAL, ' — ').replace(/^\s*—\s*/, '').replace(/\s*—\s*—\s*/g, ' — ').trim(); }
    const k = s.lastIndexOf(' — ');
    return k > 0 ? { title: s.slice(0, k).trim(), location: s.slice(k + 3).trim(), conditional } : { title: s, location: '', conditional };
  }

  function section(lines, start) {
    const h = heading(lines[start]);
    let end = start + 1;
    while (end < lines.length) { const g = heading(lines[end]); if (g && g.level <= h.level) break; end++; }
    return lines.slice(start + 1, end);
  }

  function parseQueries(lines) {
    const tops = [];
    let last = null;
    for (const l of lines) {
      let m;
      if ((m = l.match(/^([*+-]|\d+[.)])\s+(.*)$/))) { tops.push(last = { text: m[2].trim(), subs: [] }); }
      else if ((m = l.match(/^\s+([*+-]|\d+[.)])\s+(.*)$/)) && tops.length) { tops[tops.length - 1].subs.push(last = { text: m[2].trim() }); }
      else if (l.trim() && last && !heading(l) && !/^\s*---/.test(l)) last.text += ' ' + l.trim();
    }
    const queries = [], groups = {};
    tops.forEach((t, i) => {
      if (!t.subs.length) return queries.push({ id: `q${queries.length + 1}`, text: t.text, orig: t.text });
      const gid = `g${i + 1}`;
      groups[gid] = { header: t.text, kind: /typo|grammat/i.test(t.text) ? 'typo' : /misreferenc|cross-referenc/i.test(t.text) ? 'misref' : 'list' };
      t.subs.forEach(s => queries.push({ id: `q${queries.length + 1}`, text: s.text, orig: s.text, group: gid }));
    });
    return { queries, groups };
  }

  function parseAudit(text) {
    const lines = text.split(/\r?\n/);
    const titleLine = lines.find(l => /^#\s/.test(l)) || '';
    const out = {
      msid: (titleLine.match(/—\s*(\S+)/) || [])[1] || '',
      manuscript: (lines.find(l => /^\*\*Manuscript:?\*\*/.test(l)) || '').replace(/^\*\*Manuscript:?\*\*:?\s*/, ''),
      findings: [], checked: '', queries: [], groups: {}
    };
    const qIdx = lines.findIndex(l => { const h = heading(l); return h && /author quer/i.test(h.text); });
    const cIdx = lines.findIndex(l => { const h = heading(l); return h && /checked but not raised/i.test(h.text); });
    const stop = Math.min(...[qIdx, cIdx, lines.length].filter(i => i >= 0));
    const lit = lines.slice(0, stop).some(l => { const m = l.match(HEAD_RE); return m && m[1]; });
    let sec = '', cur = null;
    const close = () => { if (cur) { cur.body = cur.body.join('\n').trim(); out.findings.push(cur); cur = null; } };
    for (let i = 0; i < stop; i++) {
      const l = lines[i];
      const m = l.match(HEAD_RE);
      if (m && (m[1] || !lit)) {
        close();
        const t = splitTitle(m[3]);
        cur = { id: m[2], colour: LIGHT[m[1]] || null, section: sec, ...t, body: [] };
        continue;
      }
      const h = heading(l);
      if (h) { close(); if (!/part\s*\d|findings report|^findings$/i.test(h.text)) sec = h.text.replace(/^(?:[A-Z]|\d+)\.\s+/, ''); continue; }
      if (/^\s*---+\s*$/.test(l)) { close(); continue; }
      if (cur) cur.body.push(l);
    }
    close();
    if (cIdx >= 0) out.checked = section(lines, cIdx).join('\n').trim();
    if (qIdx >= 0) Object.assign(out, parseQueries(section(lines, qIdx)));
    return out;
  }

  function parseCritical(text) {
    const lines = text.split(/\r?\n/);
    const out = {
      msid: ((lines.find(l => /^#\s/.test(l)) || '').match(/—\s*(\S+)/) || [])[1] || '',
      title: (lines.find(l => /^\*[^*].*\*\s*$/.test(l)) || '').replace(/^\*|\*\s*$/g, ''),
      claim: '', pattern: '', entries: [], typo: null
    };
    let colour = null, block = null, inSummary = false, pending = [], para = false;
    const pattern = [];
    for (const l of lines) {
      const h = heading(l);
      if (h && h.level <= 2) {
        const m = h.text.match(/^(⬛|🟥|🟨|🟩)/u);
        colour = m ? LIGHT[m[1]] : null;
        block = /^central claim/i.test(h.text) ? 'claim' : null;
        inSummary = /^summary/i.test(h.text);
        pending = []; para = false;
        continue;
      }
      if (block === 'claim') { out.claim += l + '\n'; continue; }
      if (inSummary) { if (!/^\s*\|/.test(l)) pattern.push(l); continue; }
      if (!colour) continue;
      if (!l.trim()) { if (para) { pending = []; para = false; } continue; }
      const bullet = /^\s*[-*]\s+(?!\*\*\*)/.test(l) && !/^\*\*/.test(l);
      const s = bullet ? l.replace(/^\s*[-*]\s+/, '') : l.trim();
      const bm = s.match(/^\*\*(Findings?\s+.+?\*?)\*\*(?!\*)\s*(.*)$/);
      if (bm) {
        if (para) { pending = []; para = false; }
        const inner = bm[1];
        const k = inner.indexOf(' — ');
        let head = k > 0 ? inner.slice(k + 3) : '';
        let brief = bm[2].replace(/^—\s*/, '');
        const conditional = CONDITIONAL.test(head) || CONDITIONAL.test(brief);
        head = head.replace(CONDITIONAL, ' ').replace(/^\s*—\s*/, '').trim();
        brief = brief.replace(CONDITIONAL, ' ').replace(/^\s*—\s*/, '').trim();
        const e = { colour, ids: (k > 0 ? inner.slice(0, k) : inner).replace(/^Findings?\s+/, '').match(/C?\d+/g) || [], head, brief, conditional };
        out.entries.push(e);
        if (!brief) pending.push(e);
        continue;
      }
      if (bullet && /typograph/i.test(s)) { out.typo = { colour, text: s.replace(/\*\*/g, '').trim() }; continue; }
      if (bullet || /^\s*\|/.test(l)) continue;
      pending.forEach(e => e.brief += (e.brief ? ' ' : '') + l.trim());
      para = true;
    }
    out.claim = out.claim.trim();
    out.pattern = pattern.join('\n').trim();
    return out;
  }

  const STOP = new Set(('the and for with from that this are was were not but its their which have has been than then into also each other these those there where when what does please check verify confirm double appear appears appear seem consistent agree given stated state reported against between both same can you whether used shown data given value values one two all any per only such under over more most less including particular attention respective corresponding').split(' '));

  function norm(s) {
    return s.toLowerCase()
      .replace(/<[^>]+>/g, ' ')
      .replace(/supplementary\s+(?:information\s+)?fig(?:ure)?s?\.?/g, ' sfig ')
      .replace(/extended\s+data\s+fig(?:ure)?s?\.?|\bed\s+fig(?:ure)?s?\.?/g, ' edfig ')
      .replace(/\bfig(?:ure)?s?\.?/g, ' fig ')
      .replace(/supplementary\s+tables?/g, ' stable ')
      .replace(/supplementary\s+data/g, ' sdata ')
      .replace(/supplementary\s+notes?/g, ' snote ');
  }

  function tokens(s, mult = 1, into = new Map()) {
    const t = norm(s);
    const add = (k, w) => into.set(k, Math.max(into.get(k) || 0, w * mult));
    for (const m of t.matchAll(/\b(sfig|edfig|fig|stable|table|sdata|snote)\s*(s?\d+)([a-z])?(?![a-z0-9])/g)) {
      add(m[1] + m[2], 3);
      if (m[3]) add(m[1] + m[2] + m[3], 3);
    }
    for (const w of t.match(/\d+(?:\.\d+)?|[\p{L}\p{N}]{3,}/gu) || []) {
      if (/^\d/.test(w)) { if (w.includes('.') || w.length >= 3) add(w, 2); }
      else if (!STOP.has(w)) add(w, 1);
    }
    return into;
  }

  function match(findings, queries, groups) {
    if (!findings.length) return;
    const docs = findings.map(f => tokens(f.body, 1, tokens(f.title + ' ' + f.location, 2)));
    const df = new Map();
    docs.forEach(d => d.forEach((_, k) => df.set(k, (df.get(k) || 0) + 1)));
    const N = docs.length;
    const idf = k => Math.log((N + 1) / ((df.get(k) || 0) + 0.5));
    const score = q => {
      const qt = tokens(q.text);
      let tot = 0; qt.forEach((w, k) => tot += w * idf(k));
      return docs.map(d => { let s = 0; qt.forEach((w, k) => { if (d.has(k)) s += w * idf(k) * Math.min(1, d.get(k) / 2); }); return tot ? s / tot : 0; });
    };
    const main = queries.filter(q => !q.group);
    const LAMBDA = 0.12;
    if (main.length) {
      const S = main.map(score), n = N;
      const best = S.map(() => new Array(n).fill(-Infinity)), from = S.map(() => new Array(n).fill(-1));
      for (let j = 0; j < n; j++) best[0][j] = S[0][j] - LAMBDA * j;
      for (let i = 1; i < main.length; i++)
        for (let j = 0; j < n; j++)
          for (let k = 0; k <= j; k++) {
            const v = best[i - 1][k] - LAMBDA * Math.max(0, j - k - 1) + S[i][j];
            if (v > best[i][j]) { best[i][j] = v; from[i][j] = k; }
          }
      let j = 0, bv = -Infinity;
      for (let k = 0; k < n; k++) { const v = best[main.length - 1][k] - LAMBDA * (n - 1 - k); if (v > bv) { bv = v; j = k; } }
      for (let i = main.length - 1; i >= 0; i--) { main[i].finding = findings[j].id; j = from[i][j]; }
    }
    const typoF = findings.find(f => /typo|grammat/i.test(f.title));
    Object.entries(groups).forEach(([gid, g]) => {
      const items = queries.filter(q => q.group === gid);
      if (g.kind === 'typo') return items.forEach(q => q.finding = typoF ? typoF.id : 'T');
      const S = items.map(score), sum = new Array(N).fill(0);
      S.forEach(r => r.forEach((v, j) => sum[j] += v));
      const G = sum.indexOf(Math.max(...sum));
      items.forEach((q, i) => {
        const b = S[i].indexOf(Math.max(...S[i]));
        q.finding = findings[S[i][b] > S[i][G] + 0.15 ? b : G].id;
      });
    });
  }

  return { parseAudit, parseCritical, match };
})();

if (typeof module !== 'undefined') module.exports = Parse;
