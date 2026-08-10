'use strict';

require('./src/env');

const path = require('path');
const express = require('express');
const multer = require('multer');

const C = require('./src/content');
const T = require('./src/templates');
const { renderQuotation } = require('./src/render');
const { extractFromPdf, toQuotation, MODEL } = require('./src/extract');
const { saveQuotation, getQuotation, listQuotations } = require('./src/db');

const app = express();
const PORT = process.env.PORT || 80;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));

/* ----- routes are declared BEFORE express.static so nothing is shadowed ----- */

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    provider: 'gemini',
    model: MODEL,
    apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
    boilerplateVersion: T.getGeneralConditions().version,
    presets: T.getPresets().map((p) => p.key),
    templates: T.status(),
  });
});

app.get('/', (req, res) => {
  res.render('upload', { error: null });
});

app.post('/extract', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).render('upload', { error: 'Please choose a PDF file.' });
  try {
    const { data } = await extractFromPdf(req.file.buffer);
    const q = toQuotation(data);
    res.render('review', {
      q,
      presets: T.getPresets(),
      catalog: T.getCatalog(),
      defaults: C.CONDITIONS_DEFAULTS,
      pleaseNote: C.PLEASE_NOTE,
      generalConditions: T.getGeneralConditions(),
    });
  } catch (err) {
    const msg = err.code === 'NO_API_KEY'
      ? 'GEMINI_API_KEY is not configured on the server.'
      : `Extraction failed: ${err.message}`;
    res.status(500).render('upload', { error: msg });
  }
});

/** Normalized shape used to detect edits away from the saved template. */
function gcFingerprint(gc) {
  return JSON.stringify({
    title: String(gc.title || '').trim(),
    closing: String(gc.closing || '').trim(),
    clauses: (gc.clauses || []).map((c) => ({
      h: String(c.h || '').trim(),
      p: (c.p || []).map((s) => String(s).trim()).filter(Boolean),
    })),
  });
}

/**
 * Read the general conditions back off the review form. Wording is frozen onto
 * the quote, and any deviation from the saved template is marked on the version
 * so a reprint makes clear the terms were hand-edited.
 */
function generalConditionsFromForm(b) {
  const base = T.getGeneralConditions();
  const headings = [].concat(b.gcHeading || []);
  const bodies = [].concat(b.gcBody || []);

  const clauses = [];
  headings.forEach((h, i) => {
    const heading = String(h).trim();
    const paras = String(bodies[i] || '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (heading || paras.length) clauses.push({ h: heading, p: paras });
  });

  const gc = {
    version: base.version,
    effectiveFrom: base.effectiveFrom,
    title: String(b.gcTitle || base.title).trim(),
    clauses: clauses.length ? clauses : base.clauses,
    closing: String(b.gcClosing || base.closing).trim(),
  };
  if (gcFingerprint(gc) !== gcFingerprint(base)) gc.version = `${base.version} (edited)`;
  return gc;
}

/** Build a canonical quotation object from the review form. */
function fromForm(b) {
  const rows = [];
  const labels = [].concat(b.rowLabel || []);
  const values = [].concat(b.rowValue || []);
  const modes = [].concat(b.rowMode || []);
  labels.forEach((l, i) => {
    if (String(l).trim()) rows.push({ mode: modes[i] || 'inline', label: l, value: values[i] || '' });
  });

  const catalog = T.getCatalog();
  const ticks = {};
  catalog.forEach((a) => { ticks[a.key] = b[`tick_${a.key}`] === 'on'; });

  const generalConditions = generalConditionsFromForm(b);

  const presets = T.getPresets();
  const presetKey = b.presetKey || presets[0].key;
  const preset = presets.find((p) => p.key === presetKey) || presets[0];

  return {
    quoteNo: b.quoteNo || '',
    jobNo: b.jobNo || '',
    date: b.date || '',
    attention: b.attention || 'PURCHASING',
    customer: {
      name: b.customerName || '',
      addressLines: String(b.customerAddress || '').split('\n').map((s) => s.trim()).filter(Boolean),
    },
    salutation: '',
    costBox: { rows },
    warrantyMonths: parseInt(b.warrantyMonths, 10) || 6,
    standardActionsPresetKey: preset.key,
    // Freeze the resolved wording onto the record so a later template edit
    // never rewrites an already-issued quotation.
    standardActions: { intro: preset.intro, items: preset.items },
    agreedActions: ticks,
    agreedActionsCatalog: catalog.map((a) => ({ key: a.key, label: a.label, defaultOn: a.defaultOn })),
    conditions: {
      validityDays: parseInt(b.validityDays, 10) || C.CONDITIONS_DEFAULTS.validityDays,
      paymentTermsDays: parseInt(b.paymentTermsDays, 10) || C.CONDITIONS_DEFAULTS.paymentTermsDays,
      deliveryDays: parseInt(b.deliveryDays, 10) || C.CONDITIONS_DEFAULTS.deliveryDays,
      otherConditions: b.otherConditions || C.CONDITIONS_DEFAULTS.otherConditions,
    },
    generalConditions,
    boilerplateVersion: generalConditions.version,
  };
}

app.post('/generate', (req, res) => {
  const q = fromForm(req.body);
  const id = saveQuotation(q);
  res.redirect(`/quotation/${id}/done`);
});

app.get('/quotation/:id/done', (req, res) => {
  const row = getQuotation(parseInt(req.params.id, 10));
  if (!row) return res.status(404).send('Quotation not found');
  res.render('done', { id: row.id, q: row.snapshot });
});

app.get('/quotation/:id.pdf', (req, res) => {
  const row = getQuotation(parseInt(req.params.id, 10));
  if (!row) return res.status(404).send('Quotation not found');
  const q = row.snapshot;
  const name = `Quotation_${(q.quoteNo || row.id).toString().replace(/\W+/g, '_')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  const disposition = req.query.download ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disposition}; filename="${name}"`);
  renderQuotation(q).pipe(res);
});

