// Herbruikbare "wachtwoordpoort"-logica die elke pagina van de keten gebruikt.
// Vereist dat heimdal-crypto.js al is ingeladen.
(function (global) {
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  // config:
  //   passwordHash, salt, iterations, ciphertext, iv  -> uit generate-page.js
  //   formSelector, passwordInputSelector, errorSelector, revealedSelector
  //   onReveal(payload, revealedEl)  -> optioneel, override voor custom weergave
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
          throw new Error('onjuist wachtwoord');
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
            link.textContent = payload.nextLabel || 'Ga verder →';
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
