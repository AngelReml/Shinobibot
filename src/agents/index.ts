// src/agents/index.ts
//
// Barrel del subsistema de agentes especialistas (Bloque 1 del encargo
// multibloque). Punto de entrada único para el resto del runtime.

export { SpecialistAgent } from './specialist_agent.js';
export { ResearchAgent } from './research_agent.js';
export { DocsAgent } from './docs_agent.js';
export { DataAgent } from './data_agent.js';
export {
  listSpecialistAgents,
  getSpecialistAgent,
  describeSpecialistAgents,
} from './registry.js';
export {
  AgentContractError,
  ToolNotAllowedError,
  type AgentLevel,
  type SpecialistAgentSpec,
  type SpecialistAgentInfo,
} from './types.js';
export {
  agentLLM,
  setAgentLLM,
  type DocsOutput,
  type DataOutput,
  type ResearchOutput,
  type ResearchSource,
  type WebResult,
  type SearchFn,
} from './agent_runtime.js';
export type { DocsRequest } from './docs_agent.js';
export type { DataRequest } from './data_agent.js';
export type { ResearchOptions } from './research_agent.js';
export {
  listAlcaynaAgents,
  getAlcaynaAgent,
  getAlcaynaAgentByKeyword,
  ALCAYNA_AGENT_IDS,
  type AlcaynaAgentDef,
  type AlcaynaLayer,
} from './agent_registry.js';
