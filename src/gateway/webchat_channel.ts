// src/gateway/webchat_channel.ts
//
// Bloque 6 — la WebChat "remota" reusa el servidor web del Bloque 1 (port
// 3333, ya bindea a 0.0.0.0 por defecto de Node). Este módulo NO crea un
// servidor nuevo — solo recolecta las IPs LAN del host para que el boot
// del gateway pueda mostrarle al usuario dónde acceder desde otros
// dispositivos.

import * as os from 'os';

export interface LanAddress {
  iface: string;
  family: 'IPv4' | 'IPv6';
  address: string;
}

/** Returns non-loopback IPv4 addresses of all network interfaces. */
export function getLanAddresses(): LanAddress[] {
  const out: LanAddress[] = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    if (!list) continue;
    for (const i of list) {
      if (i.internal) continue;
      // Filtramos solo IPv4 — IPv6 link-local rara vez sirve para URLs simples.
      if (i.family === 'IPv4') {
        out.push({ iface: name, family: 'IPv4', address: i.address });
      }
    }
  }
  return out;
}

export function lanWebChatInfo(port: number): string {
  const addrs = getLanAddresses();
  if (addrs.length === 0) return `WebChat LAN: (sin IPs LAN detectadas — sólo localhost:${port} accesible)`;
  const urls = addrs.map(a => `http://${a.address}:${port}`).join(', ');
  return `WebChat LAN: ${urls}`;
}
