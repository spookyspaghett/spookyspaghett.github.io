#!/usr/bin/env node
'use strict';

/**
 * generate-page.js
 * -----------------
 * Standalone tool (Node 18+) so you can fill in the real puzzles/answers
 * yourself without having to write any crypto code. This script is NOT part
 * of the live site -- run it locally and paste the output into the relevant
 * HTML page.
 *
 * Usage (see README.md for the full walkthrough + examples):
 *
 *   node generate-page.js --password "secret" --text "literal text"
 *   node generate-page.js --password "secret" --file page2-payload.json
 *   node generate-page.js --image path/to/photo.jpg
 *   node generate-page.js --caesar --shift 7 --text "message"
 *   node generate-page.js --xor --text "message" --key-file clublied.txt
 *   node generate-page.js --encode-stack --text "message"
 *   node generate-page.js --sha256 --text "candidate answer"
 *   node generate-page.js --base64 --text "message or URL"
 *   node generate-page.js --stego-encode --image photo.bmp --message "text" --out photo-stego.png
 *   node generate-page.js --stego-decode --image photo-stego.png
 *   node generate-page.js --spectrogram-text --text "message" --out clue.wav
 *
 * The main mode (--password + --text/--file) hashes the password (SHA-256)
 * and encrypts the given text with AES-GCM, deriving the key via PBKDF2
 * (100,000 iterations by default, fixed salt) from the password. The output
 * contains ready-to-paste JS constants for the `// FILL IN ... HERE` spot in
 * the relevant page.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { webcrypto } = require('node:crypto');
const subtle = webcrypto.subtle;

const DEFAULT_SALT = 'heimdal-arg-fixed-salt-value-2025';
const DEFAULT_ITERATIONS = 100000;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(tok);
    }
  }
  return args;
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function sha256Hex(text) {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function deriveAesKey(password, saltStr, iterations) {
  const keyMaterial = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode(saltStr), iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
}

async function encryptText(plaintext, password, saltStr, iterations) {
  const key = await deriveAesKey(password, saltStr, iterations);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return {
    ciphertextB64: bytesToBase64(new Uint8Array(ciphertext)),
    ivB64: bytesToBase64(iv),
  };
}

// ---- Caesar cipher utility (the shift key stays local only, never in the site) ----
function caesarShift(text, shift) {
  const n = ((shift % 26) + 26) % 26;
  return text.replace(/[a-zA-Z]/g, (ch) => {
    const base = ch <= 'Z' ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + n) % 26) + base);
  });
}

// ---- XOR-with-key cipher utility (the key text, e.g. the club song, stays local only) ----
function xorEncode(text, keyText) {
  const textBytes = Buffer.from(text, 'utf8');
  const keyBytes = Buffer.from(keyText, 'utf8');
  const out = [];
  for (let i = 0; i < textBytes.length; i++) {
    out.push(textBytes[i] ^ keyBytes[i % keyBytes.length]);
  }
  return out;
}

function xorDecode(numbers, keyText) {
  const keyBytes = Buffer.from(keyText, 'utf8');
  const out = Buffer.alloc(numbers.length);
  for (let i = 0; i < numbers.length; i++) {
    out[i] = numbers[i] ^ keyBytes[i % keyBytes.length];
  }
  return out.toString('utf8');
}

// ---- Encoding-stack utility: plaintext -> hex -> rot13 -> base64 ----
function rot13(text) {
  return text.replace(/[a-zA-Z]/g, (ch) => {
    const base = ch <= 'Z' ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function toHex(text) {
  return Buffer.from(text, 'utf8').toString('hex');
}

function encodeStack(text) {
  const hexStep = toHex(text);
  const rotStep = rot13(hexStep);
  const b64Step = Buffer.from(rotStep, 'utf8').toString('base64');
  return b64Step;
}

// ---- CRC32 (needed for PNG chunk checksums) ----
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---- Minimal BMP reader (24-bit uncompressed only) ----
function parseBmp(buf) {
  if (buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error('Not a BMP file.');
  const dataOffset = buf.readUInt32LE(10);
  const width = buf.readInt32LE(18);
  const heightRaw = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);
  if (bpp !== 24 || compression !== 0) {
    throw new Error(
      'Only uncompressed 24-bit BMP files are supported. Re-export your image as a 24-bit BMP first.'
    );
  }
  const height = Math.abs(heightRaw);
  const bottomUp = heightRaw > 0;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixels = Buffer.alloc(width * height * 3); // RGB, top-to-bottom, row-major
  for (let y = 0; y < height; y++) {
    const srcRow = bottomUp ? height - 1 - y : y;
    const rowStart = dataOffset + srcRow * rowSize;
    for (let x = 0; x < width; x++) {
      const srcIdx = rowStart + x * 3;
      const dstIdx = (y * width + x) * 3;
      pixels[dstIdx] = buf[srcIdx + 2]; // R (BMP stores BGR)
      pixels[dstIdx + 1] = buf[srcIdx + 1]; // G
      pixels[dstIdx + 2] = buf[srcIdx]; // B
    }
  }
  return { width, height, pixels };
}

// ---- Minimal PNG reader (8-bit RGB/RGBA, non-interlaced, any per-scanline filter) ----
function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterScanlines(raw, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filterType = raw[y * (stride + 1)];
    const srcStart = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const rawX = raw[srcStart + x];
      const a = x >= bytesPerPixel ? out[y * stride + x - bytesPerPixel] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = y > 0 && x >= bytesPerPixel ? out[(y - 1) * stride + x - bytesPerPixel] : 0;
      let value;
      switch (filterType) {
        case 0:
          value = rawX;
          break;
        case 1:
          value = (rawX + a) & 0xff;
          break;
        case 2:
          value = (rawX + b) & 0xff;
          break;
        case 3:
          value = (rawX + Math.floor((a + b) / 2)) & 0xff;
          break;
        case 4:
          value = (rawX + paethPredictor(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`Unsupported PNG filter type ${filterType}.`);
      }
      out[y * stride + x] = value;
    }
  }
  return out;
}

function parsePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG file.');
  let offset = 8;
  let width, height, bitDepth, colorType, interlace;
  const idatChunks = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 8 + len + 4;
  }
  if (bitDepth !== 8) {
    throw new Error(`Only 8-bit PNGs are supported (got bit depth ${bitDepth}). Re-export as 8-bit.`);
  }
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(
      `Only RGB or RGBA PNGs are supported (color type ${colorType}). Re-export without a palette or grayscale mode.`
    );
  }
  if (interlace !== 0) {
    throw new Error('Interlaced PNGs are not supported. Re-export as non-interlaced.');
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const unfiltered = unfilterScanlines(raw, width, height, channels);

  if (channels === 3) return { width, height, pixels: unfiltered };
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0, j = 0; i < unfiltered.length; i += 4, j += 3) {
    pixels[j] = unfiltered[i];
    pixels[j + 1] = unfiltered[i + 1];
    pixels[j + 2] = unfiltered[i + 2];
  }
  return { width, height, pixels };
}

function readImage(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return parseBmp(buf);
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return parsePng(buf);
  throw new Error('Unsupported image format -- only BMP and PNG are supported as input.');
}

// ---- Minimal PNG writer (8-bit truecolor RGB, filter type None) ----
function writePng(width, height, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function chunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 3;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + stride);
    raw[rowOffset] = 0; // filter type: None
    pixels.copy(raw, rowOffset + 1, y * stride, (y + 1) * stride);
  }
  const idatData = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idatData), chunk('IEND', Buffer.alloc(0))]);
}

// ---- LSB steganography: length-prefixed message, 1 bit per RGB color byte, row-major ----
function lsbEmbed(pixels, message) {
  const msgBytes = Buffer.from(message, 'utf8');
  const lenBytes = Buffer.alloc(4);
  lenBytes.writeUInt32BE(msgBytes.length, 0);
  const payload = Buffer.concat([lenBytes, msgBytes]);
  const totalBits = payload.length * 8;
  if (totalBits > pixels.length) {
    throw new Error(
      `Message too long for this image: need ${totalBits} bits, image only has ${pixels.length} color bytes available.`
    );
  }
  const out = Buffer.from(pixels);
  for (let i = 0; i < totalBits; i++) {
    const byteIdx = i >> 3;
    const bitIdx = 7 - (i & 7);
    const bit = (payload[byteIdx] >> bitIdx) & 1;
    out[i] = (out[i] & 0xfe) | bit;
  }
  return out;
}

function lsbExtract(pixels) {
  function bitsToInt(startBit, count) {
    let value = 0;
    for (let i = 0; i < count; i++) value = (value << 1) | (pixels[startBit + i] & 1);
    return value >>> 0;
  }
  const length = bitsToInt(0, 32);
  const msgBytes = Buffer.alloc(length);
  for (let b = 0; b < length; b++) {
    msgBytes[b] = bitsToInt(32 + b * 8, 8);
  }
  return msgBytes.toString('utf8');
}

// ---- Minimal WAV writer (mono, 16-bit PCM) ----
function writeWavPCM16(filePath, sampleRate, samples) {
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(filePath, buffer);
}

// ---- 5x7 dot-matrix font + spectrogram text synthesis ----
const FONT_5X7 = {
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '####.', '#...#', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '####.', '#....', '#....', '#....', '#####'],
  F: ['#####', '#....', '####.', '#....', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['#...#', '#...#', '#...#', '#####', '....#', '....#', '....#'],
  5: ['#####', '#....', '####.', '....#', '....#', '....#', '####.'],
  6: ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '/': ['....#', '...#.', '..#..', '..#..', '.#...', '#....', '#....'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
};

function synthesizeSpectrogramText(text, options = {}) {
  const sampleRate = options.sampleRate || 44100;
  const durationPerCol = options.durationPerCol || 0.08;
  const baseFreq = options.baseFreq || 1200;
  const freqStep = options.freqStep || 150;
  const rows = 7;

  const columns = [];
  for (const ch of text.toUpperCase()) {
    const glyph = FONT_5X7[ch] || FONT_5X7[' '];
    for (let col = 0; col < 5; col++) {
      const colBits = [];
      for (let row = 0; row < rows; row++) colBits.push(glyph[row][col] === '#' ? 1 : 0);
      columns.push(colBits);
    }
    columns.push(new Array(rows).fill(0)); // spacer between characters
  }

  const totalSamples = Math.ceil(columns.length * durationPerCol * sampleRate);
  const samples = new Float64Array(totalSamples);

  for (let colIdx = 0; colIdx < columns.length; colIdx++) {
    const colBits = columns[colIdx];
    const startSample = Math.floor(colIdx * durationPerCol * sampleRate);
    const endSample = Math.min(totalSamples, Math.floor((colIdx + 1) * durationPerCol * sampleRate));
    const colDuration = (endSample - startSample) / sampleRate;
    for (let row = 0; row < rows; row++) {
      if (!colBits[row]) continue;
      const freq = baseFreq + (rows - 1 - row) * freqStep;
      for (let s = startSample; s < endSample; s++) {
        const t = (s - startSample) / sampleRate;
        const fade = Math.max(0, Math.min(1, Math.min(t, colDuration - t) / (colDuration * 0.2 || 1)));
        samples[s] += Math.sin(2 * Math.PI * freq * t) * fade * 0.3;
      }
    }
  }

  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak > 0) {
    const scale = 0.9 / peak;
    for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  }
  return { sampleRate, samples };
}

function printBlock(lines) {
  console.log('\n// ---- Generated by generate-page.js (' + new Date().toISOString() + ') ----');
  for (const line of lines) console.log(line);
  console.log('// -----------------------------------------------------------------\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 32).join('\n'));
    return;
  }

  // --- Utility: image/audio file -> data URL (no crypto, just to paste into a JSON payload) ---
  if (args.image && !args['stego-encode'] && !args['stego-decode']) {
    const filePath = path.resolve(String(args.image));
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mimeTypes = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      svg: 'image/svg+xml',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      wav: 'audio/wav',
      mp3: 'audio/mpeg',
      ogg: 'audio/ogg',
    };
    const mime = mimeTypes[ext] || `image/${ext || 'png'}`;
    const dataUrl = `data:${mime};base64,${data.toString('base64')}`;
    printBlock([`Data URL for ${filePath}:`, dataUrl]);
    return;
  }

  // --- Utility: Caesar cipher (set the shift locally, NEVER paste it into the site) ---
  if (args.caesar) {
    if (!args.text || !args.shift) {
      console.error('Usage: node generate-page.js --caesar --shift <number> --text "<message>"');
      process.exit(1);
    }
    const shifted = caesarShift(String(args.text), parseInt(args.shift, 10));
    printBlock([
      `Caesar shift: ${args.shift} (do NOT put this value on the site, only in the club song)`,
      `Ciphertext to show on the page:`,
      shifted,
    ]);
    return;
  }

  // --- Utility: XOR-with-key cipher (e.g. the club song text as the key, NEVER on the site) ---
  if (args.xor) {
    if (!args.text || (!args.key && !args['key-file'])) {
      console.error(
        'Usage: node generate-page.js --xor --text "<message>" --key "<key text>"\n' +
          '   or: node generate-page.js --xor --text "<message>" --key-file <path>'
      );
      process.exit(1);
    }
    const keyText = args['key-file']
      ? fs.readFileSync(path.resolve(String(args['key-file'])), 'utf8')
      : String(args.key);
    const numbers = xorEncode(String(args.text), keyText);
    printBlock([
      'XOR key (do NOT put this on the site, only give players a hint toward it):',
      keyText.length > 60 ? keyText.slice(0, 60) + '...' : keyText,
      'Numbers to show on the page (comma-separated):',
      numbers.join(','),
    ]);
    return;
  }

  // --- Utility: verify an --xor result decodes back correctly ---
  if (args['xor-decode']) {
    if (!args.numbers || (!args.key && !args['key-file'])) {
      console.error(
        'Usage: node generate-page.js --xor-decode --numbers "41,11,88,..." --key "<key text>"\n' +
          '   or: node generate-page.js --xor-decode --numbers "41,11,88,..." --key-file <path>'
      );
      process.exit(1);
    }
    const keyText = args['key-file']
      ? fs.readFileSync(path.resolve(String(args['key-file'])), 'utf8')
      : String(args.key);
    const numbers = String(args.numbers)
      .split(',')
      .map((n) => parseInt(n.trim(), 10));
    printBlock(['Decoded message:', xorDecode(numbers, keyText)]);
    return;
  }

  // --- Utility: encoding-stack (hex -> rot13 -> base64) ---
  if (args['encode-stack']) {
    if (!args.text) {
      console.error('Usage: node generate-page.js --encode-stack --text "<message>"');
      process.exit(1);
    }
    const encoded = encodeStack(String(args.text));
    printBlock(['Encoding-stack result (player must peel back: base64 -> rot13 -> hex):', encoded]);
    return;
  }

  // --- Utility: plain base64 (for a simple "decode this" puzzle, e.g. an external link) ---
  if (args.base64) {
    if (!args.text) {
      console.error('Usage: node generate-page.js --base64 --text "<message or URL>"');
      process.exit(1);
    }
    const encoded = Buffer.from(String(args.text), 'utf8').toString('base64');
    printBlock(['Base64 result (player must decode this to get the answer):', encoded]);
    return;
  }

  // --- Utility: sha256 of a candidate answer (for the hash-crack page) ---
  if (args.sha256) {
    if (!args.text) {
      console.error('Usage: node generate-page.js --sha256 --text "<answer>"');
      process.exit(1);
    }
    const hash = await sha256Hex(String(args.text));
    printBlock(['SHA-256 hash to use as the target on the hash-crack page:', hash]);
    return;
  }

  // --- Utility: hide a message in an image via LSB steganography (BMP or PNG in, PNG out) ---
  if (args['stego-encode']) {
    if (!args.image || !args.message || !args.out) {
      console.error(
        'Usage: node generate-page.js --stego-encode --image <path.bmp|path.png> --message "<text>" --out <path.png>'
      );
      process.exit(1);
    }
    const { width, height, pixels } = readImage(path.resolve(String(args.image)));
    const embedded = lsbEmbed(pixels, String(args.message));
    const png = writePng(width, height, embedded);
    fs.writeFileSync(path.resolve(String(args.out)), png);
    printBlock([
      `Wrote ${args.out} (${width}x${height}) with the message hidden in the pixel LSBs.`,
      'Verify it with --stego-decode before publishing. Players extract it with the bundled',
      'stego-decoder.html tool (same LSB scheme: 32-bit big-endian length, then UTF-8 bytes,',
      '1 bit per R/G/B color byte, row-major order).',
    ]);
    return;
  }

  // --- Utility: verify a message hidden with --stego-encode ---
  if (args['stego-decode']) {
    if (!args.image) {
      console.error('Usage: node generate-page.js --stego-decode --image <path.png>');
      process.exit(1);
    }
    const { pixels } = readImage(path.resolve(String(args.image)));
    const message = lsbExtract(pixels);
    printBlock(['Extracted hidden message:', message]);
    return;
  }

  // --- Utility: hide text visually in an audio spectrogram (WAV output) ---
  if (args['spectrogram-text']) {
    if (!args.text || !args.out) {
      console.error('Usage: node generate-page.js --spectrogram-text --text "<message>" --out <path.wav>');
      process.exit(1);
    }
    const { sampleRate, samples } = synthesizeSpectrogramText(String(args.text));
    writeWavPCM16(path.resolve(String(args.out)), sampleRate, samples);
    printBlock([
      `Wrote ${args.out}.`,
      'Open it in a spectrogram view (Audacity: track dropdown -> Spectrogram; or any online',
      'spectrogram/sonogram viewer) to reveal the hidden text.',
    ]);
    return;
  }

  // --- Main mode: password hash + AES-GCM encrypted payload ---
  if (!args.password) {
    console.error(
      'Usage:\n' +
        '  node generate-page.js --password "secret" --text "literal text"\n' +
        '  node generate-page.js --password "secret" --file payload.json\n' +
        '  node generate-page.js --image path/to/photo.jpg\n' +
        '  node generate-page.js --caesar --shift 7 --text "message"\n' +
        '  node generate-page.js --xor --text "message" --key-file clublied.txt\n' +
        '  node generate-page.js --encode-stack --text "message"\n' +
        '  node generate-page.js --base64 --text "message or URL"\n' +
        '  node generate-page.js --sha256 --text "candidate answer"\n' +
        '  node generate-page.js --stego-encode --image photo.bmp --message "text" --out out.png\n' +
        '  node generate-page.js --stego-decode --image out.png\n' +
        '  node generate-page.js --spectrogram-text --text "message" --out clue.wav'
    );
    process.exit(1);
  }

  if (!args.text && !args.file) {
    console.error('Provide --text "..." or --file <path> with the content to encrypt.');
    process.exit(1);
  }

  const password = String(args.password);
  const plaintext = args.file
    ? fs.readFileSync(path.resolve(String(args.file)), 'utf8')
    : String(args.text);
  const salt = args.salt ? String(args.salt) : DEFAULT_SALT;
  const iterations = args.iterations ? parseInt(args.iterations, 10) : DEFAULT_ITERATIONS;

  const passwordHash = await sha256Hex(password);
  const { ciphertextB64, ivB64 } = await encryptText(plaintext, password, salt, iterations);

  printBlock([
    `const PASSWORD_HASH = "${passwordHash}";`,
    `const PBKDF2_SALT = "${salt}";`,
    `const PBKDF2_ITERATIONS = ${iterations};`,
    `const CIPHERTEXT = "${ciphertextB64}";`,
    `const IV = "${ivB64}";`,
  ]);
  console.log(
    'Paste these 5 lines into the page at the `// FILL IN ... HERE` spot.\n' +
      'Note: if you generate for the SAME page more than once (e.g. text + a separate payload\n' +
      'file), reuse the same password + the same --salt each time so PASSWORD_HASH and\n' +
      'PBKDF2_SALT stay identical everywhere -- only CIPHERTEXT and IV are unique per run.'
  );
}

module.exports = {
  sha256Hex,
  encryptText,
  caesarShift,
  xorEncode,
  xorDecode,
  encodeStack,
  readImage,
  parseBmp,
  parsePng,
  writePng,
  lsbEmbed,
  lsbExtract,
  writeWavPCM16,
  synthesizeSpectrogramText,
};

if (require.main === module) {
  main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
