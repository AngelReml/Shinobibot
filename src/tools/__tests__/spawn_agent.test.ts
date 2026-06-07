// src/tools/__tests__/spawn_agent.test.ts
//
// Tests del wrapper de delegación spawn_agent (sobre agent_loop). Deterministas:
// el LLM del subagente se inyecta vía __setSpawnInvokerForTest (sin red) y el
// audit se desactiva. Cubre: formato de resultado, filtrado de tools
// destructivas (seguridad), profundidad de spawn, restauración de env y
// validación de entrada.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import spawnAgent, { __setSpawnInvokerForTest } from '../spawn_agent.js';
import type { LLMInvoker } from '../../agents/agent_loop.js';

/** Invocador que cierra de inmediato con un texto fijo. */
const completesWith = (text: string): LLMInvoker => async () => ({
  success: true,
  output: JSON.stringify({ content: text }),
  error: '',
});

beforeAll(() => {
  process.env.SHINOBI_AUDIT_DISABLED = '1';
});
afterAll(() => {
  delete process.env.SHINOBI_AUDIT_DISABLED;
  __setSpawnInvokerForTest(null);
});
afterEach(() => {
  delete process.env.SHINOBI_SPAWN_DEPTH;
  __setSpawnInvokerForTest(null);
});

describe('spawn_agent — delegación multi-agente', () => {
  it('devuelve el resultado del subagente cuando cierra limpio', async () => {
    __setSpawnInvokerForTest(completesWith('tarea resuelta'));
    const res = await spawnAgent.execute({ task: 'haz algo', tools: ['read_file'] });
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/COMPLETED/);
    expect(res.output).toContain('tarea resuelta');
  });

  it('falla limpio si falta la task', async () => {
    const res = await spawnAgent.execute({ task: '   ' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/task/);
  });

  it('filtra herramientas destructivas de la caja del subagente (seguridad)', async () => {
    __setSpawnInvokerForTest(completesWith('ok'));
    const res = await spawnAgent.execute({
      task: 'algo',
      tools: ['read_file', 'run_command', 'write_file'],
    });
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/destructivas excluidas/);
    expect(res.output).toContain('run_command');
    expect(res.output).toContain('write_file');
  });

  it('aborta por profundidad de spawn alcanzada', async () => {
    process.env.SHINOBI_SPAWN_DEPTH = '3'; // hijo sería nivel 4 ≥ maxDepth(3)
    __setSpawnInvokerForTest(completesWith('no debería llegar'));
    const res = await spawnAgent.execute({ task: 'algo' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/profundidad|DEPTH/i);
  });

  it('restaura SHINOBI_SPAWN_DEPTH tras ejecutar', async () => {
    expect(process.env.SHINOBI_SPAWN_DEPTH).toBeUndefined();
    __setSpawnInvokerForTest(completesWith('ok'));
    await spawnAgent.execute({ task: 'algo', tools: ['read_file'] });
    expect(process.env.SHINOBI_SPAWN_DEPTH).toBeUndefined();
  });
});
