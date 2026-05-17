// src/skills/skill_manager.ts
//
// Bloque 3 — Skill Manager autónomo. Bucle de auto-mejora inspirado en
// Hermes Agent.
//
// Flujo:
//   1. observeRun({input, toolSequence, success, error}) en cada turno.
//      Persiste en task_runs.db (better-sqlite3).
//   2. evaluateAndPropose() corre triggers después de cada observeRun:
//        - failure trigger: N≥SHINOBI_SKILL_FAILURE_THRESHOLD (default 3)
//          fallos consecutivos del mismo prompt (input_hash) → propone skill
//          de tipo "failure recovery"
//        - pattern trigger: misma tool_sequence aparece M≥SHINOBI_SKILL_PATTERN_THRESHOLD
//          (default 5) veces con éxito → propone skill de tipo "shortcut"
//   3. proposeSkill() llama a OpenRouter (anthropic/claude-haiku-4.5 default)
//      en background fire-and-forget, escribe SKILL.md en skills/pending/.
//      Emite evento `skill_proposed` para el listener (server.ts → WS).
//   4. approve(id) mueve pending → approved (con status: approved en frontmatter).
//   5. reject(id) borra pending.
//   6. loadApproved() lee skills/approved/ a un índice in-memory.
//   7. getContextSection(input) matchea por trigger_keywords y devuelve un
//      bloque para inyectar como system message en el orchestrator.
//
// Cohabitación: SkillLoader (src/skills/skill_loader.ts) sigue gestionando
// .mjs ejecutables que vienen de OpenGravity. SkillManager gestiona SKILL.md
// (prompts) generados localmente. Ambos coexisten sin pisarse.

import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { randomUUID, createHash } from 'crypto';
import {
  parseSkillMd,
  serializeSkillMd,
  type ParsedSkill,
  type SkillFrontmatter,
} from './skill_md_parser.js';
import { verifySkill } from './skill_signing.js';
import { bumpUse, markAgentCreated } from '../learning/skill_telemetry.js';

/** Kinds de skill nacidos del agente (elegibles para el Curator), vs 'manual'. */
function isAgentBornKind(kind: string | undefined): boolean {
  return kind === 'review' || kind === 'failure' || kind === 'pattern';
}
import { invokeLLMViaOpenRouter } from '../cloud/openrouter_fallback.js';
import type { CloudResponse, LLMChatPayload } from '../cloud/types.js';

const FAILURE_THRESHOLD = parseInt(process.env.SHINOBI_SKILL_FAILURE_THRESHOLD || '3', 10);
const PATTERN_THRESHOLD = parseInt(process.env.SHINOBI_SKILL_PATTERN_THRESHOLD || '5', 10);
const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';

interface RunRow {
  id: string;
  ts: string;
  input_hash: string;
  prompt: string;
  tool_sequence_json: string;
  success: number;
  error: string | null;
}

interface ApprovedSkill {
  id: string;
  frontmatter: SkillFrontmatter;
  body: string;
  filepath: string;
}

export interface SkillEvent {
  type: 'skill_proposed' | 'skill_approved' | 'skill_rejected';
  id: string;
  name?: string;
  description?: string;
  source_kind?: string;
}

export interface ObserveRunInput {
  input: string;
  toolSequence: string[];
  success: boolean;
  error?: string;
}

type LLMInvoker = (payload: LLMChatPayload) => Promise<CloudResponse>;

let invoker: LLMInvoker = invokeLLMViaOpenRouter;
let listener: ((e: SkillEvent) => void) | null = null;

/** Override the LLM caller. Used by tests to avoid real network calls. */
export function setLLMInvokerForTesting(fn: LLMInvoker | null): void {
  invoker = fn ?? invokeLLMViaOpenRouter;
}

/** Subscribe to skill lifecycle events (server.ts uses this to broadcast over WS). */
export function setSkillEventListener(fn: ((e: SkillEvent) => void) | null): void {
  listener = fn;
}

function emit(e: SkillEvent): void {
  try { listener?.(e); } catch { /* ignore listener errors */ }
}

function ensureDirs(skillsRoot: string, pendingDir: string, approvedDir: string): void {
  if (!fs.existsSync(skillsRoot)) fs.mkdirSync(skillsRoot, { recursive: true });
  if (!fs.existsSync(pendingDir)) fs.mkdirSync(pendingDir, { recursive: true });
  if (!fs.existsSync(approvedDir)) fs.mkdirSync(approvedDir, { recursive: true });
}

function inputHash(input: string): string {
  return createHash('sha256').update(input.trim().toLowerCase()).digest('hex').slice(0, 16);
}

function patternHash(toolSeq: string[]): string {
  return createHash('sha256').update(JSON.stringify(toolSeq)).digest('hex').slice(0, 16);
}

