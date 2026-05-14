/**
 * Plugin Manifest — schema y validador del archivo `shinobi.plugin.json`
 * que cada plugin de Shinobi debe declarar en su raíz.
 *
 * Inspirado en OpenClaw plugin SDK (manifest-first, terceros pueden
 * distribuir sin fork) pero más conservador: capabilities tipadas, sin
 * surface ENORME de exports.
 *
 * Schema versión 1.0 (estable):
 *   {
 *     "schemaVersion": "1.0",
 *     "name": "shinobi-plugin-<algo>",
 *     "version": "<semver>",
 *     "description": "...",
 *     "author": "...",              // opcional
 *     "entry": "./index.js",        // path relativo al manifest
 *     "capabilities": ["tool", "channel", "provider", "memory"],
 *     "sdkVersion": ">=1.0.0"       // rango semver
 *   }
 *
 * El loader rechaza manifestos que no validen — el usuario ve un error
 * claro en vez de un fallo de runtime opaco.
 */

export const SUPPORTED_CAPABILITIES = ['tool', 'channel', 'provider', 'memory'] as const;
export type Capability = (typeof SUPPORTED_CAPABILITIES)[number];

export const CURRENT_SCHEMA_VERSION = '1.0';
export const CURRENT_SDK_VERSION = '1.0.0';

export interface PluginManifest {
  schemaVersion: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  entry: string;
  capabilities: Capability[];
  sdkVersion: string;
}

export interface ValidationResult {
  ok: boolean;
  manifest?: PluginManifest;
  errors: string[];
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/i;
const NAME_RE = /^shinobi-plugin-[a-z0-9][a-z0-9-]{0,40}$/i;
const SDK_RANGE_RE = /^(\^|~|>=|>|<=|<|=)?\s*\d+\.\d+\.\d+(?:\s+(\^|~|>=|>|<=|<|=)\s*\d+\.\d+\.\d+)*$/i;

/**
 * Compara dos semvers a.b.c. Devuelve -1, 0 o 1.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('-')[0].split('.').map(Number);
  const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

/**
 * Evalúa un rango semver tipo ">=1.0.0", "^1.2.3", "~1.0", "=1.0.0" o
 * exactamente "1.0.0". Devuelve true si `version` satisface el rango.
 *
 * Implementación mínima (sin semver dep): soporta los operadores que el
 * plugin SDK necesita en práctica. Para reglas complejas (>=1.0 <2.0
 * combinadas) lo trataría como error y se rechazaría el plugin.
 */
export function satisfiesSemverRange(range: string, version: string): boolean {
  const trimmed = range.trim();
  if (!trimmed) return false;
  const exactMatch = trimmed.match(/^=?\s*(\d+\.\d+\.\d+)$/);
  if (exactMatch) return compareSemver(version, exactMatch[1]) === 0;
  const opMatch = trimmed.match(/^(\^|~|>=|>|<=|<)\s*(\d+\.\d+\.\d+)$/);
  if (!opMatch) return false;
  const [, op, target] = opMatch;
  const cmp = compareSemver(version, target);
  switch (op) {
    case '>=': return cmp >= 0;
    case '>': return cmp > 0;
    case '<=': return cmp <= 0;
    case '<': return cmp < 0;
    case '^': {
      // ^1.2.3 → >=1.2.3 <2.0.0
      const major = Number(target.split('.')[0]);
      const upper = `${major + 1}.0.0`;
      return cmp >= 0 && compareSemver(version, upper) < 0;
    }
    case '~': {
      // ~1.2.3 → >=1.2.3 <1.3.0
      const [maj, min] = target.split('.').map(Number);
      const upper = `${maj}.${min + 1}.0`;
      return cmp >= 0 && compareSemver(version, upper) < 0;
    }
    default:
      return false;
  }
}

export function validateManifest(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['manifest no es un objeto JSON'] };
  }
  const m = input as Record<string, unknown>;

  // schemaVersion
  if (m.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    errors.push(`schemaVersion debe ser "${CURRENT_SCHEMA_VERSION}" (got ${JSON.stringify(m.schemaVersion)})`);
  }
  // name
  if (typeof m.name !== 'string' || !NAME_RE.test(m.name)) {
    errors.push(`name debe matchear ${NAME_RE} (got ${JSON.stringify(m.name)})`);
  }
  // version
  if (typeof m.version !== 'string' || !SEMVER_RE.test(m.version)) {
    errors.push(`version debe ser semver (got ${JSON.stringify(m.version)})`);
  }
  // description
  if (typeof m.description !== 'string' || m.description.trim().length < 5) {
    errors.push(`description debe ser string de >=5 chars`);
  }
  // entry
  if (typeof m.entry !== 'string' || !/^\.\.?\//.test(m.entry)) {
    errors.push(`entry debe ser path relativo (empezar por ./ o ../)`);
  }
  // capabilities
  if (!Array.isArray(m.capabilities) || m.capabilities.length === 0) {
    errors.push(`capabilities debe ser array no vacío`);
  } else {
    for (const c of m.capabilities) {
      if (typeof c !== 'string' || !(SUPPORTED_CAPABILITIES as readonly string[]).includes(c)) {
        errors.push(`capability "${String(c)}" no soportada. Permitidas: ${SUPPORTED_CAPABILITIES.join(', ')}`);
      }
    }
  }
  // sdkVersion
  if (typeof m.sdkVersion !== 'string' || !SDK_RANGE_RE.test(m.sdkVersion)) {
    errors.push(`sdkVersion debe ser rango semver simple (got ${JSON.stringify(m.sdkVersion)})`);
  } else if (!satisfiesSemverRange(m.sdkVersion, CURRENT_SDK_VERSION)) {
    errors.push(`sdkVersion ${m.sdkVersion} incompatible con SDK actual ${CURRENT_SDK_VERSION}`);
  }
  // author es opcional pero si está, debe ser string.
  if (m.author !== undefined && typeof m.author !== 'string') {
    errors.push(`author debe ser string si está presente`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    manifest: {
      schemaVersion: m.schemaVersion as string,
      name: m.name as string,
      version: m.version as string,
      description: m.description as string,
      author: m.author as string | undefined,
      entry: m.entry as string,
      capabilities: m.capabilities as Capability[],
      sdkVersion: m.sdkVersion as string,
    },
    errors: [],
  };
}