app.get('/quotations', (req, res) => {
  res.render('list', { rows: listQuotations() });
});

/* --------------------------- template management --------------------------- */

app.get('/templates', (req, res) => {
  res.render('templates', {
    presets: T.getPresets(),
    catalog: T.getCatalog(),
    generalConditions: T.getGeneralConditions(),
    status: T.status(),
    saved: req.query.saved || null,
    reset: req.query.reset || null,
    error: null,
  });
});

/** Shared handler for the three save endpoints. Accepts JSON or form posts. */
function renderTemplates(res, extra) {
  res.render('templates', Object.assign({
    presets: T.getPresets(),
    catalog: T.getCatalog(),
    generalConditions: T.getGeneralConditions(),
    status: T.status(),
    saved: null,
    reset: null,
    error: null,
  }, extra));
}

app.post('/templates/presets', (req, res) => {
  try {
    T.savePresets(req.body.presets);
    res.redirect('/templates?saved=presets#presets');
  } catch (err) {
    renderTemplates(res.status(400), { error: `Could not save presets: ${err.message}` });
  }
});

app.post('/templates/catalog', (req, res) => {
  try {
    T.saveCatalog(req.body.catalog);
    res.redirect('/templates?saved=catalog#catalog');
  } catch (err) {
    renderTemplates(res.status(400), { error: `Could not save agreed actions: ${err.message}` });
  }
});

app.post('/templates/general', (req, res) => {
  try {
    T.saveGeneralConditions(req.body.general);
    res.redirect('/templates?saved=general#general');
  } catch (err) {
    renderTemplates(res.status(400), { error: `Could not save general conditions: ${err.message}` });
  }
});

app.post('/templates/reset', (req, res) => {
  const kind = req.body.kind;
  T.reset(kind);
  res.redirect(`/templates?reset=${encodeURIComponent(kind || '')}#${kind || ''}`);
});

/** Preview using reference values, so layout can be checked without an upload. */
app.get('/preview.pdf', (req, res) => {
  const preset = T.getPresets()[0];
  res.setHeader('Content-Type', 'application/pdf');
  renderQuotation({
    quoteNo: 'PREVIEW/0000', jobNo: 'PREVIEW/0000',
    date: new Date().toLocaleDateString('en-GB'),
    attention: 'PURCHASING',
    customer: { name: 'SAMPLE CUSTOMER SDN. BHD', addressLines: ['Lot 1, Jalan Contoh,', '40000 Shah Alam,', 'Selangor.'] },
    costBox: { rows: [
      { mode: 'inline', label: 'Spindle type/rpm', value: 'SAMPLE SPINDLE / 12,000 RPM' },
      { mode: 'inline', label: 'Total Cost Spindle Recondition', value: 'RM 0.00' },
      { mode: 'columns', label: 'Total Cost', value: 'RM 0.00' },
      { mode: 'columns', label: 'Service time', value: '14 working days from the date of purchase order' },
      { mode: 'columns', label: 'Warranty', value: '6 months' },
    ] },
    warrantyMonths: 6,
    standardActionsPresetKey: preset.key,
    standardActions: { intro: preset.intro, items: preset.items },
    agreedActions: {},
    agreedActionsCatalog: T.getCatalog(),
    generalConditions: T.getGeneralConditions(),
  }).pipe(res);
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`quotation generator listening on ${PORT}`));
