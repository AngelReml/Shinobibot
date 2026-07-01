// src/egress/ip_ranges.ts
//
// F2.1 (CRIT-08, auditoría 2026-07-01) — clasificador puro de IPs
// privadas/reservadas/metadata. Sin I/O, sin dependencias de red: solo
// aritmética sobre la representación numérica de la IP. Es el núcleo
// testeable del runtime guard (runtime_guard.ts), separado para poder
// unit-testear la lógica de rangos sin necesitar sockets reales.
//
// Alcance deliberado: bloquea el destino de egress MÁS peligroso y menos
// disputable (red privada del operador + endpoint de metadata cloud), no
// intenta ser un firewall de propósito general. Ver runtime_guard.ts para
// el razonamiento sobre qué SÍ se permite (loopback) y por qué.

/** Convierte una IPv4 "a.b.c.d" a entero de 32 bits (para comparar rangos). */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

interface Cidr4 { base: number; mask: number; }

function cidr4(base: string, prefixLen: number): Cidr4 {
  const b = ipv4ToInt(base);
  if (b === null) throw new Error(`ip_ranges: CIDR base inválida: ${base}`);
  const mask = prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0;
  return { base: b & mask, mask };
}

function inCidr4(ipInt: number, c: Cidr4): boolean {
  return (ipInt & c.mask) === c.base;
}

// RFC 1918 (privada) + RFC 3927 (link-local, incluye el endpoint de
// metadata cloud 169.254.169.254 usado por AWS/GCP/Azure para exponer
// credenciales de instancia — el objetivo clásico de un SSRF) + loopback +
// CGNAT (RFC 6598) + "this network" (RFC 791).
const IPV4_BLOCKED: Cidr4[] = [
  cidr4('10.0.0.0', 8),
  cidr4('172.16.0.0', 12),
  cidr4('192.168.0.0', 16),
  cidr4('169.254.0.0', 16),   // incluye 169.254.169.254 (metadata cloud)
  cidr4('100.64.0.0', 10),    // CGNAT
  cidr4('0.0.0.0', 8),
];

// Loopback (127.0.0.0/8) se clasifica APARTE — ver isLoopbackIp: se permite
// por defecto (Ollama local, servicios de dev), no se bloquea.
const IPV4_LOOPBACK = cidr4('127.0.0.0', 8);

export function isIPv4(ip: string): boolean {
  return ipv4ToInt(ip) !== null;
}

export function isLoopbackIp(ip: string): boolean {
  if (ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  const n = ipv4ToInt(stripV4MappedPrefix(ip));
  if (n === null) return false;
  return inCidr4(n, IPV4_LOOPBACK);
}

function stripV4MappedPrefix(ip: string): string {
  // "::ffff:10.0.0.1" → "10.0.0.1" (IPv4-mapped IPv6, común cuando Node
  // resuelve dual-stack). Sin esto, una IP privada disfrazada de IPv6
  // pasaría el check IPv4 sin ser detectada.
  const m = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  return m ? m[1] : ip;
}

/** IPv6 privado/reservado: unique-local (fc00::/7), link-local (fe80::/10). */
function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1') return false; // loopback, tratado aparte
  if (lower === '::') return true;   // unspecified — no es un destino válido
  // unique-local fc00::/7 → primer grupo hex empieza en fc o fd.
  const firstGroup = lower.split(':')[0];
  if (/^f[cd][0-9a-f]{2}$/.test(firstGroup)) return true;
  // link-local fe80::/10 → primer grupo fe8x-febx.
  if (/^fe[89ab][0-9a-f]$/.test(firstGroup)) return true;
  return false;
}

/**
 * ¿Es esta IP (v4 o v6, ya resuelta — no un hostname) un destino
 * privado/reservado/metadata que el runtime guard debe bloquear?
 * Loopback NO cuenta como "privado" aquí — ver isLoopbackIp / el banner de
 * runtime_guard.ts para el porqué.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const stripped = stripV4MappedPrefix(ip);
  if (isLoopbackIp(ip)) return false;
  const v4 = ipv4ToInt(stripped);
  if (v4 !== null) return IPV4_BLOCKED.some((c) => inCidr4(v4, c));
  if (ip.includes(':')) return isPrivateIpv6(ip);
  return false; // no parseable como IP — el caller decide qué hacer (p.ej. tratar como hostname)
}
