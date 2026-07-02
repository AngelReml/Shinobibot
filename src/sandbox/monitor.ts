// P1.E1 (plan de frontera 2026-07-01) — Monitor de Referencia Único: `mediatedEffect()`.
//
// Chokepoint ÚNICO por el que pasa todo efecto de ejecución que antes se hacía
// llamando `sandboxRegistry().get(id).run()` directo desde fuera de src/sandbox/.
// Un reference monitor en el sentido clásico (Anderson 1972) tiene tres propiedades:
// completo (nadie lo esquiva), a prueba de manipulación y pequeño para ser verificable.
// Este fichero implementa la ETAPA E1-E2 de esa ambición, ni más ni menos:
//
//   HOY (E1-E2, este fichero):
//   - El efecto se modela como DATO tipado (`Effect`), no como string interpolado.
//     El modo argv (`target` + `args`) compone el comando con quoting seguro:
//     un argumento con `;`, `$( )`, backticks o comillas llega LITERAL al programa,
//     nunca al shell. La clase de inyección de F4.2 muere aquí por construcción.
//   - El modo `rawCommandLine` existe y es EXPLÍCITO: los callers legados pasan
//     líneas de shell completas; ocultarlo sería mentir. La policy (E3) podrá
//     denegarlo por-misión precisamente porque está declarado como dato.
//   - Resolución de backend en un solo punto, sin fallback silencioso: backend
//     desconocido o no registrado ⇒ denial, nunca "te lo corro en local y calla"
//     (paridad con la postura de run_command.ts).
//   - Completitud vigilada por arquitectura: `monitor_bypass_ratchet.test.ts` +
//     `monitor_is_unbypassable.test.ts` fallan en CI si cualquier fichero fuera de
//     src/sandbox/ vuelve a tocar `sandboxRegistry`.
//
//   TODAVÍA NO (etapas posteriores, declarado sin adornos):
//   - E3.a+E3.b HECHO: mandatos de capacidad. Pasar un mandato (explícito o de misión)
//     ENFORCEA de verdad (`./mandate.js`): efecto fuera del mandato ⇒
//     `capability_not_granted`/`mandate_expired`. La EMISIÓN por misión está cableada,
//     operador-controlada (`SHINOBI_MANDATE`, default-off ⇒ paridad legado). Queda la
//     FIRMA del mandato (E3.c, depende de P2) y que P4 derive el mínimo por misión.
//   - E4: backend confinado por defecto. El default sigue siendo `local` (con su
//     defensa propia F1.1: blacklist + env allowlist + redacción — intacta, §9).
//   - E4/E5: `fs.read`/`fs.write`/`net`/`input` existen en el TIPO para que el
//     contrato sea el del plan, pero ejecutar esos kinds DENIEGA (`unsupported_kind`)
//     hasta que su mediación real exista. La ruta PowerShell de run_command y el
//     resto de efectos no-shell del árbol siguen fuera de este monitor (documentado
//     en DECISIONES.md 2026-07-02).
//
// El monitor NO añade validación de contenido en E1-E2 (eso rompería paridad de
// comportamiento con los 6 callers migrados): la defensa de contenido vive en el
// propio LocalBackend (F1.1) y no se debilita. Lo que este fichero garantiza es
// ESTRUCTURAL: hay un solo camino, tipado, auditable y con un lugar donde colgar
// la policy de E3 sin volver a tocar a los callers.

import type { BackendId, RunOutput } from './types.js';
import { sandboxRegistry } from './registry.js';
import { redactSecrets } from '../security/secret_redactor.js';
import { checkMandate, currentMandate, type Mandate } from './mandate.js';

// ── El efecto como dato tipado ────────────────────────────────────────────────────

export type EffectKind = 'shell' | 'fs.read' | 'fs.write' | 'net' | 'input';

