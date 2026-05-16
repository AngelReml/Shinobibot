/**
 * Test de regresión — incidente 2026-05-16 (escenario Iván):
 * "Iván pide una misión de browser sin Comet abierto".
 *
 * Lo que pasó: clean_extract falló con "No browser on port 9222". Shinobi NO
 * paró — probó 12 keywords distintas, luego run_command, luego screen_observe,
 * y finalmente intentó cerrar las ventanas del usuario con screen_act + Alt+F4.
 *
 * --- ACTUALIZACIÓN tras 2ª prueba real con Iván ---
 * El primer fix (capa 3 = "N fallos CONSECUTIVOS del mismo modo") NO funcionó
 * en ejecución real: Shinobi intercaló otras tools (taskkill, sleeps,
 * screen_observe) entre los fallos de browser, reseteando el contador. Llegó a
 * la iteración 10 sin abortar (fallos browser_unavailable en iter 4, 5, 8 — no
 * consecutivos). El test de regresión inicial pasaba porque simulaba fallos
 * CONSECUTIVOS; la realidad es INTERCALADA.
 *
 * Este test ahora reproduce el comportamiento REAL observado: fallos del mismo
 * modo intercalados con otras tools. La capa 3 ya no cuenta consecutivos —
 * usa un contador acumulativo + una ventana deslizante.
 *
 * Doc del incidente: docs/incidents/2026-05-16_screen_act_hotkey_escape.md
 */
import { describe, it, expect } from 'vitest';
import {
  checkDestructiveHotkey,
  isDestructiveAction,
  normalizeKeyToken,
} from '../../utils/screen_safety.js';
import { LoopDetector, classifyFailureMode, type FailureMode } from '../loop_detector.js';

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
    expect(isDestructiveAction({ action: 'hotkey', hotkey: ['alt', 'f4'] }).destructive).toBe(false);
    expect(isDestructiveAction({ action: 'hotkey', hotkey: ['control', 'w'] }).destructive).toBe(false);
    expect(isDestructiveAction({ action: 'press_key', keys: ['delete'] }).destructive).toBe(true);
  });
});

// --- Capa 3 del loop detector: fallo de entorno repetido NO consecutivo ----

