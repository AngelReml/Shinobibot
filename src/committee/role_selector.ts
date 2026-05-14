/**
 * Role Selector — dada una descripción de tarea, elige los N roles más
 * relevantes del Role Registry (Sprint 2.2).
 *
 * Política:
 *   1. Para cada rol del catálogo, calcula `relevance(role, task)`.
 *   2. Ordena descendente.
 *   3. Garantiza incluir al menos 1 "core" role (architect) y 1
 *      "security" role (security_auditor) cuando la tarea no es
 *      explícitamente off-topic — esto evita que el selector pierda
 *      la cobertura mínima.
 *   4. Toma top `count` (default 3).
 *
 * Si el caller force-listed `requiredIds`, esos roles entran siempre,
 * los demás slots se llenan con top-relevance restantes.
 */

import { listRoles, relevanceFor, type RoleDefinition } from './role_registry.js';
import { VoteHistory } from './vote_history.js';

export interface SelectorOptions {
  count?: number;
  requiredIds?: string[];
  ensureCoreCoverage?: boolean;
  history?: VoteHistory;
}

export interface SelectedRole extends RoleDefinition {
  relevance: number;
  weight: number;
}

const CORE_IDS = ['architect', 'security_auditor'];

export function selectRoles(taskDescription: string, opts: SelectorOptions = {}): SelectedRole[] {
  const count = Math.max(1, opts.count ?? 3);
  const ensureCore = opts.ensureCoreCoverage !== false;
  const required = opts.requiredIds ?? [];
  const history = opts.history ?? new VoteHistory();
  const catalog = listRoles();

  const scored = catalog.map(r => ({
    role: r,
    relevance: relevanceFor(r, taskDescription),
  })).sort((a, b) => b.relevance - a.relevance);

  const picked = new Map<string, SelectedRole>();

  // Step 1: required roles (siempre).
  for (const id of required) {
    const r = catalog.find(c => c.id === id);
    if (r && !picked.has(id)) {
      picked.set(id, {
        ...r,
        relevance: relevanceFor(r, taskDescription),
        weight: history.statsFor(id).weight,
      });
    }
  }

  // Step 2: core coverage (architect + security_auditor) si aplica.
  if (ensureCore) {
    for (const id of CORE_IDS) {
      if (picked.size >= count) break;
      if (picked.has(id)) continue;
      const r = catalog.find(c => c.id === id);
      if (r) {
        picked.set(id, {
          ...r,
          relevance: relevanceFor(r, taskDescription),
          weight: history.statsFor(id).weight,
        });
      }
    }
  }

  // Step 3: top relevance restantes hasta llenar count.
  for (const s of scored) {
    if (picked.size >= count) break;
    if (picked.has(s.role.id)) continue;
    picked.set(s.role.id, {
      ...s.role,
      relevance: s.relevance,
      weight: history.statsFor(s.role.id).weight,
    });
  }

  // Step 4: orden final por (weight × relevance) descendente.
  return [...picked.values()].sort((a, b) => (b.weight * b.relevance) - (a.weight * a.relevance));
}
