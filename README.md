# Heimdal ARG

Static, client-side ARG site (no backend) that teases the upcoming year's theme through a
chain of 6 password-locked pages. Pure HTML/CSS/JS, no build step, runs directly on
GitHub Pages.

## Structure

```
index.html                  page 1 -- landing + password #1 (a Discord/Instagram clue,
                             e.g. finding a specific user's ID), reveals a riddle -> pw2
b7f2e9a1c4d8.html           page 2 -- photo with a message hidden via steganography -> pw3
3f8a6c2e9d17.html           page 3 -- Caesar cipher (shift from the club song) -> pw4
e1d4b9f6a832.html           page 4 -- SHA-256 hash hidden in the page source (View
                             Source / F12), crack it with your own word list -> pw5
9c2a7e4f1b06.html           page 5 -- text hidden in an audio spectrogram -> pw6
5d8f1a9c6e23.html           page 6 -- final teaser + a base64 code that decodes to a
                             Google Drive folder link (or wherever the real reward lives)
robots.txt                  plain, no puzzle content
assets/css/style.css        shared dark/sand theme
assets/js/heimdal-crypto.js shared Web Crypto helpers (SHA-256, PBKDF2, AES-GCM)
assets/js/heimdal-gate.js   shared password-gate logic (used by every page)
assets/tools/stego-decoder.html  standalone tool players use to extract the page-2 photo's
                             hidden message (drag an image in, get the text out)
generate-page.js            standalone Node tool to encrypt passwords/content and
                             generate puzzle assets (Caesar, hash, steganography, audio)
```

The filenames for pages 2 through 6 are deliberately unpredictable (hash-like strings,
not `page1.html` etc.). They never appear as a static link in the source -- the link to
the next page is only inserted into the DOM by JavaScript after a correct password.

## How the chain works

Every page only shows a password field. On submit:

1. The entered password is hashed (SHA-256) and compared against the stored hash.
2. On a match, an AES-GCM key is derived from that same password via PBKDF2 (fixed salt,
   100,000+ iterations), and that page's encrypted payload is decrypted.
3. The payload is JSON: `{ "html": "...", "next": "filename.html", "nextLabel": "..." }`.
   The `html` is shown on the page (this is the puzzle/content for that page), and the
   link to the next page is only now added via JS.
4. The player solves the puzzle in the displayed `html` (steganography, Caesar decode,
   cracking a hidden hash, reading an audio spectrogram, or decoding base64) to find the
   password for the *next* page (or, on the last page, the link to the real reward).

**No plaintext password ever sits in the code.** Only SHA-256 hashes and AES-GCM
ciphertext live in the repo -- both are useless without the right password.

Password #1 on `index.html` is already wired to a real value (see the comment in that
file for where it's supposed to come from). Pages 2 through 6 still contain a **working
test chain** so you can verify the mechanics before filling in the real puzzles. Because
this repo is public, the test passwords for pages 2-6 are **not** written in this file or
in code comments -- ask whoever set up the site, or generate your own test chain with
`generate-page.js` (see below). Every spot you need to edit is marked with a
`// FILL IN ... HERE` comment in the HTML files.

## Testing locally

You need to view the site through a local server -- not by opening the HTML files
directly (`file://`), since a few things (relative links to `assets/tools/`, and in
general anything that behaves differently under `file://`) work more reliably over HTTP.

With Node (already required for `generate-page.js`):

```bash
npx serve .
# or
npx http-server .
```

Or with Python:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/` (or whichever port the tool reports) and walk the
chain with your test passwords.

## Using `generate-page.js`

Requires Node.js 18+ (uses the built-in `node:crypto` webcrypto implementation, no
dependencies). Only ever run this script locally -- it is not part of the live site.

### 1. Generate a password hash + encrypted payload (main mode)

```bash
node generate-page.js --password "my-real-password" --text "literal content"
# or, for longer/JSON content:
node generate-page.js --password "my-real-password" --file payload.json
```

`payload.json` must be exactly the JSON the page expects, for example:

```json
{
  "html": "<p>Your puzzle text here...</p>",
  "next": "3f8a6c2e9d17.html",
  "nextLabel": "Follow the trail →"
}
```

The output contains 5 ready-to-paste `const` lines
(`PASSWORD_HASH`, `PBKDF2_SALT`, `PBKDF2_ITERATIONS`, `CIPHERTEXT`, `IV`) that you paste
at the `// FILL IN ... HERE` spot in the corresponding HTML page.

> If you generate for the same page more than once (e.g. you tweak the text), reuse the
> same password and the same `--salt` each time so `PASSWORD_HASH` doesn't accidentally
> change.

### 2. Convert an image or audio file to a data URL (for pages 2 and 5)

```bash
node generate-page.js --image path/to/file.png
node generate-page.js --image path/to/clue.wav
```

