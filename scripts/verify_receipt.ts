// P2 (Modo Cristal) — verificador STANDALONE de Recibos de Misión.
//
// Uso:  npm run verify:receipt -- <recibo.json> [audit.jsonl]
//   o:  tsx scripts/verify_receipt.ts <recibo.json> [audit.jsonl]
//
// Un tercero (o tú) valida con SOLO la pública embebida que una misión no excedió su
// mandato — sin arrancar Shinobi. Exit 0 si el recibo es válido, 1 si no, 2 si mal uso.
import { verifyReceiptFile } from '../src/attest/mission_receipt.js';

const [, , receiptPath, auditPath] = process.argv;
if (!receiptPath) {
  console.error('Uso: verify_receipt <recibo.json> [audit.jsonl]');
  process.exit(2);
}
const v = verifyReceiptFile(receiptPath, auditPath);
if (v.valid) {
  console.log(`OK — recibo VÁLIDO (${v.reason}): autenticidad + integridad + no-exceso del mandato.`);
  process.exit(0);
}
const extra = v.offendingEffect ? ` — efecto fuera de mandato: ${v.offendingEffect.kind}:${v.offendingEffect.scope}` : '';
console.error(`FALLO — recibo INVÁLIDO: ${v.reason}${extra}`);
process.exit(1);
