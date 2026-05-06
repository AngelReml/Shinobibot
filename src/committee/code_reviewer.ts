// F2 — code_reviewer role.
// Selecciona archivos de mayor riesgo del repo y los lee LITERALMENTE
// (no via meta-descripcion del Reader). Inyecta hasta 8k tokens (~32k chars)
// de codigo fuente al prompt para que el reviewer pueda detectar SQLi/XSS/
// path traversal/etc. — cosas que el security_auditor estandar pierde porque
// solo recibe el RepoReport sintetizado.

import * as fs from 'fs';
import * as path from 'path';
import type { CommitteeRole } from './Committee.js';

export const CODE_REVIEWER_MAX_CHARS = 32_000;   // ~8k tokens
const PER_FILE_MAX_CHARS = 5_000;

/** Risk-scoring patterns. Higher score = scanned earlier. */
const NAME_HEURISTICS: { regex: RegExp; weight: number }[] = [
  { regex: /(auth|login|signin|signup|passwd|password|secret|token|jwt|session)/i, weight: 6 },
  { regex: /(query|sql|db|database|exec|eval)/i, weight: 5 },
  { regex: /(upload|download|file|stream|input)/i, weight: 4 },
  { regex: /(admin|api|endpoint|route|handler|controller)/i, weight: 3 },
  { regex: /(crypto|hash|sign|verify|encrypt|decrypt)/i, weight: 3 },
  { regex: /(parser|render|template|html|inject)/i, weight: 3 },
];

/** File extensions considered code with potential security surface. */
const RISKY_EXTENSIONS = new Set([
  '.php', '.py', '.rb', '.pl', '.cgi', '.go', '.java', '.cs',
  '.js', '.mjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte',
  '.html', '.htm', '.sql',
  '.c', '.cc', '.cpp', '.h', '.hpp',
]);

const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.venv', '__pycache__',
  '.next', 'coverage', '.cache', '.idea', '.vscode',
  'vendor', 'target', 'out',
]);

interface CandidateFile { abs: string; rel: string; score: number }

function scoreFile(rel: string): number {
  const ext = path.extname(rel).toLowerCase();
  if (!RISKY_EXTENSIONS.has(ext)) return 0;
  let score = 1;
  for (const h of NAME_HEURISTICS) if (h.regex.test(rel)) score = Math.max(score, h.weight);
  // Files inside src/, lib/, app/ get a small bonus over deeply nested locations.
  if (/^(src|lib|app|server|api)\//i.test(rel)) score += 1;
  return score;
}

export function pickRiskyFiles(repoAbs: string, maxFiles = 12): CandidateFile[] {
  const out: CandidateFile[] = [];
  walk(repoAbs, repoAbs, out);
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, maxFiles);
}

function walk(root: string, dir: string, acc: CandidateFile[]): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      walk(root, path.join(dir, e.name), acc);
    } else if (e.isFile()) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      const s = scoreFile(rel);
      if (s > 0) acc.push({ abs, rel, score: s });
    }
  }
}

function readSnippet(abs: string, maxBytes: number): string {
  try {
    const stat = fs.statSync(abs);
    if (stat.size <= maxBytes) return fs.readFileSync(abs, 'utf-8');
    const fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(maxBytes);
    fs.readSync(fd, buf, 0, maxBytes, 0);
    fs.closeSync(fd);
    return buf.toString('utf-8') + `\n\n[truncated at ${maxBytes} bytes]`;
  } catch (e: any) {
    return `[unreadable: ${e?.message ?? String(e)}]`;
  }
}

/** Build the literal source-code blob to splice into the code_reviewer prompt. */
export function buildCodeReviewBlob(repoAbs: string, maxChars = CODE_REVIEWER_MAX_CHARS): { blob: string; files: string[] } {
  const candidates = pickRiskyFiles(repoAbs);
  const usedFiles: string[] = [];
  const parts: string[] = [];
  let chars = 0;
  for (const c of candidates) {
    const remaining = maxChars - chars;
    if (remaining < 500) break;
    const cap = Math.min(PER_FILE_MAX_CHARS, remaining - 200);
    const body = readSnippet(c.abs, cap);
    const block = `\n--- ${c.rel} (risk_score=${c.score}) ---\n${body}\n`;
    parts.push(block);
    chars += block.length;
    usedFiles.push(c.rel);
  }
  return { blob: parts.join(''), files: usedFiles };
}

export function makeCodeReviewerRole(repoAbs: string): CommitteeRole | undefined {
  const { blob, files } = buildCodeReviewBlob(repoAbs);
  if (files.length === 0 || blob.length < 200) return undefined;
  const systemPrompt =
`You are a senior application security auditor reviewing ACTUAL SOURCE CODE.
You have been given the highest-risk files from the repository (by extension and naming heuristics).
DO NOT rely on summaries — the code is provided literally below.

Look specifically for:
- SQL injection (string concatenation into queries, missing parameterization)
- XSS (unescaped output, innerHTML, dangerouslySetInnerHTML, document.write)
- Command injection (exec/system/shell with user input)
- Path traversal (file paths built from user input, missing path normalization)
- Authentication bypass (weak compare, missing checks)
- File upload abuse (missing extension/size/MIME validation)
- Hardcoded secrets, weak crypto, insecure randomness
- Insecure deserialization

Cite specific file:line references in your weaknesses (e.g., "src/login.php:42 — direct \\$_POST in mysqli_query").
If the code is sound for these vectors, say so explicitly — do not invent vulnerabilities.

Source files reviewed (${files.length}):
${files.map((f) => `- ${f}`).join('\n')}

CODE:
${blob}
`;
  return {
    role: 'code_reviewer',
    model: 'claude-opus-4-7',
    systemPrompt,
  };
}
