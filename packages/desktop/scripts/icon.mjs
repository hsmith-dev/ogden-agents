// The app icon's source image (story 13.8): the product mark of the web UI (an ink square with an
// "O"), drawn here as a 1024 by 1024 PNG with soft edges and the margin macOS icons have, so the
// repository holds no binary. `tauri icon <this file>` makes every size and format from it.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZE = 1024;
const INK = [31, 29, 26];
const CREAM = [244, 240, 232];
/** The square's half width (the usual 824 of 1024 content area) and corner radius. */
const HALF = 412;
const RADIUS = 186;
/** The "O": a ring around the centre. */
const RING_RADIUS = 232;
const RING_HALF_WIDTH = 46;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Signed distance from a point to a rounded box centred on the origin (negative inside). */
function roundedBox(x, y) {
  const qx = Math.abs(x) - (HALF - RADIUS);
  const qy = Math.abs(y) - (HALF - RADIUS);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - RADIUS;
}

/** The icon as RGBA bytes, `SIZE * SIZE * 4`. */
export function iconPixels() {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x + 0.5 - SIZE / 2;
      const dy = y + 0.5 - SIZE / 2;
      const shape = clamp01(0.5 - roundedBox(dx, dy));
      const ring = clamp01(0.5 - (Math.abs(Math.hypot(dx, dy) - RING_RADIUS) - RING_HALF_WIDTH));
      const o = (y * SIZE + x) * 4;
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(INK[c] + (CREAM[c] - INK[c]) * ring);
      px[o + 3] = Math.round(shape * 255);
    }
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (/** @type {Buffer} */ buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (/** @type {string} */ type, /** @type {Buffer} */ data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};

/**
 * Encodes RGBA pixels as a PNG.
 * @param {Buffer} pixels
 */
export function encodePng(pixels, size = SIZE) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Writes the icon source PNG. */
export function writeIconPng(/** @type {string} */ file) {
  writeFileSync(file, encodePng(iconPixels()));
}
