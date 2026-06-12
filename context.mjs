#!/usr/bin/env node
// context.mjs — genera el ENTRYPOINT de contexto para IA desde verdad de fuente.
//
// El problema que resuelve: el contexto del sistema estaba disperso en 30+ .md con
// drift (el tool-count decia 41 en unos y 58 en otros) y el unico doc "para IA"
// (SHINOBIBOT_DOCS_FOR_AI.md) describia un sistema de hace 450 commits. Una IA que
// aterriza no sabia que leer ni que creer.
//
// La forma sencilla: UN fichero, AUTOGENERADO, que una IA lee primero. Hereda el
// patron de estado.mjs (leer lo que no puede mentir: git + package.json + escaneo
// real del codigo) y anade el MAPA DE MODULOS extraido de los banners del propio
// codigo — asi nunca miente y nunca se queda viejo. Escribe AGENTS.md (estandar
// cross-tool) y CLAUDE.md (Claude Code) con el mismo contenido.
//
// Uso:  node context.mjs        (se engancha al pre-commit, como estado.mjs)
// Node puro, sin deps, cross-platform.

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname, basename } from 'path';

const ROOT = process.cwd();
const sh = (cmd) => { try { return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const readJSON = (p) => { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } };

const pkg = readJSON(join(ROOT, 'package.json')) || {};
const version = pkg.version || '?';
const description = pkg.description || '';
const branch = sh('git rev-parse --abbrev-ref HEAD') || '?';
const lastCommit = sh('git log -1 --oneline') || '?';
const dirty = sh('git status --porcelain');
const treeState = dirty ? ('SUCIO (' + dirty.split('\n').filter(Boolean).length + ' cambios)') : 'limpio';

// ── Escaneo de src/ ──
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e === '.git') continue;
    const p = join(dir, e);
    let s; try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p, out);
    else if (['.ts', '.tsx'].includes(extname(p))) out.push(p);
  }
  return out;
}
const allFiles = walk(join(ROOT, 'src'));
const srcFiles = allFiles.filter((f) => !f.includes('__tests__') && !f.endsWith('.test.ts'));
const testFiles = allFiles.filter((f) => f.includes('__tests__') || f.endsWith('.test.ts'));
const loc = srcFiles.reduce((n, f) => { try { return n + readFileSync(f, 'utf-8').split('\n').length; } catch { return n; } }, 0);
const srcText = srcFiles.map((f) => { try { return readFileSync(f, 'utf-8'); } catch { return ''; } }).join('\n');
const toolCount = (srcText.match(/registerTool\(/g) || []).length;
const mcpCount = (srcText.match(/mcp__/g) || []).length;

// ── Mapa de modulos: rol extraido del banner del propio codigo (auto, sin drift) ─
function firstBanner(file) {
  try {
    for (const raw of readFileSync(file, 'utf-8').split(/\r?\n/).slice(0, 22)) {
      const t = raw.trim();
      if (!t.startsWith('//')) { if (t === '') continue; else break; }
      const bodyLine = t.replace(/^\/+/, '').trim();
      if (!bodyLine) continue;
      if (/^src\//.test(bodyLine) || /^[\w./-]+\.tsx?$/.test(bodyLine)) continue;
      return bodyLine.length > 100 ? bodyLine.slice(0, 99) + '...' : bodyLine;
    }
  } catch { /* */ }
  return '';
}
function repFile(dir) {
  for (const c of ['index.ts', basename(dir) + '.ts']) { const p = join(dir, c); if (existsSync(p)) return p; }
  let best = null, bs = -1;
  for (const e of readdirSync(dir)) {
    if (!e.endsWith('.ts') || e.endsWith('.test.ts')) continue;
    const p = join(dir, e); let s; try { s = statSync(p); } catch { continue; }
    if (s.isFile() && s.size > bs) { bs = s.size; best = p; }
  }
  return best;
}
const srcRoot = join(ROOT, 'src');
const moduleRows = readdirSync(srcRoot)
  .filter((d) => { try { return statSync(join(srcRoot, d)).isDirectory() && d !== '__tests__'; } catch { return false; } })
  .sort()
  .map((d) => {
    const dir = join(srcRoot, d);
    const n = walk(dir).filter((f) => !f.includes('__tests__') && !f.endsWith('.test.ts')).length;
    const rep = repFile(dir);
    const role = rep ? firstBanner(rep) : '';
    return '| `src/' + d + '/` | ' + n + ' | ' + (role || '_(anade un banner de cabecera)_') + ' |';
  });

const scripts = pkg.scripts || {};
const cmdRows = Object.entries(scripts).map(([k, v]) => '| `npm run ' + k + '` | `' + v + '` |').join('\n');

// Docs marcados como históricos/no-fiables. SHINOBIBOT_DOCS_FOR_AI.md y
// BENCHMARK_READINESS_PLAN.md se eliminaron en la limpieza 2026-06-10; la lista
// queda vacía y lista para futuros (staleNote filtra por existsSync de todas formas).
const KNOWN_STALE = [];
const staleNote = KNOWN_STALE.filter((f) => existsSync(join(ROOT, f))).map((f) => '`' + f + '`').join(', ') || '-';

const now = new Date().toISOString();
const L = [];
L.push('# AGENTS.md — contexto del sistema para una IA');
L.push('<!-- GENERADO por context.mjs · NO editar a mano · ' + now + ' -->');
L.push('');
L.push('> Si eres una IA y acabas de aterrizar en este repo: **lee este fichero primero.**');
L.push('> Se genera desde la verdad de fuente (git + package.json + escaneo del codigo),');
L.push('> asi que no miente ni se queda viejo. Para el detalle de diseno, sigue el orden');
L.push('> de lectura del final.');
L.push('');
L.push('## Que es');
L.push('**' + (pkg.name || 'shinobi') + '** — ' + (description || 'agente autonomo Windows-native.'));
L.push('Canon del producto: *«extension de ti mismo, todo local, todo tuyo».* Ejecuta');
L.push('acciones reales en la maquina (archivos, shell, navegador real con CDP), orquesta');
L.push('sub-agentes (swarm/team), aprende y fabrica skills firmadas. No es un wrapper de chat.');
L.push('');
L.push('## Pulso (vivo)');
L.push('- **Version:** ' + version + ' · **Rama:** ' + branch + ' · **Arbol:** ' + treeState);
L.push('- **Ultimo commit:** ' + lastCommit);
L.push('- **Tamano:** ' + srcFiles.length + ' ficheros de codigo (' + loc + ' LOC), ' + testFiles.length + ' de test');
L.push('- **Inventario (escaneo real):** ~' + toolCount + ' registros de tool · ' + mcpCount + ' referencias MCP');
L.push('');
L.push('## Mapa de modulos (`src/`, autogenerado del banner de cada modulo)');
L.push('');
L.push('| Modulo | Ficheros | Rol (de la cabecera del codigo) |');
L.push('|---|---|---|');
L.push(moduleRows.join('\n'));
L.push('');
L.push('## Como se corre / prueba');
L.push('');
L.push('| Comando | Hace |');
L.push('|---|---|');
L.push(cmdRows);
L.push('');
L.push('> Entrada principal: `scripts/shinobi.ts` (CLI) y `scripts/shinobi_web.ts` (WebChat :3333).');
L.push('> El orquestador del bucle LLM-tool vive en `src/coordinator/orchestrator.ts`.');
L.push('');
L.push('## Orden de lectura (de lo mas autoritativo a lo mas historico)');
L.push('1. **Este fichero** (AGENTS.md / CLAUDE.md) — orientacion viva, autogenerada.');
L.push('2. **ARCHITECTURE.md** — diseno y flujo de una peticion.');
L.push('3. **ROADMAP_FRONTERA_2026.md** — hacia donde va (motores E5-E8, pilares).');
L.push('4. **PLAN_SOMBRA_2026.md** — el como estrategico: sigilo, economia 0-200, puertas G0-G7, emergencia.');
L.push('5. **ESTRATEGIA_DIFERENCIADORES.md** — donde Shinobi gana indiscutible + plan de publicacion honesto.');
L.push('6. **DECISIONES.md** — log append-only de decisiones (lo mas reciente arriba).');
L.push('7. **ESTADO.md** — pulso autogenerado (lo genera estado.mjs).');
L.push('');
L.push('**Historicos / no fiables como verdad actual:** ' + staleNote + '.');
L.push('(Describen versiones anteriores; este fichero los reemplaza como puerta de entrada.)');
L.push('');
L.push('## Convenciones que importan');
L.push('- TypeScript ESM (Node 22). Tests con vitest (`*.test.ts` en `__tests__/`).');
L.push('- El audit (`src/audit/`) registra toda tool-call en `audit.jsonl` (append-only).');
L.push('- Seguridad: gate selectivo en `src/security/approval.ts` (no `utils/permissions.ts`).');
L.push('- LLM multi-proveedor con failover (`src/providers/`), no un solo modelo fijo.');
L.push('- Regla del repo: ninguna afirmacion sin dato medido; las decisiones van a DECISIONES.md.');
L.push('');
const out = L.join('\n');

writeFileSync(join(ROOT, 'AGENTS.md'), out, 'utf-8');
writeFileSync(join(ROOT, 'CLAUDE.md'), out, 'utf-8');
console.log('[context] AGENTS.md + CLAUDE.md escritos: ' + moduleRows.length + ' modulos, ' + srcFiles.length + ' ficheros, ' + loc + ' LOC, ' + toolCount + ' tools');
