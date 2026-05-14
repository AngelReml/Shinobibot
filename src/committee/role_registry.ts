/**
 * Role Registry — catálogo de roles disponibles para el Committee
 * evolutivo (Sprint 2.2).
 *
 * Cada rol declara:
 *   - `id`: identificador estable (usado en historial y dissents)
 *   - `label`: humano
 *   - `defaultModel`: modelo recomendado (puede override-arse)
 *   - `systemPrompt`: instrucciones específicas del rol
 *   - `keywords`: lista de palabras que indican alta relevancia
 *   - `relevance(task)`: devuelve 0..1 según qué tan aplicable es a la
 *     descripción de la tarea. La heurística por defecto es keyword
 *     matching ponderado; los roles pueden override para algo más
 *     sofisticado.
 *
 * Diferenciador vs el Committee original (`DEFAULT_ROLES` fijo, 3
 * miembros): este registry permite N roles, selección dinámica, y
 * pesos por historial.
 */

import type { CommitteeRole } from './Committee.js';

export interface RoleDefinition extends CommitteeRole {
  id: string;
  keywords: string[];
  /** Override opcional para una relevance más sofisticada. */
  customRelevance?: (taskDescription: string) => number;
}

export const ROLE_CATALOG: RoleDefinition[] = [
  {
    id: 'architect',
    role: 'architect',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'Senior software architect. Evalúa estructura, coupling, riesgos arquitectónicos. Cita módulos y paths exactos.',
    keywords: ['architecture', 'arquitectura', 'estructura', 'design', 'diseño', 'module', 'refactor', 'coupling', 'system'],
  },
  {
    id: 'security_auditor',
    role: 'security_auditor',
    model: 'z-ai/glm-4.7-flash',
    systemPrompt: 'Application security auditor. Identifica attack surface, secret handling, command execution risks, dependency risk. Nombra file:line.',
    keywords: ['security', 'seguridad', 'vulnerab', 'exploit', 'audit', 'auditoría', 'sqli', 'xss', 'rce', 'cve', 'attack', 'credentials', 'token'],
  },
  {
    id: 'design_critic',
    role: 'design_critic',
    model: 'z-ai/glm-4.7-flash',
    systemPrompt: 'Product/design critic. Evalúa API ergonomics, naming, scope creep, hidden complexity. Cada item con un anclaje concreto.',
    keywords: ['ux', 'design', 'diseño', 'usability', 'ergonomics', 'naming', 'api', 'cli', 'command', 'flag', 'product'],
  },
  {
    id: 'performance_analyst',
    role: 'performance_analyst',
    model: 'claude-haiku-4-5',
    systemPrompt: 'Performance analyst. Identifica hot paths, N+1 queries, blocking I/O, leaks, allocations excesivas. Nombra el path y la métrica observable.',
    keywords: ['performance', 'rendimiento', 'latency', 'slow', 'lento', 'optimization', 'optimizar', 'memory', 'allocation', 'leak', 'cpu', 'benchmark', 'throughput'],
  },
  {
    id: 'data_modeler',
    role: 'data_modeler',
    model: 'claude-haiku-4-5',
    systemPrompt: 'Data modeler. Evalúa schemas, migraciones, integridad referencial, índices, particionamiento. Nombra tablas y campos.',
    keywords: ['database', 'sqlite', 'postgres', 'mysql', 'schema', 'migration', 'migración', 'data', 'datos', 'index', 'índice', 'tabla', 'table', 'modelo'],
  },
  {
    id: 'devops_reviewer',
    role: 'devops_reviewer',
    model: 'claude-haiku-4-5',
    systemPrompt: 'DevOps reviewer. Evalúa CI/CD, deployment, observability, runbooks, secrets management. Nombra workflows y scripts.',
    keywords: ['ci/cd', 'ci', 'cd', 'deploy', 'despliegue', 'docker', 'kubernetes', 'k8s', 'observability', 'monitoring', 'pipeline', 'github actions', 'workflow', 'runbook'],
  },
  {
    id: 'product_critic',
    role: 'product_critic',
    model: 'claude-haiku-4-5',
    systemPrompt: 'Product critic. Evalúa scope, prioridades, fit usuario. Cada crítica con un caso de uso concreto.',
    keywords: ['producto', 'product', 'users', 'usuarios', 'feature', 'priority', 'prioridad', 'scope', 'mvp', 'roadmap', 'fit'],
  },
];

/** Catálogo público (immutable). */
export function listRoles(): RoleDefinition[] {
  return [...ROLE_CATALOG];
}

export function getRole(id: string): RoleDefinition | undefined {
  return ROLE_CATALOG.find(r => r.id === id);
}

/**
 * Heurística base de relevance: comparación case-insensitive del input
 * contra los keywords del rol. Score = matches / max(keywords/2, 1)
 * normalizado a [0, 1]. Los roles con `customRelevance` pueden override.
 */
export function relevanceFor(role: RoleDefinition, taskDescription: string): number {
  if (role.customRelevance) return clamp01(role.customRelevance(taskDescription));
  const lower = (taskDescription || '').toLowerCase();
  if (!lower) return 0;
  let matches = 0;
  for (const k of role.keywords) {
    if (lower.includes(k.toLowerCase())) matches++;
  }
  // Normalización: una sola keyword fuerte ≈ 0.5, varias ≈ 1.
  const normalized = matches / Math.max(2, role.keywords.length / 2);
  return clamp01(normalized);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
