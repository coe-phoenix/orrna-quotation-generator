'use strict';

/**
 * Editable template store.
 *
 * The wording in src/content.js is the shipped baseline. This module lets the
 * user override three of those libraries at runtime and save the result so it
 * becomes the new default for every future quotation:
 *
 *   - standardActionPresets  → Step 3, "Overview of standardized analyze and action"
 *   - agreedActionsCatalog   → "Others agreed actions"
 *   - generalConditions      → "ORRNA JAYA (SPINDLE SERVICE) General Condition –
 *                               Repair & refurbishment Work"
 *
 * Overrides live in a small key/value table in the same SQLite database as the
 * issued quotations. When no override is stored, the baseline from content.js
 * is returned, so the app behaves exactly as before until something is saved.
 *
 * Reprints are unaffected: each issued quotation freezes its own fully-resolved
 * wording into its snapshot, so editing a template here never rewrites history.
 */

const { db } = require('./db');
const C = require('./content');

db.exec(`
CREATE TABLE IF NOT EXISTS templates (
  name       TEXT PRIMARY KEY,
  json       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

const readStmt = db.prepare('SELECT json, updated_at FROM templates WHERE name = ?');
const writeStmt = db.prepare(`
  INSERT INTO templates (name, json, updated_at) VALUES (@name, @json, @updated_at)
  ON CONFLICT(name) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at
`);
const deleteStmt = db.prepare('DELETE FROM templates WHERE name = ?');

const NAMES = {
  presets: 'standardActionPresets',
  catalog: 'agreedActionsCatalog',
  general: 'generalConditions',
};

function readOverride(name) {
  const row = readStmt.get(name);
  if (!row) return null;
  try {
    return JSON.parse(row.json);
  } catch (_) {
    return null;
  }
}

function updatedAt(name) {
  const row = readStmt.get(name);
  return row ? row.updated_at : null;
}

/* --------------------------------- helpers -------------------------------- */

const str = (v) => String(v == null ? '' : v).trim();
const lines = (v) => str(v).split('\n').map((s) => s.trim()).filter(Boolean);

function slug(s, fallback) {
  const out = str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return out || fallback;
}

/** Ensure preset keys stay unique even if two labels slugify the same. */
function uniqueKeys(items, keyOf) {
  const seen = new Set();
  return items.map((it, i) => {
    let key = keyOf(it, i);
    let n = 2;
    while (seen.has(key)) key = `${keyOf(it, i)}-${n++}`;
    seen.add(key);
    return key;
  });
}

/* -------------------------------- presets --------------------------------- */

function normalizePresets(input) {
  const arr = Array.isArray(input) ? input : [];
  const cleaned = arr
    .map((p) => ({
      key: str(p.key),
      label: str(p.label),
      version: Number(p.version) || 1,
      intro: str(p.intro),
      items: (Array.isArray(p.items) ? p.items : lines(p.items)).map(str).filter(Boolean),
    }))
    .filter((p) => p.label || p.items.length);
  const keys = uniqueKeys(cleaned, (p, i) => slug(p.key || p.label, `preset-${i + 1}`));
  cleaned.forEach((p, i) => { p.key = keys[i]; });
  return cleaned;
}

function getPresets() {
  const o = readOverride(NAMES.presets);
  const list = o && Array.isArray(o) && o.length ? o : C.STANDARD_ACTION_PRESETS;
  return list;
}

function savePresets(input) {
  const normalized = normalizePresets(input);
  if (!normalized.length) throw new Error('At least one preset is required.');
  writeStmt.run({ name: NAMES.presets, json: JSON.stringify(normalized), updated_at: new Date().toISOString() });
  return normalized;
}

/* -------------------------------- catalog --------------------------------- */

function normalizeCatalog(input) {
  const arr = Array.isArray(input) ? input : [];
  const cleaned = arr
    .map((a) => ({ key: str(a.key), label: str(a.label), defaultOn: !!a.defaultOn }))
    .filter((a) => a.label);
  const keys = uniqueKeys(cleaned, (a, i) => slug(a.key || a.label, `action-${i + 1}`));
  cleaned.forEach((a, i) => { a.key = keys[i]; });
  return cleaned;
}

function getCatalog() {
  const o = readOverride(NAMES.catalog);
  return o && Array.isArray(o) && o.length ? o : C.AGREED_ACTIONS_CATALOG;
}

function saveCatalog(input) {
  const normalized = normalizeCatalog(input);
  if (!normalized.length) throw new Error('At least one agreed action is required.');
  writeStmt.run({ name: NAMES.catalog, json: JSON.stringify(normalized), updated_at: new Date().toISOString() });
  return normalized;
}

/* --------------------------- general conditions --------------------------- */

function normalizeGeneralConditions(input) {
  const base = C.GENERAL_CONDITIONS;
  const clauses = (Array.isArray(input && input.clauses) ? input.clauses : [])
    .map((cl) => ({ h: str(cl.h), p: Array.isArray(cl.p) ? cl.p.map(str).filter(Boolean) : lines(cl.p) }))
    .filter((cl) => cl.h || cl.p.length);
  return {
    version: str(input && input.version) || base.version,
    effectiveFrom: str(input && input.effectiveFrom) || base.effectiveFrom,
    title: str(input && input.title) || base.title,
    clauses: clauses.length ? clauses : base.clauses,
    closing: str(input && input.closing) || base.closing,
  };
}

function getGeneralConditions() {
  const o = readOverride(NAMES.general);
  return o && o.clauses && o.clauses.length ? o : C.GENERAL_CONDITIONS;
}

function saveGeneralConditions(input) {
  const normalized = normalizeGeneralConditions(input);
  writeStmt.run({ name: NAMES.general, json: JSON.stringify(normalized), updated_at: new Date().toISOString() });
  return normalized;
}

/* ---------------------------------- misc ---------------------------------- */

function reset(kind) {
  const name = NAMES[kind];
  if (name) deleteStmt.run(name);
}

/** Snapshot of which libraries have been customised, for UI badges. */
function status() {
  return {
    presets: { customized: !!readOverride(NAMES.presets), updatedAt: updatedAt(NAMES.presets) },
    catalog: { customized: !!readOverride(NAMES.catalog), updatedAt: updatedAt(NAMES.catalog) },
    general: { customized: !!readOverride(NAMES.general), updatedAt: updatedAt(NAMES.general) },
  };
}

module.exports = {
  NAMES,
  getPresets,
  savePresets,
  getCatalog,
  saveCatalog,
  getGeneralConditions,
  saveGeneralConditions,
  reset,
  status,
};
