#!/usr/bin/env node
'use strict';

/**
 * generate-page.js
 * -----------------
 * Los te draaien tool (Node 18+) om zelf de echte puzzels/antwoorden in te vullen
 * zonder zelf crypto-code te hoeven schrijven. Dit script is GEEN onderdeel van de
 * live site -- draai het lokaal en plak de output in de betreffende HTML-pagina.
 *
 * Gebruik (zie README.md voor volledige uitleg + voorbeelden):
 *
 *   node generate-page.js --password "geheim" --text "letterlijke tekst"
 *   node generate-page.js --password "geheim" --file pagina2-payload.json
 *   node generate-page.js --image pad/naar/foto.jpg
 *   node generate-page.js --caesar --shift 7 --text "boodschap"
 *   node generate-page.js --encode-stack --text "boodschap"
 *   node generate-page.js --sha256 --text "kandidaat-antwoord"
 *
 * De hoofdmodus (--password + --text/--file) hasht het wachtwoord (SHA-256) en
 * versleutelt de meegegeven tekst met AES-GCM, waarbij de sleutel via PBKDF2
 * (standaard 100.000 iteraties, vaste salt) wordt afgeleid van het wachtwoord.
 * De output bevat kant-en-klare JS-constanten om te plakken op de plek van
 * `// VUL HIER ... IN` in de betreffende pagina.
 */

const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const subtle = webcrypto.subtle;

const DEFAULT_SALT = 'heimdal-arg-vaste-zout-waarde-2025';
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

// ---- Caesar cipher utility (shift-key blijft alleen lokaal, nooit in de site) ----
function caesarShift(text, shift) {
  const n = ((shift % 26) + 26) % 26;
  return text.replace(/[a-zA-Z]/g, (ch) => {
    const base = ch <= 'Z' ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + n) % 26) + base);
  });
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

function printBlock(lines) {
  console.log('\n// ---- Gegenereerd door generate-page.js (' + new Date().toISOString() + ') ----');
  for (const line of lines) console.log(line);
  console.log('// -----------------------------------------------------------------\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 30).join('\n'));
    return;
  }

  // --- Utility: image -> data URL (geen crypto, gewoon om in een JSON-payload te plakken) ---
  if (args.image) {
    const filePath = path.resolve(String(args.image));
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mimeMap = { jpg: 'jpeg', svg: 'svg+xml' };
    const mime = mimeMap[ext] || ext || 'png';
    const dataUrl = `data:image/${mime};base64,${data.toString('base64')}`;
    printBlock([`Data-URL voor ${filePath}:`, dataUrl]);
    return;
  }

  // --- Utility: Caesar cipher (shift-key lokaal instellen, NOOIT in de site plakken) ---
  if (args.caesar) {
    if (!args.text || !args.shift) {
      console.error('Gebruik: node generate-page.js --caesar --shift <getal> --text "<boodschap>"');
      process.exit(1);
    }
    const shifted = caesarShift(String(args.text), parseInt(args.shift, 10));
    printBlock([
      `Caesar-shift: ${args.shift} (deze waarde NIET op de site zetten, enkel in het clublied)`,
      `Cijfertekst om op de pagina te tonen:`,
      shifted,
    ]);
    return;
  }

  // --- Utility: encoding-stack (hex -> rot13 -> base64) ---
  if (args['encode-stack']) {
    if (!args.text) {
      console.error('Gebruik: node generate-page.js --encode-stack --text "<boodschap>"');
      process.exit(1);
    }
    const encoded = encodeStack(String(args.text));
    printBlock([
      'Encoding-stack resultaat (speler moet: base64 -> rot13 -> hex terugpellen):',
      encoded,
    ]);
    return;
  }

  // --- Utility: sha256 van een kandidaat-antwoord (voor de hash-crack pagina) ---
  if (args.sha256) {
    if (!args.text) {
      console.error('Gebruik: node generate-page.js --sha256 --text "<antwoord>"');
      process.exit(1);
    }
    const hash = await sha256Hex(String(args.text));
    printBlock(['SHA-256 hash om als doelwit op de hash-crack pagina te zetten:', hash]);
    return;
  }

  // --- Hoofdmodus: wachtwoord-hash + AES-GCM versleutelde payload ---
  if (!args.password) {
    console.error(
      'Gebruik:\n' +
        '  node generate-page.js --password "geheim" --text "letterlijke tekst"\n' +
        '  node generate-page.js --password "geheim" --file payload.json\n' +
        '  node generate-page.js --image pad/naar/foto.jpg\n' +
        '  node generate-page.js --caesar --shift 7 --text "boodschap"\n' +
        '  node generate-page.js --encode-stack --text "boodschap"\n' +
        '  node generate-page.js --sha256 --text "kandidaat-antwoord"'
    );
    process.exit(1);
  }

  if (!args.text && !args.file) {
    console.error('Geef --text "..." of --file <pad> op met de inhoud die versleuteld moet worden.');
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
    'Plak deze 5 regels in de pagina op de plek van `// VUL HIER ... IN`.\n' +
      'Let op: als je meerdere keren voor DEZELFDE pagina genereert (bv. tekst + los payload-bestand),\n' +
      'gebruik dan telkens hetzelfde wachtwoord + dezelfde --salt, zodat PASSWORD_HASH en PBKDF2_SALT\n' +
      'overal identiek blijven -- alleen CIPHERTEXT en IV zijn per keer uniek.'
  );
}

main().catch((err) => {
  console.error('Fout:', err.message);
  process.exit(1);
});
