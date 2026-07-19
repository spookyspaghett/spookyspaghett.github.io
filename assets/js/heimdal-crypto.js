// Shared crypto helpers for the Heimdal ARG site.
// Uses only the browser-native Web Crypto API (crypto.subtle) -- no external libs.
// Loaded as a plain <script> (not a module) so the site can also be tested via file://.
(function (global) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function deriveAesKey(password, saltStr, iterations) {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode(saltStr), iterations, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
  }

  // Throws an Error if the password is wrong (the AES-GCM auth tag won't match).
  async function decryptText(ciphertextB64, ivB64, password, saltStr, iterations) {
    const key = await deriveAesKey(password, saltStr, iterations);
    const iv = base64ToBytes(ivB64);
    const ciphertext = base64ToBytes(ciphertextB64);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return dec.decode(plainBuf);
  }

  global.HeimdalCrypto = { sha256Hex, deriveAesKey, decryptText, bytesToBase64, base64ToBytes };
})(window);
