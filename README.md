# Heimdal ARG

Statische, client-side ARG-site (geen backend) die het jaarthema teasert via een keten
van 6 wachtwoord-vergrendelde pagina's. Puur HTML/CSS/JS, geen build step, draait direct
op GitHub Pages.

## Structuur

```
index.html                 pagina 1 -- landing + wachtwoord #1 (extern bekendgemaakt)
b7f2e9a1c4d8.html           pagina 2 -- foto + Caesar cipher (shift uit het clublied)
3f8a6c2e9d17.html           pagina 3 -- encoding-stack (hex -> ROT13 -> base64)
e1d4b9f6a832.html           pagina 4 -- SHA-256 hash-crack
9c2a7e4f1b06.html           pagina 5 -- devtools puzzel (robots.txt + Network-tab)
5d8f1a9c6e23.html           pagina 6 -- finale teaser
robots.txt                  bevat fragment A voor de pagina 5-puzzel
assets/css/style.css        gedeeld donker/zand thema
assets/js/heimdal-crypto.js gedeelde Web Crypto helpers (SHA-256, PBKDF2, AES-GCM)
assets/js/heimdal-gate.js   gedeelde wachtwoordpoort-logica (door elke pagina gebruikt)
assets/data/seismograaf.json bevat fragment B voor de pagina 5-puzzel (alleen zichtbaar
                             via de Network-tab, niet gelinkt in de UI)
generate-page.js            los te draaien Node-tool om wachtwoorden/content te versleutelen
```

De bestandsnamen van pagina 2 t/m 6 zijn bewust niet-voorspelbaar (hash-achtige strings,
geen `pagina1.html` etc.). Ze staan nergens als statische link in de broncode -- elke
link naar de volgende pagina wordt pas na een correct wachtwoord door JavaScript in de
DOM gezet.

## Hoe de keten werkt

Elke pagina toont alleen een wachtwoordveld. Bij het indienen:

1. Het ingevoerde wachtwoord wordt gehasht (SHA-256) en vergeleken met de opgeslagen hash.
2. Bij een match wordt een AES-GCM sleutel afgeleid van datzelfde wachtwoord via PBKDF2
   (vaste salt, 100.000+ iteraties) en wordt de versleutelde payload van die pagina
   ontsleuteld.
3. De payload is JSON: `{ "html": "...", "next": "bestandsnaam.html", "nextLabel": "..." }`.
   De `html` wordt in de pagina getoond (dit is de puzzel/inhoud voor die pagina), en de
   link naar de volgende pagina wordt pas nu, via JS, toegevoegd.
4. De speler lost de puzzel in de getoonde `html` op (Caesar-decode, encoding-stack
   afpellen, hash kraken, of de devtools-puzzel) om het wachtwoord voor de *volgende*
   pagina te vinden.

**Nergens staat een plaintext-wachtwoord in de code.** Alleen SHA-256 hashes en AES-GCM
ciphertext staan in de repo -- die zijn nutteloos zonder het juiste wachtwoord.

Op dit moment bevat elke pagina een **werkende testketen** (gegenereerd met
`generate-page.js`) zodat je kan verifiëren dat de crypto-pipeline werkt voor je de
echte puzzels invult. Omdat deze repo publiek is, staan de testwachtwoorden **niet** in
dit bestand of in code-comments -- vraag ze na bij wie de site heeft opgezet, of genereer
zelf een eigen testketen met `generate-page.js` (zie hieronder) en test daarmee. Vervang
alles door je echte puzzels/antwoorden zodra je zover bent. Alle plekken die je moet
aanpassen zijn gemarkeerd met `// VUL HIER ... IN` commentaar in de HTML-bestanden.

## Lokaal testen

Omdat pagina 5 een `fetch()`-call doet (nodig voor de devtools-puzzel), moet je de site
via een lokale server bekijken -- niet door de HTML-bestanden direct te openen
(`file://`), want browsers blokkeren `fetch()` naar lokale bestanden onder `file://`.

Met Node (al vereist voor `generate-page.js`):

```bash
npx serve .
# of
npx http-server .
```

Of met Python:

```bash
python -m http.server 8000
```

Open daarna `http://localhost:8000/` (of de poort die de tool meldt) en loop de keten
door met je testwachtwoorden. Gebruik de DevTools Network-tab op pagina 5 om te
controleren dat `assets/data/seismograaf.json` zichtbaar is, en bekijk `robots.txt` in de
browser om fragment A te zien.

## `generate-page.js` gebruiken

Vereist Node.js 18+ (gebruikt de ingebouwde `node:crypto` webcrypto-implementatie, geen
dependencies). Dit script draai je alleen lokaal -- het is geen onderdeel van de site.

### 1. Wachtwoord-hash + versleutelde payload genereren (hoofdmodus)

```bash
node generate-page.js --password "mijn-echte-wachtwoord" --text "letterlijke inhoud"
# of, voor langere/JSON-inhoud:
node generate-page.js --password "mijn-echte-wachtwoord" --file payload.json
```

`payload.json` moet de exacte JSON zijn die de pagina verwacht, bijvoorbeeld:

