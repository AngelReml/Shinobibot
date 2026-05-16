/**
 * Test de regresión — incidente 2026-05-16 (escenario Iván):
 * "Iván pide una misión de browser sin Comet abierto".
 *
 * Lo que pasó: clean_extract falló con "No browser on port 9222". Shinobi NO
 * paró — probó 12 keywords distintas, luego run_command, luego screen_observe,
 * y finalmente intentó cerrar las ventanas del usuario con screen_act + Alt+F4.
 *
 * Lo que debe pasar ahora:
 *   1. screen_act RECHAZA de plano cualquier hotkey destructiva (Alt+F4,
 *      Ctrl+W, Ctrl+Q, Win+L, Alt+Tab…) — no se puede cerrar la ventana del
 *      usuario ni con force_confirm.
 *   2. El loop detector capa 3 PARA tras 3 fallos consecutivos del mismo modo
 *      de fallo de entorno (browser caído), aunque sean tools/args distintos,
 *      y pide intervención humana en vez de cambiar de táctica.
 *
 * Doc del incidente: docs/incidents/2026-05-16_screen_act_hotkey_escape.md
 */
import { describe, it, expect } from 'vitest';
import {
  checkDestructiveHotkey,
  isDestructiveAction,
  normalizeKeyToken,
} from '../../utils/screen_safety.js';
import { LoopDetector, classifyFailureMode } from '../loop_detector.js';

describe('Incidente 2026-05-16 — blacklist de hotkeys destructivas en screen_act', () => {
  it('Alt+F4 está bloqueado — screen_act nunca cierra la ventana del usuario', () => {
    const r = checkDestructiveHotkey({ action: 'hotkey', hotkey: ['Alt', 'F4'] });
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/alt\+f4/i);
  });

  it('bloquea Ctrl+W, Ctrl+F4, Ctrl+Q, Ctrl+Shift+Q (cierre de ventana/app)', () => {
    for (const combo of [['Control', 'W'], ['Control', 'F4'], ['Control', 'Q'], ['Control', 'Shift', 'Q']]) {
      expect(checkDestructiveHotkey({ action: 'hotkey', hotkey: combo }).blocked).toBe(true);
    }
  });

  it('bloquea Win+L, Win+D, Win+M (bloqueo / minimizar todo)', () => {
    for (const combo of [['Win', 'L'], ['Win', 'D'], ['Win', 'M']]) {
      expect(checkDestructiveHotkey({ action: 'hotkey', hotkey: combo }).blocked).toBe(true);
    }
  });

  it('bloquea Ctrl+Alt+Delete y Alt+Tab (cambio de contexto)', () => {
    expect(checkDestructiveHotkey({ action: 'hotkey', hotkey: ['Control', 'Alt', 'Delete'] }).blocked).toBe(true);
    expect(checkDestructiveHotkey({ action: 'hotkey', hotkey: ['Alt', 'Tab'] }).blocked).toBe(true);
  });

  it('reconoce alias de nut-js: LeftAlt+F4, LeftControl+w, super+l', () => {
    expect(checkDestructiveHotkey({ action: 'hotkey', hotkey: ['LeftAlt', 'F4'] }).blocked).toBe(true);
    expect(checkDestructiveHotkey({ action: 'hotkey', hotkey: ['LeftControl', 'w'] }).blocked).toBe(true);
    expect(checkDestructiveHotkey({ action: 'hotkey', hotkey: ['super', 'l'] }).blocked).toBe(true);
  });

  it('bloquea también vía press_key (keys[]) — defensa adicional', () => {
    expect(checkDestructiveHotkey({ action: 'press_key', keys: ['alt', 'f4'] }).blocked).toBe(true);
  });

  it('el orden de las teclas y mayúsculas no importan', () => {
    expect(checkDestructiveHotkey({ action: 'hotkey', hotkey: ['F4', 'ALT'] }).blocked).toBe(true);
    expect(checkDestructiveHotkey({ action: 'hotkey', hotkey: ['w', 'CONTROL'] }).blocked).toBe(true);
  });

  it('NO bloquea hotkeys legítimas: Ctrl+S, Ctrl+C, Ctrl+V, Ctrl+A, Ctrl+T', () => {
    for (const combo of [['Control', 'S'], ['Control', 'C'], ['Control', 'V'], ['Control', 'A'], ['Control', 'T']]) {
      expect(checkDestructiveHotkey({ action: 'hotkey', hotkey: combo }).blocked).toBe(false);
    }
  });

  it('NO aplica a acciones que no son hotkey/press_key (click, type, scroll)', () => {
    expect(checkDestructiveHotkey({ action: 'click' }).blocked).toBe(false);
    expect(checkDestructiveHotkey({ action: 'type' }).blocked).toBe(false);
  });

  it('normalizeKeyToken colapsa los alias esperados', () => {
    expect(normalizeKeyToken('LeftControl')).toBe('control');
    expect(normalizeKeyToken('ctrl')).toBe('control');
    expect(normalizeKeyToken('LeftAlt')).toBe('alt');
    expect(normalizeKeyToken('super')).toBe('win');
    expect(normalizeKeyToken('cmd')).toBe('win');
  });

  it('isDestructiveAction ya NO marca Alt+F4/Ctrl+W (los gestiona la blacklist dura)', () => {
    // Alt+F4 y Ctrl+W pasan de "confirmable" a "bloqueado de plano": ya no
    // deben aparecer como destructive en la capa de confirmación.
    expect(isDestructiveAction({ action: 'hotkey', hotkey: ['alt', 'f4'] }).destructive).toBe(false);
    expect(isDestructiveAction({ action: 'hotkey', hotkey: ['control', 'w'] }).destructive).toBe(false);
    // Delete sigue siendo confirmable.
    expect(isDestructiveAction({ action: 'press_key', keys: ['delete'] }).destructive).toBe(true);
  });
});

