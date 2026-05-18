// src/agents/types.ts
//
// Contrato de un agente especialista de Shinobi (Bloque 1 del encargo
// multibloque). Un SpecialistAgent es una abstracción NUEVA e independiente
// — no es ni el Committee (roles efímeros) ni el SubAgent del reader.
//
// Un agente especialista declara cuatro cosas y nada más en el Bloque 1
// (la lógica de output llega en el Bloque 2):
//   1. identidad estable,
//   2. especialidad en UNA frase,
//   3. lista CERRADA de herramientas permitidas (su "caja"),
//   4. prompt madre, versionado en un fichero propio.

export type AgentLevel = 'L1' | 'L2' | 'L3';

export interface SpecialistAgentSpec {
  /** Identidad estable del agente, en snake_case. */
  id: string;
  /** Especialidad declarada en UNA sola frase (sin saltos de línea). */
  specialty: string;
  /**
   * Nivel del prompt madre (L1/L2/L3). Se decide ANTES de redactar el prompt
   * corriendo la matriz §7 del manual; el resultado queda documentado en el
   * frontmatter del fichero de prompt madre.
   */
  level: AgentLevel;
  /**
   * Lista CERRADA de herramientas que el agente puede usar (su "caja").
   * Cualquier tool fuera de esta lista se rechaza limpio.
   */
  allowedTools: readonly string[];
  /** Nombre del fichero de prompt madre dentro de src/agents/prompts/. */
  promptFile: string;
  /**
   * True si el agente OBTIENE input externo no confiable con sus propias
   * herramientas (p. ej. busca en la web). Activa la validación §9 capa 3:
   * un agente así NO puede tener herramientas irreversibles en su caja.
   *
   * Ojo: NO es lo mismo que "recibe contenido para procesar" — eso lo
   * cubre la separación estructural (§9 capa 1) dentro del prompt madre.
   */
  readsUntrustedInput: boolean;
}

/** Vista serializable de un agente (para listados / introspección). */
export interface SpecialistAgentInfo {
  id: string;
  specialty: string;
  level: AgentLevel;
  allowedTools: string[];
  readsUntrustedInput: boolean;
}

/** El contrato del agente está mal formado — no se puede instanciar. */
export class AgentContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentContractError';
  }
}

/** Un agente intentó usar una herramienta fuera de su caja. */
export class ToolNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolNotAllowedError';
  }
}
