/**
 * Validación REAL del fix P3: el sender de webhooks de alertas valida la
 * URL (bloquea esquemas no http/https) — antes era un vector SSRF.
 * Run: npx tsx scripts/audit_validation/p3_alerts_real.ts
 */
import { isSafeWebhookUrl } from '../../src/observability/alerts.js';

const cases: Array<[string, boolean]> = [
  ['https://hooks.slack.com/services/X', true],
  ['http://localhost:9000/webhook', true],
  ['file:///etc/passwd', false],
  ['ftp://host/x', false],
  ['javascript:alert(1)', false],
  ['no-soy-una-url', false],
];

let pass = 0, fail = 0;
for (const [url, expected] of cases) {
  const got = isSafeWebhookUrl(url);
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? '[OK]  ' : '[FAIL]'} isSafeWebhookUrl(${JSON.stringify(url)}) = ${got} (esperado ${expected})`);
}
console.log(`=== ${pass} OK, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