describe('Incidente 2026-05-16 — loop detector capa 3 (modo de fallo de entorno)', () => {
  const browserErr = (kw: string) =>
    `clean_extract failed for "${kw}": No browser on port 9222 (CDP unavailable)`;

  it('para tras 3 clean_extract que fallan por el mismo modo (browser caído)', () => {
    const d = new LoopDetector();
    expect(d.recordOutcome('clean_extract', false, browserErr('gatos')).abort).toBe(false);
    expect(d.recordOutcome('clean_extract', false, browserErr('perros')).abort).toBe(false);
    const r = d.recordOutcome('clean_extract', false, browserErr('aves'));
    expect(r.abort).toBe(true);
    expect(r.verdict).toBe('LOOP_SAME_FAILURE');
    expect(r.reason).toBe('env_failure:browser_unavailable');
  });

  it('detecta el mismo modo de fallo aunque cambie la tool y los args', () => {
    // El incidente: 12× clean_extract → run_command → screen_observe, todas
    // fallando por el browser. Distintas tools, mismo modo de fallo.
    const d = new LoopDetector();
    expect(d.recordOutcome('clean_extract', false, browserErr('noticias')).abort).toBe(false);
    expect(d.recordOutcome('run_command', false, 'chrome is not running, devtools port closed').abort).toBe(false);
    const r = d.recordOutcome('screen_observe', false, 'cannot connect: devtools port 9222 refused');
    expect(r.abort).toBe(true);
    expect(r.verdict).toBe('LOOP_SAME_FAILURE');
  });

  it('un éxito intermedio rompe la racha (no hay falso positivo)', () => {
    const d = new LoopDetector();
    d.recordOutcome('clean_extract', false, browserErr('a'));
    d.recordOutcome('clean_extract', false, browserErr('b'));
    expect(d.recordOutcome('web_search', true).abort).toBe(false); // éxito → reset
    expect(d.recordOutcome('clean_extract', false, browserErr('c')).abort).toBe(false);
    expect(d.recordOutcome('clean_extract', false, browserErr('d')).abort).toBe(false);
    expect(d.recordOutcome('clean_extract', false, browserErr('e')).abort).toBe(true);
  });

  it('un fallo de modo distinto rompe la racha (cuenta como racha nueva)', () => {
    const d = new LoopDetector();
    d.recordOutcome('clean_extract', false, browserErr('a'));
    d.recordOutcome('clean_extract', false, browserErr('b'));
    // Fallo de red: modo distinto → reinicia la racha a 1.
    expect(d.recordOutcome('http_get', false, 'ECONNREFUSED 10.0.0.1:443').abort).toBe(false);
    expect(d.recordOutcome('http_get', false, 'ETIMEDOUT').abort).toBe(false);
    expect(d.recordOutcome('http_get', false, 'getaddrinfo ENOTFOUND host').abort).toBe(true);
  });

  it('un fallo no clasificable (bug del agente) rompe la racha y no aborta', () => {
    const d = new LoopDetector();
    d.recordOutcome('clean_extract', false, browserErr('a'));
    d.recordOutcome('clean_extract', false, browserErr('b'));
    // Error no de entorno → reset; cambiar de táctica AQUÍ sí tiene sentido.
    expect(d.recordOutcome('calc', false, 'invalid argument: expected a number').abort).toBe(false);
    expect(d.recordOutcome('clean_extract', false, browserErr('c')).abort).toBe(false);
  });

  it('maxSameFailureMode es configurable', () => {
    const d = new LoopDetector({ maxSameFailureMode: 2 });
    expect(d.recordOutcome('clean_extract', false, browserErr('a')).abort).toBe(false);
    expect(d.recordOutcome('clean_extract', false, browserErr('b')).abort).toBe(true);
  });
});

