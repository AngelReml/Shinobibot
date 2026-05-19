// src/dispatch/__tests__/intent_router.test.ts
import { describe, it, expect } from 'vitest';
import { IntentRouter } from '../intent_router.js';
import { performance } from 'perf_hooks';

describe('IntentRouter', () => {
  it('resuelve comandos deterministas explícitos (!ping, !version) de forma inmediata', async () => {
    const t0 = performance.now();
    const resPing = await IntentRouter.route('!ping');
    const t1 = performance.now();

    expect(resPing.matched).toBe(true);
    expect(resPing.type).toBe('command');
    expect(resPing.intentName).toBe('ping');
    expect(resPing.response).toBe('pong');
    
    // Validar latencia < 2ms (usualmente < 0.1ms en local)
    const duration = t1 - t0;
    expect(duration).toBeLessThan(2);
  });

  it('resuelve otros comandos deterministas (!version, !status, !help)', async () => {
    const resVer = await IntentRouter.route('!version');
    expect(resVer.matched).toBe(true);
    expect(resVer.response).toContain('ShinobiBot v4.5.1');

    const resHelp = await IntentRouter.route('!help');
    expect(resHelp.matched).toBe(true);
    expect(resHelp.response).toContain('Comandos disponibles');
  });

  it('identifica y resuelve intenciones de lenguaje natural ligeras', async () => {
    const res1 = await IntentRouter.route('hola shinobi');
    expect(res1.matched).toBe(true);
    expect(res1.type).toBe('regex_intent');
    expect(res1.intentName).toBe('ping');
    expect(res1.response).toContain('¡Hola! Soy ShinobiBot');

    const res2 = await IntentRouter.route('ayuda');
    expect(res2.matched).toBe(true);
    expect(res2.intentName).toBe('help');
    expect(res2.response).toContain('`/status` para verificar');

    const res3 = await IntentRouter.route('cÓmo estÁs?');
    expect(res3.matched).toBe(true);
    expect(res3.intentName).toBe('status');
  });

  it('retorna no-matched para inputs no estructurados complejos', async () => {
    const res = await IntentRouter.route('necesito que analices el log del servidor y me generes un reporte');
    expect(res.matched).toBe(false);
    expect(res.type).toBe('none');
  });
});
