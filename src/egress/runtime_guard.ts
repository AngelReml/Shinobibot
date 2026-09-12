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
// QUÉ SÍ HACE ADEMÁS (P1.E5 — broker de egress POR MISIÓN):
//   - Cuando la MISIÓN activa corre bajo un mandato (P1), toda salida a un HOSTNAME
//     que el mandato no conceda (`net:<host>`) se bloquea aquí — allowlist de destino
//     POR TAREA, no por proceso. Resuelve justo el "por tarea, no por proceso" que
//     antes quedaba fuera. Sin mandato de misión ⇒ no aplica (solo el bloqueo de IPs
//     privadas de abajo). Reusa `egressAllowed`/`mandateCovers` de P1.
//
// QUÉ NO HACE (alcance deliberado, no es teatro — ver DECISIONES.md):
//   - NO impone la allowlist de MÓDULOS ORIGEN de egress_policy.ts (esa sigue siendo
//     honor-based/lint estático). El allowlist por-misión de arriba cubre el DESTINO
//     por tarea; el de módulos-origen es otra capa.
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
import { currentMandate, egressAllowed } from '../sandbox/mandate.js';

let installed = false;
// Referencias originales guardadas a nivel de módulo — necesarias para que
// _uninstallEgressRuntimeGuardForTests() pueda restaurar de verdad (no solo
// bajar el flag `installed`, que dejaría el patch puesto y produciría un
// doble-wrap en la siguiente instalación dentro del mismo proceso de test).
let _savedLookup: typeof dns.lookup | null = null;
let _savedPromiseLookup: typeof dns.promises.lookup | null = null;
let _savedConnect: typeof net.Socket.prototype.connect | null = null;

export class EgressBlockedError extends Error {
  constructor(public readonly host: string, public readonly ip: string, reason?: string) {
    super(reason ?? `Egress bloqueado: ${host} resuelve a ${ip} (IP privada/reservada/metadata). Ver src/egress/runtime_guard.ts.`);
    this.name = 'EgressBlockedError';
  }
}

function auditBlock(host: string, ip: string, reason = 'destino privado/reservado'): void {
  console.error(`[SECURITY][egress] BLOQUEADO: intento de conexión a ${host} (${ip}) — ${reason}.`);
  try {
    logToolCall({ tool: 'egress_runtime_guard', args: { host, ip, reason }, success: false, durationMs: 0, error: 'EGRESS_BLOCKED' });
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
    // P1.E5 — broker por misión: si la misión activa tiene mandato y no concede
    // `net:<hostname>`, se bloquea aquí, ANTES de resolver. Sin mandato ⇒ pasa.
    const mLookup = currentMandate();
    if (mLookup && !egressAllowed(hostname, mLookup)) {
      auditBlock(hostname, '(mandate)', `host fuera del mandato de red de la misión (net:${hostname})`);
      cb(new EgressBlockedError(hostname, '(mandate)', `Egress bloqueado: '${hostname}' fuera del mandato de red de la misión.`));
      return;
    }
    return (originalLookup as any).call(dns, hostname, opts, (err: any, address: string | Array<{ address: string; family: number }>, family: number) => {
      const addresses = Array.isArray(address) ? address.map((entry) => entry.address) : [address];
      const blocked = addresses.find((candidate) => candidate && isPrivateOrReservedIp(candidate));
      if (!err && blocked) {
        auditBlock(hostname, blocked);
        cb(new EgressBlockedError(hostname, blocked));
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
      const mPromise = currentMandate();
      if (mPromise && !egressAllowed(hostname, mPromise)) {
        auditBlock(hostname, '(mandate)', `host fuera del mandato de red de la misión (net:${hostname})`);
        throw new EgressBlockedError(hostname, '(mandate)', `Egress bloqueado: '${hostname}' fuera del mandato de red de la misión.`);
      }
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
    // P1.E5 — si el host es un HOSTNAME (no IP literal) y la misión tiene mandato que no lo cubre, bloquear.
    const mConnect = currentMandate();
    if (typeof host === 'string' && !isIPv4(host) && mConnect && !egressAllowed(host, mConnect)) {
      auditBlock(host, '(mandate)', `host fuera del mandato de red de la misión (net:${host})`);
      const err = new EgressBlockedError(host, '(mandate)', `Egress bloqueado: '${host}' fuera del mandato de red de la misión.`);
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
