// F1.5 (RANK #3, auditoría 2026-07-01) — el veredicto post-acción 'halt' debe
// tener consecuencias REALES, no solo un console.log. Dos verificaciones
// separadas, correspondientes a los dos hallazgos distintos del ítem:
//
// 1) effectiveModeForPostAction: en modo 'flag' (default global), una tool de
//    la clase destructiva (DESTRUCTIVE_TOOLS) debe evaluarse en 'enforce' —
//    antes, SOLO SHINOBI_INTEGRITY=enforce global daba halt; una tool
//    destructiva con fabricación pasaba desapercibida en el modo por defecto.
// 2) La cobertura pre-acción (11.1/11.2) NO se sube automáticamente para la
//    clase destructiva — documentamos y fijamos por qué (ver banner de
//    engine.ts): haría que CADA llamada a run_command/screen_act/etc. se
//    bloqueara siempre al no existir certificado CSV para esas tools. Este
//    test ancla ese comportamiento para que no se "arregle" por accidente de
//    forma que rompa el uso normal de esas tools.
import { describe, it, expect } from 'vitest';
import { runPostAction, runPreAction, effectiveModeForPostAction } from '../engine.js';
import { stepForToolCall } from '../registry.js';

describe('F1.5 — effectiveModeForPostAction sube flag→enforce para la clase destructiva', () => {
  it('tool destructiva (run_command) en modo flag global → modo efectivo enforce', () => {
    delete process.env.SHINOBI_INTEGRITY; // default 'flag'
    expect(effectiveModeForPostAction('run_command')).toBe('enforce');
    expect(effectiveModeForPostAction('write_file')).toBe('enforce');
    expect(effectiveModeForPostAction('screen_act')).toBe('enforce');
  });

  it('tool NO destructiva (read_file) en modo flag global → sigue en flag (FIX 0.14: no-disruptivo)', () => {
    delete process.env.SHINOBI_INTEGRITY;
    expect(effectiveModeForPostAction('read_file')).toBe('flag');
  });

  it('modo off explícito nunca se sube, ni para tool destructiva', () => {
    process.env.SHINOBI_INTEGRITY = 'off';
    try {
      expect(effectiveModeForPostAction('run_command')).toBe('off');
    } finally {
      delete process.env.SHINOBI_INTEGRITY;
    }
  });

  it('run_command con fabricación real bajo modo flag global → runPostAction ya da halt (antes daba flag)', () => {
    delete process.env.SHINOBI_INTEGRITY;
    const v = runPostAction({
      tool: 'run_command',
      real: { success: false, output: 'Permission denied' },
      reported: { claims_success: true },
      risk: 'low',
    });
    expect(v.ok).toBe(false);
    expect(v.flags).toContain('FABRICATION');
    expect(v.action).toBe('halt'); // la regresión que este test fija: antes era 'flag'
  });

  it('read_file (no destructiva) con fabricación bajo modo flag global → sigue en flag, no halt', () => {
    delete process.env.SHINOBI_INTEGRITY;
    const v = runPostAction({
      tool: 'read_file',
      real: { success: false, output: 'ENOENT' },
      reported: { claims_success: true },
      risk: 'low',
    });
    expect(v.ok).toBe(false);
    expect(v.action).toBe('flag'); // comportamiento no-disruptivo preservado
  });
});

describe('F1.5 — cobertura pre-acción (11.1/11.2) deliberadamente NO se sube para la clase destructiva', () => {
  it('run_command sin skill binding, modo flag global → proceed (11.1 UNVERIFIED pero NO bloquea)', () => {
    delete process.env.SHINOBI_INTEGRITY;
    const v = runPreAction(stepForToolCall('run_command', { command: 'ls' }));
    expect(v.ok).toBe(false); // 11.1 UNVERIFIED_SKILL sigue fallando (es la verdad: no hay cert)
    expect(v.action).toBe('flag'); // pero NO bloquea — si esto fuera 'halt', run_command dejaría de funcionar SIEMPRE
  });

  it('ancla documentada: si algún día se sube pre-acción a enforce para destructivas SIN certificar, esto debe fallar (recordatorio activo)', () => {
    // Verificación directa de que, en el estado actual del código, subir el
    // modo pre-acción para run_command (simulando con SHINOBI_INTEGRITY=enforce
    // global, el único mecanismo que existe hoy) SÍ bloquea con UNVERIFIED_SKILL
    // — la prueba de por qué NO se puede hacer eso "por defecto" sin antes
    // construir certificados reales para la familia shell.
    process.env.SHINOBI_INTEGRITY = 'enforce';
    try {
      const v = runPreAction(stepForToolCall('run_command', { command: 'ls' }));
      expect(v.action).toBe('halt');
      expect(v.flags).toContain('UNVERIFIED_SKILL');
    } finally {
      delete process.env.SHINOBI_INTEGRITY;
    }
  });
});
