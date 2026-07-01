import { describe, it, expect } from 'vitest';
import {
  listAgents,
  getAgent,
  getAgentByKeyword,
  AGENT_IDS,
} from '../agent_registry.js';
import { IntentRouter } from '../../dispatch/intent_router.js';

describe('AgentRegistry', () => {
  it('registers exactly 13 agents', () => {
    expect(listAgents()).toHaveLength(13);
  });

  it('all agent IDs are unique', () => {
    const ids = listAgents().map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all agent IDs are valid snake_case', () => {
    for (const agent of listAgents()) {
      expect(agent.id).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('all agents have non-empty allowedTools', () => {
    for (const agent of listAgents()) {
      expect(agent.allowedTools.length).toBeGreaterThan(0);
    }
  });

  it('all agents have non-empty system_prompt', () => {
    for (const agent of listAgents()) {
      expect(agent.system_prompt.trim().length).toBeGreaterThan(0);
    }
  });

  it('all agents have a valid layer', () => {
    const validLayers = ['direccion', 'go_to_market', 'operaciones', 'infraestructura'];
    for (const agent of listAgents()) {
      expect(validLayers).toContain(agent.layer);
    }
  });

  it('ceo_sintetico uses claude-opus, all others use claude-sonnet', () => {
    for (const agent of listAgents()) {
      if (agent.id === 'ceo_sintetico') {
        expect(agent.recommendedModel).toBe('claude-opus');
      } else {
        expect(agent.recommendedModel).toBe('claude-sonnet');
      }
    }
  });

  it('getAgent resolves by id', () => {
    const agent = getAgent('ceo_sintetico');
    expect(agent).toBeDefined();
    expect(agent?.layer).toBe('direccion');
  });

  it('getAgent returns undefined for unknown id', () => {
    expect(getAgent('nonexistent_dept')).toBeUndefined();
  });

  it('AGENT_IDS contains all 13 IDs', () => {
    expect(AGENT_IDS.size).toBe(13);
  });

  it('AGENT_IDS contains the expected department IDs', () => {
    const expected = [
      'marca_storytelling', 'comercial_b2b', 'producto_packaging', 'analisis_mercado',
      'contenido_community', 'atencion_cliente', 'operaciones_pedidos', 'finanzas_pricing',
      'legal_cumplimiento', 'diseno_visual', 'web_tecnologia', 'datos_bi', 'ceo_sintetico',
    ];
    for (const id of expected) {
      expect(AGENT_IDS.has(id)).toBe(true);
    }
  });

  it('getAgentByKeyword resolves exact keyword', () => {
    const agent = getAgentByKeyword('MODO MARCA ACTIVADO');
    expect(agent?.id).toBe('marca_storytelling');
  });

  it('getAgentByKeyword is case-insensitive', () => {
    expect(getAgentByKeyword('modo ceo activado')?.id).toBe('ceo_sintetico');
    expect(getAgentByKeyword('MODO CEO ACTIVADO')?.id).toBe('ceo_sintetico');
  });

  it('getAgentByKeyword returns undefined for unknown keyword', () => {
    expect(getAgentByKeyword('MODO INEXISTENTE ACTIVADO')).toBeUndefined();
  });

  it('all activation keywords are unique', () => {
    const keywords = listAgents().map((a) => a.activationKeyword.toLowerCase());
    expect(new Set(keywords).size).toBe(keywords.length);
  });

  it('no system_prompt references a specific real/client business name (F0.4)', () => {
    // Guard contra la regresión original: los 13 prompts citaban literalmente
    // "Repostería Alcayna" (cliente real, Cieza/Murcia). El contenido debe ser
    // genérico — sin nombre propio de empresa ni ubicación específica.
    const bannedTerms = /alcayna|cieza|murcia|pasteler/i;
    for (const agent of listAgents()) {
      expect(agent.system_prompt).not.toMatch(bannedTerms);
    }
  });
});

describe('IntentRouter — agent activation', () => {
  it('isValidAgentNode returns true for all 13 IDs', () => {
    for (const id of AGENT_IDS) {
      expect(IntentRouter.isValidAgentNode(id)).toBe(true);
    }
  });

  it('isValidAgentNode returns false for unknown ID', () => {
    expect(IntentRouter.isValidAgentNode('fake_dept')).toBe(false);
    expect(IntentRouter.isValidAgentNode('')).toBe(false);
  });

  it('routes "MODO MARCA ACTIVADO" to agent_activation', async () => {
    const result = await IntentRouter.route('MODO MARCA ACTIVADO');
    expect(result.matched).toBe(true);
    expect(result.type).toBe('agent_activation');
    expect(result.agentId).toBe('marca_storytelling');
  });

  it('routes "MODO CEO ACTIVADO" to agent_activation', async () => {
    const result = await IntentRouter.route('MODO CEO ACTIVADO');
    expect(result.matched).toBe(true);
    expect(result.type).toBe('agent_activation');
    expect(result.agentId).toBe('ceo_sintetico');
  });

  it('routes all 13 activation keywords correctly', async () => {
    for (const agent of listAgents()) {
      const result = await IntentRouter.route(agent.activationKeyword);
      expect(result.type).toBe('agent_activation');
      expect(result.agentId).toBe(agent.id);
    }
  });

  it('does not route partial activation keywords as agent_activation', async () => {
    const result = await IntentRouter.route('MODO MARCA');
    expect(result.type).not.toBe('agent_activation');
  });

  it('does not route unrelated text as agent_activation', async () => {
    const result = await IntentRouter.route('hola');
    expect(result.type).not.toBe('agent_activation');
  });

  it('existing regex intents still work alongside agent routing', async () => {
    const ping = await IntentRouter.route('ping');
    expect(ping.type).toBe('regex_intent');
    expect(ping.intentName).toBe('ping');
  });
});
