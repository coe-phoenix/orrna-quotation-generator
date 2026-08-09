'use strict';

require('./src/env');

const path = require('path');
const express = require('express');
const multer = require('multer');

const C = require('./src/content');
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

/* ----- routes are declared BEFORE express.static so nothing is shadowed ----- */

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    boilerplateVersion: C.GENERAL_CONDITIONS.version,
    presets: C.STANDARD_ACTION_PRESETS.map((p) => p.key),
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
      presets: C.STANDARD_ACTION_PRESETS,
      catalog: C.AGREED_ACTIONS_CATALOG,
      defaults: C.CONDITIONS_DEFAULTS,
      pleaseNote: C.PLEASE_NOTE,
    });
  } catch (err) {
    const msg = err.code === 'NO_API_KEY'
      ? 'ANTHROPIC_API_KEY is not configured on the server.'
      : `Extraction failed: ${err.message}`;
    res.status(500).render('upload', { error: msg });
  }
});

/** Build a canonical quotation object from the review form. */
function fromForm(b) {
  const rows = [];
  const labels = [].concat(b.rowLabel || []);
  const values = [].concat(b.rowValue || []);
  const modes = [].concat(b.rowMode || []);
  labels.forEach((l, i) => {
    if (String(l).trim()) rows.push({ mode: modes[i] || 'inline', label: l, value: values[i] || '' });
  });

  const ticks = {};
  C.AGREED_ACTIONS_CATALOG.forEach((a) => { ticks[a.key] = b[`tick_${a.key}`] === 'on'; });

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
    standardActionsPresetKey: b.presetKey || C.STANDARD_ACTION_PRESETS[0].key,
    agreedActions: ticks,
    conditions: {
      validityDays: parseInt(b.validityDays, 10) || C.CONDITIONS_DEFAULTS.validityDays,
      paymentTermsDays: parseInt(b.paymentTermsDays, 10) || C.CONDITIONS_DEFAULTS.paymentTermsDays,
      deliveryDays: parseInt(b.deliveryDays, 10) || C.CONDITIONS_DEFAULTS.deliveryDays,
      otherConditions: b.otherConditions || C.CONDITIONS_DEFAULTS.otherConditions,
    },
    boilerplateVersion: C.GENERAL_CONDITIONS.version,
  };
}

app.post('/generate', (req, res) => {
  const q = fromForm(req.body);
  const id = saveQuotation(q);
  res.redirect(`/quotation/${id}.pdf`);
});

app.get('/quotation/:id.pdf', (req, res) => {
  const row = getQuotation(parseInt(req.params.id, 10));
  if (!row) return res.status(404).send('Quotation not found');
  const q = row.snapshot;
  const name = `Quotation_${(q.quoteNo || row.id).toString().replace(/\W+/g, '_')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${name}"`);
  renderQuotation(q).pipe(res);
});

app.get('/quotations', (req, res) => {
  res.render('list', { rows: listQuotations() });
});

/** Preview using reference values, so layout can be checked without an upload. */
app.get('/preview.pdf', (req, res) => {
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
    standardActionsPresetKey: C.STANDARD_ACTION_PRESETS[0].key,
    agreedActions: {},
  }).pipe(res);
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`quotation generator listening on ${PORT}`));
