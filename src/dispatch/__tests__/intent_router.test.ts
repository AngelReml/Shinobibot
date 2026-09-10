// src/dispatch/__tests__/intent_router.test.ts
import { describe, it, expect } from 'vitest';
import { IntentRouter } from '../intent_router.js';
import { performance } from 'perf_hooks';
import { APP_VERSION } from '../../utils/app_version.js';

describe('IntentRouter', () => {
  it('resuelve comandos deterministas explícitos (!ping, !version) de forma inmediata', async () => {
    const t0 = performance.now();
    const resPing = await IntentRouter.route('!ping');
    const t1 = performance.now();

    expect(resPing.matched).toBe(true);
    expect(resPing.type).toBe('command');
    expect(resPing.intentName).toBe('ping');
    expect(resPing.response).toBe('pong');

    // Canario de "no hace I/O": el enrutado de comandos deterministas no toca
    // disco, red ni LLM, así que resuelve en microsegundos. El umbral es holgado
    // (< 50 ms) a propósito — no es un microbenchmark (2 ms flakeaba bajo GC/carga),
    // es una alarma para si `route()` empezara a hacer trabajo asíncrono real.
    const duration = t1 - t0;
    expect(duration).toBeLessThan(50);
  });

  it('resuelve otros comandos deterministas (!version, !status, !help)', async () => {
    const resVer = await IntentRouter.route('!version');
    expect(resVer.matched).toBe(true);
    // F0.4: versión única de verdad (package.json vía APP_VERSION), no un
    // literal hardcodeado ("ShinobiBot Enterprise Edition - Versión 4.5.1").
    expect(resVer.response).toBe(`Shinobi v${APP_VERSION}`);
    expect(resVer.response).not.toMatch(/enterprise edition|4\.5\.1/i);

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
    // Texto post-extirpación OG: ya no cita "el estado del OpenGravity Kernel".
    expect(res2.response).toContain('`/status` para ver el estado');

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
