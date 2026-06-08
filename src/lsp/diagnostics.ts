// src/lsp/diagnostics.ts
//
// LSP-flavored — DIAGNÓSTICOS al escribir/editar código.
//
// Da al agente feedback semántico/sintáctico INMEDIATO sobre el código que
// acaba de escribir, antes del siguiente turno (igual que un LSP en un editor).
// Engancha con el self-debug: el agente ve el problema y lo corrige solo.
//
// Pragmático y real por lenguaje:
//   - TS/JS: API del compilador TypeScript → diagnósticos SINTÁCTICOS por
//     fichero (rápidos, deterministas, sin falsos positivos de resolución de
//     módulos). Caza justo los errores que un LLM comete al escribir código.
//   - JSON: JSON.parse → error de sintaxis con posición.
//   - Python: `python -m py_compile` (best-effort; [] si no hay python).
//
// El compilador TS se importa de forma dinámica (dep perezosa): si no está,
// degrada a [] sin romper.

import { extname } from 'path';
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface Diagnostic {
  line: number; // 1-based
  column: number; // 1-based
  severity: 'error' | 'warning';
  message: string;
  code?: string | number;
}

const TS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

let _ts: any | null | undefined; // undefined=no probado, null=ausente
async function loadTs(): Promise<any | null> {
  if (_ts !== undefined) return _ts;
  try { _ts = (await import('typescript')).default ?? (await import('typescript')); }
  catch { _ts = null; }
  return _ts;
}

async function tsDiagnostics(filePath: string, text: string): Promise<Diagnostic[]> {
  const ts = await loadTs();
  if (!ts) return [];
  const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  const parseDiags: any[] = (sf as any).parseDiagnostics ?? [];
  return parseDiags.map((d) => mapDiag(ts, sf, d));
}

function mapDiag(ts: any, sf: any, d: any): Diagnostic {
  const pos = typeof d.start === 'number' ? ts.getLineAndCharacterOfPosition(sf, d.start) : { line: 0, character: 0 };
  return {
    line: pos.line + 1,
    column: pos.character + 1,
    severity: d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    code: d.code ? `TS${d.code}` : undefined,
  };
}

// FASE 3.1 — diagnósticos SEMÁNTICOS (chequeo de tipos) por fichero. Whitelist
// de errores INTRA-fichero de alta confianza; se EXCLUYE el ruido de resolución
// de módulos (2307/2304/2305…), que sin el proyecto entero daría falsos
// positivos. Pesca: tipos no asignables, args mal, sobrecargas, comparaciones
// imposibles, readonly. Rápido (programa de un fichero, skipLibCheck).
const SEMANTIC_WHITELIST = new Set<number>([
  2322, // Type X is not assignable to type Y
  2345, // Argument of type X not assignable to parameter Y
  2554, // Expected N arguments, but got M
  2769, // No overload matches this call
  2367, // comparison appears unintentional
  2540, // Cannot assign to readonly
  2365, // Operator cannot be applied to types
  2362, 2363, // arithmetic operand must be number/bigint
]);

async function tsSemanticDiagnostics(filePath: string, text: string): Promise<Diagnostic[]> {
  const ts = await loadTs();
  if (!ts) return [];
  const fileName = filePath.replace(/\\/g, '/');
  const options = {
    noEmit: true,
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    skipLibCheck: true,
    strict: false,
    noResolve: true, // no cargamos imports → su ruido se filtra por whitelist
    noLib: false,
  };
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  try {
    const host = ts.createCompilerHost(options);
    const origGetSource = host.getSourceFile.bind(host);
    host.getSourceFile = (name: string, languageVersion: any, ...rest: any[]) =>
      name.replace(/\\/g, '/') === fileName ? sf : origGetSource(name, languageVersion, ...rest);
    host.writeFile = () => {};
    const program = ts.createProgram([fileName], options, host);
    const diags: any[] = program.getSemanticDiagnostics(sf) ?? [];
    return diags
      .filter((d) => SEMANTIC_WHITELIST.has(d.code))
      .map((d) => mapDiag(ts, sf, d));
  } catch {
    return []; // el chequeo semántico es best-effort; nunca rompe
  }
}