```json
{
  "html": "<p>Je puzzeltekst hier...</p>",
  "next": "3f8a6c2e9d17.html",
  "nextLabel": "Volg het spoor →"
}
```

De output bevat 5 kant-en-klare `const`-regels
(`PASSWORD_HASH`, `PBKDF2_SALT`, `PBKDF2_ITERATIONS`, `CIPHERTEXT`, `IV`) die je plakt op
de plek van `// VUL HIER ... IN` in de bijbehorende HTML-pagina.

> Genereer je voor dezelfde pagina meerdere keren (bv. je past de tekst nog aan), gebruik
> dan telkens hetzelfde wachtwoord en dezelfde `--salt` zodat `PASSWORD_HASH` niet per
> ongeluk verandert.

### 2. Foto omzetten naar data-URL (voor pagina 2)

```bash
node generate-page.js --image pad/naar/foto.jpg
```

Print een `data:image/...;base64,...` string. Plak die in een `<img src="...">` binnen je
`html`-veld van de payload-JSON, en versleutel die JSON zoals hierboven.

### 3. Caesar-cijfertekst genereren (voor pagina 2)

De shift-waarde komt uit het clublied en staat **nergens** in de site -- alleen in dit
lokale commando:

```bash
node generate-page.js --caesar --shift 7 --text "wachtwoord van de volgende pagina"
```

Plak de geprinte cijfertekst in de `html` van pagina 2's payload-JSON (bv. in een
`<pre>`), en versleutel die JSON met stap 1.

### 4. Encoding-stack genereren (voor pagina 3)

```bash
node generate-page.js --encode-stack --text "wachtwoord van de volgende pagina"
```

Past hex -> ROT13 -> base64 toe. Spelers moeten dit terugpellen (base64 decoderen, dan
ROT13, dan hex decoderen) om het wachtwoord te vinden.

### 5. SHA-256 doelwit genereren (voor pagina 4)

```bash
node generate-page.js --sha256 --text "antwoord uit onze codex/geschiedenis"
```

Plak de hash in de `html` van pagina 4's payload (het doelwit dat spelers moeten kraken).

## Placeholders die je zelf moet invullen

| Plek | Wat |
|---|---|
| `index.html` | Cryptische zin/afbeelding + echte `PASSWORD_HASH`/`CIPHERTEXT` voor wachtwoord #1 |
| `b7f2e9a1c4d8.html` | Echte foto + Caesar-cijfertekst (shift uit clublied) + echte crypto-constanten |
| `3f8a6c2e9d17.html` | Echte encoding-stack boodschap + crypto-constanten |
| `e1d4b9f6a832.html` | Echte SHA-256 doelwit + hint-tekst + crypto-constanten |
| `9c2a7e4f1b06.html` | Crypto-constanten (hint-tekst verwijst al naar robots.txt + Network-tab) |
| `5d8f1a9c6e23.html` | Finale teaser-tekst/foto/video in de `.teaser-placeholder` sectie + crypto-constanten |
| `robots.txt` | Fragment A (comment onderaan) |
| `assets/data/seismograaf.json` | Fragment B (`"fragment"` veld) |

Elke plek is gemarkeerd met `// VUL HIER ... IN` (of het JSON-equivalent) in de code.

## Live op GitHub Pages

1. Push deze repo naar `<gebruiker>.github.io` (of een gewone repo + Pages-instelling).
2. Zorg dat alle wachtwoorden/content vervangen zijn door de echte versies (zie hierboven)
   voordat je live gaat -- de testketen is alleen bedoeld om lokaal te verifiëren dat
   alles werkt, niet om live te blijven staan.
3. Ga naar **Settings -> Pages** in de GitHub-repo, kies de branch (meestal `main`) en map
   `/ (root)`.
4. Na een paar minuten is de site live op `https://<gebruiker>.github.io/` (of je custom
   domain als je die instelt).
5. GitHub Pages serveert alles static, dus de `fetch()`-puzzel op pagina 5 werkt daar
   vanzelf (geen CORS-probleem zoals bij `file://` lokaal).

## Beveiligingsnotities

- Er staat geen enkel plaintext-wachtwoord in de repo -- alleen SHA-256 hashes.
- Alle pagina-inhoud (tekst/foto) is AES-GCM versleuteld; de sleutel wordt per pagina via
  PBKDF2 afgeleid van het wachtwoord van die pagina zelf. Zonder het juiste wachtwoord is
  de ciphertext in de repo waardeloos.
- De salt is publiek (staat in de code) -- dat is normaal voor PBKDF2. De veiligheid zit
  in de hoge iteratiecount + de entropie van je wachtwoorden, niet in het geheim houden
  van de salt.
- Kies wachtwoorden die niet triviaal te raden zijn zodra een speler weet dat het om deze
  ARG gaat. De testketen die nu in de code zit is puur voor lokaal testen en hoort niet
  in de live/publieke versie te blijven staan.
- Schrijf nergens (README, comments, commit messages) een echt of test-antwoord uit --
  deze repo is publiek, dus alles wat je hier typt is voor iedereen leesbaar.
