const XLSX = (() => {
  const enc = new TextEncoder();
  const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = b => { let c = 0xFFFFFFFF; for (const x of b) c = CRC[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

  function zip(files) {
    const parts = [], central = [];
    let off = 0;
    for (const [name, text] of files) {
      const n = enc.encode(name), d = enc.encode(text), crc = crc32(d);
      const h = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x800, 2], [12, 0x21, 2], [14, crc, 4], [18, d.length, 4], [22, d.length, 4], [26, n.length, 2]]
        .forEach(([o, v, s]) => s === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true));
      const c = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x800, 2], [14, 0x21, 2], [16, crc, 4], [20, d.length, 4], [24, d.length, 4], [28, n.length, 2], [42, off, 4]]
        .forEach(([o, v, s]) => s === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true));
      parts.push(h.buffer, n, d);
      central.push(c.buffer, n);
      off += 30 + n.length + d.length;
    }
    const size = central.reduce((a, b) => a + b.byteLength, 0);
    const e = new DataView(new ArrayBuffer(22));
    [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, off, 4]]
      .forEach(([o, v, s]) => s === 4 ? e.setUint32(o, v, true) : e.setUint16(o, v, true));
    return new Blob([...parts, ...central, e.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  const x = s => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const ns = 'http://schemas.openxmlformats.org';
  const col = i => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + (i % 26));

  // sheets: [{ name, header, rows, widths }]; a cell may be { v, hl: true } to shade it
  function build(sheets) {
    const cell = (v, ri, ci) => {
      const hl = v && typeof v === 'object', val = hl ? v.v : v;
      const ref = `${col(ci)}${ri + 1}`, s = ri ? hl && v.hl ? 3 : 1 : 2;
      return typeof val === 'number'
        ? `<c r="${ref}" s="${s}"><v>${val}</v></c>`
        : `<c r="${ref}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${x(val)}</t></is></c>`;
    };
    const sheetXml = sh => {
      const sheetData = [sh.header, ...sh.rows].map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, ri, ci)).join('')}</row>`).join('');
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${sh === sheets[0] ? ' tabSelected="1"' : ''}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${sheetData}</sheetData></worksheet>`;
    };
    const n = sheets.length, idx = sheets.map((_, i) => i + 1);
    return zip([
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${idx.map(i => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
      ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets>${sheets.map((sh, i) => `<sheet name="${x(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}/package/2006/relationships">${idx.map(i => `<Relationship Id="rId${i}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${ns}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EAF0"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFDF0C4"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
      ...sheets.map((sh, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sh)])
    ]);
  }

  return { build };
})();
