// THE THURSDAY LEDGER — a one-page newspaper drawn entirely in code.
// News Image bounty, 26 November 2026. Node 22, standard library only.
// The program renders a 1024x1024 broadsheet page (masthead, stat band,
// hero stories, a dotted world map, 38 dated stories in three columns and
// 13 drawn scenes) into an in-memory raster, encodes it as a PNG and
// writes it to $MAKEFUN_OUTPUT_DIR/entry.png (default /output).
// Deterministic: no clock, no randomness, no I/O besides the final write,
// so two runs produce byte-identical files.
//
//   mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/* ------------------------------------------------------------------ */
/* PNG encoding                                                        */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgb) {
  // Pick, per scanline, the cheaper of filter None / Up by a fixed heuristic.
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const rowOff = y * (stride + 1);
    const cur = rgb.subarray(y * stride, (y + 1) * stride);
    let costNone = 0;
    for (let i = 0; i < stride; i += 7) costNone += Math.abs(cur[i] - 128);
    let useUp = false;
    if (y > 0) {
      const prev = rgb.subarray((y - 1) * stride, y * stride);
      let costUp = 0;
      for (let i = 0; i < stride; i += 7) costUp += Math.abs(((cur[i] - prev[i]) & 0xff) - 128);
      useUp = costUp < costNone;
    }
    raw[rowOff] = useUp ? 2 : 0;
    if (useUp) {
      const prev = rgb.subarray((y - 1) * stride, y * stride);
      for (let i = 0; i < stride; i++) raw[rowOff + 1 + i] = (cur[i] - prev[i]) & 0xff;
    } else {
      raw.set(cur, rowOff + 1);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* Raster canvas                                                       */
/* ------------------------------------------------------------------ */

const W = 1024;
const H = 1024;
const px = new Uint8Array(W * H * 3);

function setPx(x, y, c) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 3;
  px[o] = c[0];
  px[o + 1] = c[1];
  px[o + 2] = c[2];
}

function fillRect(x, y, w, h, c) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(W, Math.round(x + w));
  const y1 = Math.min(H, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    let o = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
      o += 3;
    }
  }
}

function strokeRect(x, y, w, h, c, t = 1) {
  fillRect(x, y, w, t, c);
  fillRect(x, y + h - t, w, t, c);
  fillRect(x, y, t, h, c);
  fillRect(x + w - t, y, t, h, c);
}

function line(x0, y0, x1, y1, c, t = 1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (t <= 1) setPx(x0, y0, c);
    else fillRect(x0 - (t >> 1), y0 - (t >> 1), t, t, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function fillCircle(cx, cy, r, c) {
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y));
    fillRect(cx - half, cy + y, half * 2 + 1, 1, c);
  }
}

function ringCircle(cx, cy, r, c, t = 1) {
  for (let i = 0; i < t; i++) {
    const rr = r - i;
    for (let a = 0; a < 360; a += 1) {
      const rad = (a * Math.PI) / 180;
      setPx(Math.round(cx + rr * Math.cos(rad)), Math.round(cy + rr * Math.sin(rad)), c);
    }
  }
}

