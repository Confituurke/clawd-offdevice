// Clawd mirror: turns a push-mode frame (the same draw commands AWTRIX gets)
// into a PNG, so something else - a Home Assistant MQTT camera, say - can show
// the pet. Optional; see MIRROR in the README.
//
// Only what the engine draws is supported: pixel, pixels, line, rect,
// rectFill and text, plus a payload's plain `text`. Text uses a 3x5 font
// with the same 3 px glyph + 1 px spacing as AWTRIX's small font.
//
// n8n Code nodes cannot load npm modules, so the PNG is built by hand: palette
// colour, stored (uncompressed) deflate, CRC-32 and Adler-32. Each LED is an
// 8x8 dot, so a 32x8 frame becomes a 256x64 image of about 16 KB.
'use strict';

const MIRROR_W = 32, MIRROR_H = 8, MIRROR_S = 8;
const MIRROR_BG = '#050505', MIRROR_OFF = '#161616';
const MIRROR_DOT = ['..####..', '.######.', '########', '########', '########', '########', '.######.', '..####..'];

const MIRROR_FONT = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'], '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'], '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'], 'A': ['010', '101', '111', '101', '101'], 'B': ['110', '101', '110', '101', '110'],
  'C': ['011', '100', '100', '100', '011'], 'D': ['110', '101', '101', '101', '110'], 'E': ['111', '100', '110', '100', '111'],
  'F': ['111', '100', '110', '100', '100'], 'G': ['011', '100', '101', '101', '011'], 'H': ['101', '101', '111', '101', '101'],
  'I': ['111', '010', '010', '010', '111'], 'J': ['001', '001', '001', '101', '010'], 'K': ['101', '101', '110', '101', '101'],
  'L': ['100', '100', '100', '100', '111'], 'M': ['101', '111', '111', '101', '101'], 'N': ['101', '111', '111', '111', '101'],
  'O': ['010', '101', '101', '101', '010'], 'P': ['110', '101', '110', '100', '100'], 'Q': ['010', '101', '101', '111', '011'],
  'R': ['110', '101', '110', '101', '101'], 'S': ['011', '100', '010', '001', '110'], 'T': ['111', '010', '010', '010', '010'],
  'U': ['101', '101', '101', '101', '011'], 'V': ['101', '101', '101', '010', '010'], 'W': ['101', '101', '111', '111', '101'],
  'X': ['101', '101', '010', '101', '101'], 'Y': ['101', '101', '010', '010', '010'], 'Z': ['111', '001', '010', '100', '111'],
  '%': ['101', '001', '010', '100', '101'], '?': ['111', '001', '010', '000', '010'], '.': ['000', '000', '000', '000', '010'],
  '-': ['000', '000', '111', '000', '000'], ':': ['000', '010', '000', '010', '000'], ' ': ['000', '000', '000', '000', '000']
};

function mirrorColor(c) {
  c = String(c || '#FFFFFF');
  if (c[0] !== '#') c = '#' + c;
  if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  return c.toUpperCase();
}

