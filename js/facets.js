const Facets = (() => {
  // ---------- entities: figures, tables, notes, source data, text sections ----------
  const REF = /\b(?:(Supplementary(?:\s+Information)?|Suppl?\.|SI|Extended\s+Data|ED)\s+)?(Fig(?:ure)?s?\.?|Tables?|Notes?|Data)\s*(S?\d{1,3}[A-Za-z]{0,2}(?:\s*(?:,|and|&|–|-|to)\s*(?:S?\d{1,3}[A-Za-z]{0,2}|[A-Za-z]{1,2}(?!\w)))*)/g;
  const NOUN = { f: 'Fig.', t: 'Table', n: 'Note', d: 'Data' };
  const SCOPE = { '': '', ed: 'ED ', s: 'Supp. ' };
  // group id, label, order; source data sits with the object it belongs to
  const GROUPS = [
    ['f', 'Figures'], ['t', 'Tables'], ['edf', 'ED figures'], ['edt', 'ED tables'],
    ['sf', 'Supp. figures'], ['st', 'Supp. tables'], ['sn', 'Supp. notes'], ['sd', 'Supp. data'],
    ['src', 'Source data'], ['x', 'Text']
  ];
  const SECTIONS = [
    ['Abstract', /\bAbstract\b/], ['Introduction', /\bIntroduction\b/], ['Results', /\bResults\b/],
    ['Discussion', /\bDiscussion\b/], ['Methods', /\bMethods\b/], ['Legends', /\blegends?\b/i],
    ['Reporting Summary', /\bReporting Summary\b/i], ['Data availability', /\bData availability\b/i],
    ['Protocol', /\bprotocol\b/i], ['Rebuttal', /\b(?:rebuttal|response to (?:the )?reviewers?|point-by-point)\b/i]
  ];
  const SRC_BEFORE = /(?:source[\s_-]*data|\bsheets?\b|\bworksheets?\b)(?:(?!\.\s)[^;\n]){0,40}$/i;
  const SRC_AFTER = /^(?:(?!\.\s)[^;\n]){0,18}?\bsource[\s-]*data\b/i;
  const unabbrev = s => s.replace(/\b(Figs?|Suppl?|Ext|No|pp?|vs|al|approx)\.\s/gi, '$1 ');

  function refs(text) {
    const out = [];
    for (const m of text.matchAll(REF)) {
      const [all, pre = '', noun, list] = m;
      const n = noun[0].toLowerCase();
      let scope = /^(Extended|ED)/.test(pre) ? 'ed' : pre ? 's' : '';
      if ((n === 'n' || n === 'd') && scope !== 's' && !/^S\d/.test(list)) continue;
      const before = unabbrev(text.slice(Math.max(0, m.index - 60), m.index));
      const after = unabbrev(text.slice(m.index + all.length, m.index + all.length + 40));
      const src = n !== 'd' && n !== 'n' && (SRC_BEFORE.test(before) || SRC_AFTER.test(after));
      const nums = [];
      let prev = null;
      for (const t of list.matchAll(/(–|-|to)?\s*(S?)(\d{1,3})/g)) {
        const v = +t[3];
        if (prev !== null && (v > 25 || v === 0)) break;
        if (t[1] && prev !== null && v > prev && v - prev <= 12) for (let k = prev + 1; k < v; k++) nums.push([t[2], k]);
        nums.push([t[2], v]); prev = v;
      }
      nums.forEach(([s, v]) => {
        const sc = scope || (s ? 's' : '');
        if (!v) return;
        out.push({ key: `${sc}${n}${v}`, src });
      });
    }
    return out;
  }

  function label(key) {
    if (key.startsWith('x:')) return key.slice(2);
    const m = key.match(/^(src:)?(ed|s)?([ftnd])(\d+)$/);
    if (!m) return key;
    return `${SCOPE[m[2] || '']}${NOUN[m[3]]} ${m[4]}`;
  }

  function group(key) {
    if (key.startsWith('src:')) return 'src';
    if (key.startsWith('x:')) return 'x';
    const m = key.match(/^(ed|s)?([ftnd])/);
    return (m[1] || '') + m[2];
  }

  function sortKey(key) {
    const g = GROUPS.findIndex(x => x[0] === group(key));
    if (key.startsWith('x:')) return g * 1e4 + SECTIONS.findIndex(s => s[0] === key.slice(2));
    const m = key.match(/^(?:src:)?(ed|s)?([ftnd])(\d+)$/);
    const sub = key.startsWith('src:') ? ['', 'ed', 's'].indexOf(m[1] || '') * 1e3 + 'ftnd'.indexOf(m[2]) * 100 : 0;
    return g * 1e4 + sub + +m[3];
  }

  function entities(text) {
    const keys = new Set();
    refs(text).forEach(r => { keys.add(r.key); if (r.src) keys.add('src:' + r.key); });
    SECTIONS.forEach(([name, re]) => { if (re.test(text)) keys.add('x:' + name); });
    return [...keys].sort((a, b) => sortKey(a) - sortKey(b));
  }

  // ---------- issue types ----------
  const TYPES = [
    ['anom', 'Data anomalies', /duplicat|identical|repeat(?:ed|s)?\b|re-?used|copied|same (?:values?|numbers?|rows?|measurements?)\b|recur|twice|exactly (?:zero|equal)|placeholder|text strings?|precision|out of scale|substitut|every (?:triplicate|replicate)|carry one|pasted|stored as|coerced|corrupt|text-formatted|recorded as|whole numbers|featureless|non-zero|breaking it/gi],
    ['repro', 'Does not reproduce', /reproduc|recomput|recalculat|cannot (?:all )?(?:be )?(?:computed|derived|obtained|come from|give)|arithmetic|do(?:es)? not (?:add|sum|follow)|mean\b|s\.d\.|standard deviation|\bP ?values?\b|statistic|fold|round(?:ing|ed)|truncated|calculat|sum of|formula|imply|implies/gi],
    ['conflict', 'Values disagree', /differ|disagree|conflict|contradict|inconsisten|(?:two|three|four|several) (?:different )?(?:values|ways)|more than one value|do(?:es)? not match|matches neither|mismatch|\bvs\.?\b|versus|against|given as|stated as|transposed|opposite|not (?:in|shown in) the/gi],
    ['claim', 'Claim vs data', /claims?\b|not (?:met|present|shown?|supported|demonstrat)|do(?:es)? not (?:show|support|demonstrate|hold|accommodate)|reverse|said to|described as|overstat|holds? under|only (?:for|in)|not the (?:data|nine|same)|monotonic/gi],
    ['n', 'Replicates & n', /replicat|\bn ?=|\*n\*|sample sizes?|group sizes?|number of (?:mice|animals|patients|samples|cells|donors)|biologically independent|dropout|per (?:group|mouse|animal)|units? of replication/gi],
    ['missing', 'Missing data', /no source[- ]data|no (?:corresponding )?sheet|not in the (?:source data|workbook)|missing|absent|not (?:supplied|provided|deposited|included)|do(?:es)? not cover|covers? \d+ of|without (?:source )?data|no data/gi],
    ['methods', 'Methods & protocol', /\bmethods?\b|protocol|pre-?registr|reporting summary|endpoints?|reagent|instrument|antibod|cell lines?|software|threshold|criteri|definition|defined|detection limit|equation|simulation|parameter|dose|route|schedule|interval|not stated|unstated|timeline/gi],
    ['label', 'Labels & references', /label|header|misrefer|cross-ref|refers? to|cites?\b|cited|citation|points? to|wrong (?:figure|panel|table|note)|panel (?:letter|name)|named|names? |terminolog|\bunits?\b|caption|numbered|numbers? in the|sheet (?:names?|titles?)|lettering|swapped|attribut|assign|axis|identifiers?|interchanged|exchanged|PMIDs?/gi],
    ['typo', 'Typos', /typograph|spelling|misspel|typo\b|grammat/gi]
  ];
  const TYPE_LABEL = Object.fromEntries(TYPES.map(t => [t[0], t[1]]));
  TYPE_LABEL.other = 'Other';

  function score(text, w, into) {
    TYPES.forEach(([id, , re]) => {
      const hits = new Set((text.match(re) || []).map(s => s.toLowerCase()));
      if (hits.size) into[id] = (into[id] || 0) + w * Math.min(3, hits.size);
    });
  }

  function type(f) {
    if (f.pseudo || /typograph|typo\b/i.test(f.title)) return 'typo';
    const s = {};
    score(`${f.title} ${f.head || ''}`, 4, s);
    if (!/conditional|^[a-z]$/i.test(f.section || '')) score(f.section || '', 3, s);
    score(f.brief || '', 1.5, s);
    score((f.body || '').slice(0, 900), 0.5, s);
    let best = 'other', bv = 1.5;
    TYPES.forEach(([id]) => { if ((s[id] || 0) > bv) { bv = s[id]; best = id; } });
    return best;
  }

  return { entities, type, label, group, sortKey, GROUPS, TYPES: TYPES.map(t => t[0]).concat('other'), TYPE_LABEL };
})();

if (typeof module !== 'undefined') module.exports = Facets;