function fillTri(x0, y0, x1, y1, x2, y2, c) {
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
  const area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  if (area === 0) return;
  for (let y = minY; y <= maxY; y++) {
    let lo = Infinity;
    let hi = -Infinity;
    const pts = [[x0, y0, x1, y1], [x1, y1, x2, y2], [x2, y2, x0, y0]];
    for (const [ax, ay, bx, by] of pts) {
      if ((y >= ay && y <= by) || (y >= by && y <= ay)) {
        if (by === ay) continue;
        const x = ax + ((y - ay) * (bx - ax)) / (by - ay);
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    if (hi >= lo) fillRect(Math.floor(lo), y, Math.ceil(hi) - Math.floor(lo) + 1, 1, c);
  }
}

/* Palette */
const PAPER = [246, 241, 227];
const INK = [24, 20, 15];
const SOFT = [90, 82, 70];
const RED = [158, 27, 27];
const NAVY = [29, 53, 87];
const GOLD = [176, 124, 32];
const PANEL = [236, 228, 205];
const RULE = [120, 110, 92];

/* ------------------------------------------------------------------ */
/* 5x7 bitmap font, drawn by hand for this page                        */
/* ------------------------------------------------------------------ */

const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '.#.#.', '..#..', '..#..', '..#..', '.#.#.', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#..##', '#.#.#', '##..#', '#...#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '..##.', '.#...', '#....', '#####'],
  '3': ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  "'": ['..#..', '..#..', '..#..', '.....', '.....', '.....', '.....'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  ';': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.#...'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '..##.', '..#..', '.....', '..#..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '..#..', '..#..', '..#..', '..#..', '.#...'],
  '%': ['##..#', '##.#.', '....#', '...#.', '..#..', '.#...', '#..##'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '+': ['.....', '..#..', '..#..', '.###.', '..#..', '..#..', '.....'],
  '*': ['.....', '#.#.#', '.###.', '#.#.#', '.....', '.....', '.....'],
  '"': ['.#.#.', '.#.#.', '.#.#.', '.....', '.....', '.....', '.....'],
  '$': ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '<': ['....#', '...#.', '..#..', '.#...', '..#..', '...#.', '....#'],
  '>': ['#....', '.#...', '..#..', '...#.', '..#..', '.#...', '#....'],
};

function cleanText(s) {
  return s
    .toUpperCase()
    .replace(/[ÉÈ]/g, 'E')
    .replace(/Í/g, 'I')
    .replace(/Á/g, 'A')
    .replace(/[—–]/g, '-')
    .replace(/[·•]/g, '.')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

function charW(scale) {
  return 6 * scale;
}

function textW(s, scale) {
  return s.length * charW(scale) - scale;
}

function drawText(x, y, s, scale, color, bold = false) {
  const str = cleanText(s);
  let cx = x;
  for (const ch of str) {
    const g = GLYPHS[ch] || GLYPHS['?'];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (g[r][c] === '#') {
          fillRect(cx + c * scale, y + r * scale, scale, scale, color);
          if (bold) fillRect(cx + c * scale + scale, y + r * scale, scale, scale, color);
        }
      }
    }
    cx += charW(scale) + (bold ? scale : 0);
  }
  return cx - x;
}

function textWBold(s, scale) {
  return s.length * (charW(scale) + scale) - scale;
}

function wrapText(s, scale, maxW, bold = false) {
  const words = cleanText(s).split(' ');
  const lines = [];
  let cur = '';
  const wOf = (t) => (bold ? textWBold(t, scale) : textW(t, scale));
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w;
    if (wOf(trial) <= maxW || !cur) cur = trial;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawCentered(cx, y, s, scale, color, bold = false) {
  const w = bold ? textWBold(cleanText(s), scale) : textW(cleanText(s), scale);
  drawText(Math.round(cx - w / 2), y, s, scale, color, bold);
}

/* ------------------------------------------------------------------ */
/* Drawn scenes (flat, deliberate, in-programme)                       */
/* ------------------------------------------------------------------ */

function sceneFrame(x, y, w, h, sky) {
  fillRect(x, y, w, h, sky);
}

function sceneDrone(x, y, w, h) {
  sceneFrame(x, y, w, h, [196, 214, 228]);
  fillRect(x, y + h * 0.78, w, h * 0.22, [104, 116, 96]); // ground
  fillRect(x, y + h * 0.74, w, h * 0.04, [84, 94, 78]);
  const cx = x + w * 0.5;
  const cy = y + h * 0.38;
  const s = w / 190;
  // arms + rotors
  line(cx - 26 * s, cy - 8 * s, cx + 26 * s, cy + 8 * s, INK, 3);
  line(cx - 26 * s, cy + 8 * s, cx + 26 * s, cy - 8 * s, INK, 3);
  for (const [ox, oy] of [[-26, -8], [26, 8], [-26, 8], [26, -8]]) {
    line(cx + (ox - 9) * s, cy + oy * s, cx + (ox + 9) * s, cy + oy * s, INK, 2);
    fillCircle(cx + ox * s, cy + oy * s, 2.4 * s, INK);
  }
  fillRect(cx - 11 * s, cy - 6 * s, 22 * s, 12 * s, INK); // body
  fillCircle(cx, cy + 7 * s, 3.4 * s, RED); // camera eye
  fillCircle(cx - 20 * s, cy - 14 * s, 2 * s, RED);
  // distant smoke columns
  for (const fx of [0.12, 0.85]) {
    fillRect(x + w * fx, y + h * 0.5, w * 0.03, h * 0.28, [120, 118, 112]);
    fillCircle(x + w * fx + w * 0.015, y + h * 0.47, w * 0.035, [140, 138, 130]);
  }
}

function sceneFactory(x, y, w, h) {
  sceneFrame(x, y, w, h, [214, 224, 232]);
  fillRect(x, y + h * 0.8, w, h * 0.2, [110, 104, 92]);
  // chimneys with smoke
  for (const fx of [0.16, 0.3]) {
    fillRect(x + w * fx, y + h * 0.3, w * 0.07, h * 0.5, [148, 74, 60]);
    fillRect(x + w * fx - 2, y + h * 0.27, w * 0.07 + 4, h * 0.05, [120, 58, 48]);
    fillCircle(x + w * fx + w * 0.05, y + h * 0.24, h * 0.17, [228, 228, 224]);
    fillCircle(x + w * fx + w * 0.09, y + h * 0.17, h * 0.15, [236, 236, 232]);
  }
  // factory block
  fillRect(x + w * 0.08, y + h * 0.52, w * 0.5, h * 0.28, [96, 106, 122]);
  for (let i = 0; i < 5; i++) fillRect(x + w * (0.12 + i * 0.09), y + h * 0.58, w * 0.05, h * 0.1, [240, 214, 130]);
  fillTri(x + w * 0.08, y + h * 0.52, x + w * 0.33, y + h * 0.4, x + w * 0.58, y + h * 0.52, [70, 80, 98]);
  // shipping containers
  const cols = [[196, 84, 60], [52, 110, 160], [74, 140, 90]];
  cols.forEach((c, i) => {
    fillRect(x + w * (0.62 + (i % 2) * 0.17), y + h * (0.62 - Math.floor(i / 2) * 0.16), w * 0.16, h * 0.15, c);
    strokeRect(x + w * (0.62 + (i % 2) * 0.17), y + h * (0.62 - Math.floor(i / 2) * 0.16), w * 0.16, h * 0.15, INK, 1);
  });
  fillRect(x + w * 0.62, y + h * 0.78, w * 0.33, h * 0.03, INK);
}

function sceneShip(x, y, w, h) {
  sceneFrame(x, y, w, h, [170, 205, 226]);
  fillCircle(x + w * 0.86, y + h * 0.28, h * 0.22, [246, 205, 92]); // sun
  fillRect(x, y + h * 0.62, w, h * 0.38, [44, 96, 140]); // sea
  for (let i = 0; i < 7; i++) line(x + w * (0.05 + i * 0.13), y + h * (0.7 + (i % 3) * 0.07), x + w * (0.11 + i * 0.13), y + h * (0.7 + (i % 3) * 0.07), [120, 170, 205], 2);
  // island with palm
  fillTri(x + w * 0.02, y + h * 0.62, x + w * 0.16, y + h * 0.44, x + w * 0.3, y + h * 0.62, [96, 140, 84]);
  line(x + w * 0.16, y + h * 0.46, x + w * 0.17, y + h * 0.3, [110, 84, 50], 3);
  for (const a of [-50, -20, 15, 45]) {
    const rad = (a * Math.PI) / 180;
    line(x + w * 0.17, y + h * 0.3, x + w * 0.17 + Math.cos(rad) * w * 0.07, y + h * 0.3 + Math.sin(rad) * w * 0.05, [52, 116, 60], 2);
  }
  // naval ship
  const sx = x + w * 0.42;
  const sy = y + h * 0.6;
  fillRect(sx, sy, w * 0.46, h * 0.1, [70, 78, 90]);
  fillTri(sx + w * 0.46, sy, sx + w * 0.52, sy + h * 0.05, sx + w * 0.46, sy + h * 0.1, [70, 78, 90]);
  fillRect(sx + w * 0.08, sy - h * 0.12, w * 0.2, h * 0.12, [92, 102, 116]);
  fillRect(sx + w * 0.3, sy - h * 0.2, w * 0.05, h * 0.2, [92, 102, 116]);
  line(sx + w * 0.32, sy - h * 0.2, sx + w * 0.32, sy - h * 0.3, INK, 2);
  fillRect(sx + w * 0.14, sy - h * 0.05, w * 0.1, h * 0.03, [52, 60, 72]);
}

function sceneBank(x, y, w, h) {
  sceneFrame(x, y, w, h, [208, 216, 226]);
  fillRect(x, y + h * 0.84, w, h * 0.16, [150, 144, 128]);
  const bx = x + w * 0.14;
  const bw = w * 0.72;
  fillTri(bx - w * 0.03, y + h * 0.26, bx + bw / 2, y + h * 0.05, bx + bw + w * 0.03, y + h * 0.26, NAVY);
  fillRect(bx - w * 0.03, y + h * 0.26, bw + w * 0.06, h * 0.06, NAVY);
  fillCircle(bx + bw / 2, y + h * 0.19, Math.max(2, h * 0.08), GOLD);
  for (let i = 0; i < 5; i++) {
    const cxx = bx + (i * bw) / 5 + bw / 10;
    fillRect(cxx, y + h * 0.36, bw / 16, h * 0.42, [226, 222, 208]);
    fillRect(cxx - 1, y + h * 0.33, bw / 16 + 2, h * 0.04, [196, 190, 172]);
    fillRect(cxx - 1, y + h * 0.78, bw / 16 + 2, h * 0.04, [196, 190, 172]);
  }
  fillRect(bx - w * 0.02, y + h * 0.84, bw + w * 0.04, h * 0.05, [150, 144, 128]);
  fillRect(bx + w * 0.01, y + h * 0.9, bw - w * 0.02, h * 0.04, [168, 162, 144]);
}

function scenePylon(x, y, w, h) {
  sceneFrame(x, y, w, h, [86, 84, 102]);
  fillRect(x, y + h * 0.82, w, h * 0.18, [52, 50, 58]);
  const cx = x + w * 0.38;
  const top = y + h * 0.1;
  const bot = y + h * 0.84;
  line(cx - w * 0.13, bot, cx, top, [210, 208, 200], 2);
  line(cx + w * 0.13, bot, cx, top, [210, 208, 200], 2);
  line(cx - w * 0.13, bot, cx + w * 0.13, bot - h * 0.3, [210, 208, 200], 1);
  line(cx + w * 0.13, bot, cx - w * 0.13, bot - h * 0.3, [210, 208, 200], 1);
  for (const fy of [0.24, 0.42]) {
    line(cx - w * 0.2, y + h * fy, cx + w * 0.2, y + h * fy, [210, 208, 200], 2);
    line(cx - w * 0.2, y + h * fy, x, y + h * (fy + 0.1), [160, 158, 152], 1);
    line(cx + w * 0.2, y + h * fy, x + w, y + h * (fy + 0.06), [160, 158, 152], 1);
  }
  // lightning bolt
  const bx = x + w * 0.68;
  const by = y + h * 0.14;
  fillTri(bx, by, bx + w * 0.07, by, bx + w * 0.015, by + h * 0.2, [250, 208, 60]);
  fillTri(bx + w * 0.015, by + h * 0.18, bx + w * 0.085, by + h * 0.18, bx - w * 0.02, by + h * 0.42, [250, 208, 60]);
  // blast star on the horizon
  const ex = x + w * 0.85;
  const ey = y + h * 0.72;
  for (let a = 0; a < 360; a += 45) {
    const rad = (a * Math.PI) / 180;
    line(ex, ey, ex + Math.cos(rad) * h * 0.17, ey + Math.sin(rad) * h * 0.17, [240, 150, 60], 2);
  }
  fillCircle(ex, ey, Math.max(2, h * 0.06), [250, 190, 90]);
}

function sceneTanker(x, y, w, h) {
  sceneFrame(x, y, w, h, [176, 208, 224]);
  fillCircle(x + w * 0.1, y + h * 0.26, h * 0.2, [246, 205, 92]);
  // two headlands forming a strait
  fillTri(x, y + h * 0.34, x + w * 0.3, y + h * 0.34, x, y + h * 0.62, [150, 128, 92]);
  fillTri(x + w, y + h * 0.3, x + w * 0.72, y + h * 0.3, x + w, y + h * 0.58, [150, 128, 92]);
  fillRect(x, y + h * 0.58, w, h * 0.42, [40, 92, 138]);
  for (let i = 0; i < 6; i++) line(x + w * (0.06 + i * 0.15), y + h * (0.72 + (i % 3) * 0.08), x + w * (0.12 + i * 0.15), y + h * (0.72 + (i % 3) * 0.08), [116, 168, 204], 2);
  // tanker
  const sx = x + w * 0.3;
  const sy = y + h * 0.56;
  fillRect(sx, sy, w * 0.42, h * 0.09, [40, 44, 52]);
  fillRect(sx + w * 0.02, sy - h * 0.05, w * 0.34, h * 0.05, [172, 52, 44]);
  fillRect(sx + w * 0.36, sy - h * 0.14, w * 0.05, h * 0.14, [226, 224, 216]);
  line(sx + w * 0.1, sy - h * 0.05, sx + w * 0.1, sy - h * 0.12, INK, 2);
}

function sceneGavel(x, y, w, h) {
  sceneFrame(x, y, w, h, [226, 216, 192]);
  fillRect(x, y + h * 0.78, w, h * 0.22, [196, 184, 158]);
  // sound block
  fillRect(x + w * 0.56, y + h * 0.72, w * 0.3, h * 0.12, [122, 84, 48]);
  fillRect(x + w * 0.6, y + h * 0.66, w * 0.22, h * 0.06, [146, 102, 58]);
  // gavel, angled
  const gx = x + w * 0.28;
  const gy = y + h * 0.5;
  line(gx, gy, gx + w * 0.36, gy + h * 0.24, [122, 84, 48], 5);
  const hx = gx - w * 0.03;
  const hy = gy - h * 0.02;
  fillRect(hx - w * 0.04, hy - h * 0.24, w * 0.19, h * 0.3, [146, 102, 58]);
  fillRect(hx - w * 0.04, hy - h * 0.24, w * 0.032, h * 0.3, GOLD);
  fillRect(hx + w * 0.118, hy - h * 0.24, w * 0.032, h * 0.3, GOLD);
  strokeRect(hx - w * 0.04, hy - h * 0.24, w * 0.19, h * 0.3, [100, 66, 36], 1);
  // motion ticks
  for (const dx of [-0.09, 0.03, 0.15]) {
    line(x + w * (0.28 + dx), y + h * 0.2, x + w * (0.28 + dx), y + h * 0.1, RED, 2);
  }
}

function sceneVirus(x, y, w, h) {
  sceneFrame(x, y, w, h, [222, 232, 220]);
  const drawVirus = (cx, cy, r, c) => {
    for (let a = 0; a < 360; a += 30) {
      const rad = (a * Math.PI) / 180;
      line(cx, cy, cx + Math.cos(rad) * r * 1.45, cy + Math.sin(rad) * r * 1.45, c, 3);
      fillCircle(cx + Math.cos(rad) * r * 1.5, cy + Math.sin(rad) * r * 1.5, r * 0.22, c);
    }
    fillCircle(cx, cy, r, c);
    fillCircle(cx - r * 0.3, cy - r * 0.2, r * 0.18, [240, 244, 238]);
    fillCircle(cx + r * 0.35, cy + r * 0.3, r * 0.14, [240, 244, 238]);
    fillCircle(cx + r * 0.1, cy - r * 0.45, r * 0.11, [240, 244, 238]);
  };
  drawVirus(x + w * 0.42, y + h * 0.5, h * 0.27, [58, 128, 74]);
  drawVirus(x + w * 0.68, y + h * 0.42, h * 0.16, [96, 158, 104]);
  drawVirus(x + w * 0.85, y + h * 0.62, h * 0.12, [120, 176, 128]);
  // red cross badge
  fillCircle(x + w * 0.12, y + h * 0.5, h * 0.3, [250, 250, 248]);
  ringCircle(x + w * 0.12, y + h * 0.5, h * 0.3, RED, 2);
  fillRect(x + w * 0.12 - 1, y + h * 0.5 - h * 0.17, 3, h * 0.34, RED);
  fillRect(x + w * 0.12 - h * 0.17, y + h * 0.5 - 1, h * 0.34, 3, RED);
}

function sceneMine(x, y, w, h) {
  sceneFrame(x, y, w, h, [206, 216, 210]);
  // hillside
  fillTri(x, y + h, x + w * 0.55, y + h * 0.16, x + w, y + h, [128, 116, 88]);
  fillTri(x, y + h, x + w * 0.2, y + h * 0.44, x + w * 0.62, y + h, [146, 132, 100]);
  // mine entrance
  const ex = x + w * 0.4;
  const ey = y + h * 0.52;
  fillRect(ex, ey, w * 0.2, h * 0.34, [30, 26, 22]);
  fillTri(ex, ey, ex + w * 0.1, ey - h * 0.1, ex + w * 0.2, ey, [30, 26, 22]);
  fillRect(ex - w * 0.015, ey - h * 0.02, w * 0.23, h * 0.045, [110, 84, 50]);
  line(ex + w * 0.02, ey + h * 0.34, ex + w * 0.02, ey, [110, 84, 50], 3);
  line(ex + w * 0.18, ey + h * 0.34, ex + w * 0.18, ey, [110, 84, 50], 3);
  // rails + cart
  line(ex + w * 0.04, ey + h * 0.38, x + w * 0.12, y + h * 0.92, [70, 66, 60], 2);
  line(ex + w * 0.16, ey + h * 0.38, x + w * 0.3, y + h * 0.92, [70, 66, 60], 2);
  fillRect(x + w * 0.17, y + h * 0.78, w * 0.11, h * 0.09, [84, 60, 40]);
  fillCircle(x + w * 0.19, y + h * 0.9, w * 0.016, INK);
  fillCircle(x + w * 0.26, y + h * 0.9, w * 0.016, INK);
  fillCircle(x + w * 0.225, y + h * 0.76, w * 0.028, GOLD); // gold pile
  // warning sign
  line(x + w * 0.8, y + h * 0.5, x + w * 0.8, y + h * 0.86, [90, 80, 66], 3);
  fillTri(x + w * 0.8, y + h * 0.34, x + w * 0.72, y + h * 0.52, x + w * 0.88, y + h * 0.52, [240, 190, 60]);
  drawText(x + w * 0.8 - 1, y + h * 0.42, '!', 2, INK, true);
}

function sceneBalloon(x, y, w, h) {
  sceneFrame(x, y, w, h, [186, 214, 234]);
  fillCircle(x + w * 0.13, y + h * 0.3, h * 0.2, [244, 244, 240]);
  fillCircle(x + w * 0.19, y + h * 0.26, h * 0.24, [248, 248, 244]);
  // skyline
  const base = y + h * 0.86;
  const towers = [[0.02, 0.3], [0.12, 0.42], [0.24, 0.26], [0.78, 0.36], [0.88, 0.28]];
  for (const [fx, fh] of towers) {
    fillRect(x + w * fx, base - h * fh, w * 0.09, h * fh, [108, 122, 146]);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) fillRect(x + w * fx + 3 + c * w * 0.035, base - h * fh + 4 + r * h * 0.09, w * 0.02, h * 0.05, [246, 220, 140]);
  }
  fillRect(x, base, w, h * 0.14, [120, 116, 108]);
  // the great balloon
  const cx = x + w * 0.52;
  const cy = y + h * 0.44;
  const br = h * 0.4;
  fillCircle(cx, cy, br, [214, 84, 60]);
  fillCircle(cx - br * 0.3, cy - br * 0.3, br * 0.55, [232, 110, 82]);
  fillRect(cx - br, cy - br * 0.12, br * 2, br * 0.26, [158, 27, 27]);
  fillCircle(cx - br * 0.35, cy - br * 0.28, Math.max(1.6, br * 0.12), [250, 244, 230]);
  fillCircle(cx + br * 0.4, cy - br * 0.28, Math.max(1.6, br * 0.12), [250, 244, 230]);
  // tethers to handlers
  for (const fx of [0.4, 0.47, 0.58, 0.65]) line(cx + (fx - 0.52) * w * 0.7, cy + br * 0.9, x + w * fx, base, [80, 76, 70], 1);
  for (const fx of [0.4, 0.47, 0.58, 0.65]) fillCircle(x + w * fx, base - 3, 3, RED);
}

function scenePlane(x, y, w, h) {
  sceneFrame(x, y, w, h, [198, 214, 228]);
  fillRect(x, y + h * 0.6, w, h * 0.4, [128, 130, 134]); // tarmac
  // runway perspective
  fillTri(x + w * 0.3, y + h, x + w * 0.47, y + h * 0.6, x + w * 0.53, y + h * 0.6, [96, 98, 102]);
  fillTri(x + w * 0.7, y + h, x + w * 0.53, y + h * 0.6, x + w * 0.47, y + h * 0.6, [96, 98, 102]);
  for (let i = 0; i < 4; i++) fillRect(x + w * (0.485 - i * 0.004), y + h * (0.64 + i * 0.09), w * (0.012 + i * 0.006), h * 0.045, [240, 240, 236]);
  // cargo jet, nose left
  const py = y + h * 0.4;
  fillRect(x + w * 0.14, py, w * 0.56, h * 0.13, [232, 234, 238]);
  fillTri(x + w * 0.14, py, x + w * 0.05, py + h * 0.1, x + w * 0.14, py + h * 0.13, [232, 234, 238]);
  fillRect(x + w * 0.62, py - h * 0.14, w * 0.09, h * 0.15, [196, 84, 60]); // tail
  fillRect(x + w * 0.6, py - h * 0.03, w * 0.13, h * 0.04, [196, 84, 60]);
  fillTri(x + w * 0.3, py + h * 0.1, x + w * 0.52, py + h * 0.1, x + w * 0.44, py + h * 0.24, [178, 184, 192]); // wing
  for (let i = 0; i < 6; i++) fillCircle(x + w * (0.22 + i * 0.07), py + h * 0.045, 2.2, NAVY);
  fillRect(x + w * 0.24, py + h * 0.13, w * 0.03, h * 0.07, INK);
  fillRect(x + w * 0.55, py + h * 0.13, w * 0.03, h * 0.07, INK);
  fillCircle(x + w * 0.255, py + h * 0.22, w * 0.014, INK);
  fillCircle(x + w * 0.565, py + h * 0.22, w * 0.014, INK);
  // cones
  for (const fx of [0.08, 0.9]) {
    fillTri(x + w * fx, y + h * 0.82, x + w * (fx + 0.025), y + h * 0.68, x + w * (fx + 0.05), y + h * 0.82, [232, 110, 40]);
  }
}

function sceneStadium(x, y, w, h) {
  sceneFrame(x, y, w, h, [172, 200, 224]);
  // floodlight pylons
  for (const fx of [0.08, 0.86]) {
    line(x + w * fx, y + h * 0.62, x + w * fx, y + h * 0.14, [90, 94, 102], 3);
    fillRect(x + w * fx - w * 0.045, y + h * 0.06, w * 0.09, h * 0.09, [240, 240, 220]);
    for (let i = 0; i < 3; i++) fillCircle(x + w * fx - w * 0.025 + i * w * 0.025, y + h * 0.105, 2, [250, 240, 160]);
  }
  // bowl
  fillRect(x + w * 0.14, y + h * 0.34, w * 0.72, h * 0.3, [120, 128, 142]);
  fillRect(x + w * 0.14, y + h * 0.34, w * 0.72, h * 0.05, [150, 158, 172]);
  for (let r = 0; r < 3; r++) fillRect(x + w * 0.16, y + h * (0.44 + r * 0.07), w * 0.68, h * 0.018, [214, 120, 110]);
  fillRect(x + w * 0.2, y + h * 0.64, w * 0.6, h * 0.22, [74, 140, 74]); // pitch
  strokeRect(x + w * 0.24, y + h * 0.67, w * 0.52, h * 0.16, [240, 244, 240], 1);
  line(x + w * 0.5, y + h * 0.67, x + w * 0.5, y + h * 0.83, [240, 244, 240], 1);
  // ball
  fillCircle(x + w * 0.5, y + h * 0.75, w * 0.028, [250, 250, 248]);
  fillCircle(x + w * 0.5, y + h * 0.75, w * 0.01, INK);
  ringCircle(x + w * 0.5, y + h * 0.75, w * 0.028, INK, 1);
}

function sceneFire(x, y, w, h) {
  sceneFrame(x, y, w, h, [216, 208, 196]);
  fillRect(x, y + h * 0.8, w, h * 0.2, [110, 104, 96]);
  // tanker truck
  const ty = y + h * 0.52;
  fillRect(x + w * 0.16, ty, w * 0.46, h * 0.2, [206, 210, 214]);
  fillRect(x + w * 0.16, ty, w * 0.46, h * 0.05, [172, 52, 44]);
  fillRect(x + w * 0.64, ty + h * 0.04, w * 0.13, h * 0.16, [52, 110, 160]); // cab
  fillRect(x + w * 0.68, ty + h * 0.07, w * 0.06, h * 0.06, [190, 220, 240]);
  for (const fx of [0.24, 0.4, 0.56, 0.68]) fillCircle(x + w * fx, ty + h * 0.24, w * 0.022, INK);
  // flames above the tank
  for (const [fx, fh, c] of [[0.24, 0.3, [232, 110, 40]], [0.36, 0.4, [240, 150, 50]], [0.48, 0.32, [232, 110, 40]], [0.37, 0.24, [250, 200, 90]]]) {
    fillTri(x + w * (fx - 0.05), ty, x + w * fx, ty - h * fh, x + w * (fx + 0.05), ty, c);
  }
  // smoke
  fillCircle(x + w * 0.66, y + h * 0.24, h * 0.17, [130, 126, 120]);
  fillCircle(x + w * 0.76, y + h * 0.18, h * 0.15, [146, 142, 136]);
  fillCircle(x + w * 0.56, y + h * 0.16, h * 0.12, [120, 116, 110]);
}

const SCENES = {
  drone: sceneDrone,
  factory: sceneFactory,
  ship: sceneShip,
  bank: sceneBank,
  pylon: scenePylon,
  tanker: sceneTanker,
  gavel: sceneGavel,
  virus: sceneVirus,
  mine: sceneMine,
  balloon: sceneBalloon,
  plane: scenePlane,
  stadium: sceneStadium,
  fire: sceneFire,
};

function drawScene(key, x, y, w, h) {
  SCENES[key](x, y, w, h);
  strokeRect(x, y, w, h, INK, 1);
}

/* ------------------------------------------------------------------ */
/* Dotted world map                                                    */
/* ------------------------------------------------------------------ */

const MAP_ROWS = [
  '......##.................####..................................#####........',
  '...#######...........#########..........##...........##################.....',
  '..#########.........###########........####.........#####################...',
  '...########..........########.........######.......####################....',
  '....######............######..........################..##############.....',
  '.....#####.............####...........################....########........',
  '.....####...............##.............##############......######...........',
  '......###...............................############........####............',
  '......####...............................##########..........##...#.........',
  '.......###................................########............##............',
  '.......####................................######.............###..#..#.....',
  '........####...............................#####..............#########.....',
  '.........###................................####...............########.....',
  '.........####...............................###.................######......',
  '..........###...............................##..................########....',
  '..........####...............................................##########.....',
  '...........###................................................................',
  '...........##.................................................................',
];

// lon/lat of the day's hotspots
const MAP_SPOTS = [
  [-77, 39], // Washington
  [-80, 26], // Miami
  [30.5, 50.4], // Kyiv
  [4.4, 50.8], // Brussels
  [47.9, 29.4], // Kuwait
  [31.2, 30], // Cairo
  [15.3, -4.3], // Kinshasa
  [107, -6.9], // West Java
  [160, -9.6], // Solomon Islands
];

function drawMap(x, y, w, h) {
  fillRect(x, y, w, h, [222, 228, 232]);
  const rows = MAP_ROWS.length;
  const cols = Math.max(...MAP_ROWS.map((r) => r.length));
  const cellW = w / cols;
  const cellH = h / rows;
  const dotR = Math.max(1, Math.floor(Math.min(cellW, cellH) / 2.4));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < MAP_ROWS[r].length; c++) {
      if (MAP_ROWS[r][c] === '#') {
        fillCircle(Math.round(x + (c + 0.5) * cellW), Math.round(y + (r + 0.5) * cellH), dotR, [96, 118, 92]);
      }
    }
  }
  for (const [lon, lat] of MAP_SPOTS) {
    const mx = x + ((lon + 180) / 360) * w;
    const my = y + ((90 - lat) / 150) * h;
    fillRect(mx - 3, my - 3, 7, 7, RED);
    fillRect(mx - 1, my - 1, 3, 3, [250, 240, 220]);
  }
  strokeRect(x, y, w, h, INK, 1);
}

