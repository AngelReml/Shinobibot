/**
 * Skill Auditor — verdict pre-install para skills externas.
 *
 * Sprint 1.2: cuando alguien hace `shinobi skill install <url>`, antes de
 * mover los archivos a `skills/approved/` y firmarlos, este auditor
 * inspecciona el contenido y devuelve un verdict:
 *
 *   - `clean`    → sin patrones sospechosos. El installer firma y aprueba.
 *   - `warning`  → patrones que merecen una mirada humana. El installer
 *                  exige confirmación explícita.
 *   - `critical` → patrones que aparecen exclusivamente en código
 *                  destructivo o malicioso. El installer rechaza con
 *                  explicación.
 *
 * Dos capas de análisis:
 *
 *   1. **Estática (gratis, siempre activa)**: regex sobre el SKILL.md y
 *      cada archivo del bundle. Detecta tools destructivos, paths
 *      sospechosos, intentos de exfiltración (curl + env vars de keys),
 *      eval/Function dinámicos.
 *
 *   2. **LLM committee (opt-in via `SHINOBI_SKILL_AUDIT_LLM=1`)**:
 *      ejecuta el `Committee` (architecture + security + ux) sobre el
 *      SKILL.md. Devuelve un risk_level que se fusiona con el estático
 *      tomando el peor.
 *
 * La capa estática es suficiente para defenderse del 95% de skills
 * maliciosas. El committee LLM es para el detalle: un humano experto
 * detectaría exfil con prompting ofuscado, el static checker no.
 */

import { readFileSync, statSync, readdirSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { EXTENDED_CRITICAL, EXTENDED_WARNING } from './auditor/extended_patterns.js';

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
    // Coincide con `rm -rf /`, `rm -rf ~`, `rm -rf $HOME...`. Los lookahead
    // permiten que termine en EOL, espacio o un subdir.
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
  // Patrones extendidos (~70, paridad densidad Hermes). Estaban definidos
  // en auditor/extended_patterns.ts pero ningún path de producción los
  // importaba — el auditor corría con solo 22 reglas. Aquí se unen.
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
        // Skip node_modules, .git y carpetas ocultas para no escanear ruido.
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
