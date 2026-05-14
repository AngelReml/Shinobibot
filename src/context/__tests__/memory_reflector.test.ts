import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryReflector, renderReportMarkdown, reflectionEnabled } from '../memory_reflector.js';
import type { ConversationMessage } from '../memory_reflector.js';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'shinobi-refl-'));
  delete process.env.SHINOBI_REFLECTION_ENABLED;
});
afterEach(() => {
  try { if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true }); } catch {}
  delete process.env.SHINOBI_REFLECTION_ENABLED;
});

describe('MemoryReflector — contador', () => {
  it('shouldReflect false hasta cruzar el intervalo', () => {
    const r = new MemoryReflector({ intervalMessages: 5, reflectionDir: workDir });
    for (let i = 0; i < 4; i++) { r.noteMessage(); expect(r.shouldReflect()).toBe(false); }
    r.noteMessage();
    expect(r.shouldReflect()).toBe(true);
  });
  it('shouldReflect cada N múltiples', () => {
    const r = new MemoryReflector({ intervalMessages: 3, reflectionDir: workDir });
    const flags: boolean[] = [];
    for (let i = 0; i < 9; i++) { r.noteMessage(); flags.push(r.shouldReflect()); }
    expect(flags).toEqual([false, false, true, false, false, true, false, false, true]);
  });
});

describe('MemoryReflector — contradicciones', () => {
  it('detecta "X es Y" + "X no es Y"', () => {
    const r = new MemoryReflector({ reflectionDir: workDir });
    const h: ConversationMessage[] = [
      { role: 'user', content: 'Mi nombre es Carlos.' },
      { role: 'user', content: 'Mi nombre no es Carlos.' },
    ];
    const rep = r.analyze(h, false);
    expect(rep.contradictions.length).toBeGreaterThan(0);
  });

  it('detecta cambio de path para el mismo archivo', () => {
    const r = new MemoryReflector({ reflectionDir: workDir });
    const h: ConversationMessage[] = [
      { role: 'user', content: 'El archivo config está en /etc/app.conf' },
      { role: 'user', content: 'El archivo config está en /home/user/.app.conf' },
    ];
    const rep = r.analyze(h, false);
    expect(rep.contradictions.some(c => c.topic.includes('config'))).toBe(true);
  });

  it('NO marca como contradicción info coherente', () => {
    const r = new MemoryReflector({ reflectionDir: workDir });
    const h: ConversationMessage[] = [
      { role: 'user', content: 'Hola, qué tal.' },
      { role: 'user', content: 'Necesito ayuda con un script.' },
      { role: 'user', content: 'Gracias.' },
    ];
    const rep = r.analyze(h, false);
    expect(rep.contradictions).toEqual([]);
  });
});

describe('MemoryReflector — preferencias', () => {
  it('detecta "me gusta X"', () => {
    const r = new MemoryReflector({ reflectionDir: workDir });
    const h: ConversationMessage[] = [{ role: 'user', content: 'Me gusta TypeScript estricto.' }];
    const rep = r.analyze(h, false);
    expect(rep.preferences[0]?.kind).toBe('like');
    expect(rep.preferences[0]?.subject.toLowerCase()).toContain('typescript');
  });
  it('detecta "siempre uso X"', () => {
    const r = new MemoryReflector({ reflectionDir: workDir });
    const h: ConversationMessage[] = [{ role: 'user', content: 'Siempre uso pnpm en lugar de npm.' }];
    const rep = r.analyze(h, false);
    expect(rep.preferences[0]?.kind).toBe('always');
  });
  it('detecta "no me gusta X"', () => {
    const r = new MemoryReflector({ reflectionDir: workDir });
    const h: ConversationMessage[] = [{ role: 'user', content: 'No me gusta Jest.' }];
    const rep = r.analyze(h, false);
    expect(rep.preferences[0]?.kind).toBe('dislike');
  });
  it('detecta "prefiero X"', () => {
    const r = new MemoryReflector({ reflectionDir: workDir });
    const h: ConversationMessage[] = [{ role: 'user', content: 'Prefiero vitest sobre cualquier alternativa.' }];
    const rep = r.analyze(h, false);
    expect(rep.preferences[0]?.kind).toBe('prefer');
  });
});

describe('MemoryReflector — consolidación', () => {
  it('detecta mensajes repetidos del usuario', () => {
    const r = new MemoryReflector({ reflectionDir: workDir });
    const h: ConversationMessage[] = [
      { role: 'user', content: 'Por favor, prepara el reporte semanal.' },
      { role: 'assistant', content: 'OK.' },
      { role: 'user', content: 'Por favor, prepara el reporte semanal.' },
    ];
    const rep = r.analyze(h, false);
    expect(rep.consolidationHints.length).toBeGreaterThan(0);
    expect(rep.consolidationHints[0].samples.length).toBeGreaterThanOrEqual(2);
  });
});

describe('MemoryReflector — persistencia', () => {
  it('escribe reporte a disco si hay hallazgos', () => {
    const r = new MemoryReflector({ reflectionDir: workDir });
    const h: ConversationMessage[] = [
      { role: 'user', content: 'Mi color favorito es azul.' },
      { role: 'user', content: 'Mi color favorito no es azul.' },
    ];
    const rep = r.analyze(h, true);
    expect(rep.filePath).toBeTruthy();
    expect(existsSync(rep.filePath!)).toBe(true);
    const text = readFileSync(rep.filePath!, 'utf-8');
    expect(text).toContain('Contradicciones detectadas');
    expect(text).toContain('color');
  });

  it('NO escribe reporte si no hay hallazgos (alwaysEmit=false)', () => {
    const r = new MemoryReflector({ reflectionDir: workDir });
    const h: ConversationMessage[] = [{ role: 'user', content: 'Hola.' }];
    const rep = r.analyze(h, true);
    expect(rep.filePath).toBeUndefined();
    expect(readdirSync(workDir)).toEqual([]);
  });

  it('alwaysEmit=true escribe reporte vacío', () => {
    const r = new MemoryReflector({ reflectionDir: workDir, alwaysEmit: true });
    const h: ConversationMessage[] = [{ role: 'user', content: 'Hola.' }];
    const rep = r.analyze(h, true);
    expect(rep.filePath).toBeTruthy();
  });

  it('reflectionEnabled lee env', () => {
    expect(reflectionEnabled()).toBe(false);
    process.env.SHINOBI_REFLECTION_ENABLED = '1';
    expect(reflectionEnabled()).toBe(true);
  });
});

describe('renderReportMarkdown', () => {
  it('reporte vacío indica "sin hallazgos"', () => {
    const md = renderReportMarkdown({
      ts: '2026-05-15T10:00:00Z',
      messagesAnalyzed: 5,
      contradictions: [], preferences: [], consolidationHints: [],
    });
    expect(md).toContain('Sin hallazgos');
  });
  it('reporte poblado incluye secciones de cada tipo', () => {
    const md = renderReportMarkdown({
      ts: '2026-05-15T10:00:00Z',
      messagesAnalyzed: 30,
      contradictions: [{ topic: 'X', positiveText: 'A', negativeText: 'B', positiveIdx: 0, negativeIdx: 5 }],
      preferences: [{ kind: 'like', subject: 'Y', evidence: 'me gusta Y', idx: 2 }],
      consolidationHints: [{ hint: 'msg repetido', samples: ['s1', 's2'] }],
    });
    expect(md).toContain('Contradicciones detectadas');
    expect(md).toContain('Preferencias inferidas');
    expect(md).toContain('Sugerencias de consolidación');
    expect(md).toContain('[like]');
    expect(md).toContain('msg repetido');
  });
});
