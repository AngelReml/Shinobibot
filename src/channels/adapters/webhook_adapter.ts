/**
 * Webhook Adapter — receptor HTTP genérico para integraciones custom
 * (n8n, Zapier, sistemas internos, IFTTT, GitHub Actions, etc.).
 *
 * Expone un endpoint `POST /webhook/incoming` que acepta:
 *   { text: string, userId?: string, conversationId?: string,
 *     metadata?: object }
 *
 * Y devuelve sincronamente la respuesta del handler como JSON:
 *   { text: string, metadata?: object } | { error: string }
 *
 * Variables:
 *   - WEBHOOK_LISTEN_PORT (default 3334)
 *   - WEBHOOK_SHARED_SECRET (REQUERIDO; sin ella el endpoint rechaza todo
 *     con 503 — ver ALTA-14, auditoría 2026-06-30)
 *   - WEBHOOK_CALLBACK_URL (opcional; validada anti-SSRF antes de usarse,
 *     ver CRIT-10)
 *
 * Diseñado para que el operador conecte cualquier sistema HTTP con
 * minimal setup.
 */

import { createServer, type IncomingMessage as HttpReq, type ServerResponse, type Server } from 'http';
import { lookup as dnsLookup } from 'dns/promises';
import { isIP } from 'net';
import type {
  ChannelAdapter, IncomingMessage, MessageHandler,
  OutgoingMessage, ChannelTarget,
} from '../types.js';
import { egressGate } from '../../egress/egress_policy.js';

/** ALTA-13: límite de tamaño del body entrante (consistente con express.json({limit:'1mb'})
 *  usado en src/web/server.ts y src/gateway/index.ts). Evita DoS por OOM con bodies gigantes. */
const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

/**
 * CRIT-10 (auditoría 2026-06-30): bloquea destinos privados/loopback/link-local
 * para evitar SSRF vía WEBHOOK_CALLBACK_URL (p.ej. http://169.254.169.254/...
 * para robar credenciales IAM, o http://localhost:6379 contra servicios internos).
 *
 * Cubre IPv4 (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 * 169.254.0.0/16, 0.0.0.0/8) e IPv6 (::1, fc00::/7, fe80::/10, ::ffff:<v4>).
 */
function isPrivateOrLoopbackIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = parseInt(v4[1], 10);
    const b = parseInt(v4[2], 10);
    if (a === 127) return true;            // loopback
    if (a === 10) return true;             // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local (incluye metadata cloud)
    if (a === 0) return true;              // 0.0.0.0/8
    return false;
  }
  const norm = ip.toLowerCase();
  if (norm === '::1') return true;                       // loopback v6
  if (norm.startsWith('fc') || norm.startsWith('fd')) return true; // fc00::/7 ULA
  if (norm.startsWith('fe80:')) return true;             // link-local v6
  if (norm.startsWith('::ffff:')) {
    const mapped = norm.slice('::ffff:'.length);
    return isPrivateOrLoopbackIp(mapped);
  }
  return false;
}

/**
 * Valida WEBHOOK_CALLBACK_URL antes de usarla como destino HTTP real.
 * Rechaza protocolos distintos de http(s) y hosts que resuelvan a rangos
 * privados/loopback/link-local.
 *
 * LIMITACIÓN (documentada, CRIT-10): el lookup DNS se hace una vez al
 * validar, no hay protección contra DNS-rebinding (que el hostname
 * resuelva a una IP pública en este check y a una privada milisegundos
 * después, en la conexión TCP real). Mitigar eso de forma robusta
 * requeriría fijar la IP resuelta y forzar la conexión a esa IP exacta
 * (pinning), que está fuera de alcance de este fix puntual.
 */
async function assertCallbackUrlIsSafe(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('[webhook] WEBHOOK_CALLBACK_URL no es una URL válida');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`[webhook] WEBHOOK_CALLBACK_URL: protocolo no permitido (${url.protocol})`);
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // Bloqueo rápido por string para los casos obvios, incluso si por lo
  // que sea el lookup DNS de abajo no llegara a ejecutarse.
  if (hostname === 'localhost' || hostname === '0.0.0.0') {
    throw new Error(`[webhook] WEBHOOK_CALLBACK_URL apunta a un host local prohibido: ${hostname}`);
  }

  if (isIP(hostname)) {
    if (isPrivateOrLoopbackIp(hostname)) {
      throw new Error(`[webhook] WEBHOOK_CALLBACK_URL apunta a una IP privada/reservada prohibida: ${hostname}`);
    }
    return;
  }

  // Hostname (no IP literal): resolvemos DNS para evitar que un nombre
  // público en apariencia resuelva a una IP privada (SSRF vía DNS).
  try {
    const results = await dnsLookup(hostname, { all: true });
    for (const r of results) {
      if (isPrivateOrLoopbackIp(r.address)) {
        throw new Error(`[webhook] WEBHOOK_CALLBACK_URL (${hostname}) resuelve a IP privada/reservada prohibida: ${r.address}`);
      }
    }
  } catch (e: any) {
    if (e instanceof Error && e.message.startsWith('[webhook]')) throw e;
    // No se pudo resolver el hostname: no hay egress real posible, dejamos
    // que la propia conexión HTTP falle más abajo con su propio error.
  }
}

export class WebhookAdapter implements ChannelAdapter {
  readonly id = 'webhook' as const;
  readonly label = 'Webhook genérico';

  private server: Server | null = null;
  private handler: MessageHandler | null = null;
  private receivedCount = 0;
  private sentCount = 0;
  private lastError: string | undefined;
  private running = false;
  private port = 3334;

