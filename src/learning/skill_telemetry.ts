/**
 * Fase 4 del bucle de aprendizaje — telemetría sidecar de skills.
 *
 * Sidecar JSON en `skills/.usage.json`, keyed por nombre de skill. APARTE
 * del frontmatter del SKILL.md (para no generar conflictos en skills
 * firmadas/instaladas). Cuenta use/view/patch por skill; el `last_used_at`
 * es el ancla de staleness que consumirá el Curator (Fase 6).
 *
 * Best-effort en todo: un sidecar roto NUNCA rompe un tool. Escritura
 * atómica (temp + rename).
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export type SkillState = 'active' | 'stale' | 'archived';

export interface SkillUsageRecord {
  /** 'agent' = nacida del background review → elegible para el Curator.
   *  'user' = creada/instalada por el usuario → el Curator NO la toca. */
  created_by: 'agent' | 'user';
  use_count: number;
  view_count: number;
  patch_count: number;
  last_used_at: string | null;
  last_viewed_at: string | null;
  last_patched_at: string | null;
  created_at: string;
  /** El Curator (Fase 6) es dueño de las transiciones de estado. */
  state: SkillState;
  pinned: boolean;
  archived_at: string | null;
}

export type SkillUsageFile = Record<string, SkillUsageRecord>;

/** Ruta del sidecar — `<cwd>/skills/.usage.json`, consistente con skill_manager. */
function usagePath(): string {
  return join(process.cwd(), 'skills', '.usage.json');
}

function nowISO(): string { return new Date().toISOString(); }

function emptyRecord(): SkillUsageRecord {
  return {
    created_by: 'user', // conservador: el Curator no toca skills 'user'
    use_count: 0, view_count: 0, patch_count: 0,
    last_used_at: null, last_viewed_at: null, last_patched_at: null,
    created_at: nowISO(),
    state: 'active', pinned: false, archived_at: null,
  };
}

/** Lee el sidecar. Un fichero ausente o corrupto devuelve `{}`. */
export function loadUsage(): SkillUsageFile {
  try {
    const p = usagePath();
    if (!existsSync(p)) return {};
    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed as SkillUsageFile : {};
  } catch {
    return {};
  }
}

/** Escritura atómica del sidecar. Best-effort: un fallo no propaga. */
function saveUsage(data: SkillUsageFile): void {
  try {
    const p = usagePath();
    mkdirSync(dirname(p), { recursive: true });
    const tmp = p + '.tmp';
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    renameSync(tmp, p);
  } catch { /* best-effort — la telemetría nunca rompe un tool */ }
}

/** Aplica `mutate` al registro de `name` (creándolo si no existe) y persiste. */
function bump(name: string, mutate: (r: SkillUsageRecord) => void): void {
  if (!name) return;
  try {
    const data = loadUsage();
    const rec = data[name] ?? emptyRecord();
    mutate(rec);
    data[name] = rec;
    saveUsage(data);
  } catch { /* best-effort */ }
}

/** Una skill se inyectó al prompt o se referenció (ancla de staleness). */
export function bumpUse(name: string): void {
  bump(name, (r) => { r.use_count++; r.last_used_at = nowISO(); });
}

/** Una skill se abrió/leyó (skill_view, `/skill <name>`). */
export function bumpView(name: string): void {
  bump(name, (r) => { r.view_count++; r.last_viewed_at = nowISO(); });
}

/** Una skill se parcheó/editó. */
export function bumpPatch(name: string): void {
  bump(name, (r) => { r.patch_count++; r.last_patched_at = nowISO(); });
}

/** Marca una skill como nacida del agente (gate de elegibilidad del Curator). */
export function markAgentCreated(name: string): void {
  bump(name, (r) => { r.created_by = 'agent'; });
}

/** Transición de estado (la aplica el Curator — Fase 6). archived fija archived_at. */
export function setSkillState(name: string, state: SkillState): void {
  bump(name, (r) => {
    r.state = state;
    r.archived_at = state === 'archived' ? nowISO() : null;
  });
}

/** Registro de una skill, o null si no tiene telemetría aún. */
export function getUsageRecord(name: string): SkillUsageRecord | null {
  return loadUsage()[name] ?? null;
}

/**
 * Lista de skills elegibles para el Curator (Fase 6): SOLO las nacidas del
 * agente (`created_by==='agent'`) y no archivadas. Las skills del usuario
 * (`created_by==='user'` — el default) y las instaladas/firmadas quedan
 * fuera por construcción: nunca reciben `markAgentCreated`. Es el gate que
 * impide que el motor de mantenimiento toque trabajo del usuario.
 */
export function listAgentCreatedSkillNames(): string[] {
  const data = loadUsage();
  return Object.entries(data)
    .filter(([, r]) => r.created_by === 'agent' && r.state !== 'archived')
    .map(([name]) => name);
}
