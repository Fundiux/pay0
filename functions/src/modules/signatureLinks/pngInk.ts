import { inflateSync } from "zlib";

// Pixel-level check that a signature PNG actually contains a drawing. The size
// and pdf-lib checks only prove the file is a PNG; a blank white canvas also
// passes them. Canvas exports are 8-bit, non-interlaced RGBA; other 8-bit colour
// types are accepted as well so a legitimate PNG is never rejected for layout.

export const MIN_SIGNATURE_INK_PIXELS = 50;
export const MIN_SIGNATURE_INK_SPAN_PX = 6;

export type PngInkMeasure = {
  width: number;
  height: number;
  inkPixels: number;
  spanX: number;
  spanY: number;
};

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
const SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function readChunks(buffer: Buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("PNG_SIGNATURE");
  let offset = 8;
  let header: Buffer | null = null;
  const data: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const start = offset + 8, end = start + length;
    if (length > buffer.length || end > buffer.length) throw new Error("PNG_CHUNK");
    if (type === "IHDR") header = buffer.subarray(start, end);
    else if (type === "IDAT") data.push(buffer.subarray(start, end));
    else if (type === "IEND") break;
    offset = end + 4;
  }
  if (!header || header.length !== 13 || data.length === 0) throw new Error("PNG_STRUCTURE");
  return { header, data: Buffer.concat(data) };
}

/** Decodes the PNG and measures how many dark, opaque pixels it contains. */
export function measurePngInk(buffer: Buffer): PngInkMeasure {
  const { header, data } = readChunks(buffer);
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4);
  const bitDepth = header[8], colorType = header[9], interlace = header[12];
  const channels = CHANNELS[colorType];
  if (!channels || bitDepth !== 8 || interlace !== 0) throw new Error("PNG_UNSUPPORTED");
  if (width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error("PNG_DIMENSIONS");

  const stride = width * channels;
  const expected = (stride + 1) * height;
  const raw = inflateSync(data, { maxOutputLength: expected });
  if (raw.length !== expected) throw new Error("PNG_DATA");

  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  let inkPixels = 0, minX = width, maxX = -1, minY = height, maxY = -1;

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? current[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) value += paeth(a, b, c);
      else if (filter !== 0) throw new Error("PNG_FILTER");
      current[i] = value & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const base = x * channels;
      const alpha = colorType === 4 || colorType === 6 ? current[base + channels - 1] : 255;
      if (alpha < 128) continue;
      const darkest = channels >= 3
        ? Math.min(current[base], current[base + 1], current[base + 2])
        : current[base];
      if (darkest >= 160) continue;
      inkPixels++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    previous.set(current);
  }

  return {
    width,
    height,
    inkPixels,
    spanX: inkPixels ? maxX - minX + 1 : 0,
    spanY: inkPixels ? maxY - minY + 1 : 0,
  };
}

/** True when the drawing has enough ink to count as a signature stroke. */
export function pngHasSignatureInk(buffer: Buffer): boolean {
  const ink = measurePngInk(buffer);
  return ink.inkPixels >= MIN_SIGNATURE_INK_PIXELS &&
    Math.max(ink.spanX, ink.spanY) >= MIN_SIGNATURE_INK_SPAN_PX;
}
