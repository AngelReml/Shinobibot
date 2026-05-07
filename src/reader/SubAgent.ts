// Habilidad A — SubAgent: lee una sub-ruta del repo, devuelve SubReport JSON.
// Función pura, sin estado global. Inyectable para tests.

import * as fs from 'fs';
import * as path from 'path';
import {
  SubReport,
  SubReportError,
  validateSubReport,
  tryParseJSON,
} from './schemas.js';

export interface SubTask {
  sub_path: string;          // relative to repo root
  abs_path: string;
  files_to_read: string[];   // absolute paths, already truncated by partition
  prompt_extra?: string;     // extra guidance (e.g. "this is the root_meta task")
  token_budget: number;
}

export interface LLMClient {
  chat(messages: { role: string; content: string }[], opts?: { model?: string; temperature?: number }): Promise<string>;
}

const SYSTEM_PROMPT = `You are a static code analyst reading exactly ONE folder of a repository as part of a hierarchical reading swarm. Your scope is this folder only — siblings are read by other workers in parallel. Stay factual; another worker will synthesize.

Return ONE JSON object matching this exact schema (no prose, no markdown fence):
{
  "path": string,
  "purpose": string (max 200 chars),
  "key_files": [{"name": string, "role": string (max 100)}],   // max 8
  "dependencies": {"internal": string[], "external": string[]},
  "concerns": string[]   // max 5, each <=150 chars
}

Rules:
- If you cannot read a file (binary, truncated, missing), set the field to null. Do NOT invent paths, function names, or dependencies.
- "internal" = paths within THIS repo (use relative paths like "src/utils/foo"). Verify by checking the file content shown — if a path isn't imported in the visible code, omit it.
- "external" = npm/PyPI/etc package names you literally see imported. Quote the import line if uncertain.
- "concerns" = factual observations only (TODO comments, dead code, missing tests, known anti-patterns). No speculation. No "could be better" — only what IS.
- All array fields are required (use [] when empty). Output JSON only.

Example of an acceptable output (real, from p-event audit):
{
  "path": "/",
  "purpose": "p-event promisifies event emitter results, simplifying async operations in Node.js and browsers.",
  "key_files": [
    {"name": "package.json", "role": "Project metadata, dependencies, and scripts."},
    {"name": "readme.md", "role": "Documentation for usage and API details."}
  ],
  "dependencies": {"internal": [], "external": ["p-timeout", "@types/node", "ava", "delay", "tsd", "xo"]},
  "concerns": []
}
Counter-example to avoid: a "purpose" like "this folder probably contains the main logic" — speculation, no evidence. Or listing "lodash" as external when no file imports it — invention.

Self-check before emitting: every entry in dependencies.internal/external must appear in at least one of the file blocks above. Every key_files name must be one of the files actually shown. If you can't verify, omit.`;

function buildUserPrompt(task: SubTask, fileContents: { name: string; content: string }[]): string {
  const fileBlocks = fileContents
    .map((f) => `--- ${f.name} ---\n${f.content}`)
    .join('\n\n');
  const extra = task.prompt_extra ? `\nNote: ${task.prompt_extra}\n` : '';
  return `Folder: ${task.sub_path}${extra}

Read these files and return the SubReport JSON.

${fileBlocks}`;
}

function readTruncated(absPath: string, maxBytes: number): string {
  try {
    const stat = fs.statSync(absPath);
    if (stat.size <= maxBytes) return fs.readFileSync(absPath, 'utf-8');
    const fd = fs.openSync(absPath, 'r');
    const buf = Buffer.alloc(maxBytes);
    fs.readSync(fd, buf, 0, maxBytes, 0);
    fs.closeSync(fd);
    return buf.toString('utf-8') + `\n\n[truncated at ${maxBytes} bytes]`;
  } catch (e: any) {
    return `[unreadable: ${e?.message ?? String(e)}]`;
  }
}

export interface SubAgentOptions {
  model?: string;             // default Haiku
  maxBytesPerFile?: number;   // default 12_000
  /** When provided, KnowledgeRouter scans the user prompt and prepends matched manuals. */
  knowledgeInjector?: (task: string) => string;
  /** Mission id passed to the knowledge router for usage logging. */
  missionId?: string;
}

