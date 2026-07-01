/**
 * Skill Auditor — verdict pre-install/pre-carga para skills externas.
 *
 * Defensa real en CAPAS — la regex sola NO es suficiente y no debe tratarse
 * como tal (ofuscación mínima como `globalThis['pro'+'cess']` o
 * `String.fromCharCode(...)` la evade trivialmente):
 *
 *   1. **AST (capa estructural, siempre activa para .js/.mjs/.cjs/.ts)**:
 *      `auditor/ast_auditor.ts` recorre el árbol de sintaxis real
 *      (`ts.createSourceFile` + walk de nodos, paquete `typescript` ya
 *      presente en el repo — sin dependencia nueva). Detecta acceso a
 *      `process`/`require`/`import()` dinámico/`eval`/`new Function`/
 *      `child_process`/módulos `fs` y afines por su FORMA sintáctica, no por
 *      texto — así que concatenación de strings o acceso vía
 *      `globalThis[...]` con clave calculada no la esquiva.
 *
 *   2. **Regex (capa textual, ~90 patrones, siempre activa)**: sobre el
 *      SKILL.md y cada archivo del bundle. Cubre señales que el AST no ve
 *      (rutas de exfiltración, API keys hardcodeadas, comandos de shell
 *      destructivos embebidos en strings, patrones de red).
 *
 *   3. **Sandbox de ejecución (isolated-vm)**: incluso si algo pasa las
 *      capas 1+2, `skill_loader.ts` NUNCA usa `import()` nativo sobre el
 *      .mjs de la skill — lo ejecuta dentro de un isolate v8 aislado
 *      (mismo patrón que `src/plugins/hot_plug_registry.ts`, 64MB, timeout),
 *      así que aunque una skill maliciosa pasara el audit estático, corre
 *      sin acceso al proceso host.
 *
 *   4. **Firma/checksum + aprobación humana**: capa de integridad —
 *      cualquier tampering post-aprobación se detecta (`skill_signing.ts`).
 *      NO es autenticación de autor (ver banner de ese módulo) — es una
 *      capa más, no la única línea de defensa.
 *
 *   5. **LLM committee (opt-in via `SHINOBI_SKILL_AUDIT_LLM=1`)**: ejecuta
 *      el `Committee` (architecture + security + ux) sobre el SKILL.md.
 *      Devuelve un risk_level que se fusiona con el estático tomando el peor.
 *
 * Ninguna capa individual es "suficiente" — el diseño asume que cada una
 * puede fallar y depende de que las demás cubran el hueco.
 */

