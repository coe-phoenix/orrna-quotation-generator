'use strict';

const path = require('path');
const PDFDocument = require('pdfkit');
const C = require('./content');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const LOGO = require('./logo');

const F = {
  serif: path.join(FONT_DIR, 'Caladea-Regular.ttf'),
  body: path.join(FONT_DIR, 'Carlito-Regular.ttf'),
  bold: path.join(FONT_DIR, 'Carlito-Bold.ttf'),
};

/** Coordinates measured directly from the client's reference PDF (A4, pt). */
const L = {
  pageW: 595.32,
  pageH: 841.92,
  marginL: 70,
  marginR: 525,
  get contentW() { return this.marginR - this.marginL; },

  logo: { x: 70, y: 71, w: 76, h: 54.3 },
  title1: { x: 245.2, y: 105, size: 25.3 },
  title2: { x: 139.8, y: 134.6, size: 25.3 },
  regNo: { x: 438.1, y: 147.2, size: 9.7 },
  rule: { x: 70, y: 164, w: 455, h: 1 },
  addr: { y1: 181.5, y2: 193.4, y3: 205.3, size: 9.7 },

  bodySize: 8.8,
  bodyLead: 1.56,
  boxSize: 9.7,
  clauseLead: 0,

  bodyTop: 243.2,
  contentBottom: 722,
};

const COLOR = {
  accent: '#4F81BD',
  title: '#17365D',
  link: '#0563C1',
  text: '#000000',
};

const nz = (v, d) => (v === undefined || v === null || v === '' ? d : v);

function reg(doc, size) { return doc.font(F.body).fontSize(size); }
function bold(doc, size) { return doc.font(F.bold).fontSize(size); }

function line(doc, text, x, y, { font = F.body, size = L.bodySize, color = COLOR.text } = {}) {
  doc.font(font).fontSize(size).fillColor(color)
    .text(String(text), x, y, { lineBreak: false, lineGap: 0 });
}

function para(doc, text, x, y, width, { font = F.body, size = L.bodySize, lead = L.bodyLead, color = COLOR.text, align = 'left' } = {}) {
  doc.font(font).fontSize(size).fillColor(color)
    .text(String(text), x, y, { width, align, lineGap: lead });
  return doc.y;
}

function measuredHeight(doc, text, width, { font = F.body, size = L.bodySize, lead = L.bodyLead } = {}) {
  return doc.font(font).fontSize(size).heightOfString(String(text), { width, lineGap: lead });
}

function underline(doc, text, x, y, size = L.bodySize) {
  const w = doc.font(F.bold).fontSize(size).widthOfString(String(text));
  doc.moveTo(x, y + size + 0.6).lineTo(x + w, y + size + 0.6)
    .lineWidth(0.6).strokeColor(COLOR.text).stroke();
}

/** Wingdings-style solid arrowhead used for the standardized-action bullets. */
function arrowBullet(doc, x, yMid) {
  doc.save().fillColor(COLOR.text)
    .moveTo(x, yMid - 3.2).lineTo(x + 5.2, yMid).lineTo(x, yMid + 3.2).closePath().fill()
    .restore();
  doc.fillColor(COLOR.text);
}

function letterhead(doc) {
  doc.image(LOGO, L.logo.x, L.logo.y, { width: L.logo.w, height: L.logo.h });

  doc.font(F.serif).fontSize(L.title1.size).fillColor(COLOR.title)
    .text(C.COMPANY.name1, L.title1.x, L.title1.y, { lineBreak: false, lineGap: 0 });
  doc.font(F.serif).fontSize(L.title2.size).fillColor(COLOR.title)
    .text(C.COMPANY.name2, L.title2.x, L.title2.y, { lineBreak: false, lineGap: 0 });
  const t2w = doc.font(F.serif).fontSize(L.title2.size).widthOfString(C.COMPANY.name2);
  doc.font(F.bold).fontSize(L.regNo.size).fillColor(COLOR.title)
    .text(C.COMPANY.regNo, L.title2.x + t2w + 1.5, L.regNo.y, { lineBreak: false, lineGap: 0 });

  doc.rect(L.rule.x, L.rule.y, L.rule.w, L.rule.h).fill(COLOR.accent);

  const cw = L.contentW;
  reg(doc, L.addr.size).fillColor(COLOR.text)
    .text(C.COMPANY.addr1, L.marginL, L.addr.y1, { width: cw, align: 'center', lineGap: 0 })
    .text(C.COMPANY.addr2, L.marginL, L.addr.y2, { width: cw, align: 'center', lineGap: 0 });

  const f = doc.font(F.body).fontSize(L.addr.size);
  const wTel = f.widthOfString(C.COMPANY.tel);
  const wLbl = f.widthOfString(C.COMPANY.emailLabel);
  const wMail = f.widthOfString(C.COMPANY.email);
  let x = L.marginL + (cw - (wTel + wLbl + wMail)) / 2;
  const y = L.addr.y3;

  doc.fillColor(COLOR.link).text(C.COMPANY.tel, x, y, { lineBreak: false, lineGap: 0 });
  doc.moveTo(x, y + 10.4).lineTo(x + wTel, y + 10.4).lineWidth(0.5).strokeColor(COLOR.link).stroke();
  x += wTel;
  doc.fillColor(COLOR.text).text(C.COMPANY.emailLabel, x, y, { lineBreak: false, lineGap: 0 });
  x += wLbl;
  doc.fillColor(COLOR.link).text(C.COMPANY.email, x, y, { lineBreak: false, lineGap: 0 });
  doc.moveTo(x, y + 10.4).lineTo(x + wMail, y + 10.4).lineWidth(0.5).strokeColor(COLOR.link).stroke();
  doc.fillColor(COLOR.text);
}