Prints a `data:image/...;base64,...` or `data:audio/...;base64,...` string (mime type is
guessed from the file extension). Paste that into an `<img src="...">` or
`<audio controls src="...">` inside the `html` field of your payload JSON, and encrypt
that JSON as in step 1.

### 3. Hide a message in a photo (steganography, for page 2)

```bash
node generate-page.js --stego-encode --image your-photo.bmp --message "password for the next page" --out stego.png
node generate-page.js --stego-decode --image stego.png   # verify before publishing
```

Input can be a 24-bit BMP or an 8-bit RGB/RGBA PNG (non-interlaced); output is always a
PNG. The message is hidden 1 bit per red/green/blue color byte (a 32-bit length prefix,
then the UTF-8 bytes, row by row) -- invisible to the eye, but not encrypted on its own,
so only ship it inside the AES-encrypted payload, never as a plain file. Turn the output
into a data URL with step 2 and embed it in an `<img>` in page 2's payload.

Players extract the hidden text themselves with `assets/tools/stego-decoder.html`
(already linked from page 2's revealed content) -- they just drop the image in.

### 4. Generate Caesar ciphertext (for page 3)

The shift value comes from the club song and is **nowhere** in the site -- only in this
local command:

```bash
node generate-page.js --caesar --shift 7 --text "password for the next page"
```

Paste the printed ciphertext into the `html` of page 3's payload JSON (e.g. in a
`<pre>`), and encrypt that JSON with step 1.

### 5. Generate a SHA-256 target hidden in the page source (for page 4)

```bash
node generate-page.js --sha256 --text "answer from our codex/history"
```

Paste the hash into page 4's payload as an HTML comment (`<!-- target-hash: ... -->`)
rather than visible text, so players have to check View Source or the DevTools Elements
panel (F12) to find it, then crack it with their own word list.

### 6. Hide text in an audio spectrogram (for page 5)

```bash
node generate-page.js --spectrogram-text --text "password for the next page" --out clue.wav
```

Writes a WAV file where the text is drawn as tones across frequency and time -- silent to
casual listening, but legible as blocky letters when viewed in a spectrogram (e.g.
Audacity: track dropdown -> Spectrogram, or any online spectrogram viewer). Turn it into
a data URL with step 2 and embed it in an `<audio controls>` element in page 5's payload.

### 7. Base64-encode a link or message (for the finale)

```bash
node generate-page.js --base64 --text "https://drive.google.com/drive/folders/YOUR_REAL_FOLDER_ID"
```

Paste the result into a `<pre>` in the finale payload; players decode it themselves
(browser console `atob(...)`, or any online base64 tool) to get the real link to
whatever comes next.

## Placeholders you need to fill in

| Spot | What |
|---|---|
| `index.html` | Real password #1 is wired in; replace the placeholder riddle with your own |
| `b7f2e9a1c4d8.html` | Real steganography photo + crypto constants |
| `3f8a6c2e9d17.html` | Real Caesar ciphertext (shift from the club song) + crypto constants |
| `e1d4b9f6a832.html` | Real SHA-256 target (hidden in an HTML comment) + hint text + crypto constants |
| `9c2a7e4f1b06.html` | Real spectrogram audio clue + crypto constants |
| `5d8f1a9c6e23.html` | Final teaser text/photo/video in `.teaser-placeholder` + real base64 link code + crypto constants |

Every spot is marked with `// FILL IN ... HERE` (or the JSON equivalent) in the code.

## Going live on GitHub Pages

1. Push this repo to `<username>.github.io` (or a regular repo + Pages setting).
2. Make sure all test content/passwords for pages 2-6 have been replaced with the real
   versions (see above) before you go live.
3. Go to **Settings -> Pages** in the GitHub repo, pick the branch (usually `main`) and
   the `/ (root)` folder.
4. After a few minutes the site is live at `https://<username>.github.io/` (or your
   custom domain if you set one up).

## Security notes

- No plaintext password ever sits in the repo -- only SHA-256 hashes.
- All page content (text/photo/audio) is AES-GCM encrypted; the key is derived per page
  via PBKDF2 from that page's own password. Without the right password, the ciphertext in
  the repo is worthless. Steganography and Caesar/base64 encoding are not encryption on
  their own -- they only become part of the puzzle chain once wrapped in the AES payload.
- The salt is public (it's in the code) -- that's normal for PBKDF2. The security comes
  from the high iteration count and the entropy of your passwords, not from keeping the
  salt secret.
- Pick passwords that aren't trivial to guess once a player knows it's this ARG. The test
  chain currently in pages 2-6 is purely for local testing and should not stay in the
  live/public version.
- Never write a real or test answer anywhere (README, comments, commit messages) -- this
  repo is public, so anything you type here is readable by everyone.