import { readFileSync, statSync, readdirSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { EXTENDED_CRITICAL, EXTENDED_WARNING } from './auditor/extended_patterns.js';
import { scanAst, isAstScannable } from './auditor/ast_auditor.js';

export type AuditVerdict = 'clean' | 'warning' | 'critical';

export interface AuditFinding {
  level: AuditVerdict;
  rule: string;
  file: string;
  line?: number;
  snippet: string;
  reason: string;
}

export interface AuditResult {
  verdict: AuditVerdict;
  findings: AuditFinding[];
  filesScanned: number;
  bytesScanned: number;
}

/**
 * Patrón → razón. El nivel se decide por la lista en la que aparece
 * (`CRITICAL_PATTERNS` vs `WARNING_PATTERNS`).
 */
const CRITICAL_PATTERNS: Array<{ rule: string; pattern: RegExp; reason: string }> = [
  {
    rule: 'rm-rf-root',
    pattern: /\brm\s+-rf\s+(\/(?=\s|$|\w)|~(?=\s|$|\/)|\$HOME)/i,
    reason: 'borrado recursivo del root, home o variable equivalente',
  },
  {
    rule: 'rm-rf-star',
    pattern: /\brm\s+-rf\s+(\.{1,2}(?=\s|$|\/)|\*|\/\*)/,
    reason: 'borrado recursivo de cwd, parent o wildcard',
  },
  {
    rule: 'win-format',
    pattern: /\bformat\s+[a-z]:(?=\s|$|\/)/i,
    reason: 'comando `format <drive>:` formatea unidad',
  },
  {
    rule: 'win-del-rec',
    pattern: /\bdel\s+\/[sfq]\s+/i,
    reason: 'borrado masivo con `del /s` o `/f` o `/q`',
  },
  {
    rule: 'kill-system',
    pattern: /\b(Stop-Process|taskkill|pkill|killall)\s+/i,
    reason: 'mata procesos del sistema (no permitido por blacklist destructiva)',
  },
  {
    rule: 'wmic-process',
    pattern: /\bwmic\s+process\b/i,
    reason: 'wmic process puede terminar procesos arbitrarios',
  },
  {
    rule: 'exfil-curl-key',
    pattern: /curl[^\n]*\$\{?(API_KEY|TOKEN|SECRET|PASSWORD|OPENAI_API_KEY|GITHUB_TOKEN)/i,
    reason: 'envia variable sensible a un endpoint via curl',
  },
  {
    rule: 'exfil-fetch-key',
    pattern: /fetch\([^)]*process\.env\.(API_KEY|TOKEN|SECRET|PASSWORD)/i,
    reason: 'envia variable sensible a un endpoint via fetch',
  },
  {
    rule: 'eval-input',
    pattern: /\beval\s*\(\s*(input|args|user|prompt|request)/i,
    reason: 'eval sobre entrada del usuario / prompt',
  },
  {
    rule: 'function-constructor',
    pattern: /new\s+Function\s*\(\s*[^)]*\barguments\b/,
    reason: 'new Function() construyendo código desde args',
  },
  {
    rule: 'reverse-shell',
    pattern: /(bash\s+-i\s+>&\s+\/dev\/tcp|nc\s+-e\s+\/bin\/sh|powershell.*Invoke-WebRequest.*IEX)/i,
    reason: 'patrón clásico de reverse shell',
  },
];

const WARNING_PATTERNS: Array<{ rule: string; pattern: RegExp; reason: string }> = [
  {
    rule: 'sudo-required',
    pattern: /\bsudo\s+/,
    reason: 'requiere privilegios elevados — revisa el contexto',
  },
  {
    rule: 'curl-pipe-sh',
    pattern: /curl[^\n|]*\|\s*(sh|bash|zsh)\b/i,
    reason: '`curl | sh` ejecuta script remoto sin verificar firma',
  },
  {
    rule: 'wget-pipe-sh',
    pattern: /wget[^\n|]*\|\s*(sh|bash|zsh)\b/i,
    reason: '`wget | sh` ejecuta script remoto sin verificar firma',
  },
  {
    rule: 'iex-remote',
    pattern: /Invoke-Expression\s+.*Invoke-WebRequest/i,
    reason: 'IEX sobre contenido remoto — equivalente PowerShell de `curl | sh`',
  },
  {
    rule: 'env-dump',
    pattern: /(printenv|Get-ChildItem\s+env:|process\.env\s*$|console\.log\s*\(\s*process\.env\s*\))/,
    reason: 'volcado de todas las variables de entorno (potencial leak)',
  },
  {
    rule: 'http-download-exec',
    pattern: /(Start-Process|exec).+\.(exe|msi|bat|cmd|ps1|sh)\b/i,
    reason: 'descarga + ejecución de binario externo',
  },
  {
    rule: 'private-key',
    pattern: /-----BEGIN\s+(RSA|OPENSSH|EC|PGP)\s+PRIVATE\s+KEY-----/,
    reason: 'archivo contiene clave privada embebida (no debería)',
  },
  {
    rule: 'hardcoded-api-key',
    pattern: /(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|AIza[A-Za-z0-9_\-]{30,})/,
    reason: 'API key hardcodeada en el código',
  },
  {
    rule: 'network-mass',
    pattern: /\.allSettled\(.*fetch\(|for\s*\(.*fetch\(/,
    reason: 'múltiples requests concurrentes — posible scan',
  },
];

const MAX_FILE_BYTES = 1024 * 1024; // 1 MiB
const SCANNED_EXTENSIONS = new Set([
  '.md', '.txt', '.ts', '.tsx', '.js', '.mjs', '.cjs',
  '.py', '.sh', '.ps1', '.cmd', '.bat', '.yaml', '.yml', '.json',
]);

function escalate(current: AuditVerdict, incoming: AuditVerdict): AuditVerdict {
  if (current === 'critical' || incoming === 'critical') return 'critical';
  if (current === 'warning' || incoming === 'warning') return 'warning';
  return 'clean';
}

function findLine(content: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Escanea contenido textual. Devuelve solo los findings — el caller
 * decide cómo combinarlos con otros archivos.
 */
export function scanText(content: string, filePath: string): AuditFinding[] {
  const out: AuditFinding[] = [];
  for (const pat of CRITICAL_PATTERNS) {
    const m = content.match(pat.pattern);
    if (m && m.index !== undefined) {
      out.push({
        level: 'critical',
        rule: pat.rule,
        file: filePath,
        line: findLine(content, m.index),
        snippet: m[0].slice(0, 120),
        reason: pat.reason,
      });
    }
  }
  for (const pat of WARNING_PATTERNS) {
    const m = content.match(pat.pattern);
    if (m && m.index !== undefined) {
      out.push({
        level: 'warning',
        rule: pat.rule,
        file: filePath,
        line: findLine(content, m.index),
        snippet: m[0].slice(0, 120),
        reason: pat.reason,
      });
    }
  }
  for (const pat of EXTENDED_CRITICAL) {
    const m = content.match(pat.pattern);
    if (m && m.index !== undefined) {
      out.push({
        level: 'critical',
        rule: pat.rule,
        file: filePath,
        line: findLine(content, m.index),
        snippet: m[0].slice(0, 120),
        reason: pat.reason,
      });
    }
  }
  for (const pat of EXTENDED_WARNING) {
    const m = content.match(pat.pattern);
    if (m && m.index !== undefined) {
      out.push({
        level: 'warning',
        rule: pat.rule,
        file: filePath,
        line: findLine(content, m.index),
        snippet: m[0].slice(0, 120),
        reason: pat.reason,
      });
    }
  }
  if (isAstScannable(filePath)) {
    out.push(...scanAst(content, filePath));
  }
  return out;
}

/**
 * Recorre recursivamente un directorio o un único archivo. Ignora
 * binarios y archivos > 1 MiB. Devuelve `AuditResult`.
 */
export function auditPath(rootPath: string): AuditResult {
  const findings: AuditFinding[] = [];
  let filesScanned = 0;
  let bytesScanned = 0;
  let verdict: AuditVerdict = 'clean';

  function visit(p: string): void {
    let stat;
    try { stat = statSync(p); } catch { return; }
    if (stat.isDirectory()) {
      let entries: string[];
      try { entries = readdirSync(p); } catch { return; }
      for (const e of entries) {
        if (e === 'node_modules' || e === '.git' || e.startsWith('.')) continue;
        visit(join(p, e));
      }
      return;
    }
    if (!stat.isFile()) return;
    if (stat.size > MAX_FILE_BYTES) return;
    const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
    if (!SCANNED_EXTENSIONS.has(ext)) return;
    let text: string;
    try { text = readFileSync(p, 'utf-8'); } catch { return; }
    filesScanned++;
    bytesScanned += text.length;
    const rel = relative(rootPath, p) || p;
    for (const f of scanText(text, rel)) {
      findings.push(f);
      verdict = escalate(verdict, f.level);
    }
  }

  if (existsSync(rootPath)) visit(rootPath);
  return { verdict, findings, filesScanned, bytesScanned };
}

/**
 * Versión "in-memory" del audit, útil cuando el contenido viene de una
 * fuente remota (GitHub raw) y aún no se ha persistido a disco. Acepta
 * un Map de path → content.
 */
export function auditFiles(files: Map<string, string>): AuditResult {
  const findings: AuditFinding[] = [];
  let bytesScanned = 0;
  let verdict: AuditVerdict = 'clean';
  for (const [filePath, content] of files) {
    bytesScanned += content.length;
    for (const f of scanText(content, filePath)) {
      findings.push(f);
      verdict = escalate(verdict, f.level);
    }
  }
  return { verdict, findings, filesScanned: files.size, bytesScanned };
}

/** Resumen humano del audit, para el CLI / logs. */
export function formatAuditSummary(result: AuditResult, target: string): string {
  const lines: string[] = [];
  lines.push(`Skill audit · ${target}`);
  lines.push(`  Verdict: ${result.verdict.toUpperCase()}`);
  lines.push(`  Files scanned: ${result.filesScanned} (${(result.bytesScanned / 1024).toFixed(1)} KiB)`);
  if (result.findings.length === 0) {
    lines.push('  No findings.');
  } else {
    lines.push(`  Findings (${result.findings.length}):`);
    for (const f of result.findings) {
      const where = f.line ? `${f.file}:${f.line}` : f.file;
      lines.push(`    [${f.level.toUpperCase()}] ${f.rule} · ${where}`);
      lines.push(`      ${f.reason}`);
      lines.push(`      Snippet: ${f.snippet.replace(/\n/g, ' ')}`);
    }
  }
  return lines.join('\n');
}