  isConfigured(): boolean {
    return process.env.SHINOBI_WEBHOOK_ENABLED === '1';
  }

  requiredEnvVars(): string[] {
    return ['SHINOBI_WEBHOOK_ENABLED'];
  }

  status() {
    return {
      running: this.running,
      receivedCount: this.receivedCount,
      sentCount: this.sentCount,
      lastError: this.lastError,
    };
  }

  /** Inyectable para tests. */
  getPort(): number { return this.port; }

  async start(handler: MessageHandler): Promise<void> {
    if (!this.isConfigured()) throw new Error('SHINOBI_WEBHOOK_ENABLED no es 1');
    // ALTA-14 (auditoría 2026-06-30): sin shared secret el endpoint queda
    // abierto sin autenticación. No bloqueamos el arranque (otros canales
    // pueden depender de status()/stop() funcionando), pero el handler de
    // requests rechaza TODO con 503 mientras no haya secreto configurado.
    if (!process.env.WEBHOOK_SHARED_SECRET) {
      console.warn(
        '[webhook] WEBHOOK_SHARED_SECRET no configurado — el endpoint /webhook/incoming ' +
        'rechazará TODAS las peticiones con 503 hasta que se configure un secreto.'
      );
    }
    this.handler = handler;
    this.port = parseInt(process.env.WEBHOOK_LISTEN_PORT ?? '3334', 10);

    this.server = createServer((req, res) => this.onRequest(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, '127.0.0.1', () => resolve());
    });
    this.running = true;
  }

  private async onRequest(req: HttpReq, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST' || req.url !== '/webhook/incoming') {
      res.statusCode = 404;
      res.end('not_found');
      return;
    }
    // ALTA-14: sin secreto configurado, el endpoint está deshabilitado de
    // facto — rechazamos todo en vez de quedar abierto sin autenticación.
    const secret = process.env.WEBHOOK_SHARED_SECRET;
    if (!secret) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: 'webhook_disabled_no_secret' }));
      return;
    }
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${secret}`) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    // ALTA-13: límite de bytes mientras se lee el body — evita DoS por OOM
    // con un body arbitrariamente grande (antes se acumulaba sin límite).
    let body = '';
    let bytes = 0;
    let tooLarge = false;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        tooLarge = true;
        break;
      }
      body += chunk.toString('utf-8');
    }
    if (tooLarge) {
      res.statusCode = 413;
      res.end(JSON.stringify({ error: 'payload_too_large' }));
      req.destroy();
      return;
    }
    let payload: any;
    try { payload = JSON.parse(body); }
    catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'invalid_json' }));
      return;
    }
    if (typeof payload?.text !== 'string') {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'text_required' }));
      return;
    }

    // ALTA-15 (auditoría 2026-06-30): `payload.userId` lo declara libremente
    // el caller que conoce el shared secret (que es único por integración,
    // no por usuario) — NO es una identidad verificada. Lo propagamos como
    // claim sin verificar y lo marcamos explícitamente en metadata para que
    // cualquier consumidor downstream sepa que no puede confiar en él para
    // autorización.
    const incoming: IncomingMessage = {
      channelId: this.id,
      text: payload.text,
      target: {
        channelId: this.id,
        conversationId: payload.conversationId ?? 'webhook-default',
        userId: payload.userId,
        metadata: {
          ...(payload.metadata ?? {}),
          ...(payload.userId !== undefined ? { _unverifiedClaimedUserId: true } : {}),
        },
      },
      receivedAt: new Date().toISOString(),
    };
    this.receivedCount++;

    try {
      const reply = await this.handler!(incoming);
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      if (reply) {
        this.sentCount++;
        res.end(JSON.stringify({ text: reply.text, metadata: reply.metadata }));
      } else {
        res.end(JSON.stringify({ text: null }));
      }
    } catch (e: any) {
      this.lastError = e?.message ?? String(e);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: this.lastError }));
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
    this.server = null;
    this.handler = null;
    this.running = false;
  }

  async send(target: ChannelTarget, msg: OutgoingMessage): Promise<void> {
    const callbackUrl = process.env.WEBHOOK_CALLBACK_URL;
    if (!callbackUrl) {
      // No-op: sin callback URL no hay destino; el adapter queda silencioso.
      return;
    }

    // CRIT-10: rechaza protocolos no-http(s) y destinos privados/loopback/
    // link-local (SSRF) ANTES de tocar la red.
    await assertCallbackUrlIsSafe(callbackUrl);

    // ALTA-12: este es el único egress real de este adapter — pasa por el
    // gate E3 antes de salir. `src/channels/adapters/webhook_adapter.ts`
    // está en EGRESS_ALLOWLIST precisamente para este caso opt-in del
    // operador (ver src/egress/egress_policy.ts).
    const gate = egressGate({
      source: 'src/channels/adapters/webhook_adapter.ts',
      destination: callbackUrl,
      reason: 'callback saliente configurado por el operador vía WEBHOOK_CALLBACK_URL',
    });
    if (!gate.allowed) {
      throw new Error(`[webhook] egress bloqueado: ${gate.reason}`);
    }

    const body = JSON.stringify({
      text: msg.text,
      metadata: msg.metadata,
      conversationId: target.conversationId,
      userId: target.userId,
    });
    const { default: https } = await import(callbackUrl.startsWith('https') ? 'https' : 'http');
    await new Promise<void>((resolve, reject) => {
      const req = (https as any).request(callbackUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res: any) => {
        res.resume();
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error(`[webhook] callback respondió ${res.statusCode}`));
        });
      });
      req.on('error', reject);
      req.end(body);
    });
    this.sentCount++;
  }
}
