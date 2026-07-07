/**
 * tenshu/registry.ts — el REGISTRO ABIERTO de capacidades del dojo. Sustituye al enum
 * cerrado DojoSource: una capacidad se registra con su DojoManifest (presentación) y, opcional,
 * las capacidades de seguridad que declaró (la MISMA gramática `kind:scope` que confine/manifest).
 * De ahí se DERIVA el territorio que dispara el candado (§11) — una sola fuente de verdad: el
 * permiso. Puro/in-process. Añadir una capacidad = registrar; cero enums que editar.
 */

import type { DojoManifest, DojoSource, Territorio } from './types.js';

/** Gramática de capacidades de seguridad (idéntica a src/confine/manifest.ts). */
const CAP_RE = /^(shell|fs\.read|fs\.write|net|input):(.+)$/;
/** Scopes que huelen a secreto/credencial. */
const SECRET_RE = /(^|[/._-])(env|ssh|secret|secrets|token|tokens|key|keys|credential|credentials|password)\b/i;

/**
 * capabilities → territorio. La pieza que lee el candado. 'dinero' NO es derivable de esta
 * gramática (se declara aparte). Precedencia: secretos > destrucción > ninguno.
 */
export function deriveTerritory(capabilities: readonly string[]): Territorio {
  let destructive = false;
  for (const cap of capabilities) {
    const m = CAP_RE.exec(cap);
    if (!m) continue;                             // malformada → se ignora (fail-closed en confine)
    const kind = m[1];
    const scope = m[2];
    if ((kind === 'fs.read' || kind === 'fs.write') && SECRET_RE.test(scope)) return 'secretos';
    if (kind === 'shell') destructive = true;     // shell arbitrario puede destruir
  }
  return destructive ? 'destruccion' : 'ninguno';
}

interface Entry { manifest: DojoManifest; capabilities: readonly string[]; }
const REGISTRY = new Map<DojoSource, Entry>();

/** Registra (o reemplaza) una capacidad por su id. */
export function registerCapability(manifest: DojoManifest, capabilities: readonly string[] = []): void {
  REGISTRY.set(manifest.id, { manifest, capabilities });
}
export function getManifest(id: DojoSource): DojoManifest | undefined { return REGISTRY.get(id)?.manifest; }
/** Territorio derivado del permiso declarado; sin registro ⇒ 'ninguno'. */
export function getTerritory(id: DojoSource): Territorio {
  const e = REGISTRY.get(id);
  return e ? deriveTerritory(e.capabilities) : 'ninguno';
}
export function listSources(): DojoSource[] { return [...REGISTRY.keys()]; }
/** Solo para tests: vacía el registro. */
export function clearRegistry(): void { REGISTRY.clear(); }

/**
 * Semilla: las 6 fuentes que antes vivían en el enum. Registrarlas aquí conserva el
 * comportamiento y demuestra que el enum ya no es la fuente de verdad. Capacidades vacías
 * ⇒ territorio 'ninguno' (conservador): los mandatos reales de cada subsistema viven en su gate.
 */
export function seedKnownSources(): void {
  const seed: DojoManifest[] = [
    { id: 'kagemusha', nombre: 'Kagemusha', hace: 'Investiga de noche y trae el Informe del Amanecer', zona: 'CONDUCIR', emite: ['phase_start', 'phase_end', 'action', 'skill_certified'], estado: 'sello' },
    { id: 'kagami',    nombre: 'Kagami',    hace: 'Autocrítica calibrada del propio trabajo',           zona: 'ENTENDER', emite: ['phase_start', 'phase_end', 'metric'], estado: 'sello' },
    { id: 'chizu',     nombre: 'Chizu',     hace: 'Retrata la máquina: descubrimiento, uso y riesgo',   zona: 'VER',      emite: ['phase_start', 'phase_end', 'metric'], estado: 'sello' },
    { id: 'shugyo',    nombre: 'Shugyo',    hace: 'Aprende programas en jaula revertible',              zona: 'CONDUCIR', emite: ['phase_start', 'phase_end', 'action', 'skill_certified'], estado: 'sello' },
    { id: 'shitsuji',  nombre: 'Shitsuji',  hace: 'Compone skills certificados sobre datos reales',     zona: 'CONDUCIR', emite: ['phase_start', 'phase_end', 'action', 'skill_certified'], estado: 'sello' },
    { id: 'kangeiko',  nombre: 'Kangeiko',  hace: 'Motor de auto-mejora verificada',                    zona: 'ENTENDER', emite: ['phase_start', 'phase_end', 'metric', 'frontier_update'], estado: 'sello' },
  ];
  for (const m of seed) registerCapability(m);
}