export async function runSubAgent(
  task: SubTask,
  llm: LLMClient,
  opts: SubAgentOptions = {},
): Promise<SubReport | SubReportError> {
  const maxBytesPerFile = opts.maxBytesPerFile ?? 12_000;
  const fileContents = task.files_to_read.map((p) => ({
    name: path.relative(task.abs_path, p) || path.basename(p),
    content: readTruncated(p, maxBytesPerFile),
  }));

  let userPrompt = buildUserPrompt(task, fileContents);

  // C.2 — KnowledgeRouter injection (opt-in via opts.knowledgeInjector).
  if (opts.knowledgeInjector) {
    const injection = opts.knowledgeInjector(userPrompt);
    if (injection) userPrompt = injection + '\n\n' + userPrompt;
  }

  const callOnce = async (extraSystem = ''): Promise<unknown> => {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + (extraSystem ? `\n\n${extraSystem}` : '') },
      { role: 'user', content: userPrompt },
    ];
    const raw = await llm.chat(messages, { model: opts.model });
    return tryParseJSON(raw);
  };

  // F-01 — sub-report es "sospechosamente vacío" cuando validación pasa pero
  // todos los arrays vienen vacíos para una carpeta que SÍ tenía archivos
  // visibles. No es un fallo de protocolo, es señal de que el LLM no extrajo
  // nada. Lo tratamos como degradación, NO como sub-report válido.
  const hadVisibleFiles = task.files_to_read.length > 0;
  const isEmptyShape = (r: SubReport): boolean =>
    r.key_files.length === 0 &&
    r.dependencies.internal.length === 0 &&
    r.dependencies.external.length === 0 &&
    r.concerns.length === 0;

  // First attempt
  let parsed: unknown;
  try {
    parsed = await callOnce();
  } catch (e: any) {
    parsed = { __parse_error: e?.message ?? String(e) };
  }

  let v = validateSubReport(parsed);
  if (v.ok) {
    if (!hadVisibleFiles || !isEmptyShape(v.value)) return v.value;
    // F-01: sospechosamente vacío. Retry con guidance específica.
    try {
      parsed = await callOnce(
        `Your previous response had ALL arrays empty (key_files, dependencies.internal, dependencies.external, concerns) for this folder. The folder has ${task.files_to_read.length} visible file blocks above — that is suspicious. Re-read the file contents more carefully and emit at least:\n` +
        `- file names actually shown (in key_files)\n` +
        `- the most-imported package or import statement (in dependencies.external)\n` +
        `- any TODO comments, dead code, or known anti-patterns you observe (in concerns)\n` +
        `If the folder genuinely has nothing extractable (only binary assets, only generated code, etc.), return arrays empty AGAIN — that confirms it is intentionally empty, not a missed read.`,
      );
    } catch (e: any) {
      return {
        path: task.sub_path,
        purpose: '[degraded-empty]',
        error: `suspicious-empty + retry call failed: ${e?.message ?? String(e)}`,
      };
    }
    const v2 = validateSubReport(parsed);
    if (v2.ok) {
      if (!isEmptyShape(v2.value)) return v2.value;
      // Sigue vacío tras retry: marcar como degraded, NO devolver como válido.
      return {
        path: task.sub_path,
        purpose: '[degraded-empty]',
        error: `suspicious empty subreport — ${task.files_to_read.length} files visible but no content extracted (after empty-aware retry)`,
      };
    }
    return {
      path: task.sub_path,
      purpose: '[degraded-empty]',
      error: `suspicious-empty + retry validation failed: ${v2.error}`,
    };
  }

  // Retry once with the validation error as additional guidance
  try {
    parsed = await callOnce(
      `Your previous response failed validation: ${v.error}. Return strictly valid JSON now.`,
    );
  } catch (e: any) {
    return {
      path: task.sub_path,
      purpose: '[unreadable]',
      error: `LLM call failed on retry: ${e?.message ?? String(e)}`,
    };
  }

  v = validateSubReport(parsed);
  if (v.ok) {
    if (!hadVisibleFiles || !isEmptyShape(v.value)) return v.value;
    // Pasó validación tras retry pero está vacío con archivos visibles.
    return {
      path: task.sub_path,
      purpose: '[degraded-empty]',
      error: `suspicious empty subreport after validation retry — ${task.files_to_read.length} files visible`,
    };
  }

  return {
    path: task.sub_path,
    purpose: '[unreadable]',
    error: `validation failed twice: ${v.error}`,
  };
}
