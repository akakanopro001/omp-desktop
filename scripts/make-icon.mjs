#!/usr/bin/env node
/**
 * Build icons for the desktop shell with zero dependencies.
 *
 * Renders the OMP tile at 4× and box-filters it down, then writes:
 *   build/icon.png          512×512, Linux/macOS packaging + repo artwork
 *   build/icon.ico          256…16 multi-size, Windows packaging
 *
 * The mark: an ember π on a near-black rounded tile, the same tokens the app
 * theme uses (chrome #0b0c0e, hairline #24272f, ember #ff6b3d → #ffab73).
 *
 * Usage: bun run icons
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SS = 4; // supersample factor
const SIZES = [256, 128, 64, 48, 32, 16];

const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const smooth = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Signed distance to a rounded rectangle centred on (cx, cy). */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const radius = Math.min(r, hw, hh);
  const dx = Math.abs(px - cx) - (hw - radius);
  const dy = Math.abs(py - cy) - (hh - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

function hex(value) {
  const v = value.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

const CHROME_TOP = hex("#15171d");
const CHROME_BOTTOM = hex("#0a0b0d");
const EMBER_TOP = hex("#ff7a45");
const EMBER_BOTTOM = hex("#ffb27d");
const HAIRLINE = hex("#2b2f39");
const SPARK = hex("#7dd3fc");

/**
 * The π mark, as rounded rectangles in unit space. `arch` bows the top bar so
 * the glyph reads as a hand-drawn pi rather than a table.
 */
function coverage(u, v) {
  const bar = sdRoundRect(u, v + 0.012 * Math.cos((u - 0.5) * 3.6), 0.5, 0.375, 0.295, 0.047, 0.046);
  const left = sdRoundRect(u, v, 0.352, 0.56, 0.052, 0.19, 0.052);
  const right = sdRoundRect(u, v, 0.652, 0.575, 0.055, 0.205, 0.055);
  return { glyph: Math.min(bar, left, right) };
}

function renderTile(size) {
  const big = size * SS;
  const pixels = new Float64Array(big * big * 4);
  for (let y = 0; y < big; y += 1) {
    const v = (y + 0.5) / big;
    for (let x = 0; x < big; x += 1) {
      const u = (x + 0.5) / big;
      const index = (y * big + x) * 4;

      const tile = sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.235);
      const tileAlpha = 1 - smooth(-0.004, 0.004, tile);
      if (tileAlpha <= 0) continue;

      const shade = v;
      let r = mix(CHROME_TOP[0], CHROME_BOTTOM[0], shade);
      let g = mix(CHROME_TOP[1], CHROME_BOTTOM[1], shade);
      let b = mix(CHROME_TOP[2], CHROME_BOTTOM[2], shade);

      // Inner hairline ring, then the ember glyph.
      const ring = Math.abs(sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.235) + 0.022);
      const ringAlpha = (1 - smooth(0.0035, 0.0075, ring)) * 0.5;
      r = mix(r, HAIRLINE[0], ringAlpha);
      g = mix(g, HAIRLINE[1], ringAlpha);
      b = mix(b, HAIRLINE[2], ringAlpha);

      const { glyph } = coverage(u, v);
      const glyphAlpha = 1 - smooth(-0.005, 0.005, glyph);
      if (glyphAlpha > 0) {
        const gy = clamp01((v - 0.32) / 0.5);
        r = mix(r, mix(EMBER_TOP[0], EMBER_BOTTOM[0], gy), glyphAlpha);
        g = mix(g, mix(EMBER_TOP[1], EMBER_BOTTOM[1], gy), glyphAlpha);
        b = mix(b, mix(EMBER_TOP[2], EMBER_BOTTOM[2], gy), glyphAlpha);
      }

      // A single cool spark on the right leg — the "runtime running" cue.
      const spark = sdRoundRect(u, v, 0.735, 0.44, 0.022, 0.022, 0.022);
      const sparkAlpha = 1 - smooth(-0.004, 0.004, spark);
      if (sparkAlpha > 0) {
        r = mix(r, SPARK[0], sparkAlpha);
        g = mix(g, SPARK[1], sparkAlpha);
        b = mix(b, SPARK[2], sparkAlpha);
      }

      pixels[index] = r;
      pixels[index + 1] = g;
      pixels[index + 2] = b;
      pixels[index + 3] = 255;
    }
  }

  // Box filter down to the target size.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const index = ((y * SS + sy) * big + (x * SS + sx)) * 4;
          r += pixels[index];
          g += pixels[index + 1];
          b += pixels[index + 2];
          a += pixels[index + 3];
        }
      }
      const count = SS * SS;
      const offset = (y * size + x) * 4;
      out[offset] = Math.round(r / count);
      out[offset + 1] = Math.round(g / count);
      out[offset + 2] = Math.round(b / count);
      out[offset + 3] = Math.round(a / count);
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = 6 + directory.length;
  entries.forEach((entry, index) => {
    const base = index * 16;
    directory[base] = entry.size >= 256 ? 0 : entry.size;
    directory[base + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[base + 2] = 0;
    directory[base + 3] = 0;
    directory.writeUInt16LE(1, base + 4);
    directory.writeUInt16LE(32, base + 6);
    directory.writeUInt32BE(0, base + 8);
    directory.writeUInt32LE(entry.png.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += entry.png.length;
  });
  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
}

const outDir = path.join(process.cwd(), "build");
mkdirSync(outDir, { recursive: true });

const icon512 = encodePng(renderTile(512), 512);
writeFileSync(path.join(outDir, "icon.png"), icon512);

const icoEntries = SIZES.map((size) => ({ size, png: encodePng(renderTile(size), size) }));
writeFileSync(path.join(outDir, "icon.ico"), encodeIco(icoEntries));

process.stdout.write(`wrote build/icon.png (${icon512.length} B) and build/icon.ico (${SIZES.join(", ")} px)\n`);
