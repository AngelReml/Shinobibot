/**
 * VERIFICACIÓN — FASE 2 (encargo de cierre): bóveda Obsidian memory/.
 *
 * La migración de memoria a Markdown se cerró al inicio del proyecto pero
 * nunca se verificó que la carpeta memory/ sea una bóveda Obsidian válida y
 * legible. Este script lo comprueba con EVIDENCIA de disco real (no
 * afirmación): existencia, codificación, ausencia de binarios/artefactos,
 * y que el formato § es parseable.
 *
 * FASE 2 no toca código (la bóveda está correcta) — esto es verificación.
 *
 * Run: npx tsx scripts/audit_validation/fase2_vault_verify.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseSections } from '../../src/memory/memory_md_parser.js';

let pass = 0, fail = 0;
function check(id: string, name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[PASS] ${id} — ${name} :: ${detail}`); }
  else { fail++; console.log(`[FAIL] ${id} — ${name} :: ${detail}`); }
}

const VAULT = path.join(process.cwd(), 'memory');

function main() {
  // V1 — la carpeta memory/ existe.
  check('V1', 'la bóveda memory/ existe', fs.existsSync(VAULT) && fs.statSync(VAULT).isDirectory(), VAULT);

  // V2 — USER.md y MEMORY.md existen.
  const userPath = path.join(VAULT, 'USER.md');
  const memPath = path.join(VAULT, 'MEMORY.md');
  check('V2', 'USER.md y MEMORY.md existen', fs.existsSync(userPath) && fs.existsSync(memPath),
    `${fs.existsSync(userPath) ? 'USER.md✓' : 'USER.md✗'} ${fs.existsSync(memPath) ? 'MEMORY.md✓' : 'MEMORY.md✗'}`);

  // V3 — ambos son texto plano UTF-8 sin bytes NUL (no binarios).
  const userBuf = fs.readFileSync(userPath);
  const memBuf = fs.readFileSync(memPath);
  const noNul = !userBuf.includes(0) && !memBuf.includes(0);
  check('V3', 'ambos son texto plano sin bytes NUL (no binarios)', noNul,
    `USER.md ${userBuf.length}b · MEMORY.md ${memBuf.length}b`);

  // V4 — los ficheros VISIBLES de la bóveda son todos .md (Obsidian-friendly).
  const visible = fs.readdirSync(VAULT).filter(f => !f.startsWith('.'));
  const allMd = visible.every(f => f.endsWith('.md'));
  check('V4', 'la bóveda solo contiene .md visibles (válida para Obsidian)', allMd && visible.length > 0,
    `visibles: ${visible.join(', ')}`);

  // V5 — no hay artefactos .lock / .tmp visibles que rompan la bóveda.
  const artifacts = fs.readdirSync(VAULT).filter(f => /\.(lock|tmp)$/.test(f) && !f.startsWith('.'));
  check('V5', 'sin artefactos .lock/.tmp visibles', artifacts.length === 0,
    artifacts.length ? `artefactos: ${artifacts.join(', ')}` : 'ninguno');

  // V6 — el formato § es parseable en ambos ficheros.
  const userSecs = parseSections(userBuf.toString('utf-8'));
  const memSecs = parseSections(memBuf.toString('utf-8'));
  check('V6', 'el formato § es parseable (memory_md_parser)', userSecs.length >= 1 && memSecs.length >= 1,
    `USER.md ${userSecs.length} secciones · MEMORY.md ${memSecs.length} secciones`);

  // V7 — el contenido es legible por un humano (texto imprimible, no vacío).
  const userText = userBuf.toString('utf-8').trim();
  const memText = memBuf.toString('utf-8').trim();
  check('V7', 'el contenido es legible y no vacío', userText.length > 20 && memText.length > 20,
    `USER.md ${userText.length}c · MEMORY.md ${memText.length}c`);

  console.log(`\n=== VERIFICACIÓN FASE 2: ${pass}/${pass + fail} PASS ===`);
  console.log(`Ruta de la bóveda Obsidian: ${VAULT}`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
