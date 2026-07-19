# Heimdal ARG

Static, client-side ARG site (no backend) that teases the upcoming year's theme through a
chain of 6 password-locked pages. Pure HTML/CSS/JS, no build step, runs directly on
GitHub Pages.

## Structure

```
index.html                  page 1 -- landing + password #1 (announced externally)
b7f2e9a1c4d8.html           page 2 -- photo + Caesar cipher (shift from the club song)
3f8a6c2e9d17.html           page 3 -- encoding stack (hex -> ROT13 -> base64)
e1d4b9f6a832.html           page 4 -- SHA-256 hash crack
9c2a7e4f1b06.html           page 5 -- devtools puzzle (robots.txt + Network tab)
5d8f1a9c6e23.html           page 6 -- final teaser
robots.txt                  contains fragment A for the page 5 puzzle
assets/css/style.css        shared dark/sand theme
assets/js/heimdal-crypto.js shared Web Crypto helpers (SHA-256, PBKDF2, AES-GCM)
assets/js/heimdal-gate.js   shared password-gate logic (used by every page)
assets/data/seismograph.json contains fragment B for the page 5 puzzle (only visible
                             via the Network tab, not linked in the UI)
generate-page.js            standalone Node tool to encrypt passwords/content
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
4. The player solves the puzzle in the displayed `html` (Caesar decode, peeling back the
   encoding stack, cracking the hash, or the devtools puzzle) to find the password for
   the *next* page.

**No plaintext password ever sits in the code.** Only SHA-256 hashes and AES-GCM
ciphertext live in the repo -- both are useless without the right password.

Right now every page contains a **working test chain** (generated with
`generate-page.js`) so you can verify the crypto pipeline works before filling in the
real puzzles. Because this repo is public, the test passwords are **not** written in
this file or in code comments -- ask whoever set up the site, or generate your own test
chain with `generate-page.js` (see below) and test with that. Replace everything with
your real puzzles/answers once you're ready. Every spot you need to edit is marked with
a `// FILL IN ... HERE` comment in the HTML files.

## Testing locally

Because page 5 makes a `fetch()` call (needed for the devtools puzzle), you need to view
the site through a local server -- not by opening the HTML files directly (`file://`),
since browsers block `fetch()` to local files under `file://`.

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
chain with your test passwords. Use the DevTools Network tab on page 5 to confirm
`assets/data/seismograph.json` is visible, and check `robots.txt` in the browser to see
fragment A.

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

### 2. Convert a photo to a data URL (for page 2)

```bash
node generate-page.js --image path/to/photo.jpg
```

Prints a `data:image/...;base64,...` string. Paste that into an `<img src="...">` inside
the `html` field of your payload JSON, and encrypt that JSON as above.

### 3. Generate Caesar ciphertext (for page 2)

The shift value comes from the club song and is **nowhere** in the site -- only in this
local command:

```bash
node generate-page.js --caesar --shift 7 --text "password for the next page"
```

Paste the printed ciphertext into the `html` of page 2's payload JSON (e.g. in a
`<pre>`), and encrypt that JSON with step 1.

### 4. Generate the encoding stack (for page 3)

```bash
node generate-page.js --encode-stack --text "password for the next page"
```

Applies hex -> ROT13 -> base64. Players must peel this back (base64 decode, then ROT13,
then hex decode) to find the password.

### 5. Generate a SHA-256 target (for page 4)

```bash
node generate-page.js --sha256 --text "answer from our codex/history"
```

Paste the hash into the `html` of page 4's payload (the target players must crack).

## Placeholders you need to fill in

| Spot | What |
|---|---|
| `index.html` | Cryptic sentence/image + real `PASSWORD_HASH`/`CIPHERTEXT` for password #1 |
| `b7f2e9a1c4d8.html` | Real photo + Caesar ciphertext (shift from the club song) + real crypto constants |
| `3f8a6c2e9d17.html` | Real encoding-stack message + crypto constants |
| `e1d4b9f6a832.html` | Real SHA-256 target + hint text + crypto constants |
| `9c2a7e4f1b06.html` | Crypto constants (hint text already points to robots.txt + Network tab) |
| `5d8f1a9c6e23.html` | Final teaser text/photo/video in the `.teaser-placeholder` section + crypto constants |
| `robots.txt` | Fragment A (comment at the bottom) |
| `assets/data/seismograph.json` | Fragment B (the `"fragment"` field) |

Every spot is marked with `// FILL IN ... HERE` (or the JSON equivalent) in the code.

## Going live on GitHub Pages

1. Push this repo to `<username>.github.io` (or a regular repo + Pages setting).
2. Make sure all passwords/content have been replaced with the real versions (see above)
   before you go live -- the test chain is only meant to verify locally that everything
   works, not to stay live.
3. Go to **Settings -> Pages** in the GitHub repo, pick the branch (usually `main`) and
   the `/ (root)` folder.
4. After a few minutes the site is live at `https://<username>.github.io/` (or your
   custom domain if you set one up).
5. GitHub Pages serves everything statically, so the `fetch()` puzzle on page 5 just
   works there (no CORS issue like locally under `file://`).

## Security notes

- No plaintext password ever sits in the repo -- only SHA-256 hashes.
- All page content (text/photo) is AES-GCM encrypted; the key is derived per page via
  PBKDF2 from that page's own password. Without the right password, the ciphertext in
  the repo is worthless.
- The salt is public (it's in the code) -- that's normal for PBKDF2. The security comes
  from the high iteration count and the entropy of your passwords, not from keeping the
  salt secret.
- Pick passwords that aren't trivial to guess once a player knows it's this ARG. The test
  chain currently in the code is purely for local testing and should not stay in the
  live/public version.
- Never write a real or test answer anywhere (README, comments, commit messages) -- this
  repo is public, so anything you type here is readable by everyone.
