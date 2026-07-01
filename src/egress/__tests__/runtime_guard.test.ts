// F2.1 (CRIT-08, auditoría 2026-07-01) — el guard debe rechazar egress a IPs
// privadas/reservadas/metadata a nivel de proceso, sin importar qué módulo
// origina la llamada (a diferencia de egress_policy.ts, que es honor-based).
//
// Estrategia de test: mockeamos `dns.lookup`/`net.Socket.prototype.connect`
// ANTES de instalar el guard, de forma que installEgressRuntimeGuard() los
// envuelve. Así verificamos el comportamiento SIN hacer resolución DNS ni
// conexión TCP real (determinista, rápido, no depende de red del sandbox).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import dns from 'node:dns';
import net from 'node:net';
import {
  installEgressRuntimeGuard,
  _uninstallEgressRuntimeGuardForTests,
  EgressBlockedError,
} from '../runtime_guard.js';

describe('runtime_guard — dns.lookup interceptado', () => {
  let lookupSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    _uninstallEgressRuntimeGuardForTests();
    lookupSpy.mockRestore();
    delete process.env.SHINOBI_EGRESS_RUNTIME_GUARD;
  });

  it('hostname que resuelve a IP de metadata cloud (169.254.169.254) → EgressBlockedError', async () => {
    lookupSpy = vi.spyOn(dns, 'lookup').mockImplementation(((hostname: string, opts: any, cb: any) => {
      const callback = typeof opts === 'function' ? opts : cb;
      callback(null, '169.254.169.254', 4);
    }) as any);
    installEgressRuntimeGuard();

    await new Promise<void>((resolve) => {
      dns.lookup('metadata.google.internal', (err: any) => {
        expect(err).toBeInstanceOf(EgressBlockedError);
        resolve();
      });
    });
  });

  it('hostname que resuelve a IP privada RFC1918 → EgressBlockedError', async () => {
    lookupSpy = vi.spyOn(dns, 'lookup').mockImplementation(((hostname: string, opts: any, cb: any) => {
      const callback = typeof opts === 'function' ? opts : cb;
      callback(null, '10.0.0.5', 4);
    }) as any);
    installEgressRuntimeGuard();

    await new Promise<void>((resolve) => {
      dns.lookup('internal.corp.example', (err: any) => {
        expect(err).toBeInstanceOf(EgressBlockedError);
        resolve();
      });
    });
  });

  it('hostname que resuelve a IP pública → pasa sin error (no bloquea tráfico legítimo)', async () => {
    lookupSpy = vi.spyOn(dns, 'lookup').mockImplementation(((hostname: string, opts: any, cb: any) => {
      const callback = typeof opts === 'function' ? opts : cb;
      callback(null, '93.184.216.34', 4);
    }) as any);
    installEgressRuntimeGuard();

    await new Promise<void>((resolve) => {
      dns.lookup('example.com', (err: any, address: string) => {
        expect(err).toBeNull();
        expect(address).toBe('93.184.216.34');
        resolve();
      });
    });
  });

  it('hostname que resuelve a loopback → pasa sin error (excepción deliberada)', async () => {
    lookupSpy = vi.spyOn(dns, 'lookup').mockImplementation(((hostname: string, opts: any, cb: any) => {
      const callback = typeof opts === 'function' ? opts : cb;
      callback(null, '127.0.0.1', 4);
    }) as any);
    installEgressRuntimeGuard();

    await new Promise<void>((resolve) => {
      dns.lookup('localhost', (err: any, address: string) => {
        expect(err).toBeNull();
        expect(address).toBe('127.0.0.1');
        resolve();
      });
    });
  });

  it('SHINOBI_EGRESS_RUNTIME_GUARD=0 → no instala el patch (opt-out documentado)', async () => {
    process.env.SHINOBI_EGRESS_RUNTIME_GUARD = '0';
    lookupSpy = vi.spyOn(dns, 'lookup').mockImplementation(((hostname: string, opts: any, cb: any) => {
      const callback = typeof opts === 'function' ? opts : cb;
      callback(null, '169.254.169.254', 4);
    }) as any);
    installEgressRuntimeGuard();

    await new Promise<void>((resolve) => {
      dns.lookup('metadata.google.internal', (err: any, address: string) => {
        // Sin el guard instalado, pasa directo al mock — no hay bloqueo.
        expect(err).toBeNull();
        expect(address).toBe('169.254.169.254');
        resolve();
      });
    });
  });
});

describe('runtime_guard — net.Socket.connect con IP literal interceptado', () => {
  let connectSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    _uninstallEgressRuntimeGuardForTests();
    connectSpy.mockRestore();
  });

  it('connect directo a IP privada (bypass de DNS) → error EgressBlockedError, NO llega a la conexión real', async () => {
    connectSpy = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket) {
      return this; // si esto se invoca, el guard NO bloqueó — el test lo detecta abajo
    } as any);
    installEgressRuntimeGuard();

    const socket = new net.Socket();
    const errorPromise = new Promise<Error>((resolve) => socket.once('error', resolve));
    socket.connect({ host: '192.168.1.1', port: 80 });
    const err = await errorPromise;
    expect(err).toBeInstanceOf(EgressBlockedError);
    // La conexión "real" (mock) NUNCA debió invocarse para un destino bloqueado.
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('connect a IP pública → delega a la implementación original (no bloquea)', () => {
    connectSpy = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket) {
      return this;
    } as any);
    installEgressRuntimeGuard();

    const socket = new net.Socket();
    socket.connect({ host: '8.8.8.8', port: 443 });
    expect(connectSpy).toHaveBeenCalled();
  });
});

describe('runtime_guard — smoke real (sin mocks): el guard no rompe resolución DNS legítima', () => {
  afterEach(() => _uninstallEgressRuntimeGuardForTests());

  it('dns.lookup real de "localhost" sigue funcionando tras instalar el guard (sin red externa)', async () => {
    installEgressRuntimeGuard();
    const address = await new Promise<string>((resolve, reject) => {
      dns.lookup('localhost', (err, addr) => (err ? reject(err) : resolve(addr as string)));
    });
    expect(['127.0.0.1', '::1']).toContain(address);
  });
});
