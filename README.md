# Heimdal ARG

Static, client-side ARG site (no backend) that teases the upcoming year's theme through a
chain of 6 password-locked pages. Pure HTML/CSS/JS, no build step, runs directly on
GitHub Pages.

This is a public repository, so this README intentionally does **not** describe how any
individual page's puzzle works, what technique it uses, or what the real or test
passwords are. That information lives only in the comments of the specific page you're
editing (visible once you already have that page open to work on it) and in
`generate-page.js --help`, not here.

## Structure

```
index.html                  page 1 -- landing, password field
b7f2e9a1c4d8.html            page 2
3f8a6c2e9d17.html            page 3
e1d4b9f6a832.html            page 4
9c2a7e4f1b06.html            page 5
5d8f1a9c6e23.html            page 6 -- final page
robots.txt                   plain, no puzzle content
assets/css/style.css         shared dark/sand theme
assets/js/heimdal-crypto.js  shared Web Crypto helpers (SHA-256, PBKDF2, AES-GCM)
assets/js/heimdal-gate.js    shared password-gate logic (used by every page)
assets/tools/                supporting tools linked from specific pages when needed
generate-page.js             standalone Node tool to encrypt passwords/content and
                              generate puzzle assets -- run `--help` for the full list
```

The filenames for pages 2 through 6 are deliberately unpredictable (hash-like strings,
not `page1.html` etc.). They never appear as a static link in the source -- the link to
the next page is only inserted into the DOM by JavaScript after a correct password.

## How the password gate works

Every page only shows a password field. On submit:

1. The entered password is hashed (SHA-256) and compared against the stored hash.
2. On a match, an AES-GCM key is derived from that same password via PBKDF2 (fixed salt,
   100,000+ iterations), and that page's encrypted payload is decrypted.
3. The payload is JSON: `{ "html": "...", "next": "filename.html", "nextLabel": "..." }`.
   The `html` is shown on the page, and the link to the next page is only now added via
   JS.

**No plaintext password ever sits in the code.** Only SHA-256 hashes and AES-GCM
ciphertext live in the repo -- both are useless without the right password. This applies
uniformly to every page regardless of what its specific puzzle is.

Some pages already have their real password wired in; others still contain a working
test chain so you can verify the site functions before filling in the real puzzle. Every
spot you need to edit is marked with a `// FILL IN ... HERE` comment in that page's own
file -- open the page you're working on to see what it needs and how to regenerate it.

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
chain with your passwords.

## Using `generate-page.js`

Requires Node.js 18+ (uses the built-in `node:crypto` webcrypto implementation, no
dependencies). Only ever run this script locally -- it is not part of the live site.

```bash
node generate-page.js --help
```

prints the full list of available commands. The core one is:

```bash
node generate-page.js --password "my-real-password" --file payload.json
```

which hashes the password and AES-GCM-encrypts the payload, printing 5 ready-to-paste
`const` lines (`PASSWORD_HASH`, `PBKDF2_SALT`, `PBKDF2_ITERATIONS`, `CIPHERTEXT`, `IV`)
for the `// FILL IN ... HERE` spot in that page. `payload.json` must match the JSON
shape that page's script expects -- see the comment in that specific page's `<script>`
block for the exact fields and, where relevant, the command to generate that page's
puzzle content before encrypting it.

> If you generate for the same page more than once, reuse the same password and the
> same `--salt` each time so `PASSWORD_HASH` doesn't accidentally change.

## Placeholders you need to fill in

Open each HTML page and look for its `// FILL IN ... HERE` comment block -- it explains
exactly what that page needs and which `generate-page.js` command to run. Replace any
remaining test content with your real puzzle/password before the site goes live.

## Going live on GitHub Pages

1. Push this repo to `<username>.github.io` (or a regular repo + Pages setting).
2. Make sure all test content/passwords have been replaced with the real versions before
   you go live.
3. Go to **Settings -> Pages** in the GitHub repo, pick the branch (usually `main`) and
   the `/ (root)` folder.
4. After a few minutes the site is live at `https://<username>.github.io/` (or your
   custom domain if you set one up).

## Security notes

- No plaintext password ever sits in the repo -- only SHA-256 hashes.
- All page content is AES-GCM encrypted; the key is derived per page via PBKDF2 from that
  page's own password. Without the right password, the ciphertext in the repo is
  worthless. Any additional encoding a specific page's puzzle uses is not encryption on
  its own -- it only becomes part of the puzzle chain once wrapped in the AES payload.
- The salt is public (it's in the code) -- that's normal for PBKDF2. The security comes
  from the high iteration count and the entropy of your passwords, not from keeping the
  salt secret.
- Pick real passwords that aren't trivial to guess once a player knows it's this ARG.
- Never write a real or test password, or a description of how a specific puzzle works,
  anywhere that isn't strictly needed (not in this README, not in commit messages) --
  this repo is public, so anything you type here is readable by everyone.