describe('Incidente 2026-05-16 — loop detector capa 3 (fallos de entorno INTERCALADOS)', () => {
  const browserErr = (kw: string) =>
    `clean_extract failed for "${kw}": No browser on port 9222 (CDP unavailable)`;

  it('aborta tras 3 fallos del mismo modo aunque NO sean consecutivos', () => {
    const d = new LoopDetector();
    // Fallo de browser, luego un éxito de otra tool, luego otro fallo, etc.
    expect(d.recordOutcome('clean_extract', false, browserErr('a')).abort).toBe(false);
    expect(d.recordOutcome('screen_observe', true).abort).toBe(false);
    expect(d.recordOutcome('clean_extract', false, browserErr('b')).abort).toBe(false);
    expect(d.recordOutcome('run_command', true).abort).toBe(false);
    const r = d.recordOutcome('clean_extract', false, browserErr('c'));
    expect(r.abort).toBe(true);
    expect(r.verdict).toBe('LOOP_SAME_FAILURE');
    expect(r.reason).toBe('env_failure:browser_unavailable');
  });

  it('los éxitos intercalados NO resetean el contador acumulativo', () => {
    const d = new LoopDetector();
    d.recordOutcome('clean_extract', false, browserErr('a'));
    for (let i = 0; i < 5; i++) d.recordOutcome('web_search', true); // 5 éxitos seguidos
    d.recordOutcome('clean_extract', false, browserErr('b'));
    for (let i = 0; i < 5; i++) d.recordOutcome('web_search', true);
    // 3er fallo de browser: pese a 10 éxitos intercalados, aborta.
    expect(d.recordOutcome('clean_extract', false, browserErr('c')).abort).toBe(true);
  });

  it('un fallo no-de-entorno intercalado (taskkill rechazado) NO resetea', () => {
    const d = new LoopDetector();
    d.recordOutcome('clean_extract', false, browserErr('a'));
    d.recordOutcome('run_command', false, 'Blocked destructive command: taskkill rejected by blacklist');
    d.recordOutcome('clean_extract', false, browserErr('b'));
    d.recordOutcome('screen_act', false, 'Blocked destructive hotkey — Alt+F4 closes the active window');
    expect(d.recordOutcome('clean_extract', false, browserErr('c')).abort).toBe(true);
  });

  it('detecta el mismo modo aunque cambie la tool y los args', () => {
    const d = new LoopDetector();
    d.recordOutcome('clean_extract', false, browserErr('noticias'));
    d.recordOutcome('run_command', false, 'chrome is not running, devtools port closed');
    const r = d.recordOutcome('screen_observe', false, 'cannot connect: devtools port 9222 refused');
    expect(r.abort).toBe(true);
    expect(r.verdict).toBe('LOOP_SAME_FAILURE');
  });

  it('modos de fallo distintos tienen contadores independientes', () => {
    const d = new LoopDetector();
    d.recordOutcome('clean_extract', false, browserErr('a'));   // browser 1
    d.recordOutcome('http_get', false, 'ECONNREFUSED');         // network 1
    d.recordOutcome('clean_extract', false, browserErr('b'));   // browser 2
    d.recordOutcome('http_get', false, 'ETIMEDOUT');            // network 2
    // browser llega a 3 antes que network → aborta por browser.
    const r = d.recordOutcome('clean_extract', false, browserErr('c'));
    expect(r.abort).toBe(true);
    expect(r.reason).toBe('env_failure:browser_unavailable');
  });

  it('contador acumulativo configurable vía maxSameFailureMode', () => {
    const d = new LoopDetector({ maxSameFailureMode: 2 });
    expect(d.recordOutcome('clean_extract', false, browserErr('a')).abort).toBe(false);
    expect(d.recordOutcome('clean_extract', false, browserErr('b')).abort).toBe(true);
  });

  it('la ventana deslizante caza el clustering aunque el umbral acumulativo sea alto', () => {
    // maxSameFailureMode alto a propósito: solo la ventana debe disparar.
    const d = new LoopDetector({ maxSameFailureMode: 100, failureWindowSize: 6, failureWindowThreshold: 3 });
    d.recordOutcome('clean_extract', false, browserErr('a'));
    d.recordOutcome('screen_observe', true);
    d.recordOutcome('clean_extract', false, browserErr('b'));
    d.recordOutcome('screen_observe', true);
    const r = d.recordOutcome('clean_extract', false, browserErr('c'));
    expect(r.abort).toBe(true);
    expect(r.verdict).toBe('LOOP_SAME_FAILURE');
    expect(r.hash).toMatch(/^window:/);
  });

  it('la ventana NO dispara si los fallos quedan fuera de su tamaño (lo cubre el acumulativo)', () => {
    const d = new LoopDetector({ maxSameFailureMode: 100, failureWindowSize: 3, failureWindowThreshold: 3 });
    d.recordOutcome('clean_extract', false, browserErr('a'));
    d.recordOutcome('screen_observe', true);
    d.recordOutcome('screen_observe', true);
    d.recordOutcome('screen_observe', true);
    d.recordOutcome('clean_extract', false, browserErr('b'));
    // Solo 1 fallo de browser en la ventana de 3 → la ventana NO aborta;
    // el acumulativo tampoco (umbral 100). Demuestra que se necesitan ambos.
    expect(d.recordOutcome('screen_observe', true).abort).toBe(false);
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
    expect(classifyFailureMode('Blocked destructive command: taskkill rejected by blacklist')).toBeNull();
    expect(classifyFailureMode('Blocked destructive hotkey — Alt+F4 closes the active window')).toBeNull();
    expect(classifyFailureMode('')).toBeNull();
    expect(classifyFailureMode(null)).toBeNull();
    expect(classifyFailureMode(undefined)).toBeNull();
  });
});

// --- Fixture: log REAL de la sesión que falló, iteraciones 1-10 -------------

interface IterOutcome {
  iter: number;
  tool: string;
  success: boolean;
  error?: string;
  /** Modo de fallo esperado tras clasificar (solo documental / aserción). */
  expectedMode: FailureMode | null;
}

