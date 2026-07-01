// src/egress/runtime_guard.ts
//
// F2.1 (CRIT-08, auditoría 2026-07-01) — enforcement REAL de egress en
// runtime, a diferencia de egress_policy.ts (honor-based: solo un test de
// CI que escanea imports en texto fuente).
//
// QUÉ SÍ HACE: intercepta, a nivel de proceso, toda resolución DNS
// (`dns.lookup`, el mecanismo que usan por debajo `http`/`https`/`axios`/
// `fetch` nativo de Node/undici cuando no se pasa un `lookup` custom) y
// todo `net.connect`/`Socket.connect` directo con IP literal. Si el
// destino resuelto es una IP privada/reservada/metadata (ver
// ip_ranges.ts: RFC1918, link-local incl. 169.254.169.254 — el endpoint
// de credenciales de instancia en AWS/GCP/Azure, el objetivo clásico de un
// SSRF), la conexión se rechaza ANTES de establecerse, sin importar qué
// módulo la origina — incluido código importado dinámicamente o generado
// en runtime, que es exactamente el caso que el lint estático de
// egress_policy.ts no puede cubrir.
//
// QUÉ NO HACE (alcance deliberado, no es teatro — ver DECISIONES.md):
//   - NO impone la allowlist de MÓDULOS ORIGEN de egress_policy.ts (esa
//     sigue siendo honor-based/lint). Imponerla en runtime requeriría un
//     allowlist de HOSTS DE DESTINO por módulo, y varios módulos legítimos
//     (web_search, el instalador de skills, el gateway multi-proveedor)
//     necesitan poder llegar a destinos arbitrarios/dinámicos por diseño —
//     un allowlist de hosts fijo los rompería o habría que dejarlo tan
//     abierto que dejaría de proteger nada. Ese es un cambio de arquitectura
//     mayor (por tarea, no por proceso) fuera de alcance de este fix.
//   - NO bloquea loopback (127.0.0.0/8, ::1): hay integraciones legítimas
//     con servicios locales (p.ej. Ollama en localhost) que dependen de
//     poder conectar ahí. Loopback no es un vector de movimiento lateral
//     del mismo tipo que una IP de LAN o el endpoint de metadata cloud.
//   - Reduce, no elimina, la superficie SSRF: un atacante que ya controla
//     un proceso con acceso a `net`/`dns` de bajo nivel más allá de estos
//     puntos de entrada (p.ej. un binding nativo) podría evadirlo. Cubre el
//     99% real: cualquier `axios`/`fetch`/`http`/`https` estándar, que es
//     como se hace egress en JS/TS en la práctica.
//
// Activado por defecto; opt-out explícito con SHINOBI_EGRESS_RUNTIME_GUARD=0
// (documentar en DECISIONES.md si se desactiva y por qué).

import dns from 'node:dns';
import net from 'node:net';
import { isPrivateOrReservedIp, isIPv4 } from './ip_ranges.js';
import { logToolCall } from '../audit/audit_log.js';

let installed = false;
// Referencias originales guardadas a nivel de módulo — necesarias para que
// _uninstallEgressRuntimeGuardForTests() pueda restaurar de verdad (no solo
// bajar el flag `installed`, que dejaría el patch puesto y produciría un
// doble-wrap en la siguiente instalación dentro del mismo proceso de test).
let _savedLookup: typeof dns.lookup | null = null;
let _savedPromiseLookup: typeof dns.promises.lookup | null = null;
let _savedConnect: typeof net.Socket.prototype.connect | null = null;

export class EgressBlockedError extends Error {
  constructor(public readonly host: string, public readonly ip: string) {
    super(`Egress bloqueado: ${host} resuelve a ${ip} (IP privada/reservada/metadata). Ver src/egress/runtime_guard.ts.`);
    this.name = 'EgressBlockedError';
  }
}

function auditBlock(host: string, ip: string): void {
  console.error(`[SECURITY][egress] BLOQUEADO: intento de conexión a ${host} (${ip}) — destino privado/reservado.`);
  try {
    logToolCall({ tool: 'egress_runtime_guard', args: { host, ip }, success: false, durationMs: 0, error: 'EGRESS_BLOCKED_PRIVATE_IP' });
  } catch { /* el guard nunca debe romperse porque el audit falle */ }
}