/* ------------------------------------------------------------------ */
/* The day's stories (only items verified in the research brief)       */
/* ------------------------------------------------------------------ */

const HEROES = [
  {
    tag: 'KUWAIT - CONFLICT',
    head: 'Two Italian technicians killed in Iranian drone strike on Kuwait',
    body: "Rome blames Tehran for the attack on the pair, who worked for Rheinmetall's Italian unit. Iran denies any role in the strike.",
    scene: 'drone',
  },
  {
    tag: 'WASHINGTON - TRADE',
    head: 'US proposes new tariffs on 14 trading partners',
    body: 'Washington targets excess factory capacity and subsidised production. China, the EU, Japan, India and Indonesia are among those named; Beijing and others hit back.',
    scene: 'factory',
  },
];

const COL_A = [
  { h: 'PACIFIC SECURITY' },
  { tag: 'CANBERRA', head: 'Solomon Islands names Australia its main security partner', body: 'Treaty signed by PMs Wale and Albanese rules out foreign military bases in the Pacific nation.', scene: 'ship' },
  { h: 'UKRAINE WAR' },
  { tag: 'KYIV', head: 'Zelenskyy warns of major Russian strike on power grid', body: 'Ballistic missiles and 113 drones overnight: two killed in Kharkiv, power cut in seven regions.', scene: 'pylon' },
  { tag: 'ODESA', head: 'Russia hits two grain ships near Odesa ports', body: 'Over 100,000 tonnes of grain aboard; Ukrainian drones hit Nevinnomyssk power plant in reply.' },
  { h: 'MIDDLE EAST & GULF' },
  { tag: 'HORMUZ', head: 'Houthis claim refinery hit; Iran claims mine strikes - unverified', body: 'Mine-hit claims in the Strait of Hormuz remain uncorroborated. Oil climbs: Brent $94.71, WTI $84.03.', scene: 'tanker' },
  { tag: 'JIZAN', head: 'Houthis intensify attacks on Saudi Arabia', body: 'Projectile hits Jizan Red Sea port; coalition intercepts a drone near Jeddah and missiles over Riyadh.' },
  { tag: 'GAZA', head: 'Israeli strikes kill eight in Gaza', body: 'Hamas official Abu Nada and wife among dead.' },
  { tag: 'JERUSALEM', head: 'Judges suggest dropping Netanyahu bribery charge', body: 'Case 4000 is the only bribery count he faces.' },
  { tag: 'BAGHDAD', head: 'Baghdad closes two Kurdistan border crossings', body: 'Al-Waleed and Bashta posts shut over KRG control.' },
  { tag: 'CAIRO', head: 'Egypt detains driver after tanker fire kills 31', body: 'Driver held as inquiry opens into the fire.', scene: 'fire' },
  { h: 'WORLD & SPORT' },
  { tag: 'FOOTBALL', head: 'FIFA confirms cyberattack on its systems', body: "Football's governing body says attackers accessed personal and business information.", scene: 'stadium' },
];