describe('classifyFailureMode', () => {
  it('clasifica browser/CDP caído', () => {
    expect(classifyFailureMode('No browser on port 9222')).toBe('browser_unavailable');
    expect(classifyFailureMode('devtools websocket disconnected')).toBe('browser_unavailable');
    expect(classifyFailureMode('Comet is not running')).toBe('browser_unavailable');
  });
  it('clasifica auth inválida', () => {
    expect(classifyFailureMode('401 Unauthorized')).toBe('auth_invalid');
    expect(classifyFailureMode('invalid api key')).toBe('auth_invalid');
  });
  it('clasifica fichero inexistente', () => {
    expect(classifyFailureMode('ENOENT: no such file or directory')).toBe('file_not_found');
  });
  it('clasifica red inalcanzable', () => {
    expect(classifyFailureMode('ECONNREFUSED')).toBe('network_unreachable');
  });
  it('devuelve null para errores no de entorno (bug del agente)', () => {
    expect(classifyFailureMode('invalid argument: expected a number')).toBeNull();
    expect(classifyFailureMode('')).toBeNull();
    expect(classifyFailureMode(null)).toBeNull();
    expect(classifyFailureMode(undefined)).toBeNull();
  });
});

describe('Incidente 2026-05-16 — escenario completo: misión de browser sin Comet', () => {
  it('Shinobi para limpiamente y NO intenta cerrar ventanas ni cambiar de táctica', () => {
    const d = new LoopDetector();
    let aborted: ReturnType<LoopDetector['recordOutcome']> | null = null;

    // Iván pide extraer info de 12 temas. Comet no está abierto.
    const temas = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
    for (const t of temas) {
      const r = d.recordOutcome('clean_extract', false, `extract "${t}": No browser on port 9222`);
      if (r.abort) { aborted = r; break; }
    }

    // Debe haber parado en el 3er intento — no en el 12º.
    expect(aborted).not.toBeNull();
    expect(aborted!.verdict).toBe('LOOP_SAME_FAILURE');
    expect(aborted!.reason).toBe('env_failure:browser_unavailable');

    // Y si, pese a todo, intentara "arreglar" el browser cerrando ventanas,
    // screen_act lo rechaza de plano.
    expect(checkDestructiveHotkey({ action: 'hotkey', hotkey: ['Alt', 'F4'] }).blocked).toBe(true);
  });
});