/**
 * Instala el interceptor. Idempotente (llamar varias veces no duplica el
 * patch). No-op si SHINOBI_EGRESS_RUNTIME_GUARD=0.
 */
export function installEgressRuntimeGuard(): void {
  if (installed) return;
  if (process.env.SHINOBI_EGRESS_RUNTIME_GUARD === '0') return;
  installed = true;

  // 1) dns.lookup — chokepoint que usan por defecto http/https/axios/fetch
  // nativo cuando resuelven un HOSTNAME (no una IP literal). Node invoca
  // `dns.lookup` dinámicamente vía el objeto de módulo, así que parchear la
  // función exportada aquí es visible para TODO caller que no pase su
  // propio `lookup` custom (el caso por defecto, y el que usan nuestros
  // providers/tools).
  const originalLookup = dns.lookup;
  _savedLookup = originalLookup;
  (dns as any).lookup = function guardedLookup(hostname: string, ...rest: any[]): any {
    const cb = rest[rest.length - 1];
    const opts = rest.length > 1 ? rest[0] : undefined;
    if (typeof cb !== 'function') {
      // Firma sin callback (p.ej. dns.promises) — no interceptable aquí de
      // forma segura sin romper el contrato de retorno; delega a la
      // original. dns.promises.lookup tiene su propio wrapper más abajo.
      return (originalLookup as any).call(dns, hostname, ...rest);
    }
    return (originalLookup as any).call(dns, hostname, opts, (err: any, address: string, family: number) => {
      if (!err && address && isPrivateOrReservedIp(address)) {
        auditBlock(hostname, address);
        cb(new EgressBlockedError(hostname, address));
        return;
      }
      cb(err, address, family);
    });
  };

  // dns.promises.lookup — usado por algunos clientes HTTP modernos (p.ej.
  // undici, que respalda el `fetch` global nativo de Node).
  try {
    _savedPromiseLookup = dns.promises.lookup;
    const originalPromiseLookup = dns.promises.lookup.bind(dns.promises);
    (dns.promises as any).lookup = async function guardedPromiseLookup(hostname: string, opts?: any): Promise<any> {
      const result: any = await originalPromiseLookup(hostname, opts as any);
      const addr = Array.isArray(result) ? result[0]?.address : result?.address;
      if (addr && isPrivateOrReservedIp(addr)) {
        auditBlock(hostname, addr);
        throw new EgressBlockedError(hostname, addr);
      }
      return result;
    };
  } catch { /* best-effort — algunas versiones de Node no exponen dns.promises igual */ }

  // 2) net.Socket.prototype.connect — cubre el caso en que el CALLER ya
  // resolvió la IP y conecta directo con un literal (bypassa dns.lookup por
  // completo). Sin este segundo hook, `net.connect({host:'169.254.169.254'})`
  // evadiría el guard de arriba.
  const originalConnect = net.Socket.prototype.connect;
  _savedConnect = originalConnect;
  (net.Socket.prototype as any).connect = function guardedConnect(this: net.Socket, ...args: any[]) {
    const opts = args[0];
    const host: string | undefined =
      typeof opts === 'object' && opts !== null ? (opts.host ?? opts.path) : typeof args[1] === 'string' ? args[1] : undefined;
    if (typeof host === 'string' && isIPv4(host) && isPrivateOrReservedIp(host)) {
      auditBlock(host, host);
      const err = new EgressBlockedError(host, host);
      queueMicrotask(() => this.emit('error', err));
      return this;
    }
    return (originalConnect as any).apply(this, args);
  };
}

/** Solo para tests: revierte el patch de verdad (restaura las funciones
 *  originales guardadas), no solo el flag — evitar doble-wrap si un test
 *  vuelve a instalar dentro del mismo proceso. */
export function _uninstallEgressRuntimeGuardForTests(): void {
  if (_savedLookup) { (dns as any).lookup = _savedLookup; _savedLookup = null; }
  if (_savedPromiseLookup) { (dns.promises as any).lookup = _savedPromiseLookup; _savedPromiseLookup = null; }
  if (_savedConnect) { (net.Socket.prototype as any).connect = _savedConnect; _savedConnect = null; }
  installed = false;
}