function newPage(doc) {
  doc.addPage({ size: [L.pageW, L.pageH], margin: 0 });
  letterhead(doc);
  return L.bodyTop;
}

function renderPage1(doc, q) {
  line(doc, 'To,', 70.1, 272.0);
  bold(doc, L.bodySize);
  line(doc, nz(q.attention, 'PURCHASING'), 70.1, 294.0, { font: F.bold });

  const addr = [q.customer && q.customer.name, ...((q.customer && q.customer.addressLines) || [])]
    .filter(Boolean);
  const boxH = Math.max(76, addr.length * 11.9 + 18);
  doc.rect(70, 314, 193, boxH).fillAndStroke('#FFFFFF', '#000000');
  doc.lineWidth(0.72).rect(70, 314, 193, boxH).stroke('#000000');
  addr.forEach((t, i) => line(doc, t, 77.4, 320 + i * 11.9, { size: L.boxSize }));

  line(doc, `ORRNA JAYA QUOTE nb:${q.quoteNo || ''}`, 384.4, 316.0);
  line(doc, `ORRNA JAYA JOB nb:${q.jobNo || ''}`, 385.2, 328.3);
  line(doc, `Date: ${q.date || ''}`, 385.2, 340.5);

  if (q.salutation) line(doc, q.salutation, 70.1, Math.max(374.8, 314 + boxH + 6));

  const intro = (q.introParagraphs && q.introParagraphs.length) ? q.introParagraphs : C.INTRO_PARAGRAPHS;
  let y = 418.9;
  intro.forEach((p) => {
    const h = measuredHeight(doc, p, L.contentW);
    para(doc, p, 70.1, y, L.contentW);
    y += h + 9.6;
  });

  const rows = (q.costBox && q.costBox.rows) || [];
  const rowGap = 23.4;
  const firstRow = 539.1;
  const boxHeight = Math.max(175, (rows.length - 1) * rowGap + 45);
  doc.lineWidth(0.48).rect(68, 533, 457, boxHeight).stroke('#000000');

  rows.forEach((r, i) => {
    const ry = firstRow + i * rowGap;
    if (r.mode === 'columns') {
      line(doc, r.label, 75.1, ry, { font: F.bold, size: L.boxSize });
      const lw = doc.font(F.bold).fontSize(L.boxSize).widthOfString(r.label);
      const vx = Math.max(145.0, 75.1 + lw + 8);
      line(doc, `: ${r.value}`, vx, ry, { font: F.bold, size: L.boxSize });
    } else {
      const t = r.value ? `${r.label} : ${r.value}` : r.label;
      line(doc, t, 75.1, ry, { font: F.bold, size: L.boxSize });
    }
  });
}

function renderActionsPage(doc, q, preset) {
  let y = newPage(doc);

  para(doc, nz(preset.intro, ''), 70.1, y, L.contentW);
  y = 265.2;

  const h1 = 'Overview of standardized analyze and action';
  line(doc, h1, 70.1, y, { font: F.bold });
  underline(doc, h1, 70.1, y);
  y += 21.4;

  const bulletX = 87.5;
  const textX = 105.0;
  const textW = L.marginR - textX;
  preset.items.forEach((item) => {
    arrowBullet(doc, bulletX, y + 2.6);
    const h = measuredHeight(doc, item, textW);
    para(doc, item, textX, y, textW);
    y += h;
  });

  y = Math.max(y + 21.4, 456.7);

  const pre = 'Others agreed actions (marked with';
  line(doc, pre, 70.1, y, { font: F.bold });
  const pw = doc.font(F.bold).fontSize(L.bodySize).widthOfString(pre);
  doc.rect(70.1 + pw + 2, y + 0.8, 7.8, 7.8).fill('#000000');
  doc.fillColor(COLOR.text);
  line(doc, '):', 70.1 + pw + 12.6, y, { font: F.bold });
  underline(doc, `${pre}     ):`, 70.1, y);

  y += 21.9;
  const ticks = q.agreedActions || {};
  C.AGREED_ACTIONS_CATALOG.forEach((a) => {
    const on = Object.prototype.hasOwnProperty.call(ticks, a.key) ? !!ticks[a.key] : a.defaultOn;
    if (on) {
      doc.rect(91.3, y + 0.6, 7.8, 7.8).fill('#000000');
    } else {
      doc.lineWidth(0.7).rect(91.3, y + 0.6, 7.8, 7.8).stroke('#000000');
    }
    doc.fillColor(COLOR.text);
    line(doc, a.label, 105.0, y);
    y += 16.1;
  });
}

