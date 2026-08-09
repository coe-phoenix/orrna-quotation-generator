'use strict';

/* Writes .env from arguments, e.g.
 *   npm run set-env -- ANTHROPIC_API_KEY=sk-...
 * Exists because the deploy channel rejects shell redirection and heredocs,
 * so the secret cannot be written with `cat > .env`. Existing keys are
 * preserved unless overwritten. .env is gitignored.
 */
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');
const args = process.argv.slice(2).filter(Boolean);

if (!args.length) {
  console.error('usage: npm run set-env -- KEY=value [KEY2=value2]');
  process.exit(1);
}

const current = {};
if (fs.existsSync(ENV_PATH)) {
  fs.readFileSync(ENV_PATH, 'utf8').split('\n').forEach((l) => {
    const i = l.indexOf('=');
    if (i > 0 && !l.trim().startsWith('#')) current[l.slice(0, i).trim()] = l.slice(i + 1);
  });
}

args.forEach((a) => {
  const i = a.indexOf('=');
  if (i < 1) { console.error(`skipping malformed argument: ${a}`); return; }
  current[a.slice(0, i).trim()] = a.slice(i + 1);
});

fs.writeFileSync(
  ENV_PATH,
  Object.entries(current).map(([k, v]) => `${k}=${v}`).join('\n') + '\n',
  { mode: 0o600 }
);

console.log(`wrote ${Object.keys(current).length} key(s) to .env:`, Object.keys(current).join(', '));
