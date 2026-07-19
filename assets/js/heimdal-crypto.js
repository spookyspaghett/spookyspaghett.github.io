// Gedeelde crypto-helpers voor de Heimdal ARG-site.
// Gebruikt uitsluitend de browser-native Web Crypto API (crypto.subtle) -- geen externe libs.
// Wordt als gewoon <script> (geen module) ingeladen zodat de site ook via file:// getest kan worden.
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

  // Gooit een Error als het wachtwoord fout is (AES-GCM auth tag klopt dan niet).
  async function decryptText(ciphertextB64, ivB64, password, saltStr, iterations) {
    const key = await deriveAesKey(password, saltStr, iterations);
    const iv = base64ToBytes(ivB64);
    const ciphertext = base64ToBytes(ciphertextB64);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return dec.decode(plainBuf);
  }

  global.HeimdalCrypto = { sha256Hex, deriveAesKey, decryptText, bytesToBase64, base64ToBytes };
})(window);
