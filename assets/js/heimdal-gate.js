// Reusable "password gate" logic used by every page in the chain.
// Requires heimdal-crypto.js to already be loaded.
(function (global) {
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  // config:
  //   passwordHash, salt, iterations, ciphertext, iv  -> from generate-page.js
  //   formSelector, passwordInputSelector, errorSelector, revealedSelector
  //   onReveal(payload, revealedEl)  -> optional, override for custom rendering
  function init(config) {
    const form = $(config.formSelector || '#gate-form');
    const errorEl = $(config.errorSelector || '#error');
    const revealedEl = $(config.revealedSelector || '#revealed');
    const passwordInput = $(config.passwordInputSelector || '#password');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const pw = passwordInput.value;
      errorEl.hidden = true;

      try {
        const hash = await HeimdalCrypto.sha256Hex(pw);
        if (hash !== config.passwordHash) {
          throw new Error('incorrect password');
        }

        const plaintext = await HeimdalCrypto.decryptText(
          config.ciphertext,
          config.iv,
          pw,
          config.salt,
          config.iterations
        );
        const payload = JSON.parse(plaintext);

        if (typeof config.onReveal === 'function') {
          config.onReveal(payload, revealedEl);
        } else {
          revealedEl.innerHTML = payload.html || '';
          if (payload.next) {
            const link = document.createElement('a');
            link.href = payload.next;
            link.className = 'next-link';
            link.textContent = payload.nextLabel || 'Continue →';
            revealedEl.appendChild(link);
          }
        }

        revealedEl.hidden = false;
        form.hidden = true;
      } catch (err) {
        errorEl.hidden = false;
      }
    });
  }

  global.HeimdalGate = { init };
})(window);
