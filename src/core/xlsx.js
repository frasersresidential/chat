/**
 * Tiny dependency-free reader for the two import formats sales teams actually
 * export: .xlsx (Excel/Salesforce reports) and .csv. Just enough of the OOXML
 * spreadsheet format to pull a grid of strings out of the first worksheet —
 * inline strings, shared strings and numbers/booleans. No styling, no formulas.
 *
 *   parseSheet(buffer, name) → { headers:[...], rows:[{header: value}, ...] }
 *
 * Keeping this in-repo avoids adding a binary xlsx dependency to an otherwise
 * zero-dependency core, and matches the project's "no build step" philosophy.
 */
import zlib from 'node:zlib';

const xmlDecode = (s) => String(s)
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const colToIndex = (col) => {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
const isXlsx = (buf) => buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b; // 'PK' zip magic

// ── Minimal ZIP reader (stored + deflate) via the central directory ─────────────
function readZipEntries(buf) {
  const entries = {};
  // End of Central Directory record: signature 0x06054b50.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('invalid xlsx (no EOCD)');
  let off = buf.readUInt32LE(eocd + 16); // start of central directory
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    // Jump to the local file header to find where the data actually starts.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    entries[name] = () => (method === 0 ? raw : zlib.inflateRawSync(raw));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Parse an .xlsx buffer into a dense 2-D array of cell strings. */
function xlsxGrid(buf) {
  const entries = readZipEntries(buf);
  // Shared strings (optional).
  const shared = [];
  if (entries['xl/sharedStrings.xml']) {
    const xml = entries['xl/sharedStrings.xml']().toString('utf8');
    for (const si of xml.match(/<si[\s>][\s\S]*?<\/si>/g) || xml.match(/<si\/>/g) || []) {
      let txt = '';
      for (const t of si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) txt += t[1];
      shared.push(xmlDecode(txt));
    }
  }
  // First worksheet.
  const sheetName = Object.keys(entries).find((n) => /^xl\/worksheets\/sheet1\.xml$/.test(n))
    || Object.keys(entries).find((n) => /^xl\/worksheets\/.*\.xml$/.test(n));
  if (!sheetName) throw new Error('xlsx has no worksheet');
  const sheet = entries[sheetName]().toString('utf8');

  const grid = [];
  for (const r of sheet.matchAll(/<row[^>]*?(?:r="(\d+)")?[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const c of r[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = c[1]; const body = c[2];
      const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1];
      const type = (attrs.match(/t="([^"]+)"/) || [])[1];
      let val = '';
      if (type === 'inlineStr') {
        let txt = '';
        for (const t of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) txt += t[1];
        val = xmlDecode(txt);
      } else {
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (v != null) val = type === 's' ? (shared[Number(v)] ?? '') : xmlDecode(v);
      }
      const idx = ref ? colToIndex(ref) : cells.length;
      cells[idx] = val;
    }
    grid.push(cells);
  }
  return grid;
}

/** Parse a CSV string into a dense 2-D array (handles quotes + embedded newlines). */
function csvGrid(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r') { /* skip */ }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * Read a buffer (xlsx or csv) into header + row objects.
 *
 * Report exports often have title/filter banner rows above the table, so we
 * pick the header row as the first row with the most non-empty cells (>=3).
 */
export function parseSheet(input, filename = '') {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const useXlsx = isXlsx(buf) || /\.xlsx$/i.test(filename);
  const grid = useXlsx ? xlsxGrid(buf) : csvGrid(buf.toString('utf8'));

  const filled = (r) => (r || []).filter((v) => String(v ?? '').trim() !== '').length;
  let headerIdx = 0; let best = 0;
  for (let i = 0; i < grid.length; i++) {
    const f = filled(grid[i]);
    if (f > best) { best = f; headerIdx = i; }
    if (f >= 3 && filled(grid[i + 1]) >= 3) { headerIdx = i; break; } // header followed by data
  }
  const headers = (grid[headerIdx] || []).map((h) => String(h ?? '').trim());
  const rows = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i];
    if (!r || !filled(r)) continue;
    const obj = {};
    headers.forEach((h, idx) => { if (h) obj[h] = r[idx] != null ? String(r[idx]) : ''; });
    rows.push(obj);
  }
  return { headers: headers.filter(Boolean), rows };
}