const COL_B = [
  { h: 'EUROPE' },
  { tag: 'BRUSSELS', head: "Spain's Hernandez de Cos picked to lead the ECB", body: 'Eurozone leaders choose the Bank of Spain governor to succeed Christine Lagarde at the central bank.', scene: 'bank' },
  { tag: 'BRUSSELS', head: 'EU leaders wrestle over Ukraine aid and loan', body: '45bn-euro loan decision put off to December.' },
  { tag: 'PARIS', head: 'Depardieu to stand trial for alleged rape', body: "Paris appeal court rejects the actor's bid to avoid trial over actress Charlotte Arnould's 2018 claim.", scene: 'gavel' },
  { tag: 'LONDON', head: 'Huntingdon train attacker found guilty', body: 'Guilty of 14 attempted murders, ten of them on a London-bound train, the court rules.' },
  { tag: 'BELGRADE', head: 'Serbia sets presidential election for 27 Dec', body: 'Student protest movement won the October polls.' },
  { tag: 'BUCHAREST', head: 'Romania charges hard-right leader Simion', body: 'Prosecutors: incited violence vs election staff.' },
  { tag: 'LONDON', head: 'New UK-EU treaty carries 10-year exit clause', body: 'Bill lets ministers enact closer bloc ties.' },
  { tag: 'OSLO', head: 'Norse Atlantic suspends all flights', body: 'Carrier grounds fleet in urgent funding plea.' },
  { tag: 'NAIROBI', head: 'Kenyan cult leader convicted on terror charges', body: 'Paul Mackenzie, already serving 200 years for murder, is convicted of terrorism-related charges.' },
  { h: 'AFRICA' },
  { tag: 'KINSHASA', head: 'DR Congo Ebola cases pass 12,000', body: 'Second-largest outbreak on record; violence forces responders to evacuate in Ituri province.', scene: 'virus' },
  { tag: 'HEALTH', head: 'Cheaper HIV prevention jab reaches Africa', body: 'Twice-yearly lenacapavir injection, at lower cost, now rolling out across the continent.' },
  { tag: 'BISSAU', head: 'Guinea-Bissau delays elections to Nov 2028', body: 'Transition extended a year after the coup.' },
  { h: 'SPORT' },
  { tag: 'PITTSBURGH', head: 'Steelers release quarterback Rodgers', body: 'Axed after ripping coach McCarthy on TV.' },
];