/**
 * Reconstrucción del log real observado por Iván (2026-05-16). Shinobi recibe
 * una misión de navegación con Comet cerrado. Los fallos de `browser_unavailable`
 * caen en las iteraciones 4, 5 y 8 — NO consecutivas, intercaladas con
 * taskkill (rechazado), screen_observe y un intento de Alt+F4.
 *
 * Con el diseño "consecutivo" original Shinobi llegó a la iteración 10 sin
 * abortar. Con el diseño nuevo (acumulativo) debe abortar en la iteración 8,
 * que es el 3er `browser_unavailable`.
 */
const REAL_SESSION_ITERS: IterOutcome[] = [
  { iter: 1,  tool: 'screen_observe', success: true,  expectedMode: null },
  { iter: 2,  tool: 'run_command',    success: true,  expectedMode: null },
  { iter: 3,  tool: 'web_search',     success: true,  expectedMode: null },
  { iter: 4,  tool: 'clean_extract',  success: false, error: 'clean_extract "noticias": No browser on port 9222', expectedMode: 'browser_unavailable' },
  { iter: 5,  tool: 'clean_extract',  success: false, error: 'clean_extract "deportes": No browser on port 9222', expectedMode: 'browser_unavailable' },
  { iter: 6,  tool: 'run_command',    success: false, error: 'Blocked destructive command: taskkill /im chrome.exe rejected by blacklist', expectedMode: null },
  { iter: 7,  tool: 'screen_observe', success: true,  expectedMode: null },
  { iter: 8,  tool: 'clean_extract',  success: false, error: 'clean_extract "economia": No browser on port 9222', expectedMode: 'browser_unavailable' },
  { iter: 9,  tool: 'screen_act',     success: false, error: 'Blocked destructive hotkey — Alt+F4 closes the active window', expectedMode: null },
  { iter: 10, tool: 'clean_extract',  success: false, error: 'clean_extract "cultura": No browser on port 9222', expectedMode: 'browser_unavailable' },
];

describe('Incidente 2026-05-16 — escenario REAL: misión de browser sin Comet (iter 1-10)', () => {
  it('el fixture refleja fallos de browser NO consecutivos (defeat del diseño viejo)', () => {
    // El diseño original ("N fallos CONSECUTIVOS del mismo modo") nunca habría
    // abortado: la racha consecutiva máxima de browser_unavailable es 2.
    let run = 0;
    let maxRun = 0;
    for (const it of REAL_SESSION_ITERS) {
      run = it.expectedMode === 'browser_unavailable' ? run + 1 : 0;
      maxRun = Math.max(maxRun, run);
    }
    expect(maxRun).toBe(2);            // < 3 → el detector consecutivo NO dispara
    const totalBrowser = REAL_SESSION_ITERS.filter(i => i.expectedMode === 'browser_unavailable').length;
    expect(totalBrowser).toBe(4);      // pero hay 4 fallos de browser en la misión
  });

  it('Shinobi aborta en la iteración 8 (3er browser_unavailable), NO en la 10+', () => {
    const d = new LoopDetector();      // config por defecto: acumulativo=3, ventana 3/6
    let abortedAtIter: number | null = null;
    let abortVerdict: string | undefined;
    let abortReason: string | undefined;

    for (const it of REAL_SESSION_ITERS) {
      // Sanity: la clasificación del error coincide con lo esperado.
      expect(classifyFailureMode(it.success ? undefined : it.error)).toBe(it.expectedMode);
      const r = d.recordOutcome(it.tool, it.success, it.error);
      if (r.abort && abortedAtIter === null) {
        abortedAtIter = it.iter;
        abortVerdict = r.verdict;
        abortReason = r.reason;
        break; // el orchestrator para aquí — no sigue ejecutando tools
      }
    }

    expect(abortedAtIter).not.toBeNull();
    expect(abortedAtIter).toBeLessThanOrEqual(8);
    expect(abortedAtIter).toBe(8);
    expect(abortVerdict).toBe('LOOP_SAME_FAILURE');
    expect(abortReason).toBe('env_failure:browser_unavailable');
  });

  it('tras abortar, Shinobi NO puede cerrar la ventana del usuario con Alt+F4', () => {
    // Aunque el agente intentara "arreglar" el browser, screen_act lo rechaza.
    expect(checkDestructiveHotkey({ action: 'hotkey', hotkey: ['Alt', 'F4'] }).blocked).toBe(true);
  });
});
