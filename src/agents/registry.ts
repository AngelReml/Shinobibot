// src/agents/registry.ts
//
// Registro de los agentes especialistas de Shinobi. Singleton: los tres
// agentes del Bloque 1 se instancian una vez al cargar el módulo. Si
// cualquiera viola su contrato, la instanciación lanza y el fallo es
// inmediato y visible (no un cascarón silencioso).

import { SpecialistAgent } from './specialist_agent.js';
import { ResearchAgent } from './research_agent.js';
import { DocsAgent } from './docs_agent.js';
import { DataAgent } from './data_agent.js';
import type { SpecialistAgentInfo } from './types.js';

const _agents = new Map<string, SpecialistAgent>();

function register(agent: SpecialistAgent): void {
  if (_agents.has(agent.id)) {
    throw new Error(`agents/registry: id duplicado "${agent.id}".`);
  }
  _agents.set(agent.id, agent);
}

// Los tres agentes especialistas del encargo.
register(new ResearchAgent());
register(new DocsAgent());
register(new DataAgent());

/** Todos los agentes especialistas registrados. */
export function listSpecialistAgents(): SpecialistAgent[] {
  return [..._agents.values()];
}

/** Un agente por id, o undefined si no existe. */
export function getSpecialistAgent(id: string): SpecialistAgent | undefined {
  return _agents.get(id);
}

/** Vista serializable de todos los agentes (para listados/introspección). */
export function describeSpecialistAgents(): SpecialistAgentInfo[] {
  return listSpecialistAgents().map(a => a.describe());
}