function renderConditionsPage(doc, q) {
  let y = newPage(doc);

  line(doc, 'Please note:', 70.1, y, { font: F.bold });
  y += 25.7;

  const notes = (q.pleaseNote && q.pleaseNote.length) ? q.pleaseNote : C.PLEASE_NOTE;
  notes.forEach((p) => {
    const h = measuredHeight(doc, p, L.contentW);
    para(doc, p, 70.1, y, L.contentW);
    y += h + 9.6;
  });

  y = Math.max(y + 22, 462.4);
  line(doc, 'Conditions:', 70.1, y, { font: F.bold });
  y += 22.0;

  const cond = Object.assign({}, C.CONDITIONS_DEFAULTS, q.conditions || {});
  line(doc, `Quotation period of validity: ${cond.validityDays} days`, 70.1, y); y += 22.1;

  const pt = 'Payment terms: ';
  line(doc, pt, 70.1, y);
  line(doc, `${cond.paymentTermsDays} days`, 70.1 + doc.font(F.body).fontSize(L.bodySize).widthOfString(pt), y, { font: F.bold });
  y += 21.9;

  const td = 'Terms of delivery: ';
  line(doc, `${td}${cond.deliveryDays} `, 70.1, y);
  const tdw = doc.font(F.body).fontSize(L.bodySize).widthOfString(`${td}${cond.deliveryDays} `);
  line(doc, 'days from the date of purchase order.', 70.1 + tdw, y, { font: F.bold });
  y += 22.0;

  para(doc, `Other conditions: ${cond.otherConditions}`, 70.1, y, L.contentW);
}

function renderGeneralConditions(doc, q) {
  const gc = C.GENERAL_CONDITIONS;
  const word = C.warrantyWord(nz(q.warrantyMonths, 6));
  let y = newPage(doc);

  doc.font(F.bold).fontSize(11.6).fillColor(COLOR.text)
    .text(gc.title, 70.1, y, { width: L.contentW, lineGap: 0 });
  y += 24.1;

  const flow = (text, opts) => {
    const h = measuredHeight(doc, text, L.contentW, opts);
    if (y + h > L.contentBottom) y = newPage(doc);
    para(doc, text, 70.1, y, L.contentW, opts);
    return h;
  };

  gc.clauses.forEach((cl) => {
    const headOpts = { font: F.bold, lead: L.clauseLead };
    const bodyOpts = { lead: L.clauseLead };
    const blockH = measuredHeight(doc, cl.h, L.contentW, headOpts)
      + cl.p.reduce((s, p) => s + measuredHeight(doc, p, L.contentW, bodyOpts) + 10.7, 0);
    if (y + Math.min(blockH, 32) > L.contentBottom) y = newPage(doc);

    y += flow(cl.h, headOpts);
    cl.p.forEach((p) => {
      const t = p.replace('{{warrantyMonthsWord}}', word);
      y += flow(t, bodyOpts) + 10.7;
    });
  });

  if (y + 90 > L.contentBottom) y = newPage(doc);
  line(doc, 'Best Regards,', 70.1, y); y += 32.0;
  line(doc, C.COMPANY.signOff, 70.1, y); y += 10.7;
  line(doc, C.COMPANY.signOffCompany, 70.1, y); y += 10.7;
  line(doc, C.COMPANY.signOffCity, 70.1, y); y += 12.5;
  doc.moveTo(70.1, y).lineTo(L.marginR, y).lineWidth(0.6).stroke('#000000');
  y += 8;
  para(doc, gc.closing, 70.1, y, L.contentW);
}

function renderQuotation(q) {
  const preset = C.STANDARD_ACTION_PRESETS
    .find((p) => p.key === q.standardActionsPresetKey) || C.STANDARD_ACTION_PRESETS[0];

  const doc = new PDFDocument({
    size: [L.pageW, L.pageH],
    margin: 0,
    autoFirstPage: false,
    info: {
      Title: `Quotation ${q.quoteNo || ''}`,
      Author: 'ORRNA JAYA ENGINEERING & TRADING',
      Creator: 'ORRNA JAYA Quotation Generator',
    },
  });

  doc.addPage({ size: [L.pageW, L.pageH], margin: 0 });
  letterhead(doc);
  doc.font(F.bold).fontSize(13.6).fillColor(COLOR.text)
    .text('QUOTATION', L.marginL, 244.2, { width: L.contentW, align: 'center', lineGap: 0 });
  renderPage1(doc, q);

  renderActionsPage(doc, q, preset);
  renderConditionsPage(doc, q);
  renderGeneralConditions(doc, q);

  doc.end();
  return doc;
}

module.exports = { renderQuotation, LAYOUT: L };
