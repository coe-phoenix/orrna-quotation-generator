'use strict';

/* Smoke test run against the live process from on the box.
 * Exists because curl is not on the deploy allowlist, so HTTP checks have to
 * come from inside Node. Exits non-zero if any check fails. */
const http = require('http');

const HOST = process.env.CHECK_HOST || '127.0.0.1';
const PORT = process.env.CHECK_PORT || 80;

function fetch(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: HOST, port: PORT, path, timeout: 30000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        type: res.headers['content-type'] || '',
        body: Buffer.concat(chunks),
      }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

(async () => {
  let failed = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
    if (!ok) failed++;
  };

  const root = await fetch('/');
  check('GET /', root.status === 200, `HTTP ${root.status}, ${root.body.length} bytes`);

  const health = await fetch('/health');
  const h = JSON.parse(health.body.toString());
  check('GET /health', health.status === 200, `HTTP ${health.status}`);
  check('API key configured', h.apiKeyConfigured === true, `apiKeyConfigured=${h.apiKeyConfigured}`);
  check('clause library loaded', h.presets.length > 0, `${h.presets.length} presets, terms ${h.boilerplateVersion}`);

  const pdf = await fetch('/preview.pdf');
  const magic = pdf.body.subarray(0, 5).toString();
  const pages = (pdf.body.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  check('GET /preview.pdf', pdf.status === 200, `HTTP ${pdf.status}, ${pdf.body.length} bytes, ${pdf.type}`);
  check('valid PDF produced', magic === '%PDF-', `header ${JSON.stringify(magic)}, ${pages} pages`);

  console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('FAIL  healthcheck errored:', e.message); process.exit(1); });