const COL_C = [
  { h: 'ASIA' },
  { tag: 'WEST JAVA', head: '13 trapped in illegal gold mine, 13 confirmed dead', body: 'Rescuers resume the search near Bogor after the collapse at the illegal mine workings.', scene: 'mine' },
  { tag: 'BANGKOK', head: 'Bangkok refinery blast injures nine', body: 'Three of the wounded are critical after the oil refinery explosion in the Thai capital.' },
  { tag: 'TAIPEI', head: 'Taiwan jails ex-navy sergeant for spying', body: "Six years for spying for China, as island-wide local elections draw Beijing's close attention." },
  { tag: 'MANILA', head: 'Philippines commissions three patrol vessels', body: 'BRP Patag and BRP Pag-asa join the fleet.' },
  { tag: 'SEOUL', head: 'Ruling party moves to impeach top judge', body: 'Lawmakers target Chief Justice Cho Hee-dae.' },
  { tag: 'MYANMAR', head: 'Myanmar rejects parts of ICJ genocide ruling', body: 'Junta refuses parts of Rohingya judgment.' },
  { tag: 'MUMBAI', head: 'Mumbai marks 18 years since 26/11 attacks', body: 'Tributes at the Taj Hotel from French, Israeli and US envoys on the anniversary.' },
  { h: 'AMERICAS' },
  { tag: 'WASHINGTON', head: "Trump calls GDP figures 'fake', demands probe", body: 'No evidence offered for the claim on pre-election data; Democrats hold a House majority of 259+ seats.' },
  { tag: 'TECH', head: 'Nvidia comeback fuels chip and spying debate', body: "US officials divided over spying claims; export curbs delay China's GLM-5.5 and Kimi K4 AI models." },
  { tag: 'NEW YORK', head: "Macy's parade postponed for first time ever", body: "The 100th Thanksgiving parade moves to Sat 28 Nov as a nor'easter batters the East Coast. Markets shut.", scene: 'balloon' },
  { tag: 'MIAMI', head: 'FedEx jet overruns runway at Miami airport', body: 'FAA orders a ground stop; all but one runway at the airport are closed after the overrun.', scene: 'plane' },
  { tag: 'CARACAS', head: 'US and Qatar to help Venezuela clear arrears', body: 'Bridge loans settle regional bank arrears.' },
];