// Draw a payload into a 32x8 frame buffer of '#RRGGBB' strings (null = off).
function mirrorFrame(payload) {
  const fb = new Array(MIRROR_W * MIRROR_H).fill(null);
  const set = (x, y, c) => { if (x >= 0 && x < MIRROR_W && y >= 0 && y < MIRROR_H) fb[y * MIRROR_W + x] = c; };
  const text = (x, y, str, c) => {
    let cx = x;
    for (const ch of String(str).toUpperCase()) {
      const g = MIRROR_FONT[ch] || MIRROR_FONT['?'];
      for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (g[r][k] === '1') set(cx + k, y + r, c);
      cx += 4;
    }
  };
  const line = (x0, y0, x1, y1, c) => {
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (;;) {
      set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  };
  for (const d of (payload && payload.draw) || []) {
    const [cmd, ...a] = d;
    if (cmd === 'pixel') set(a[0], a[1], mirrorColor(a[2]));
    else if (cmd === 'pixels') { const c = mirrorColor(a[0]); for (let i = 1; i + 1 < a.length; i += 2) set(a[i], a[i + 1], c); }
    else if (cmd === 'line') line(a[0], a[1], a[2], a[3], mirrorColor(a[4]));
    else if (cmd === 'rectFill') {
      for (let y = a[1]; y < a[1] + a[3]; y++) for (let x = a[0]; x < a[0] + a[2]; x++) set(x, y, mirrorColor(a[4]));
    } else if (cmd === 'rect') {
      const c = mirrorColor(a[4]), x1 = a[0] + a[2] - 1, y1 = a[1] + a[3] - 1;
      line(a[0], a[1], x1, a[1], c); line(a[0], y1, x1, y1, c); line(a[0], a[1], a[0], y1, c); line(x1, a[1], x1, y1, c);
    } else if (cmd === 'text') text(a[0], a[1], a[2], mirrorColor(a[3]));
  }
  if (payload && !payload.draw && payload.text) text(0, 1, payload.text, mirrorColor(payload.textColor));
  return fb;
}

const MIRROR_CRC = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); }
  return t;
})();
function mirrorCrc32(bytes) { let c = 0xFFFFFFFF; for (const b of bytes) c = MIRROR_CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
const mirrorU32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
function mirrorChunk(type, data) {
  const body = Array.from(type, (ch) => ch.charCodeAt(0)).concat(Array.from(data));
  return mirrorU32(data.length).concat(body, mirrorU32(mirrorCrc32(body)));
}

// Frame buffer -> PNG bytes (array of numbers).
function mirrorPng(fb) {
  const palette = [MIRROR_BG, MIRROR_OFF];
  const index = (c) => { let i = palette.indexOf(c); if (i < 0) { palette.push(c); i = palette.length - 1; } return i; };
  const cells = fb.map((c) => (!c || c === '#000000') ? 1 : index(c));
  const pw = MIRROR_W * MIRROR_S, ph = MIRROR_H * MIRROR_S;
  const raw = new Uint8Array(ph * (pw + 1));
  for (let y = 0; y < ph; y++) {
    raw[y * (pw + 1)] = 0;                                  // filter: none
    for (let x = 0; x < pw; x++) {
      const lit = MIRROR_DOT[y % MIRROR_S][x % MIRROR_S] === '#';
      raw[y * (pw + 1) + 1 + x] = lit ? cells[Math.floor(y / MIRROR_S) * MIRROR_W + Math.floor(x / MIRROR_S)] : 0;
    }
  }
  const z = [0x78, 0x01];                                   // zlib, stored blocks
  for (let off = 0; off < raw.length; off += 65535) {
    const len = Math.min(65535, raw.length - off);
    z.push(off + len >= raw.length ? 1 : 0, len & 255, len >> 8, ~len & 255, (~len >> 8) & 255);
    for (let i = 0; i < len; i++) z.push(raw[off + i]);
  }
  let a = 1, b = 0;
  for (const v of raw) { a = (a + v) % 65521; b = (b + a) % 65521; }
  const plte = [];
  for (const c of palette) plte.push(parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16));
  return [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A].concat(
    mirrorChunk('IHDR', mirrorU32(pw).concat(mirrorU32(ph), [8, 3, 0, 0, 0])),
    mirrorChunk('PLTE', plte),
    mirrorChunk('IDAT', z.concat(mirrorU32(((b << 16) | a) >>> 0))),
    mirrorChunk('IEND', []));
}

const MIRROR_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function mirrorBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    s += MIRROR_B64[n >> 18] + MIRROR_B64[(n >> 12) & 63] +
      (i + 1 < bytes.length ? MIRROR_B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? MIRROR_B64[n & 63] : '=');
  }
  return s;
}

const ClawdMirror = {
  mirrorFrame, mirrorPng, mirrorBase64,
  pngBase64: (payload) => mirrorBase64(mirrorPng(mirrorFrame(payload)))
};
if (typeof module !== 'undefined' && module.exports) module.exports = ClawdMirror;
