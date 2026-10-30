import { createInflateRaw } from "node:zlib";
import { Readable } from "node:stream";

// XLSX admission budgets, independent of financial/XML interpretation.
export const WORKBOOK_LIMITS = Object.freeze({ compressedBytes: 1024 * 1024, entries: 256,
  directoryBytes: 128 * 1024, entryBytes: 4 * 1024 * 1024, totalBytes: 16 * 1024 * 1024,
  sheets: 32, rows: 10_000, cells: 100_000, sharedStrings: 100_000, materializedCells: 200_000, milliseconds: 5_000 });
export class WorkbookLimitError extends Error {
  constructor() { super("WORKBOOK_INVALID_OR_LIMIT_EXCEEDED"); this.name = "WorkbookLimitError"; }
}
const fail = (): never => { throw new WorkbookLimitError(); };
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crcUpdate(crc: number, bytes: Buffer) {
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc;
}
type Entry = { name: string; start: number; end: number; size: number; crc: number; method: number };
function extraFields(buffer: Buffer, from: number, to: number) {
  while (from < to) {
    if (from + 4 > to) fail();
    const id = buffer.readUInt16LE(from), length = buffer.readUInt16LE(from + 2); from += 4;
    // ZIP64 and filename overrides require a separate bounded implementation.
    if (id === 1 || id === 0x7075 || from + length > to) fail();
    from += length;
  }
}
function directory(buffer: Buffer): Entry[] {
  const max = WORKBOOK_LIMITS;
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > max.compressedBytes) fail();
  let end = -1;
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 65557); at--) {
    if (buffer.readUInt32LE(at) === 0x06054b50 && at + 22 + buffer.readUInt16LE(at + 20) === buffer.length) { end = at; break; }
  }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) fail();
  const count = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16);
  if (count !== buffer.readUInt16LE(end + 8) || count > max.entries || size > max.directoryBytes || start + size !== end) fail();
  const entries: Entry[] = [], names = new Set<string>(), ranges: Array<[number, number]> = [];
  let cursor = start, total = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) fail();
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16), compressed = buffer.readUInt32LE(cursor + 20), expanded = buffer.readUInt32LE(cursor + 24);
    const nameSize = buffer.readUInt16LE(cursor + 28), extraSize = buffer.readUInt16LE(cursor + 30), commentSize = buffer.readUInt16LE(cursor + 32);
    const local = buffer.readUInt32LE(cursor + 42), next = cursor + 46 + nameSize + extraSize + commentSize;
    if (flags & ~0x080e || ![0, 8].includes(method) || buffer.readUInt16LE(cursor + 34) || next > end || !nameSize || nameSize > 512 || expanded > max.entryBytes) fail();
    total += expanded; if (total > max.totalBytes) fail();
    const rawName = buffer.subarray(cursor + 46, cursor + 46 + nameSize);
    let name: string; try { name = new TextDecoder("utf-8", { fatal: true }).decode(rawName); } catch { return fail(); }
    if (/[\\\x00-\x1f\x7f:]/.test(name) || name.startsWith("/") || name.split("/").some((part, i, all) => part === "." || part === ".." || !part && i !== all.length - 1) || names.has(name.toLowerCase())) fail();
    names.add(name.toLowerCase());
    extraFields(buffer, cursor + 46 + nameSize, cursor + 46 + nameSize + extraSize);
    if (local + 30 > start || buffer.readUInt32LE(local) !== 0x04034b50 || buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method) fail();
    const localNameSize = buffer.readUInt16LE(local + 26), localExtraSize = buffer.readUInt16LE(local + 28);
    const dataStart = local + 30 + localNameSize + localExtraSize, dataEnd = dataStart + compressed;
    if (dataEnd > start || localNameSize !== nameSize || !buffer.subarray(local + 30, local + 30 + localNameSize).equals(rawName)) fail();
    extraFields(buffer, local + 30 + localNameSize, dataStart);
    if (!(flags & 8) && (buffer.readUInt32LE(local + 14) !== crc || buffer.readUInt32LE(local + 18) !== compressed || buffer.readUInt32LE(local + 22) !== expanded)) fail();
    if (method === 0 && compressed !== expanded) fail();
    ranges.push([local, dataEnd]); entries.push({ name, start: dataStart, end: dataEnd, size: expanded, crc, method }); cursor = next;
  }
  if (cursor !== end) fail();
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) fail();
  return entries;
}

export function openBoundedWorkbook(buffer: Buffer) {
  const entries = directory(buffer), byName = new Map(entries.map(entry => [entry.name, entry]));
  const sheetNames = entries.map(e => e.name).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (sheetNames.length > WORKBOOK_LIMITS.sheets) fail();
  let total = 0, poisoned = false, busy = false;
  return {
    sheetNames,
    async readText(name: string): Promise<string> {
      if (poisoned || busy) fail();
      const entry = byName.get(name); if (!entry) return "";
      busy = true;
      const source = Readable.from([buffer.subarray(entry.start, entry.end)]);
      const stream = entry.method === 8 ? source.pipe(createInflateRaw({ chunkSize: 16 * 1024 })) : source;
      const timer = setTimeout(() => { poisoned = true; source.destroy(); stream.destroy(new WorkbookLimitError()); }, WORKBOOK_LIMITS.milliseconds);
      const chunks: Buffer[] = []; let bytes = 0, crc = 0xffffffff;
      try {
        for await (const value of stream) {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          bytes += chunk.length; total += chunk.length;
          if (bytes > WORKBOOK_LIMITS.entryBytes || bytes > entry.size || total > WORKBOOK_LIMITS.totalBytes) fail();
          crc = crcUpdate(crc, chunk); chunks.push(chunk);
        }
        if (bytes !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) fail();
        return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes));
      } catch { poisoned = true; throw new WorkbookLimitError(); }
      finally { clearTimeout(timer); source.destroy(); stream.destroy(); busy = false; }
    },
  };
}

export function createWorkbookStructureBudget() {
  let rows = 0, cells = 0, strings = 0, materialized = 0, rowSpan = 0;
  return {
    row() { if (++rows > WORKBOOK_LIMITS.rows) fail(); rowSpan = 0; },
    cell(reference: string, materializeSparseRow = false) {
      if (++cells > WORKBOOK_LIMITS.cells || !/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(reference)) fail();
      const letters = reference.match(/^[A-Z]+/)![0];
      let column = 0; for (const letter of letters) column = column * 26 + letter.charCodeAt(0) - 64;
      if (column > 16384 || Number(reference.slice(letters.length)) > 1048576) fail();
      // OC uses indexed arrays and later map/flat/slice. Count the entire row
      // span before values[column - 1], not merely populated physical cells.
      if (materializeSparseRow && column > rowSpan) {
        const added = column - rowSpan;
        if (materialized + added > WORKBOOK_LIMITS.materializedCells) fail();
        materialized += added; rowSpan = column;
      }
    },
    sharedString() { if (++strings > WORKBOOK_LIMITS.sharedStrings) fail(); },
  };
}
