/**
 * Validación REAL: audit.jsonl redacta secretos.
 * Antes, writeAuditEvent escribía el evento crudo -> el argsPreview de un
 * tool_call podía filtrar una API key. Ahora se pasa por redactSecrets.
 *
 * Ejecuta logToolCall REAL contra un audit.jsonl temporal y comprueba el
 * fichero resultante.
 *
 * Run: npx tsx scripts/audit_validation/p3_audit_redact_real.ts
 */
import { mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const auditFile = join(mkdtempSync(join(tmpdir(), 'shinobi-auditval-')), 'audit.jsonl');
process.env.SHINOBI_AUDIT_LOG_PATH = auditFile;
delete process.env.SHINOBI_AUDIT_DISABLED;

const { logToolCall } = await import('../../src/audit/audit_log.js');

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[OK]   ${name} — ${detail}`); }
  else { fail++; console.log(`[FAIL] ${name} — ${detail}`); }
}

// Secretos fabricados (no reales) — distintas formas.
const FAKE_ANTHROPIC = 'sk-ant-api03-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0';
const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIn0.abcDEF123456ghiJKL789';

logToolCall({
  tool: 'http_get',
  args: { url: 'https://api.example.com', apiKey: FAKE_ANTHROPIC, authHeader: `Bearer ${FAKE_JWT}` },
  success: true,
  durationMs: 12,
});

const raw = readFileSync(auditFile, 'utf-8');
console.log('\n=== Contenido de audit.jsonl tras logToolCall ===');
console.log(raw.trim());
console.log('===');

check('el secreto Anthropic NO aparece en crudo', !raw.includes(FAKE_ANTHROPIC), 'sk-ant-... no debe estar literal');
check('el JWT NO aparece en crudo', !raw.includes(FAKE_JWT), 'eyJ... no debe estar literal');
check('hay marcador <REDACTED', raw.includes('<REDACTED'), 'el redactor debe haber actuado');
check('el evento sigue siendo JSON válido', (() => {
  try { JSON.parse(raw.trim().split('\n')[0]); return true; } catch { return false; }
})(), 'la línea debe parsear como JSON');

console.log(`\n=== RESULTADO: ${pass} OK, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
