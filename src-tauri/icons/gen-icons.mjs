// Self-contained icon generator — no external deps.
// Generates a rounded-pill icon on a transparent background as PNG, plus an
// .ico and .icns placeholder. Run with: node src-tauri/icons/gen-icons.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = __dirname;

// ---- minimal PNG encoder (RGBA) -------------------------------------------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // add filter byte (0) at start of each row
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- draw a rounded-rect pill on transparent -----------------------------
function makePillRGBA(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  // pill: fully rounded ends, width 78% of size, height 34% of size
  const w = size * 0.82;
  const h = size * 0.40;
  const r = h / 2; // fully rounded
  const left = cx - w / 2;
  const right = cx + w / 2;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  const outerR = r + size * 0.012; // soft edge

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // signed distance to the pill shape (approx via distance to capsule centerline)
      // clamp point onto the segment between the two circle centers
      const px = Math.max(left + r, Math.min(x, right - r));
      const py = cy;
      const d = Math.hypot(x - px, y - py);
      let alpha = 0;
      if (d <= r - 1) alpha = 255;
      else if (d <= r + 1.5) alpha = Math.round(255 * (r + 1.5 - d) / 2.5);
      const i = (y * size + x) * 4;
      // near-black pill with a subtle blue tint, gradient left->right
      const t = (x - left) / w;
      buf[i] = Math.round(8 + 22 * t); // R
      buf[i + 1] = Math.round(8 + 14 * t); // G
      buf[i + 2] = Math.round(12 + 40 * t); // B
      buf[i + 3] = alpha;
    }
  }
  // small green "live" dot on the left
  const dotR = size * 0.045;
  const dx = cx - w * 0.32;
  const dy = cy;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - dx, y - dy);
      if (d <= dotR) {
        const i = (y * size + x) * 4;
        buf[i] = 74;
        buf[i + 1] = 222;
        buf[i + 2] = 128;
        buf[i + 3] = 255;
      }
    }
  }
  return buf;
}

// ---- ICO (wraps one PNG) ---------------------------------------------------
function makeICO(pngs) {
  // pngs: array of {size, png}
  const count = pngs.length;
  const headerSize = 6 + count * 16;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type ICO
  header.writeUInt16LE(count, 4);
  const dir = [];
  const blobs = [];
  let offset = headerSize;
  for (const { size, png } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    dir.push(e);
    blobs.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, ...dir, ...blobs]);
}

// ---- ICNS (minimal, single png in ic07) -----------------------------------
function makeICNS(png) {
  const magic = Buffer.from("icns", "ascii");
  const type = Buffer.from("ic07", "ascii"); // 128x32 png
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32BE(png.length + 8, 0);
  const body = Buffer.concat([type, sizeBuf, png]);
  const total = Buffer.alloc(4);
  total.writeUInt32BE(body.length + 8, 0);
  return Buffer.concat([magic, total, body]);
}

// ---- generate --------------------------------------------------------------
const sizes = [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
  ["Square30x30Logo.png", 30],
  ["Square44x44Logo.png", 44],
  ["Square71x71Logo.png", 71],
  ["Square89x89Logo.png", 89],
  ["Square107x107Logo.png", 107],
  ["Square142x142Logo.png", 142],
  ["Square150x150Logo.png", 150],
  ["Square284x284Logo.png", 284],
  ["Square310x310Logo.png", 310],
  ["StoreLogo.png", 50],
];
for (const [name, size] of sizes) {
  const rgba = makePillRGBA(size);
  writeFileSync(join(outDir, name), encodePNG(size, size, rgba));
  console.log("wrote", name);
}

const ico = makeICO([
  { size: 16, png: encodePNG(16, 16, makePillRGBA(16)) },
  { size: 32, png: encodePNG(32, 32, makePillRGBA(32)) },
  { size: 48, png: encodePNG(48, 48, makePillRGBA(48)) },
  { size: 64, png: encodePNG(64, 64, makePillRGBA(64)) },
  { size: 128, png: encodePNG(128, 128, makePillRGBA(128)) },
  { size: 256, png: encodePNG(256, 256, makePillRGBA(256)) },
]);
writeFileSync(join(outDir, "icon.ico"), ico);
console.log("wrote icon.ico");

const icnsPng = encodePNG(128, 128, makePillRGBA(128));
writeFileSync(join(outDir, "icon.icns"), makeICNS(icnsPng));
console.log("wrote icon.icns");

console.log("\nDone generating icons in", outDir);
