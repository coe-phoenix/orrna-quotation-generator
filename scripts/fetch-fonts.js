/* Downloads the metric-compatible open fonts at install time.
   Carlito is metric-compatible with Calibri, Caladea with Cambria - the two
   fonts the client's original document uses. Keeps binaries out of git. */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FONTS = {
  'Carlito-Regular.ttf': 'https://raw.githubusercontent.com/googlefonts/carlito/main/fonts/ttf/Carlito-Regular.ttf',
  'Carlito-Bold.ttf': 'https://raw.githubusercontent.com/googlefonts/carlito/main/fonts/ttf/Carlito-Bold.ttf',
  'Caladea-Regular.ttf': 'https://raw.githubusercontent.com/google/fonts/main/ofl/caladea/Caladea-Regular.ttf',
};

function get(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        return resolve(get(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${res.statusCode} ${url}`)); }
      const f = fs.createWriteStream(dest);
      res.pipe(f);
      f.on('finish', () => f.close(resolve));
    }).on('error', reject);
  });
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  for (const [name, url] of Object.entries(FONTS)) {
    const dest = path.join(DIR, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 50000) { console.log('have', name); continue; }
    process.stdout.write(`fetching ${name} ... `);
    await get(url, dest);
    console.log(`${fs.statSync(dest).size} bytes`);
  }
})().catch((e) => { console.error('font fetch failed:', e.message); process.exit(1); });
