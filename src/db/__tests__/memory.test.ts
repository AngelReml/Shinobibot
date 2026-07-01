// Regresión BAJA-05 (auditoría 2026-07-01): la deduplicación de mensajes de
// usuario consecutivos usaba igualdad EXACTA de string — "haz X " vs "haz X"
// evadían la deduplicación bajo retries automáticos.
import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { Memory } from '../memory.js';

describe('Memory — deduplicación de mensajes de usuario (BAJA-05)', () => {
  const paths: string[] = [];
  function freshPath() {
    const p = join(tmpdir(), `shinobi-memory-test-${randomUUID()}.json`);
    paths.push(p);
    return p;
  }
  afterEach(() => {
    while (paths.length) { try { rmSync(paths.pop()!, { force: true }); } catch { /* noop */ } }
  });

  it('deduplica mensajes idénticos exactos (comportamiento preexistente)', async () => {
    const m = new Memory(freshPath());
    await m.addMessage({ role: 'user', content: 'haz X' });
    await m.addMessage({ role: 'user', content: 'haz X' });
    const msgs = await m.getMessages();
    expect(msgs).toHaveLength(1);
  });

  it('deduplica mensajes que solo difieren en whitespace (BAJA-05)', async () => {
    const m = new Memory(freshPath());
    await m.addMessage({ role: 'user', content: 'haz X' });
    await m.addMessage({ role: 'user', content: 'haz X ' }); // espacio final
    await m.addMessage({ role: 'user', content: '  haz   X' }); // espacios internos/iniciales
    const msgs = await m.getMessages();
    expect(msgs).toHaveLength(1);
  });

  it('guarda el mensaje ORIGINAL sin normalizar (no reescribe el contenido)', async () => {
    const m = new Memory(freshPath());
    await m.addMessage({ role: 'user', content: '  haz X  ' });
    const msgs = await m.getMessages();
    expect(msgs[0].content).toBe('  haz X  '); // sin trim/colapsar — solo se usa para comparar
  });

  it('NO deduplica mensajes genuinamente distintos', async () => {
    const m = new Memory(freshPath());
    await m.addMessage({ role: 'user', content: 'haz X' });
    await m.addMessage({ role: 'user', content: 'haz Y' });
    const msgs = await m.getMessages();
    expect(msgs).toHaveLength(2);
  });
});
