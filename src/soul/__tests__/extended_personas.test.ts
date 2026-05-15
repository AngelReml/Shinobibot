import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadSoul, listBuiltinSouls, builtinSoul, personaSystemMessage,
} from '../soul.js';

beforeEach(() => {
  delete process.env.SHINOBI_SOUL_BUILTIN;
  delete process.env.SHINOBI_SOUL_PATH;
});
afterEach(() => {
  delete process.env.SHINOBI_SOUL_BUILTIN;
  delete process.env.SHINOBI_SOUL_PATH;
});

const NEW_PERSONAS = ['ronin', 'monje', 'kunoichi', 'oyabun', 'kohai', 'sensei', 'kappa'];

describe('listBuiltinSouls', () => {
  it('incluye los 3 originales + 7 nuevos = 10', () => {
    const list = listBuiltinSouls();
    expect(list).toContain('default');
    expect(list).toContain('kawaii');
    expect(list).toContain('samurai');
    for (const p of NEW_PERSONAS) {
      expect(list).toContain(p);
    }
    expect(list.length).toBeGreaterThanOrEqual(10);
  });
});

describe('builtinSoul — cada persona nueva existe y es distinguible', () => {
  for (const p of NEW_PERSONAS) {
    it(`${p} carga y tiene body propio`, () => {
      const soul = builtinSoul(p)!;
      expect(soul).not.toBeNull();
      expect(soul.name).toBe(`shinobi-${p}`);
      expect(soul.body.length).toBeGreaterThan(60);
      expect(soul.source).toBe(`built-in:${p}`);
    });
  }

  it('todas las personas tienen bodies distintos', () => {
    const bodies = NEW_PERSONAS.map(p => builtinSoul(p)!.body);
    const uniqueBodies = new Set(bodies);
    expect(uniqueBodies.size).toBe(NEW_PERSONAS.length);
  });

  it('cada persona tiene formality propia (usted o tu)', () => {
    expect(builtinSoul('ronin')!.formality).toBe('tu');
    expect(builtinSoul('monje')!.formality).toBe('usted');
    expect(builtinSoul('kunoichi')!.formality).toBe('tu');
    expect(builtinSoul('oyabun')!.formality).toBe('tu');
    expect(builtinSoul('kohai')!.formality).toBe('usted');
    expect(builtinSoul('sensei')!.formality).toBe('usted');
    expect(builtinSoul('kappa')!.formality).toBe('tu');
  });

  it('verbosity refleja la persona', () => {
    expect(builtinSoul('ronin')!.verbosity).toBe('low'); // escueto
    expect(builtinSoul('kohai')!.verbosity).toBe('high'); // se explica mucho
    expect(builtinSoul('sensei')!.verbosity).toBe('medium'); // pedagógico
  });
});

describe('SHINOBI_SOUL_BUILTIN env carga las nuevas', () => {
  for (const p of NEW_PERSONAS) {
    it(`env=${p} → loadSoul devuelve esa persona`, () => {
      process.env.SHINOBI_SOUL_BUILTIN = p;
      const s = loadSoul();
      expect(s.name).toBe(`shinobi-${p}`);
    });
  }
});

describe('personaSystemMessage por persona', () => {
  it('cada persona produce un meta header distinto', () => {
    const msgs = NEW_PERSONAS.map(p => personaSystemMessage(builtinSoul(p)!));
    const uniqueHeaders = new Set(msgs.map(m => m.split('\n')[0]));
    expect(uniqueHeaders.size).toBe(NEW_PERSONAS.length);
  });

  it('contiene name + tone + formality', () => {
    const msg = personaSystemMessage(builtinSoul('ronin')!);
    expect(msg).toContain('ronin');
    expect(msg).toContain('tone=');
  });
});

describe('Marca verbal distintiva', () => {
  it('ronin → "cero adornos" o "fiel a un código"', () => {
    const body = builtinSoul('ronin')!.body.toLowerCase();
    expect(/cero adornos|fiel|sin señor/.test(body)).toBe(true);
  });
  it('monje → "respiración" o "paciente"', () => {
    const body = builtinSoul('monje')!.body.toLowerCase();
    expect(/respira|paciente|contempl/.test(body)).toBe(true);
  });
  it('kohai → "humilde" o "aprendiz"', () => {
    const body = builtinSoul('kohai')!.body.toLowerCase();
    expect(/humilde|aprendiz/.test(body)).toBe(true);
  });
  it('sensei → "explicáis el por qué" o "maestro"', () => {
    const body = builtinSoul('sensei')!.body.toLowerCase();
    expect(/maestro|principio|por qué/.test(body)).toBe(true);
  });
});