class SkillManagerImpl {
  private db: Database.Database;
  private approved: ApprovedSkill[] = [];
  private lastObservedRun: ObserveRunInput | null = null;
  private skillsRoot: string;
  private pendingDir: string;
  private approvedDir: string;
  private dbPathStr: string;

  /**
   * Paths are computed from `cwd` at construction time so tests can sandbox
   * the manager against a temp directory by passing { cwd } explicitly.
   * Production code uses the no-arg form which snapshots process.cwd() once.
   */
  constructor(opts?: string | { dbPath?: string; cwd?: string }) {
    const o = typeof opts === 'string' ? { dbPath: opts } : (opts || {});
    const cwd = o.cwd ?? process.cwd();
    this.skillsRoot = path.join(cwd, 'skills');
    this.pendingDir = path.join(this.skillsRoot, 'pending');
    this.approvedDir = path.join(this.skillsRoot, 'approved');
    this.dbPathStr = o.dbPath ?? path.join(cwd, 'task_runs.db');

    ensureDirs(this.skillsRoot, this.pendingDir, this.approvedDir);
    this.db = new Database(this.dbPathStr);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_runs (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        prompt TEXT NOT NULL,
        tool_sequence_json TEXT NOT NULL,
        success INTEGER NOT NULL,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_input_hash ON task_runs(input_hash);
      CREATE INDEX IF NOT EXISTS idx_ts ON task_runs(ts);
    `);
  }

  /** Returns the path of the DB (mostly for tests / debugging). */
  dbPath(): string {
    return this.dbPathStr;
  }

  observeRun(run: ObserveRunInput): void {
    this.lastObservedRun = run;
    const hash = inputHash(run.input);
    this.db.prepare(`
      INSERT INTO task_runs (id, ts, input_hash, prompt, tool_sequence_json, success, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      new Date().toISOString(),
      hash,
      run.input.slice(0, 1000),
      JSON.stringify(run.toolSequence),
      run.success ? 1 : 0,
      run.error?.slice(0, 1000) || null,
    );
    // Fire-and-forget evaluation. Errors are logged but not propagated.
    void this.evaluateAndPropose(hash, run).catch(e => {
      console.log(`[skill-manager] evaluateAndPropose error: ${e?.message ?? e}`);
    });
  }

  /** Public hook for tests / manual flows: evaluate triggers without observeRun. */
  async evaluateAndPropose(hash: string, run: ObserveRunInput): Promise<void> {
    // Failure trigger
    const recent = this.db.prepare(`
      SELECT * FROM task_runs WHERE input_hash = ? ORDER BY ts DESC LIMIT ?
    `).all(hash, FAILURE_THRESHOLD) as RunRow[];
    if (recent.length >= FAILURE_THRESHOLD && recent.every(r => r.success === 0)) {
      if (!this.hasPendingForHash(hash)) {
        await this.proposeFromFailures(run.input, recent, hash);
      }
      return;
    }

    // Pattern trigger
    if (run.success && run.toolSequence.length >= 2) {
      const seqJson = JSON.stringify(run.toolSequence);
      const row = this.db.prepare(
        `SELECT COUNT(*) AS c FROM task_runs WHERE tool_sequence_json = ? AND success = 1`
      ).get(seqJson) as { c: number };
      if (row.c >= PATTERN_THRESHOLD) {
        const ph = patternHash(run.toolSequence);
        if (!this.hasPendingForPattern(ph)) {
          await this.proposeFromPattern(run.input, run.toolSequence, row.c, ph);
        }
      }
    }
  }

  private hasPendingForHash(hash: string): boolean {
    return this.scanPendingFor(`source_hash: ${hash}`);
  }
  private hasPendingForPattern(ph: string): boolean {
    return this.scanPendingFor(`source_pattern_hash: ${ph}`);
  }
  private scanPendingFor(needle: string): boolean {
    try {
      const files = fs.readdirSync(this.pendingDir).filter(f => f.endsWith('.skill.md'));
      for (const f of files) {
        const content = fs.readFileSync(path.join(this.pendingDir, f), 'utf-8');
        if (content.includes(needle)) return true;
      }
    } catch { /* ignore */ }
    return false;
  }

  private async proposeFromFailures(input: string, runs: RunRow[], hash: string): Promise<void> {
    const errors = runs.map(r => r.error || '(no error captured)').join('\n');
    const prompt =
      `The user has tried this task ${runs.length} consecutive times and it failed each time.\n\n` +
      `Task: "${input}"\n\n` +
      `Errors observed:\n${errors}\n\n` +
      `Generate a SKILL.md document that captures how to handle this kind of task correctly. ` +
      `Output ONLY the markdown, starting with --- frontmatter (name, description, trigger_keywords as inline list) ` +
      `and a body with step-by-step instructions. Keep it focused and actionable.`;
    await this.runProposal(prompt, { source_hash: hash, source_kind: 'failure' });
  }

  private async proposeFromPattern(input: string, toolSeq: string[], count: number, ph: string): Promise<void> {
    const prompt =
      `The user has performed this kind of task ${count} times with the same tool sequence: ${toolSeq.join(' -> ')}.\n\n` +
      `Example task: "${input}"\n\n` +
      `Generate a SKILL.md document that captures this repeated pattern as a reusable skill. ` +
      `Output ONLY the markdown, starting with --- frontmatter (name, description, trigger_keywords as inline list) ` +
      `and a body with step-by-step instructions referencing the tool sequence above.`;
    await this.runProposal(prompt, { source_pattern_hash: ph, source_kind: 'pattern' });
  }

  /** Manually propose a skill for arbitrary context (used by /skill propose). */
  async proposeSkill(context: string, kind: string = 'manual'): Promise<{ ok: boolean; id?: string; name?: string; error?: string }> {
    const prompt =
      `Generate a SKILL.md for the following context:\n\n${context}\n\n` +
      `Output ONLY the markdown, starting with --- frontmatter ` +
      `(name, description, trigger_keywords as inline list) and a body with step-by-step instructions.`;
    return await this.runProposal(prompt, { source_kind: kind });
  }

  getLastObservedRun(): ObserveRunInput | null {
    return this.lastObservedRun;
  }

  private async runProposal(
    prompt: string,
    extraFrontmatter: Record<string, string>,
  ): Promise<{ ok: boolean; id?: string; name?: string; error?: string }> {
    console.log('[skill-manager] Proposing new skill...');
    const result = await invoker({
      model: DEFAULT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2048,
    });
    if (!result.success) {
      console.log(`[skill-manager] Proposal failed: ${result.error}`);
      return { ok: false, error: result.error };
    }

    let content = '';
    try {
      const msg = JSON.parse(result.output);
      if (typeof msg.content === 'string') content = msg.content;
      else if (Array.isArray(msg.content)) content = msg.content.map((p: any) => p.text || '').join('');
    } catch (e: any) {
      return { ok: false, error: `parse: ${e.message}` };
    }
    if (!content) return { ok: false, error: 'empty content from LLM' };

    // Strip code-fence wrappers if the LLM returned ```markdown ... ```
    content = content.trim();
    content = content.replace(/^```(?:markdown|md)?\s*\n/, '').replace(/\n```\s*$/, '');

    if (!content.startsWith('---')) {
      return { ok: false, error: 'LLM did not return SKILL.md format (no leading frontmatter)' };
    }

    const parsed = parseSkillMd(content);
    const id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    parsed.frontmatter.created_at = String(parsed.frontmatter.created_at || new Date().toISOString());
    parsed.frontmatter.status = 'pending';
    parsed.frontmatter.source = 'auto';
    for (const [k, v] of Object.entries(extraFrontmatter)) parsed.frontmatter[k] = v;

    ensureDirs(this.skillsRoot, this.pendingDir, this.approvedDir);
    const filepath = path.join(this.pendingDir, `${id}.skill.md`);
    fs.writeFileSync(filepath, serializeSkillMd(parsed), 'utf-8');

    const name = String(parsed.frontmatter.name || id);
    const description = String(parsed.frontmatter.description || '');
    // Fase 5 — provenance: una skill nacida del agente (review / failure /
    // pattern, NO 'manual') se marca created_by='agent' en la telemetría.
    // Es el gate del Curator: solo toca skills 'agent', nunca las del
    // usuario ni las instaladas. proposeSkill manual deja created_by='user'.
    if (isAgentBornKind(extraFrontmatter.source_kind)) {
      markAgentCreated(name);
    }
    console.log(`[skill-manager] New skill proposed: ${name} (${id})`);
    emit({ type: 'skill_proposed', id, name, description, source_kind: extraFrontmatter.source_kind });
    return { ok: true, id, name };
  }

  approve(id: string): { ok: boolean; message: string; name?: string } {
    ensureDirs(this.skillsRoot, this.pendingDir, this.approvedDir);
    const src = path.join(this.pendingDir, `${id}.skill.md`);
    if (!fs.existsSync(src)) return { ok: false, message: `pending skill not found: ${id}` };
    const parsed = parseSkillMd(fs.readFileSync(src, 'utf-8'));
    parsed.frontmatter.status = 'approved';
    const dst = path.join(this.approvedDir, `${id}.skill.md`);
    fs.writeFileSync(dst, serializeSkillMd(parsed), 'utf-8');
    fs.unlinkSync(src);
    this.loadApproved();
    const name = String(parsed.frontmatter.name || id);
    emit({ type: 'skill_approved', id, name });
    return { ok: true, message: `approved: ${name}`, name };
  }

  reject(id: string): { ok: boolean; message: string } {
    const src = path.join(this.pendingDir, `${id}.skill.md`);
    if (!fs.existsSync(src)) return { ok: false, message: `pending skill not found: ${id}` };
    fs.unlinkSync(src);
    emit({ type: 'skill_rejected', id });
    return { ok: true, message: `rejected and removed: ${id}` };
  }

  listPending(): { id: string; name: string; description: string; created_at: string; source_kind: string }[] {
    ensureDirs(this.skillsRoot, this.pendingDir, this.approvedDir);
    const files = fs.readdirSync(this.pendingDir).filter(f => f.endsWith('.skill.md'));
    return files.map(f => {
      const id = f.replace(/\.skill\.md$/, '');
      try {
        const parsed = parseSkillMd(fs.readFileSync(path.join(this.pendingDir, f), 'utf-8'));
        return {
          id,
          name: String(parsed.frontmatter.name || id),
          description: String(parsed.frontmatter.description || ''),
          created_at: String(parsed.frontmatter.created_at || ''),
          source_kind: String(parsed.frontmatter.source_kind || 'manual'),
        };
      } catch (e: any) {
        return { id, name: '(parse error)', description: e.message, created_at: '', source_kind: 'unknown' };
      }
    });
  }

  loadApproved(): { count: number; errors: string[] } {
    ensureDirs(this.skillsRoot, this.pendingDir, this.approvedDir);
    const errors: string[] = [];
    const files = fs.readdirSync(this.approvedDir).filter(f => f.endsWith('.skill.md'));
    const out: ApprovedSkill[] = [];
    for (const f of files) {
      try {
        const filepath = path.join(this.approvedDir, f);
        const parsed = parseSkillMd(fs.readFileSync(filepath, 'utf-8'));
        // C9 — verifica la firma SHA256 al cargar. `hash_mismatch` = el
        // SKILL.md se editó fuera del flujo de aprobación → se rechaza por
        // posible manipulación. Una skill sin firma (legacy) se carga con
        // aviso, no se bloquea (no rompe instalaciones previas).
        const verdict = verifySkill(parsed);
        if (!verdict.valid && verdict.reason === 'hash_mismatch') {
          errors.push(`${f}: firma inválida (hash_mismatch) — skill rechazada por posible manipulación del SKILL.md`);
          continue;
        }
        if (!verdict.valid && verdict.reason === 'missing_signature') {
          console.warn(`[skill_manager] ${f}: skill sin firma (legacy) — cargada sin verificación de integridad`);
        }
        out.push({
          id: f.replace(/\.skill\.md$/, ''),
          frontmatter: parsed.frontmatter,
          body: parsed.body,
          filepath,
        });
      } catch (e: any) {
        errors.push(`${f}: ${e.message}`);
      }
    }
    this.approved = out;
    return { count: out.length, errors };
  }

  approvedCount(): number { return this.approved.length; }

  /**
   * Match approved skills against the user's input by `trigger_keywords`.
   * Substring match (case-insensitive). Returns up to 3 skill bodies as a
   * single system-message-ready block, or null if no match.
   */
  getContextSection(input: string, maxSkills: number = 3, maxBodyChars: number = 1500): string | null {
    if (this.approved.length === 0) return null;
    const inputLower = input.toLowerCase();
    const matched: ApprovedSkill[] = [];
    for (const skill of this.approved) {
      const kws = skill.frontmatter.trigger_keywords;
      if (!Array.isArray(kws) || kws.length === 0) continue;
      const hit = kws.some(kw => typeof kw === 'string' && kw.length > 0 && inputLower.includes(kw.toLowerCase()));
      if (hit) matched.push(skill);
      if (matched.length >= maxSkills) break;
    }
    if (matched.length === 0) return null;

    // Fase 4 — telemetría: una skill que se inyecta al prompt cuenta como
    // uso. Es el ancla de staleness que consume el Curator (best-effort).
    for (const s of matched) bumpUse(String(s.frontmatter.name || ''));

    const sections = matched.map(s => {
      const name = s.frontmatter.name || '?';
      const desc = s.frontmatter.description || '';
      const body = s.body.length > maxBodyChars ? s.body.slice(0, maxBodyChars) + '\n[...truncated]' : s.body;
      return `## Skill: ${name}\n${desc ? desc + '\n\n' : ''}${body}`;
    });
    return [
      '[Shinobi Skills] One or more local skills match this input. Use them as guidance.',
      sections.join('\n\n---\n\n'),
    ].join('\n\n');
  }
}

let _instance: SkillManagerImpl | null = null;

/** Lazy singleton (so tests can construct their own with a custom DB path via `SkillManagerImpl`). */
export function skillManager(): SkillManagerImpl {
  if (!_instance) _instance = new SkillManagerImpl();
  return _instance;
}

/** Re-export the class for tests that want isolated instances. */
export { SkillManagerImpl };