interface EffectBase {
  readonly kind: EffectKind;
  /**
   * Qué se afecta. Para `shell` en modo argv: el EJECUTABLE (argv[0]). Para `shell`
   * con `rawCommandLine:true`: la línea de shell completa. Para kinds futuros:
   * ruta (fs.*), host/url (net), descriptor de dispositivo (input).
   */
  readonly target: string;
  /**
   * Argumentos LITERALES del modo argv. Nunca se interpolan en un string de shell
   * "a mano": `composeShellCommand()` los quotea de forma que el shell los entregue
   * intactos al programa. Incompatible con `rawCommandLine:true`.
   */
  readonly args?: readonly string[];
  /**
   * Declarado por el CALLER: este efecto corre bajo un mecanismo que lo revierte
   * (p.ej. la jaula snapshot/restore de shugyo). E1-E2 lo transporta como dato;
   * E3+ (atestación pre/post, reversión enforced) lo consumirá. No es una promesa
   * del monitor: es la declaración honesta del que ejecuta.
   */
  readonly reversible: boolean;
}

export interface ShellEffect extends EffectBase {
  readonly kind: 'shell';
  readonly cwd: string;
  readonly timeoutMs: number;
  /**
   * Backend de ejecución (`local` | `docker` | `ssh` | `e2b` | `mock` | ids de test).
   * Default `'local'`: paridad exacta con el default histórico del registry.
   * Se valida en runtime contra el registro real — un id desconocido deniega.
   */
  readonly backendId?: string;
  /**
   * true ⇒ `target` ES una línea de shell completa que el shell del backend
   * interpretará (pipes, redirecciones, etc.). Es el modo de los callers legados
   * (E2) y de los comandos compuestos legítimos. EXPLÍCITO a propósito: la policy
   * de E3 podrá distinguir "shell crudo pedido a conciencia" de "argv seguro".
   */
  readonly rawCommandLine?: boolean;
}

export interface FsReadEffect extends EffectBase { readonly kind: 'fs.read'; }
export interface FsWriteEffect extends EffectBase { readonly kind: 'fs.write'; }
export interface NetEffect extends EffectBase { readonly kind: 'net'; }
export interface InputEffect extends EffectBase { readonly kind: 'input'; }

export type Effect = ShellEffect | FsReadEffect | FsWriteEffect | NetEffect | InputEffect;

// El tipo `Mandate` y el enforcement (`checkMandate`) viven en `./mandate.js`
// (E3.a). Se re-exporta aquí para no romper imports que lo tomaban del monitor —
// el contrato público del chokepoint no cambia.
export type { Mandate } from './mandate.js';

export type EffectDenialCode =
  | 'backend_unavailable'      // backend pedido no registrado / id desconocido
  | 'invalid_effect'           // el Effect está mal formado (raw+args, argv no componible, timeout inválido…)
  | 'unsupported_kind'         // kind declarado en el tipo pero sin mediación real todavía (E4/E5)
  | 'capability_not_granted'   // (E3.a) el efecto cae fuera del mandato de capacidades de la misión
  | 'mandate_expired'          // (E3.a) el mandato caducó (expiresAt en el pasado): re-emisión requerida
  | 'backend_faulted';         // el backend LANZÓ (no devolvió fallo): el monitor degrada limpio, no propaga

export type EffectResult =
  | { readonly ok: true; readonly run: RunOutput }
  | { readonly ok: false; readonly code: EffectDenialCode; readonly detail: string };

// ── Composición segura de argv → línea de shell ──────────────────────────────────
//
// Los backends ejecutan un STRING (`RunInput.command`) a través de un shell real
// (`child_process.exec`). La única forma de que un argv atraviese ese shell sin ser
// re-interpretado es quotearlo con el álgebra del shell concreto:
//
//   POSIX  — single quotes. Dentro de '…' NADA es especial salvo la propia comilla,
//            que se cierra/escapa/reabre ('\''). Es un quoting COMPLETO: cualquier
//            byte salvo NUL viaja literal, incluidos ; | & $( ) ` " \n.
//   win32  — cmd.exe NO tiene un quoting general seguro: %VAR% y ! (delayed
//            expansion) se expanden INCLUSO dentro de comillas dobles, y un CR/LF
//            parte el comando. La postura honesta es fail-closed: argumentos con
//            % ! \r \n \0 se RECHAZAN (invalid_effect) en vez de fingir que un
//            escape imposible existe. El resto se entrega con el quoting doble
//            estándar del runtime C de Windows (backslashes ante comilla doblados,
//            comilla interna escapada), que dentro de "…" también neutraliza
//            & | < > ^ para cmd.exe.
//
// La mutación canónica de este diseño (volver a concatenar `target + ' ' + args`)
// la caza `effect_no_shell_injection.test.ts`: el payload `x; touch canario`
// crearía el canario y el test se pone rojo.

