// src/coordinator/__tests__/slash_comparar.test.ts
// G4-5 — Test del slash command /comparar: verifica que la comparación
// estructural multi-repo funciona sin LLM ni red.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleSlashCommand } from '../slash_commands.js';
import type { SlashContext } from '../slash_commands.js';

// Fake context — no necesitamos ResidentLoop para /comparar.
const fakeCtx: SlashContext = {
  residentLoop: null as any,
  ask: async () => '',
};

// Mini-repos temporales para el test.
let repoA: string;
let repoB: string;

beforeAll(() => {
  repoA = fs.mkdtempSync(path.join(os.tmpdir(), 'comparar-a-'));
  repoB = fs.mkdtempSync(path.join(os.tmpdir(), 'comparar-b-'));

  fs.writeFileSync(path.join(repoA, 'auth.ts'),
    'export function login(user: string, pass: string): boolean { return pass.length > 4; }\n' +
    'export class AuthService { validate() {} }\n');
  fs.writeFileSync(path.join(repoA, 'utils.ts'),
    'export function hash(s: string) { return s.split("").reverse().join(""); }\n');

  fs.writeFileSync(path.join(repoB, 'auth.ts'),
    'export function login(u: string, p: string) { return !!u && !!p; }\n');
  fs.writeFileSync(path.join(repoB, 'api.ts'),
    'export async function fetchUser(id: string) { return { id }; }\n' +
    'export class ApiClient { get() {} post() {} }\n');
});

afterAll(() => {
  fs.rmSync(repoA, { recursive: true, force: true });
  fs.rmSync(repoB, { recursive: true, force: true });
});

describe('/comparar slash command', () => {

  it('muestra ayuda cuando se pasan menos de 2 rutas', async () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    try {
      const handled = await handleSlashCommand('/comparar ' + repoA, fakeCtx);
      expect(handled).toBe(true);
      expect(lines.some(l => l.includes('Uso:'))).toBe(true);
    } finally {
      console.log = orig;
    }
  });

  it('produce tabla de métricas para dos repos', async () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    try {
      const handled = await handleSlashCommand(`/comparar ${repoA} ${repoB}`, fakeCtx);
      expect(handled).toBe(true);
      const all = lines.join('\n');
      expect(all).toContain('E6');
      expect(all).toContain('Archivos fuente');
      expect(all).toContain('Símbolos');
      expect(all).toContain('Funciones');
      expect(all).toContain('Clases');
    } finally {
      console.log = orig;
    }
  });

  it('muestra símbolos comunes y únicos', async () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    try {
      await handleSlashCommand(`/comparar ${repoA} ${repoB}`, fakeCtx);
      const all = lines.join('\n');
      // 'login' aparece en ambos → debe estar en comunes o en uno de los únicos
      expect(all).toContain('login');
    } finally {
      console.log = orig;
    }
  });

  it('filtra por query cuando se especifica --query', async () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    try {
      await handleSlashCommand(`/comparar ${repoA} ${repoB} --query auth login`, fakeCtx);
      const all = lines.join('\n');
      expect(all).toContain('Query:');
      expect(all).toContain('auth');
    } finally {
      console.log = orig;
    }
  });

  it('devuelve false para comandos no reconocidos', async () => {
    const handled = await handleSlashCommand('/noexiste test', fakeCtx);
    expect(handled).toBe(false);
  });
});
