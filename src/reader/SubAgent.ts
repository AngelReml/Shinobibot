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
  chat(messages: { role: string; content: string }[], opts?: { model?: string }): Promise<string>;
}

const SYSTEM_PROMPT = `You are a sub-agent reading one folder of a code repository.
Return ONE JSON object matching this exact schema (no prose, no markdown fence):

{
  "path": string,
  "purpose": string (max 200 chars),
  "key_files": [{"name": string, "role": string (max 100)}]   // max 8
  "dependencies": {"internal": string[], "external": string[]},
  "concerns": string[]   // max 5, each <=150 chars
}

Rules:
- If you cannot read a file, set the field to null. Do NOT invent paths or function names.
- "internal" dependencies = paths within this repo (use relative paths like "src/utils/foo").
- "external" dependencies = npm/PyPI/etc package names you literally see imported.
- "concerns" = factual observations only (TODO comments, dead code, missing tests). No speculation.
- All array fields are required (use [] when empty). Output JSON only.`;

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

  const userPrompt = buildUserPrompt(task, fileContents);

  const callOnce = async (extraSystem = ''): Promise<unknown> => {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + (extraSystem ? `\n\n${extraSystem}` : '') },
      { role: 'user', content: userPrompt },
    ];
    const raw = await llm.chat(messages, { model: opts.model });
    return tryParseJSON(raw);
  };

  // First attempt
  let parsed: unknown;
  try {
    parsed = await callOnce();
  } catch (e: any) {
    parsed = { __parse_error: e?.message ?? String(e) };
  }

  let v = validateSubReport(parsed);
  if (v.ok) return v.value;

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
  if (v.ok) return v.value;

  return {
    path: task.sub_path,
    purpose: '[unreadable]',
    error: `validation failed twice: ${v.error}`,
  };
}
