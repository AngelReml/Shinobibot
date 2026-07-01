// src/constants/__tests__/system_prompt_tools_sync.test.ts
//
// F0.7 — el SYSTEM_PROMPT omitía las tools de delegación multi-agente
// (spawn_agent, run_swarm, run_team, synthesize_skill). Este test de
// regresión asegura que:
//   1. las 4 tools de delegación están mencionadas por nombre.
//   2. toda tool marcada como DESTRUCTIVE_TOOLS (security/approval.ts) está
//      mencionada por nombre — así una tool destructiva nueva no puede
//      colarse sin que el prompt la documente.

import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT } from '../prompts.js';
import { DESTRUCTIVE_TOOLS } from '../../security/approval.js';

// Tools de delegación multi-agente (confirmadas por registro real en
// src/tools/*.ts vía `name: '...'` — ver spawn_agent.ts, run_swarm.ts,
// run_team.ts, synthesize_skill.ts).
const DELEGATION_TOOLS = ['spawn_agent', 'run_swarm', 'run_team', 'synthesize_skill'];

function mentionsToolByName(prompt: string, toolName: string): boolean {
  // Busca el nombre exacto, tolerando que esté envuelto en backticks/comillas
  // en el prompt (p.ej. \`spawn_agent\`), pero no como substring de otra tool
  // (p.ej. "run_team" no debe casar dentro de "run_team_orchestrated").
  const re = new RegExp(`(?<![\\w-])${toolName}(?![\\w-])`);
  return re.test(prompt);
}

describe('SYSTEM_PROMPT — sincronía con el registro de tools (F0.7)', () => {
  it.each(DELEGATION_TOOLS)('menciona la tool de delegación "%s" por nombre', (toolName) => {
    expect(mentionsToolByName(SYSTEM_PROMPT, toolName)).toBe(true);
  });

  it.each(Array.from(DESTRUCTIVE_TOOLS))('menciona la tool destructiva "%s" por nombre', (toolName) => {
    expect(mentionsToolByName(SYSTEM_PROMPT, toolName)).toBe(true);
  });

  it('DESTRUCTIVE_TOOLS no está vacío (sanity check de la fuente de verdad)', () => {
    expect(DESTRUCTIVE_TOOLS.size).toBeGreaterThan(0);
  });

  it('SYSTEM_PROMPT tiene una sección explícita de delegación multi-agente', () => {
    expect(SYSTEM_PROMPT).toMatch(/MULTI-AGENT DELEGATION/i);
  });
});
