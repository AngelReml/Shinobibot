#!/usr/bin/env node
// estado.mjs — generador de ESTADO.md desde verdad de fuente.
//
// Lee lo que no puede mentir (package.json, git, conteo real de tests, inventario
// por escaneo, últimas decisiones de DECISIONES.md) y escribe ESTADO.md con
// cabecera de procedencia. Node puro, sin deps, cross-platform.
//   node estado.mjs            (con conteo de tests real — lento)
//   node estado.mjs --no-tests (rápido, para el git hook)
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT = process.cwd();
const NO_TESTS = process.argv.includes('--no-tests');

function sh(cmd) {
  try { return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}
function readJSON(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }

// ── Config opcional (estado.config.json) con defaults para shinobi ──
const cfg = readJSON(join(ROOT, 'estado.config.json')) || {};
const name = cfg.name || readJSON(join(ROOT, 'package.json'))?.name || 'repo';
const inventory = cfg.inventory || {
  tools: 'registerTool\\(',
  mcp: 'mcp__',
  verdicts: 'PASS|FAIL|LOOP_DETECTED|LOOP_SAME_FAILURE',
};
const liveDocs = cfg.liveDocs || ['DECISIONES.md'];

// ── Verdad de fuente ──
const version = readJSON(join(ROOT, 'package.json'))?.version || '?';
const branch = sh('git rev-parse --abbrev-ref HEAD') || '?';
const lastCommit = sh('git log -1 --oneline') || '?';
const dirty = sh('git status --porcelain');
const treeState = dirty ? `SUCIO (${dirty.split('\n').filter(Boolean).length} cambios)` : 'limpio';
const sync = sh('git status -sb').split('\n')[0] || '';

// ── Inventario por escaneo de src/ ──
function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e === '.git') continue;
    const p = join(dir, e);
    let s; try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p, exts, out);
    else if (exts.includes(extname(p))) out.push(p);
  }
  return out;
}
const files = walk(join(ROOT, 'src'), ['.ts', '.tsx']);
const testFiles = files.filter((f) => f.includes('__tests__') || f.endsWith('.test.ts'));
const srcText = files.filter((f) => !f.includes('__tests__')).map((f) => { try { return readFileSync(f, 'utf-8'); } catch { return ''; } }).join('\n');
const invCounts = {};
for (const [label, pattern] of Object.entries(inventory)) {
  try { invCounts[label] = (srcText.match(new RegExp(pattern, 'g')) || []).length; } catch { invCounts[label] = '?'; }
}

// ── Conteo de tests real ──
let tests = 'no ejecutados (--no-tests)';
if (!NO_TESTS) {
  const out = sh((cfg.testCommand || 'npx vitest run') + ' 2>&1') || '';
  const m = out.match(/Tests\s+(\d+)\s+passed(?:\s*\|\s*(\d+)\s+skipped)?/);
  if (m) tests = `${m[1]} passed${m[2] ? ` / ${m[2]} skipped` : ''} (corrida real)`;
  else tests = 'no se pudo leer el conteo';
}

// ── Últimas decisiones ──
let decisions = '';
for (const d of liveDocs) {
  const p = join(ROOT, d);
  if (existsSync(p)) {
    const lines = readFileSync(p, 'utf-8').split('\n').slice(0, 18).join('\n');
    decisions += `\n### ${d}\n${lines}\n`;
  }
}

const md = `# ESTADO — ${name}
> Generado por estado.mjs · procedencia: lectura directa de package.json + git + ${NO_TESTS ? 'inventario (sin tests)' : 'corrida real de tests'} · ${new Date().toISOString()}

## Pulso
- **Versión:** ${version} (fuente única: package.json)
- **Rama:** ${branch} · ${sync}
- **Último commit:** ${lastCommit}
- **Árbol:** ${treeState}
- **Tests:** ${tests}

## Inventario (escaneo de src/, ${files.length} ficheros, ${testFiles.length} de test)
${Object.entries(invCounts).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

## Últimas decisiones${decisions || '\n(sin DECISIONES.md)'}
`;

writeFileSync(join(ROOT, 'ESTADO.md'), md, 'utf-8');
console.log(`[estado] ESTADO.md escrito · versión ${version} · tests: ${tests} · árbol ${treeState}`);
