// src/egress/egress_policy.ts
//
// E3 — SOBERANÍA: Capa de Egress (punto único de control de red saliente, opt-in y auditable).
/**
 * E3 — SOBERANÍA: Capa de Egress
 *
 * Punto único de control de todo tráfico de red saliente de Shinobi.
 * Principio: toda llamada de red es opt-in explícita y auditable.
 * Las llamadas al LLM son inevitables; todo lo demás requiere justificación.
 *
 * ALLOWLIST de módulos autorizados para llamadas de red directas:
 * - src/providers/         — llamadas a LLM (razón de ser del agente)
 * - src/cloud/             — pool de credenciales + cliente legacy
 * - src/telemetry/         — opt-in anónimo (usuario acepta en wizard)
 * - src/tools/web_search*  — búsqueda explícita por el usuario
 * - src/memory/embedding_providers/ — embeddings para memoria semántica
 * - src/memory/providers/  — proveedores de memoria externos (opt-in)
 * - src/kangeiko/domains/web/ — ejecución controlada de tareas web en dojo
 * - src/skills/registry/   — instalación de skills desde fuente conocida
 *
 * TODO fuera de esa allowlist es una violación de egress.
 *
 * LIMITACIÓN CONOCIDA, PARCIALMENTE CERRADA (F2.1/CRIT-08, auditoría
 * 2026-07-01 — actualiza la nota original de 2026-06-30): `egressGate()`
 * en sí sigue siendo HONOR-BASED — solo devuelve `{allowed}`, no intercepta
 * nada; el ÚNICO caller de producción sigue siendo
 * `src/channels/adapters/webhook_adapter.ts` (ALTA-12) — y la allowlist de
 * MÓDULOS ORIGEN de más arriba sigue sin enforcement en runtime: cualquier
 * módulo que importe `axios`/`node:https` directamente puede saltarse esta
 * lista, detectado solo por el lint estático de CI
 * (`src/egress/__tests__/egress_invariants.test.ts`), no en runtime.
 * Imponer esa allowlist de MÓDULOS por HOST de destino requeriría fijar los
 * destinos de cada módulo — pero varios módulos legítimos (web_search, el
 * instalador de skills, el gateway multi-proveedor) necesitan alcanzar
 * destinos arbitrarios/dinámicos por diseño, así que ese enforcement
 * específico sigue fuera de alcance (cambio de arquitectura mayor, no un
 * fix puntual).
 *
 * LO QUE SÍ SE CERRÓ EN F2.1: `src/egress/runtime_guard.ts` instala un
 * interceptor REAL a nivel de proceso (parchea `dns.lookup`/
 * `dns.promises.lookup`/`net.Socket.prototype.connect`) que bloquea, sin
 * importar qué módulo origina la llamada — incluido código importado
 * dinámicamente o generado en runtime, el caso que el lint estático NUNCA
 * puede cubrir — cualquier conexión saliente hacia una IP privada,
 * reservada o de metadata cloud (RFC1918, link-local incl.
 * 169.254.169.254). Es un guard de clase de amenaza (SSRF/exfiltración
 * hacia la red interna), no un allowlist de host por módulo: complementario
 * a esta allowlist honor-based, no un reemplazo. Se instala por defecto en
 * los entry points (`scripts/shinobi.ts`, `scripts/shinobi_web.ts`,
 * `scripts/shinobi-tui.tsx`); opt-out explícito con
 * `SHINOBI_EGRESS_RUNTIME_GUARD=0`, documentado en DECISIONES.md si se usa.
 */

export const EGRESS_ALLOWLIST: readonly string[] = [
  'src/providers/',
  'src/cloud/',
  'src/telemetry/',
  'src/tools/web_search',
  'src/tools/audio_transcribe',        // fallback a OpenAI Whisper API (transcripción)
  'src/memory/embedding_providers/',
  'src/memory/providers/',
  'src/kangeiko/domains/web/',
  'src/skills/registry/',
  'src/skills/anthropic_skill_installer', // descarga de skills desde GitHub
  'src/gateway/',                        // gateway LLM multi-proveedor (ollama/groq/openai)
  'src/utils/vision_client',             // cliente vision LLM (OpenRouter/OpenAI)
  'src/channels/adapters/webhook_adapter.ts', // callback HTTP opt-in del operador (WEBHOOK_CALLBACK_URL), validado anti-SSRF (CRIT-10)
] as const;