function jsonDiagnostics(text: string): Diagnostic[] {
  try {
    JSON.parse(text);
    return [];
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    // Node moderno: "... at position 12 (line 2 column 3)".
    const lc = msg.match(/line (\d+) column (\d+)/i);
    if (lc) return [{ line: Number(lc[1]), column: Number(lc[2]), severity: 'error', message: msg, code: 'JSON' }];
    const posM = msg.match(/at position (\d+)/i);
    if (posM) {
      const pos = Number(posM[1]);
      const before = text.slice(0, pos);
      const line = before.split(/\r?\n/).length;
      const column = pos - before.lastIndexOf('\n');
      return [{ line, column, severity: 'error', message: msg, code: 'JSON' }];
    }
    return [{ line: 1, column: 1, severity: 'error', message: msg, code: 'JSON' }];
  }
}

function pyDiagnostics(filePath: string, text: string): Diagnostic[] {
  // py_compile necesita un fichero en disco. Si el filePath real existe lo
  // usamos; si no, escribimos a temporal. Best-effort: cualquier fallo → [].
  let target = filePath;
  let tmp: string | null = null;
  try {
    if (!existsSync(filePath)) {
      const dir = mkdtempSync(join(tmpdir(), 'shinobi-py-'));
      tmp = join(dir, 'check.py');
      writeFileSync(tmp, text, 'utf-8');
      target = tmp;
    }
    const r = spawnSync('python', ['-m', 'py_compile', target], { encoding: 'utf-8', timeout: 10_000 });
    if ((r.status ?? 0) === 0) return [];
    if (r.error) return []; // python ausente
    const err = `${r.stderr ?? ''}`;
    // SyntaxError: ... (file, line N)
    const m = err.match(/line (\d+)/i);
    const msgM = err.match(/(SyntaxError:.*|IndentationError:.*)/);
    return [{
      line: m ? Number(m[1]) : 1,
      column: 1,
      severity: 'error',
      message: (msgM ? msgM[1] : err.split(/\r?\n/).filter(Boolean).pop() || 'error de compilación').trim(),
      code: 'PY',
    }];
  } catch {
    return [];
  } finally {
    if (tmp) { try { rmSync(join(tmp, '..'), { recursive: true, force: true }); } catch { /* */ } }
  }
}

/**
 * Diagnósticos del fichero `filePath` con `content` (si se omite, se lee de
 * disco). Devuelve [] para tipos sin checker o si el checker no está disponible.
 */
export interface DiagnosticsOptions {
  /** Añade chequeo de tipos (semántico) para TS/JS. Default false (solo sintaxis). */
  semantic?: boolean;
}

export async function runDiagnostics(filePath: string, content?: string, opts: DiagnosticsOptions = {}): Promise<Diagnostic[]> {
  const ext = extname(filePath).toLowerCase();
  let text = content;
  if (text === undefined) {
    try { text = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : ''; } catch { text = ''; }
  }
  if (text === undefined) text = '';

  if (TS_EXTS.has(ext)) {
    const syntactic = await tsDiagnostics(filePath, text);
    // Si ya hay errores de sintaxis, el chequeo de tipos sobra (y sería ruidoso).
    if (!opts.semantic || syntactic.length > 0) return syntactic;
    const semantic = await tsSemanticDiagnostics(filePath, text);
    // Dedup por línea:código.
    const seen = new Set(syntactic.map((d) => `${d.line}:${d.code}`));
    return [...syntactic, ...semantic.filter((d) => !seen.has(`${d.line}:${d.code}`))];
  }
  if (ext === '.json') return jsonDiagnostics(text);
  if (ext === '.py') return pyDiagnostics(filePath, text);
  return [];
}

/** True si el chequeo semántico (tipos) está activado al escribir (opt-in). */
export function lspSemanticEnabled(): boolean {
  return process.env.SHINOBI_LSP_SEMANTIC === '1';
}

/** Formatea diagnósticos como texto legible para el agente. */
export function formatDiagnostics(diags: Diagnostic[]): string {
  if (diags.length === 0) return '';
  const lines = diags.slice(0, 20).map((d) =>
    `  ${d.severity === 'error' ? '✖' : '⚠'} ${d.line}:${d.column} ${d.code ? `[${d.code}] ` : ''}${d.message.replace(/\s+/g, ' ')}`);
  const more = diags.length > 20 ? `\n  …y ${diags.length - 20} más` : '';
  return `Diagnósticos (${diags.length}):\n${lines.join('\n')}${more}`;
}

/** True si el auto-check al escribir está activado (opt-in). */
export function lspOnWriteEnabled(): boolean {
  return process.env.SHINOBI_LSP === '1';
}
