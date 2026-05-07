// Habilidad A — schemas + validador liviano (sin dep nueva).
// Contrato: docs/ARQUITECTURA_HABILIDAD_A.md §3.

export interface SubReport {
  path: string;
  purpose: string;
  key_files: { name: string; role: string }[];
  dependencies: { internal: string[]; external: string[] };
  concerns: string[];
}

export interface SubReportError {
  path: string;
  /**
   * Sentinel describing why this sub-report degraded:
   * - '[unreadable]' — LLM could not parse files / call failed / validation failed twice.
   * - '[degraded-empty]' — F-01: validation passed but all arrays empty for a folder
   *   that had visible files. Not silent: synthesizer treats it as a low-severity gap.
   */
  purpose: '[unreadable]' | '[degraded-empty]';
  error: string;
}

export interface RepoReport {
  repo_purpose: string;
  architecture_summary: string;
  modules: { name: string; path: string; responsibility: string }[];
  entry_points: { file: string; kind: string }[];
  risks: { severity: 'low' | 'medium' | 'high'; description: string }[];
  evidence: {
    subagent_count: number;
    tokens_total: number;
    duration_ms: number;
    subreports_referenced: number;
  };
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isStr(x: unknown, max?: number): x is string {
  if (typeof x !== 'string') return false;
  if (max !== undefined && x.length > max) return false;
  return true;
}

function isStrArr(x: unknown, maxItems?: number, maxLen?: number): x is string[] {
  if (!Array.isArray(x)) return false;
  if (maxItems !== undefined && x.length > maxItems) return false;
  return x.every((s) => isStr(s, maxLen));
}

export function validateSubReport(raw: unknown): ValidationResult<SubReport> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (!isStr(r.path)) return { ok: false, error: 'path missing or not string' };
  if (!isStr(r.purpose, 200)) return { ok: false, error: 'purpose missing or >200 chars' };
  if (!Array.isArray(r.key_files) || r.key_files.length > 8)
    return { ok: false, error: 'key_files must be array len<=8' };
  for (const kf of r.key_files) {
    const o = kf as Record<string, unknown>;
    if (!isStr(o?.name) || !isStr(o?.role, 100))
      return { ok: false, error: 'key_files item invalid (name/role)' };
  }
  const deps = r.dependencies as Record<string, unknown> | undefined;
  if (!deps || typeof deps !== 'object')
    return { ok: false, error: 'dependencies missing' };
  if (!isStrArr(deps.internal)) return { ok: false, error: 'dependencies.internal not string[]' };
  if (!isStrArr(deps.external)) return { ok: false, error: 'dependencies.external not string[]' };
  if (!isStrArr(r.concerns, 5, 150))
    return { ok: false, error: 'concerns must be string[] len<=5, item<=150' };
  return { ok: true, value: raw as SubReport };
}

export function validateRepoReport(raw: unknown): ValidationResult<RepoReport> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (!isStr(r.repo_purpose, 300)) return { ok: false, error: 'repo_purpose missing or >300' };
  if (!isStr(r.architecture_summary, 1500))
    return { ok: false, error: 'architecture_summary missing or >1500' };
  if (!Array.isArray(r.modules)) return { ok: false, error: 'modules must be array' };
  for (const m of r.modules) {
    const o = m as Record<string, unknown>;
    if (!isStr(o?.name) || !isStr(o?.path) || !isStr(o?.responsibility, 200))
      return { ok: false, error: 'module item invalid' };
  }
  if (!Array.isArray(r.entry_points)) return { ok: false, error: 'entry_points must be array' };
  for (const e of r.entry_points) {
    const o = e as Record<string, unknown>;
    if (!isStr(o?.file) || !isStr(o?.kind))
      return { ok: false, error: 'entry_point item invalid' };
  }
  if (!Array.isArray(r.risks)) return { ok: false, error: 'risks must be array' };
  for (const k of r.risks) {
    const o = k as Record<string, unknown>;
    if (!['low', 'medium', 'high'].includes(o?.severity as string))
      return { ok: false, error: 'risk.severity invalid' };
    if (!isStr(o?.description, 200))
      return { ok: false, error: 'risk.description invalid' };
  }
  const ev = r.evidence as Record<string, unknown> | undefined;
  if (
    !ev ||
    typeof ev.subagent_count !== 'number' ||
    typeof ev.tokens_total !== 'number' ||
    typeof ev.duration_ms !== 'number' ||
    typeof ev.subreports_referenced !== 'number'
  )
    return { ok: false, error: 'evidence missing or wrong types' };
  return { ok: true, value: raw as RepoReport };
}

export function tryParseJSON(s: string): unknown {
  // Tolerate ```json ... ``` fences emitted by some models.
  const trimmed = s.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const body = fenced ? fenced[1] : trimmed;
  return JSON.parse(body);
}