/** Términos de import que implican llamada de red directa. */
export const NETWORK_IMPORT_PATTERNS: readonly string[] = [
  "'axios'",
  '"axios"',
  "from 'axios'",
  'from "axios"',
  "import fetch",
  "from 'node-fetch'",
  'from "node-fetch"',
  "from 'got'",
  'from "got"',
  "from 'undici'",
  'from "undici"',
] as const;

/**
 * Clasificación de una llamada de red por sensibilidad de datos.
 *
 * Degradación graciosa por sensibilidad (mitigación E3):
 * - SENSITIVE  → modelo local obligatorio (aunque sea peor)
 * - NORMAL     → remoto permitido
 *
 * El operador no elige entre soberanía y capacidad en abstracto;
 * elige por tarea, y el sistema lo impone.
 */
export type DataSensitivity = 'sensitive' | 'normal';

export interface EgressRequest {
  /** Destino de la llamada (dominio o URL parcial para logs). */
  destination: string;
  /** Módulo fuente que hace la llamada (para auditoría). */
  source: string;
  /** Razón justificada de la llamada. */
  reason: string;
  /** Sensibilidad de los datos enviados. */
  sensitivity?: DataSensitivity;
}

export interface EgressResult {
  allowed: boolean;
  reason: string;
  /** Si sensitivity=sensitive, fuerza degradación a modelo local. */
  useLocalModel?: boolean;
}

/**
 * Normaliza un path de módulo para comparación segura contra la allowlist:
 * unifica separadores de Windows (`\`) a `/` y quita el `./` inicial.
 *
 * CRIT-09/ALTA-11 (auditoría 2026-06-30): antes se comparaba con
 * `sourceModule.includes(prefix)`, lo que permite bypass por substring
 * (p.ej. `'src/evil/wrappers/src/providers/proxy.ts'.includes('src/providers/')`
 * es `true`). `source` lo provee libremente el caller, así que `includes()`
 * no es una comparación de seguridad válida — hay que anclar al INICIO
 * del string normalizado con `startsWith()`.
 */
function normalizeSourcePath(p: string): string {
  let s = String(p).replace(/\\/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  return s;
}

/**
 * Gate de egress: evalúa si una llamada de red está autorizada.
 * Todos los providers y módulos autorizados llaman esto antes de salir.
 *
 * @returns allowed=true si el módulo está en la allowlist y la llamada
 *   está justificada. Para datos sensibles, marca useLocalModel=true.
 */
export function egressGate(req: EgressRequest): EgressResult {
  const normalizedSource = normalizeSourcePath(req.source);
  const isAllowlisted = EGRESS_ALLOWLIST.some(prefix => normalizedSource.startsWith(prefix));

  if (!isAllowlisted) {
    return {
      allowed: false,
      reason: `Egress no autorizado desde ${req.source} → ${req.destination}. ` +
        `Solo los módulos en EGRESS_ALLOWLIST pueden hacer llamadas de red directas.`,
    };
  }

  const useLocalModel = req.sensitivity === 'sensitive';

  return {
    allowed: true,
    reason: `Egress autorizado: ${req.source} → ${req.destination} (${req.reason})`,
    useLocalModel,
  };
}

/**
 * Verifica si un módulo fuente está en la allowlist de egress.
 * Versión simplificada para checks rápidos.
 */
export function isEgressAuthorized(sourceModule: string): boolean {
  const normalizedSource = normalizeSourcePath(sourceModule);
  return EGRESS_ALLOWLIST.some(prefix => normalizedSource.startsWith(prefix));
}
