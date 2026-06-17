// Generates PWA icons as PNGs with zero dependencies (Node's zlib only).
// Draws a brand-blue rounded tile with a white chat bubble + three dots.
// Run: node scripts/gen-icons.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

// ── tiny PNG encoder (RGBA, 8-bit) ────────────────────────────────────────────
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // bit depth 8, colour type 6 (RGBA)
  // each scanline prefixed with filter byte 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── drawing helpers ───────────────────────────────────────────────────────────
function draw(size, { maskable }) {
  const buf = Buffer.alloc(size * size * 4); // transparent
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const ia = a / 255, na = 1 - ia;
    buf[i] = buf[i] * na + r * ia;
    buf[i + 1] = buf[i + 1] * na + g * ia;
    buf[i + 2] = buf[i + 2] * na + b * ia;
    buf[i + 3] = Math.max(buf[i + 3], a);
  };
  const inRoundRect = (x, y, x0, y0, x1, y1, rad) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + rad), x1 - rad);
    const cy = Math.min(Math.max(y, y0 + rad), y1 - rad);
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad ** 2;
  };

  // background tile (brand gradient #2f81f7 -> #1f6feb)
  const bgRad = maskable ? 0 : size * 0.22;
  for (let y = 0; y < size; y++) {
    const t = y / size;
    const r = Math.round(0x2f + (0x1f - 0x2f) * t);
    const g = Math.round(0x81 + (0x6f - 0x81) * t);
    const b = Math.round(0xf7 + (0xeb - 0xf7) * t);
    for (let x = 0; x < size; x++) {
      if (maskable || inRoundRect(x, y, 0, 0, size - 1, size - 1, bgRad)) set(x, y, r, g, b, 255);
    }
  }

  // chat bubble (white). Extra padding for maskable safe zone.
  const pad = size * (maskable ? 0.28 : 0.2);
  const bx0 = pad, bx1 = size - pad;
  const by0 = pad * 0.95, by1 = size - pad * 1.25;
  const brad = (bx1 - bx0) * 0.22;
  for (let y = Math.floor(by0); y <= Math.ceil(by1); y++)
    for (let x = Math.floor(bx0); x <= Math.ceil(bx1); x++)
      if (inRoundRect(x, y, bx0, by0, bx1, by1, brad)) set(x, y, 255, 255, 255, 255);

  // little tail bottom-left
  const tailX = bx0 + (bx1 - bx0) * 0.22, tailTop = by1 - 1, tailH = (by1 - by0) * 0.28;
  for (let y = 0; y <= tailH; y++) {
    const w = (1 - y / tailH) * tailH * 0.7;
    for (let x = -w; x <= 2; x++) set(Math.round(tailX + x), Math.round(tailTop + y), 255, 255, 255, 255);
  }

  // three dots (brand blue)
  const cy = (by0 + by1) / 2, dotR = (by1 - by0) * 0.09;
  for (let k = -1; k <= 1; k++) {
    const cx = (bx0 + bx1) / 2 + k * (bx1 - bx0) * 0.24;
    for (let y = Math.floor(cy - dotR); y <= Math.ceil(cy + dotR); y++)
      for (let x = Math.floor(cx - dotR); x <= Math.ceil(cx + dotR); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= dotR ** 2) set(x, y, 0x1f, 0x6f, 0xeb, 255);
  }
  return buf;
}

function write(name, size, opts = {}) {
  const png = encodePNG(size, size, draw(size, opts));
  fs.writeFileSync(path.join(OUT, name), png);
  console.log('wrote', name, size + 'x' + size, png.length + 'b');
}

write('icon-192.png', 192, { maskable: false });
write('icon-512.png', 512, { maskable: false });
write('icon-maskable-512.png', 512, { maskable: true });
write('apple-touch-icon.png', 180, { maskable: true });
