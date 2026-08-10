'use strict';

const { GoogleGenAI } = require('@google/genai');
const C = require('./content');
const T = require('./templates');

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const SYSTEM = `You transcribe data from an existing quotation PDF into JSON.

You are a TRANSCRIBER, not an author. Rules:
- Copy values exactly as printed, including currency formatting ("RM 8,950.00"), spacing and punctuation.
- If a field is not present on the page, return null. Never invent, infer, complete or tidy a value.
- Do not translate, reword, correct spelling, or expand abbreviations.
- Return ONLY a JSON object. No prose, no markdown fences.

Schema:
{
  "quoteNo": string|null,
  "jobNo": string|null,
  "date": string|null,
  "attention": string|null,
  "customer": { "name": string|null, "addressLines": string[] },
  "costBox": { "rows": [ { "label": string, "value": string|null } ] },
  "serviceTime": string|null,
  "warrantyMonths": number|null,
  "spindleType": string|null,
  "suggestedActions": string[]
}

Return the address inside the bordered recipient box as "customer". If any
OTHER address appears anywhere on the page, list it in a top-level
"extraAddressesFound": string[] rather than merging it into the customer
address. This flags stale content left over from a copied document.

Agreed-action catalog keys (for "suggestedActions" - only include a key when a
cost line explicitly names it):
{{CATALOG}}`;

function buildSystem() {
  const cat = T.getCatalog().map((a) => `- ${a.key}: ${a.label}`).join('\n');
  return SYSTEM.replace('{{CATALOG}}', cat);
}

function stripFences(t) {
  return String(t).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
}

async function extractFromPdf(pdfBuffer) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const e = new Error('GEMINI_API_KEY is not set on the server.');
    e.code = 'NO_API_KEY';
    throw e;
  }

  const ai = new GoogleGenAI({ apiKey });

  const resp = await ai.models.generateContent({
    model: MODEL,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') } },
        { text: 'Transcribe the first page of this quotation into the JSON schema. Return JSON only.' },
      ],
    }],
    config: {
      systemInstruction: buildSystem(),
      temperature: 0,
      maxOutputTokens: 2000,
      responseMimeType: 'application/json',
    },
  });

  const text = resp.text || '';
  let data;
  try {
    data = JSON.parse(stripFences(text));
  } catch (err) {
    const e = new Error('Model did not return valid JSON.');
    e.raw = text;
    throw e;
  }
  return { data, raw: text, usage: resp.usageMetadata };
}

/** Map extraction output onto the canonical quotation object used by the renderer. */
function toQuotation(x) {
  const rows = ((x.costBox && x.costBox.rows) || []).map((r, i, arr) => ({
    mode: i >= arr.length - 3 ? 'columns' : 'inline',
    label: r.label,
    value: r.value,
  }));

  const catalog = T.getCatalog();
  const ticks = {};
  catalog.forEach((a) => { ticks[a.key] = a.defaultOn; });
  (x.suggestedActions || []).forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(ticks, k)) ticks[k] = true;
  });

  return {
    quoteNo: x.quoteNo || '',
    jobNo: x.jobNo || '',
    date: x.date || '',
    attention: x.attention || 'PURCHASING',
    customer: {
      name: (x.customer && x.customer.name) || '',
      addressLines: (x.customer && x.customer.addressLines) || [],
    },
    salutation: '',
    costBox: { rows },
    warrantyMonths: x.warrantyMonths || 6,
    standardActionsPresetKey: T.getPresets()[0].key,
    agreedActions: ticks,
    conditions: Object.assign({}, C.CONDITIONS_DEFAULTS),
    boilerplateVersion: T.getGeneralConditions().version,
    warnings: (x.extraAddressesFound || []).length
      ? [`Page 1 contains ${x.extraAddressesFound.length} additional address(es) not in the recipient box: ${x.extraAddressesFound.join(' | ')}`]
      : [],
  };
}

module.exports = { extractFromPdf, toQuotation, MODEL };
