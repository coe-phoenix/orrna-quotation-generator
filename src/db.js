'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'quotations.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS quotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_no TEXT,
  job_no TEXT,
  customer_name TEXT,
  issued_at TEXT NOT NULL,
  boilerplate_version TEXT NOT NULL,
  preset_key TEXT NOT NULL,
  snapshot TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quote_no ON quotations(quote_no);
`);

const insert = db.prepare(`
  INSERT INTO quotations (quote_no, job_no, customer_name, issued_at, boilerplate_version, preset_key, snapshot)
  VALUES (@quote_no, @job_no, @customer_name, @issued_at, @boilerplate_version, @preset_key, @snapshot)
`);

/**
 * Freeze the fully resolved quotation. Reprints replay this snapshot rather
 * than re-resolving against live templates, so an old quote keeps its old terms.
 */
function saveQuotation(q) {
  const info = insert.run({
    quote_no: q.quoteNo || null,
    job_no: q.jobNo || null,
    customer_name: (q.customer && q.customer.name) || null,
    issued_at: new Date().toISOString(),
    boilerplate_version: q.boilerplateVersion || 'unknown',
    preset_key: q.standardActionsPresetKey || 'unknown',
    snapshot: JSON.stringify(q),
  });
  return info.lastInsertRowid;
}

function getQuotation(id) {
  const row = db.prepare('SELECT * FROM quotations WHERE id = ?').get(id);
  return row ? Object.assign(row, { snapshot: JSON.parse(row.snapshot) }) : null;
}

function listQuotations(limit = 100) {
  return db.prepare(
    'SELECT id, quote_no, job_no, customer_name, issued_at, boilerplate_version FROM quotations ORDER BY id DESC LIMIT ?'
  ).all(limit);
}

module.exports = { saveQuotation, getQuotation, listQuotations };
