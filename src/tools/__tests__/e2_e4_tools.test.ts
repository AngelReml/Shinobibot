// src/tools/__tests__/e2_e4_tools.test.ts
//
// Tests de los wrappers de tool de E2 (synthesize_skill) y E4 (run_swarm).
// LLM inyectado; sin red ni escritura en el repo real.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import synthesizeSkillTool, { __setSkillFactoryInvokerForTest, __setSkillFactoryPendingDirForTest } from '../synthesize_skill.js';
import runSwarmTool, { __setSwarmInvokerForTest } from '../run_swarm.js';
import { verifySkillText } from '../../skills/skill_signing.js';
import type { LLMInvoker } from '../../agents/agent_loop.js';

const envelope = (content: string): string => JSON.stringify({ content });
const userOf = (p: any): string => String(p?.messages?.find((m: any) => m.role === 'user')?.content ?? '');
const sysOf = (p: any): string => String(p?.messages?.find((m: any) => m.role === 'system')?.content ?? '');

const VALID_SKILL = `---
name: Resumen de PR
description: Resume un pull request en bullets
trigger_keywords: [resume pr, resumen pull request]
---
1. Lee el diff del PR.
2. Redacta un resumen en bullets.`;

beforeAll(() => { process.env.SHINOBI_AUDIT_DISABLED = '1'; });
afterAll(() => {
  delete process.env.SHINOBI_AUDIT_DISABLED;
  __setSkillFactoryInvokerForTest(null);
  __setSkillFactoryPendingDirForTest(null);
  __setSwarmInvokerForTest(null);
});

describe('synthesize_skill (tool E2)', () => {
  let dir: string;
  afterEach(() => { if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } } });

  it('crea, verifica, firma y persiste una skill en pending', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-e2tool-'));
    __setSkillFactoryPendingDirForTest(dir);
    // Un único invoker que sirve al productor y al verificador.
    const invoker: LLMInvoker = async (p) => {
      const isVerify = /REVISOR ADVERSARIAL/i.test(sysOf(p)) || /RESULTADO A VERIFICAR/i.test(userOf(p));
      return isVerify
        ? { success: true, output: envelope(JSON.stringify({ passed: true, score: 0.9, issues: [], rationale: 'ok' })), error: '' }
        : { success: true, output: envelope(VALID_SKILL), error: '' };
    };
    __setSkillFactoryInvokerForTest(invoker);

    const res = await synthesizeSkillTool.execute({ goal: 'resumir PRs' });
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/firmada/i);
    expect(res.output).toMatch(/PENDIENTE/i);

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.skill.md'));
    expect(files.length).toBe(1);
    expect(verifySkillText(fs.readFileSync(path.join(dir, files[0]), 'utf-8')).valid).toBe(true);
  });

  it('falla limpio sin goal', async () => {
    const res = await synthesizeSkillTool.execute({});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/goal/);
  });
});

describe('run_swarm (tool E4)', () => {
  afterEach(() => { delete process.env.SHINOBI_SPAWN_DEPTH; __setSwarmInvokerForTest(null); });

  it('lanza el enjambre y agrega resultados; restaura la profundidad', async () => {
    __setSwarmInvokerForTest(async (p) => ({ success: true, output: envelope('ok: ' + userOf(p)), error: '' }));
    const res = await runSwarmTool.execute({ tasks: [{ task: 'A' }, { task: 'B' }] });
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/2\/2 tareas OK/);
    expect(process.env.SHINOBI_SPAWN_DEPTH).toBeUndefined();
  });

  it('falla limpio sin tareas', async () => {
    const res = await runSwarmTool.execute({ tasks: [] });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/tarea/);
  });

  it('aborta si se alcanzó la profundidad de spawn', async () => {
    process.env.SHINOBI_SPAWN_DEPTH = '3';
    __setSwarmInvokerForTest(async () => ({ success: true, output: envelope('x'), error: '' }));
    const res = await runSwarmTool.execute({ tasks: [{ task: 'A' }] });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/profundidad/i);
  });
});
