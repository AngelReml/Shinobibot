// src/dispatch/types.ts
//
// Tipos del clasificador de despacho por afinidad (Bloque 3 del encargo).
// El clasificador decide a qué agente especialista encaja una orden del
// usuario. Funciona en SHADOW MODE: registra su decisión pero NO controla
// el despacho real (que sigue siendo el orchestrator general).

import type { SpecialistAgent } from '../agents/specialist_agent.js';

/** Destino de despacho: uno de los 3 especialistas, o el orchestrator general. */
export type DispatchSpecialist = 'research_agent' | 'docs_agent' | 'data_agent' | 'general';

export const SPECIALISTS: readonly DispatchSpecialist[] =
  ['research_agent', 'docs_agent', 'data_agent', 'general'] as const;

export type DispatchConfidence = 'high' | 'medium' | 'low';

/** Decisión del clasificador para una orden del usuario. */
export interface DispatchDecision {
  /** Especialista elegido (o 'general' si ninguno encaja claramente). */
  specialist: DispatchSpecialist;
  /** Confianza del clasificador en la decisión. */
  confidence: DispatchConfidence;
  /** Una frase: por qué ese destino. */
  rationale: string;
}

/** Una entrada del registro shadow — comparación shadow vs despacho actual. */
export interface ShadowEntry {
  /** Timestamp ISO. */
  ts: string;
  /** Mensaje del usuario (truncado). */
  message: string;
  /** Lo que el clasificador HABRÍA decidido (sin tener el control). */
  shadow: DispatchDecision;
  /**
   * Lo que el despacho ACTUAL hizo. Hoy Shinobi no tiene router: toda orden
   * la maneja el orchestrator general. Por eso este campo es constante
   * ('general-orchestrator') — la comparación que Iván lee es: ¿el shadow
   * habría enrutado a un especialista donde el despacho actual fue general?
   */
  currentDispatch: 'general-orchestrator';
}

export type { SpecialistAgent };
