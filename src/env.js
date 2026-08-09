'use strict';

/* Minimal .env loader. Values already present in the real environment win. */
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');

if (fs.existsSync(ENV_PATH)) {
  fs.readFileSync(ENV_PATH, 'utf8').split('\n').forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i < 1) return;
    const k = t.slice(0, i).trim();
    if (process.env[k] === undefined) process.env[k] = t.slice(i + 1);
  });
}
