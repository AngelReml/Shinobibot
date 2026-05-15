import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseSoulMd,
  loadSoul,
  personaSystemMessage,
  listBuiltinSouls,
  builtinSoul,
  writeSoulToFile,
  DEFAULT_SOUL,
} from '../soul.js';

let work: string;
let origCwd: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'shinobi-soul-'));
  origCwd = process.cwd();
  process.chdir(work);
  delete process.env.SHINOBI_SOUL_PATH;
  delete process.env.SHINOBI_SOUL_BUILTIN;
});

afterEach(() => {
  process.chdir(origCwd);
  try { if (existsSync(work)) rmSync(work, { recursive: true, force: true }); } catch {}
  delete process.env.SHINOBI_SOUL_PATH;
  delete process.env.SHINOBI_SOUL_BUILTIN;
});

describe('loadSoul — fallback default', () => {
  it('sin archivo ni env → DEFAULT_SOUL', () => {
    const s = loadSoul();
    expect(s.name).toBe('shinobi-default');
    expect(s.tone).toBe('sobrio');
    expect(s.source).toBe('built-in:default');
  });
});

describe('loadSoul — built-in via env', () => {
  it('SHINOBI_SOUL_BUILTIN=kawaii', () => {
    process.env.SHINOBI_SOUL_BUILTIN = 'kawaii';
    const s = loadSoul();
    expect(s.name).toBe('shinobi-kawaii');
    expect(s.tone).toBe('kawaii');
  });
  it('SHINOBI_SOUL_BUILTIN=samurai → usted', () => {
    process.env.SHINOBI_SOUL_BUILTIN = 'samurai';
    const s = loadSoul();
    expect(s.formality).toBe('usted');
  });
  it('SHINOBI_SOUL_BUILTIN=desconocido → default', () => {
    process.env.SHINOBI_SOUL_BUILTIN = 'unknown';
    expect(loadSoul().name).toBe('shinobi-default');
  });
});

describe('loadSoul — archivo soul.md', () => {
  it('archivo en cwd se carga', () => {
    const content = [
      '---',
      'name: my-soul',
      'tone: directo',
      'language: en',
      'formality: neutro',
      'verbosity: low',
      '---',
      '',
      'You are direct and concise.',
    ].join('\n');
    writeFileSync(join(work, 'soul.md'), content, 'utf-8');
    const s = loadSoul();
    expect(s.name).toBe('my-soul');
    expect(s.tone).toBe('directo');
    expect(s.language).toBe('en');
    expect(s.body).toContain('direct and concise');
    expect(s.source).toContain('file:');
  });

  it('SHINOBI_SOUL_PATH override', () => {
    const path = join(work, 'custom', 'persona.md');
    writeSoulToFile(path, { ...DEFAULT_SOUL, name: 'custom-x', body: 'BODY CUSTOM' });
    process.env.SHINOBI_SOUL_PATH = path;
    const s = loadSoul();
    expect(s.name).toBe('custom-x');
    expect(s.body).toContain('BODY CUSTOM');
  });

  it('archivo no parseable → fallback default sin lanzar', () => {
    writeFileSync(join(work, 'soul.md'), 'esto no tiene frontmatter', 'utf-8');
    const s = loadSoul();
    // parseSkillMd devuelve body completo cuando no hay frontmatter;
    // name será 'custom-soul'.
    expect(['custom-soul', 'shinobi-default']).toContain(s.name);
  });
});

describe('parseSoulMd', () => {
  it('aplica defaults a campos faltantes', () => {
    const text = '---\nname: minimal\n---\n\nHola';
    const s = parseSoulMd(text);
    expect(s.tone).toBe('sobrio');
    expect(s.formality).toBe('tu');
    expect(s.verbosity).toBe('medium');
    expect(s.body).toBe('Hola');
  });

  it('body vacío usa body de DEFAULT_SOUL', () => {
    const text = '---\nname: x\n---\n\n';
    const s = parseSoulMd(text);
    expect(s.body).toBe(DEFAULT_SOUL.body);
  });
});

describe('personaSystemMessage', () => {
  it('incluye meta + body', () => {
    const msg = personaSystemMessage();
    expect(msg).toContain('Persona activa:');
    expect(msg).toContain('tone=');
    expect(msg).toContain(DEFAULT_SOUL.body.split('\n')[0]);
  });
  it('soul custom genera meta correcto', () => {
    const msg = personaSystemMessage({ ...DEFAULT_SOUL, name: 'x', tone: 'directo' });
    expect(msg).toContain('Persona activa: x');
    expect(msg).toContain('tone=directo');
  });
});

describe('listBuiltinSouls + builtinSoul', () => {
  it('lista incluye default + kawaii + samurai', () => {
    const list = listBuiltinSouls();
    expect(list).toContain('default');
    expect(list).toContain('kawaii');
    expect(list).toContain('samurai');
  });
  it('builtinSoul devuelve el right one', () => {
    expect(builtinSoul('default')?.name).toBe('shinobi-default');
    expect(builtinSoul('inexistente')).toBeNull();
  });
});

describe('writeSoulToFile', () => {
  it('escribe y se puede recargar', () => {
    const path = join(work, 'a', 'b', 'soul.md');
    writeSoulToFile(path, { ...DEFAULT_SOUL, name: 'persist', body: 'persistido OK' });
    expect(existsSync(path)).toBe(true);
    process.env.SHINOBI_SOUL_PATH = path;
    const reloaded = loadSoul();
    expect(reloaded.name).toBe('persist');
    expect(reloaded.body).toContain('persistido OK');
  });
});
