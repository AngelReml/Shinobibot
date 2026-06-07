// src/agents/__tests__/capability_factory.test.ts
//
// Tests del motor E2 (fábrica de skills verificadas+firmadas). LLM productor y
// verificador inyectados. Los gates de seguridad se prueban con el verificador
// APROBANDO, para demostrar que los controles deterministas rechazan igualmente.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { synthesizeSkill } from '../capability_factory.js';
import { verifySkillText } from '../../skills/skill_signing.js';
import { parseSkillMd } from '../../skills/skill_md_parser.js';
import type { LLMInvoker } from '../agent_loop.js';

const envelope = (content: string): string => JSON.stringify({ content });
const producerOf = (skillMd: string): LLMInvoker => async () => ({ success: true, output: envelope(skillMd), error: '' });
const verdictPass: LLMInvoker = async () =>
  ({ success: true, output: envelope(JSON.stringify({ passed: true, score: 0.95, issues: [], rationale: 'ok' })), error: '' });
const verdictFail: LLMInvoker = async () =>
  ({ success: true, output: envelope(JSON.stringify({ passed: false, score: 0.2, issues: ['vaga'], rationale: 'no' })), error: '' });

const VALID = `---
name: Resumen de PR
description: Resume un pull request de GitHub en bullets
trigger_keywords: [resume pr, resumen pull request, summarize pr]
---
1. Lee el diff del PR.
2. Identifica los 3-5 cambios mas importantes.
3. Redacta un resumen claro en bullets.`;

let tmpDir: string;

beforeAll(() => { process.env.SHINOBI_AUDIT_DISABLED = '1'; });
afterAll(() => { delete process.env.SHINOBI_AUDIT_DISABLED; });
afterEach(() => {
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } }
});

function freshDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-skillfac-'));
  return tmpDir;
}

describe('capability_factory — síntesis de skills (E2)', () => {
  it('sintetiza, verifica, firma y persiste una skill válida', async () => {
    const dir = freshDir();
    const res = await synthesizeSkill({
      goal: 'resumir PRs de GitHub',
      pendingDir: dir,
      invokeLLM: producerOf(VALID),
      verifyInvokeLLM: verdictPass,
      now: () => '2026-06-07T00:00:00.000Z',
    });
    expect(res.ok).toBe(true);
    expect(res.name).toBe('Resumen de PR');
    expect(res.path).toBeTruthy();
    expect(fs.existsSync(res.path!)).toBe(true);

    // El fichero escrito está firmado y la firma verifica.
    const written = fs.readFileSync(res.path!, 'utf-8');
    expect(written).toBe(res.skillText);
    expect(verifySkillText(written).valid).toBe(true);

    // Procedencia correcta.
    const parsed = parseSkillMd(written);
    expect(parsed.frontmatter.status).toBe('pending');
    expect(parsed.frontmatter.source_kind).toBe('synthesized');
    expect(res.signatureHash).toHaveLength(64);
  });

  it('si la verificación E1 no aprueba, no produce ni escribe skill', async () => {
    const dir = freshDir();
    const res = await synthesizeSkill({
      goal: 'algo', pendingDir: dir,
      invokeLLM: producerOf(VALID), verifyInvokeLLM: verdictFail, maxAttempts: 1,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('verification_failed');
    expect(fs.readdirSync(dir).length).toBe(0);
  });

  it('gate estructural: rechaza skill con <2 trigger_keywords aunque el juez apruebe', async () => {
    const dir = freshDir();
    const oneKw = `---\nname: X\ndescription: y\ntrigger_keywords: [uno]\n---\ncuerpo suficientemente largo para superar el minimo.`;
    const res = await synthesizeSkill({
      goal: 'x', pendingDir: dir,
      invokeLLM: producerOf(oneKw), verifyInvokeLLM: verdictPass,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('structure');
    expect(fs.readdirSync(dir).length).toBe(0);
  });

  it('gate de seguridad: rechaza skill con secretos aunque el juez apruebe', async () => {
    const dir = freshDir();
    const withSecret = `---\nname: Deploy\ndescription: deploy\ntrigger_keywords: [deploy, publicar]\n---\nUsa la clave AWS AKIAIOSFODNN7EXAMPLE para autenticar y sube el build.`;
    const res = await synthesizeSkill({
      goal: 'deploy', pendingDir: dir,
      invokeLLM: producerOf(withSecret), verifyInvokeLLM: verdictPass,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('secrets_detected');
    expect(fs.readdirSync(dir).length).toBe(0);
  });

  it('gate de seguridad: rechaza skill que instruye comandos destructivos', async () => {
    const dir = freshDir();
    const destructive = `---\nname: Limpieza\ndescription: limpia\ntrigger_keywords: [limpiar, borrar temporales]\n---\nEjecuta rm -rf /tmp/cache para liberar espacio en disco.`;
    const res = await synthesizeSkill({
      goal: 'limpiar', pendingDir: dir,
      invokeLLM: producerOf(destructive), verifyInvokeLLM: verdictPass,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('destructive_instructions');
    expect(fs.readdirSync(dir).length).toBe(0);
  });

  it('dry-run (write:false) devuelve la skill firmada sin escribir a disco', async () => {
    const dir = freshDir();
    const res = await synthesizeSkill({
      goal: 'resumir PRs', pendingDir: dir, write: false,
      invokeLLM: producerOf(VALID), verifyInvokeLLM: verdictPass,
      now: () => '2026-06-07T00:00:00.000Z',
    });
    expect(res.ok).toBe(true);
    expect(res.path).toBeUndefined();
    expect(res.skillText).toBeTruthy();
    expect(verifySkillText(res.skillText!).valid).toBe(true);
    expect(fs.readdirSync(dir).length).toBe(0);
  });
});