const POSIX_SAFE = /^[A-Za-z0-9_%+=:,.\/@-]+$/;
const WIN_SAFE = /^[A-Za-z0-9_\-.:\\\/@]+$/;
const WIN_UNQUOTABLE = /[%!\r\n\0]/;

function quotePosix(token: string): string {
  if (token.length > 0 && POSIX_SAFE.test(token)) return token;
  return `'` + token.replace(/'/g, `'\\''`) + `'`;
}

function quoteWin32(token: string): string {
  if (WIN_UNQUOTABLE.test(token)) {
    throw new Error(
      `argumento no quoteable con seguridad en cmd.exe (contiene %, !, CR/LF o NUL): ${JSON.stringify(token)}. ` +
        `cmd.exe expande %VAR%/! incluso entre comillas; el monitor rechaza antes que fingir un escape que no existe.`,
    );
  }
  if (token.length > 0 && WIN_SAFE.test(token)) return token;
  // Quoting del runtime C de Windows: duplicar todo run de backslashes que preceda
  // a una comilla, escapar la comilla, y duplicar los backslashes finales antes de
  // cerrar. Dentro de "…" cmd.exe no interpreta & | < > ^ (y % ! ya están vetados).
  const escaped = token.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1');
  return `"${escaped}"`;
}

/**
 * Compone `target` + `args` en una línea que el shell de `platform` entregará al
 * programa EXACTAMENTE con esos argumentos. Lanza si la plataforma no puede
 * garantizarlo (win32 + caracteres de expansión de cmd.exe) — fail-closed.
 * `platform` es inyectable solo para poder testear ambas ramas desde cualquier OS.
 */
export function composeShellCommand(
  target: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string {
  if (!target || !target.trim()) throw new Error('composeShellCommand: target vacío');
  const quote = platform === 'win32' ? quoteWin32 : quotePosix;
  return [target, ...args].map(quote).join(' ');
}

// ── Observabilidad mínima (seam para tests; sin IO en el camino caliente) ────────

let _mediated = 0;
let _denied = 0;

/** Contadores del monitor (chokepoint vivo, no decorativo — lo asertan los tests). */
export function monitorStats(): { mediated: number; denied: number } {
  return { mediated: _mediated, denied: _denied };
}

/** Solo para tests. */
export function _resetMonitorStats(): void {
  _mediated = 0;
  _denied = 0;
}

// ── Audit de efectos (P1, "el chokepoint lo audita") ────────────────────────────────
//
// El Pilar 1 exige que el monitor "autorice, confine, redacte, AUDITE y (donde
// pueda) haga reversible" cada efecto. E1-E2 dejó fuera el audit; esto lo añade
// SIN acoplar el monitor a la capa de audit: un SINK inyectable, default no-op.
//
//   - Tests: nadie instala el sink ⇒ CERO escrituras, CERO cruft en el repo.
//   - Producción: el arranque (scripts/shinobi*.ts) instala el sink real vía
//     `installEffectAudit()` (src/sandbox/audit_wiring.ts) → writeAuditEvent.
//
// Cierra un hueco real: las ejecuciones de shell de shugyo/kaname/shitsuji/chizu/
// kagami eran INVISIBLES al audit (esquivaban run_command, donde el orchestrator
// audita). Ahora que todas pasan por aquí, este es su punto de observación.
// Fail-open: un fallo del sink JAMÁS bloquea ni altera el efecto (el audit es
// best-effort, igual que writeAuditEvent). El target se redacta y se recorta
// aquí mismo (defensa en profundidad), no solo en el sink.

export interface EffectAuditRecord {
  readonly kind: EffectKind;
  readonly backendId: string;
  /** Comando/target ya REDACTADO y recortado — nunca el valor crudo. */
  readonly targetPreview: string;
  readonly reversible: boolean;
  readonly decision: 'allow' | 'deny';
  /** Presente si decision==='deny'. */
  readonly code?: EffectDenialCode;
  /** Presente si decision==='allow'. */
  readonly success?: boolean;
  readonly durationMs?: number;
}

export type EffectAuditSink = (record: EffectAuditRecord) => void;

let _auditSink: EffectAuditSink | null = null;

/**
 * Instala (o quita, con null) el sink de audit de efectos. Lo llama el arranque
 * real; los tests lo usan para capturar. Default: no-op (sin efecto en tests).
 */
export function setEffectAuditSink(sink: EffectAuditSink | null): void {
  _auditSink = sink;
}

const AUDIT_TARGET_CAP = 256;

function redactAndCap(raw: string): string {
  let t = '';
  try {
    t = redactSecrets(raw ?? '').text;
  } catch {
    t = ''; // si la redacción falla, NO se filtra el crudo
  }
  if (t.length > AUDIT_TARGET_CAP) t = t.slice(0, AUDIT_TARGET_CAP) + `…[+${t.length - AUDIT_TARGET_CAP}]`;
  return t;
}

/** Construye el registro y lo entrega al sink. Fail-open total. */
function emitEffectAudit(effect: Effect, result: EffectResult): void {
  const sink = _auditSink;
  if (!sink) return;
  try {
    const backendId = effect.kind === 'shell' ? (effect.backendId ?? 'local') : 'n/a';
    const record: EffectAuditRecord = {
      kind: effect.kind,
      backendId,
      targetPreview: redactAndCap(String(effect.target ?? '')),
      reversible: effect.reversible,
      decision: result.ok ? 'allow' : 'deny',
      code: result.ok ? undefined : result.code,
      success: result.ok ? result.run.success : undefined,
      durationMs: result.ok ? result.run.durationMs : undefined,
    };
    sink(record);
  } catch {
    /* fail-open: el audit NUNCA afecta al efecto ni propaga. */
  }
}

// ── El chokepoint ─────────────────────────────────────────────────────────────────

function deny(code: EffectDenialCode, detail: string): EffectResult {
  _denied++;
  return { ok: false, code, detail };
}

/**
 * Ejecuta un `Effect` a través del único camino mediado. TODO caller fuera de
 * src/sandbox/ debe entrar por aquí — el ratchet de arquitectura lo enforcea.
 *
 * Media efectos `shell` con paridad de comportamiento respecto al acceso directo
 * previo (mismo backend, mismo RunInput, misma ausencia de fallback). Sobre esa
 * base, tres garantías de robustez añadidas tras E1-E2:
 *   - RESILIENCIA: si el backend LANZA (no devuelve fallo), el monitor lo captura
 *     y devuelve `backend_faulted` — un backend roto degrada limpio, no tumba al
 *     caller (que espera un objeto-resultado, no una excepción).
 *   - HARDENING: `timeoutMs` no-finito/negativo y `target` vacío en modo raw se
 *     rechazan como `invalid_effect` (fail-closed) en vez de colarse al backend.
 *   - AUDIT: cada efecto (permitido o denegado) se reporta al sink de audit,
 *     fail-open. `mandate` presente ⇒ denial explícita hasta que E3 exista.
 */
export async function mediatedEffect(effect: Effect, mandate?: Mandate): Promise<EffectResult> {
  // Mandato efectivo (E3): el explícito manda; si no hay, se toma el de la misión
  // activa (`currentMandate`, AsyncLocalStorage). Sin ninguno ⇒ undefined ⇒ rama
  // legado (sin enforcement), idéntica al comportamiento de E1-E2.
  const effective = mandate ?? currentMandate();
  const result = await _decideAndRun(effect, effective);
  emitEffectAudit(effect, result);   // fail-open: nunca altera `result`
  return result;
}

/** El núcleo de decisión+ejecución. `mediatedEffect` lo envuelve con el audit. */
async function _decideAndRun(effect: Effect, mandate?: Mandate): Promise<EffectResult> {
  // E3.a — enforcement de capacidades. Si hay mandato (explícito o de misión), el
  // efecto debe estar cubierto por él; si no, se DENIEGA antes de tocar backend.
  // Sin mandato ⇒ rama legado (paridad con E1-E2). El check es puro (`checkMandate`).
  if (mandate !== undefined) {
    const verdict = checkMandate(effect, mandate);
    if (!verdict.granted) return deny(verdict.code, verdict.detail);
  }

  if (effect.kind !== 'shell') {
    return deny(
      'unsupported_kind',
      `kind '${effect.kind}' declarado en el contrato pero sin mediación real todavía (P1.E4/E5). ` +
        'Fail-closed: no se ejecuta nada.',
    );
  }

  // HARDENING (resiliencia de entrada): un timeout no-finito o negativo es un
  // Effect malformado — child_process lo interpretaría de forma indefinida. Se
  // rechaza fail-closed. `0` es legítimo (Node lo trata como "sin timeout") y se
  // permite: la política de tope de duración es competencia de E3, no del tipado.
  if (!Number.isFinite(effect.timeoutMs) || effect.timeoutMs < 0) {
    return deny('invalid_effect', `timeoutMs inválido (${effect.timeoutMs}): debe ser un número finito >= 0.`);
  }

  if (effect.rawCommandLine && effect.args && effect.args.length > 0) {
    return deny(
      'invalid_effect',
      'rawCommandLine:true es incompatible con args: o línea cruda explícita, o argv componible — no ambos.',
    );
  }

  let command: string;
  if (effect.rawCommandLine) {
    // HARDENING: una línea cruda vacía no debe colarse al backend (ejecución
    // vacía / comportamiento indefinido). El modo argv ya rechaza target vacío
    // vía composeShellCommand; el modo raw lo hace aquí, con la misma postura.
    if (!effect.target.trim()) {
      return deny('invalid_effect', 'rawCommandLine con target vacío: no hay comando que ejecutar.');
    }
    command = effect.target;
  } else {
    try {
      command = composeShellCommand(effect.target, effect.args ?? []);
    } catch (e) {
      return deny('invalid_effect', (e as Error).message);
    }
  }

  const backendId = effect.backendId ?? 'local';
  // El cast es el mismo boundary que run_command.ts tenía (`as any`): ids llegan
  // de env/config como string; el Map del registry simplemente no encuentra los
  // desconocidos y eso deniega — sin fallback silencioso.
  const backend = sandboxRegistry().get(backendId as BackendId);
  if (!backend) {
    return deny('backend_unavailable', `backend '${backendId}' no registrado en el sandbox registry`);
  }

  // RESILIENCIA: el contrato de RunBackend es DEVOLVER un RunOutput (con
  // success:false ante fallo), no lanzar. Pero un backend real puede lanzar
  // (daemon docker que muere, driver e2b que tira, bug de un backend de test).
  // El monitor no debe propagar esa excepción a callers que esperan un objeto:
  // la captura y la convierte en un denial estructurado.
  let run: RunOutput;
  try {
    run = await backend.run({ command, cwd: effect.cwd, timeoutMs: effect.timeoutMs });
  } catch (e) {
    return deny('backend_faulted', `backend '${backendId}' lanzó en run(): ${(e as Error)?.message ?? String(e)}`);
  }
  _mediated++;
  return { ok: true, run };
}

/**
 * Probe read-only de disponibilidad de backend (sin efecto alguno). Para callers
 * que hoy solo necesitan saber "¿está configurado?" (p.ej. spawn_agent con e2b)
 * sin tocar el registry directamente.
 */
export function backendConfigured(id: string): boolean {
  const b = sandboxRegistry().get(id as BackendId);
  return b !== undefined && b.isConfigured();
}
