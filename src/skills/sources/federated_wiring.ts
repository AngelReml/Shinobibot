/**
 * Cableado de la cadena federada de skills (P2).
 *
 * `federatedSkillRegistry()` ensambla el FederatedSkillRegistry con las
 * fuentes disponibles (agentskills.io + ClawHub). Cada fuente se skipea
 * sola si no está configurada (`isConfigured()`), así que el registry es
 * usable aunque ninguna esté activa. C10 (verificación del hash declarado
 * contra el body) lo aplica `FederatedSkillRegistry.fetch()`.
 */

import { FederatedSkillRegistry } from './federated_registry.js';
import { AgentSkillsSource } from './agentskills_io.js';
import { ClawHubSource } from './clawhub.js';

let _registry: FederatedSkillRegistry | null = null;

/** Singleton del registry federado de skills. */
export function federatedSkillRegistry(): FederatedSkillRegistry {
  if (!_registry) {
    _registry = new FederatedSkillRegistry({
      sources: [new AgentSkillsSource(), new ClawHubSource()],
    });
  }
  return _registry;
}

/** Test helper: reinicia el singleton. */
export function _resetFederatedWiring(): void { _registry = null; }