const STATS = [
  ['113', 'DRONES FIRED OVER UKRAINE IN ONE NIGHT'],
  ['50,182.95', 'DOW CLOSE WED - UP 0.33%'],
  ['$94.71', 'BRENT CRUDE ON HORMUZ FEARS'],
  ['12,000+', 'EBOLA CASES IN DR CONGO'],
  ['14', 'PARTNERS FACE NEW US TARIFFS'],
  ['31', 'KILLED IN GIZA TANKER FIRE'],
];

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

const M = 24; // page margin
const CW = W - M * 2; // content width = 976

// Wrap where the first line is narrower than the rest (room for the tag).
function wrapFirstLine(s, firstW, restW, bold) {
  const words = cleanText(s).split(' ');
  const lines = [];
  let cur = '';
  let limit = firstW;
  const wOf = (t) => (bold ? textWBold(t, 1) : textW(t, 1));
  for (const wd of words) {
    const trial = cur ? cur + ' ' + wd : wd;
    if (wOf(trial) <= limit || !cur) cur = trial;
    else {
      lines.push(cur);
      cur = wd;
      limit = restW;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function storyBlock(x, y, w, st) {
  let cy = y;
  if (st.scene) {
    drawScene(st.scene, x, cy, w, 30);
    cy += 34;
  }
  // red tag + bold headline (first line shares the tag's row)
  const tagStr = st.tag + ' - ';
  const tagW = textWBold(cleanText(tagStr), 1);
  drawText(x, cy, tagStr, 1, RED, true);
  const headLines = wrapFirstLine(st.head, w - tagW, w, true);
  drawText(x + tagW, cy, headLines[0], 1, INK, true);
  cy += 8;
  for (let i = 1; i < headLines.length; i++) {
    drawText(x, cy, headLines[i], 1, INK, true);
    cy += 8;
  }
  const bodyLines = wrapText(st.body, 1, w);
  for (const ln of bodyLines) {
    drawText(x, cy, ln, 1, SOFT);
    cy += 8;
  }
  cy += 2;
  line(x, cy, x + w, cy, [206, 196, 172], 1);
  cy += 3;
  return cy - y;
}

function sectionHeader(x, y, w, text) {
  fillRect(x, y, w, 12, INK);
  fillRect(x, y, 4, 12, RED);
  drawText(x + 9, y + 2, text, 1, [246, 241, 227], true);
  return 15;
}

function drawColumn(x, y, w, blocks) {
  let cy = y;
  for (const b of blocks) {
    if (b.h) cy += sectionHeader(x, cy, w, b.h);
    else cy += storyBlock(x, cy, w, b);
  }
  return cy;
}

function drawPage() {
  fillRect(0, 0, W, H, PAPER);
  strokeRect(8, 8, W - 16, H - 16, INK, 2);
  strokeRect(13, 13, W - 26, H - 26, INK, 1);

  /* Masthead */
  fillRect(M, 20, CW, 3, INK);
  fillRect(M, 26, CW, 1, INK);
  drawCentered(W / 2, 32, 'THE THURSDAY LEDGER', 6, INK, true);
  fillRect(M, 79, CW, 1, INK);
  drawText(M, 84, 'VOL. I - NO. 327', 1, SOFT);
  drawCentered(W / 2, 84, 'THURSDAY, 26 NOVEMBER 2026', 1, INK, true);
  const rEdge = 'ONE PAGE - WORLD EDITION';
  drawText(M + CW - textW(rEdge, 1), 84, rEdge, 1, SOFT);
  fillRect(M, 95, CW, 3, INK);
  drawCentered(W / 2, 102, 'THE WORLD IN ONE DAY - 38 STORIES - 13 SCENES DRAWN - 9 HOTSPOTS MAPPED', 1, RED, true);
  fillRect(M, 113, CW, 1, INK);

  /* Stat band */
  const sbY = 119;
  const sbH = 38;
  strokeRect(M, sbY, CW, sbH, INK, 1);
  const cellW = CW / STATS.length;
  STATS.forEach(([num, label], i) => {
    const cx = M + i * cellW;
    if (i > 0) line(cx, sbY + 4, cx, sbY + sbH - 4, RULE, 1);
    drawCentered(cx + cellW / 2, sbY + 4, num, 2, NAVY, true);
    const ll = wrapText(label, 1, cellW - 10);
    ll.forEach((ln, j) => drawCentered(cx + cellW / 2, sbY + 21 + j * 8, ln, 1, SOFT));
  });

  /* Heroes */
  const hY = 165;
  const hW = (CW - 16) / 2;
  HEROES.forEach((hero, i) => {
    const hx = M + i * (hW + 16);
    drawScene(hero.scene, hx, hY, hW, 72);
    let cy = hY + 77;
    drawText(hx, cy, hero.tag, 1, RED, true);
    cy += 10;
    for (const ln of wrapText(hero.head, 2, hW, true)) {
      drawText(hx, cy, ln, 2, INK, true);
      cy += 15;
    }
    cy += 2;
    for (const ln of wrapText(hero.body, 1, hW)) {
      drawText(hx, cy, ln, 1, SOFT);
      cy += 9;
    }
  });
  line(M + hW + 8, hY, M + hW + 8, hY + 128, RULE, 1);

  /* Map + date check strip */
  const sY = 320;
  drawText(M, sY, 'THE DAY ON THE MAP - RED SQUARES MARK THE HOTSPOTS', 1, INK, true);
  drawMap(M, sY + 11, 636, 60);
  const bx = M + 652;
  const bw = CW - 652;
  strokeRect(bx, sY + 11, bw, 60, INK, 1);
  fillRect(bx, sY + 11, bw, 12, RED);
  drawText(bx + 8, sY + 13, 'DATE CHECK', 1, [246, 241, 227], true);
  const dcLines = [
    'ALL 38 STORIES DATED THU 26 NOV 2026.',
    'SOURCES: AP - REUTERS - THE GUARDIAN -',
    'AL JAZEERA - BBC. HORMUZ MINE CLAIMS',
    'CARRIED AS CLAIMS ONLY - UNVERIFIED.',
  ];
  dcLines.forEach((ln, i) => drawText(bx + 8, sY + 28 + i * 8, ln, 1, INK));
  drawText(bx + 8, sY + 62, 'CULTURE: ANDY TAYLOR DIES AT 65.', 1, SOFT);

  /* Columns */
  const cY = 404;
  const colW = 312;
  const colX = [M, M + 332, M + 664];
  line(colX[1] - 10, cY, colX[1] - 10, 972, RULE, 1);
  line(colX[2] - 10, cY, colX[2] - 10, 972, RULE, 1);
  drawColumn(colX[0], cY, colW, COL_A);
  drawColumn(colX[1], cY, colW, COL_B);
  drawColumn(colX[2], cY, colW, COL_C);

  /* Footer */
  fillRect(M, 982, CW, 3, INK);
  drawCentered(W / 2, 991, 'THE THURSDAY LEDGER - DRAWN IN CODE FROM WIRE COPY - NO PHOTOGRAPHS; EVERY SCENE DRAWN IN-PROGRAMME', 1, INK);
  drawCentered(W / 2, 1002, 'SOURCES: AP - REUTERS - THE GUARDIAN - AL JAZEERA - BBC - THURSDAY, 26 NOVEMBER 2026', 1, SOFT);
}

function main() {
  drawPage();
  const png = encodePNG(W, H, px);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'entry.png'), png);
}

main();
