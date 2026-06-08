// src/agents/__tests__/curator.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { curatePatternIntoSkill } from '../curator.js';
import { verifySkillText } from '../../skills/skill_signing.js';
import type { LLMInvoker } from '../agent_loop.js';

const envelope = (c: string) => JSON.stringify({ content: c });
const sysOf = (p: any) => String(p?.messages?.find((m: any) => m.role === 'system')?.content ?? '');
const userOf = (p: any) => String(p?.messages?.find((m: any) => m.role === 'user')?.content ?? '');

const SKILL = `---
name: Extraer y resumir web
description: Flujo para extraer una pagina y resumirla
trigger_keywords: [extraer web, resumir pagina, scrape y resume]
---
1. Abre la pagina con el navegador.
2. Extrae el contenido principal.
3. Resume en bullets.`;

// Un invoker que sirve al productor (devuelve la SKILL.md) y al verificador.
const invoker: LLMInvoker = async (p) => {
  const isVerify = /REVISOR ADVERSARIAL/i.test(sysOf(p)) || /RESULTADO A VERIFICAR/i.test(userOf(p));
  return isVerify
    ? { success: true, output: envelope(JSON.stringify({ passed: true, score: 0.9, issues: [], rationale: 'ok' })), error: '' }
    : { success: true, output: envelope(SKILL), error: '' };
};

let dir: string;
beforeAll(() => { process.env.SHINOBI_AUDIT_DISABLED = '1'; });
afterAll(() => { delete process.env.SHINOBI_AUDIT_DISABLED; });
afterEach(() => { if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } } });

describe('curator — patrón → skill verificada+firmada', () => {
  it('sintetiza, verifica y firma una skill desde un patrón repetido', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-curator-'));
    const res = await curatePatternIntoSkill({
      toolSequence: ['browser_observe', 'clean_extract', 'generate_document'],
      occurrences: 4,
      pendingDir: dir,
      invokeLLM: invoker,
      verifyInvokeLLM: invoker,
      now: () => '2026-06-08T00:00:00.000Z',
    });
    expect(res.ok).toBe(true);
    expect(res.path).toBeTruthy();
    const written = fs.readFileSync(res.path!, 'utf-8');
    expect(verifySkillText(written).valid).toBe(true);
  });

  it('un patrón demasiado corto no genera skill', async () => {
    const res = await curatePatternIntoSkill({ toolSequence: ['read_file'], invokeLLM: invoker, verifyInvokeLLM: invoker });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('structure');
  });
});
