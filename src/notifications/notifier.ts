// Notifier — alertas operacionales (misiones fallidas, loops) vía webhook directo.
// Silenciado por defecto: solo envía con SHINOBI_NOTIFY_ENABLED=1; si no, loguea a stdout.
// Usa fetch directo a SHINOBI_NOTIFY_WEBHOOK.

export interface NotificationPayload {
  level: 'info' | 'warning' | 'error';
  title: string;
  body: string;
  context?: any;
}

/**
 * Notifier — emite alertas operacionales (misiones fallidas, loops
 * críticos, etc.) hacia un webhook HTTP configurable.
 *
 * **Silenciado por defecto**: solo invoca el webhook cuando
 * `SHINOBI_NOTIFY_ENABLED=1` está explícito en el entorno.
 *
 * El destino se configura con `SHINOBI_NOTIFY_WEBHOOK=https://…` o
 * con `setWorkflow(url)` (back-compat).
 *
 * Si el notifier está silenciado, `send()`:
 *   - Loguea a stdout con prefijo `[Notifier:muted]`.
 *   - Devuelve `{ success: true, muted: true }` para no interrumpir
 *     callers que verifican `success`.
 */
export class Notifier {
  private static webhookUrl: string | null = null; // configurable via /notify setup

  /** Back-compat: acepta una URL de webhook (antes era un workflow ID de OG). */
  public static setWorkflow(id: string | null): void {
    this.webhookUrl = id;
  }

  public static getWorkflow(): string | null {
    return this.webhookUrl;
  }

  /** True si el operador activó explícitamente el envío externo. */
  public static isEnabled(): boolean {
    return process.env.SHINOBI_NOTIFY_ENABLED === '1';
  }

  public static async send(payload: NotificationPayload): Promise<{ success: boolean; error?: string; muted?: boolean }> {
    // Silenciado por defecto: SOLO loguea, NO invoca webhook externo.
    if (!this.isEnabled()) {
      console.log(`[Notifier:muted] ${payload.level.toUpperCase()}: ${payload.title} — ${payload.body.substring(0, 200)}`);
      return { success: true, muted: true };
    }

    const target = this.webhookUrl ?? process.env.SHINOBI_NOTIFY_WEBHOOK ?? null;
    if (!target) {
      console.log(`[Notifier] (no webhook set) ${payload.level.toUpperCase()}: ${payload.title} — ${payload.body.substring(0, 200)}`);
      return { success: true };
    }

    try {
      const res = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: payload.level,
          title: payload.title,
          body: payload.body,
          context: payload.context,
          timestamp: new Date().toISOString()
        })
      });
      if (!res.ok) {
        const msg = `HTTP ${res.status}`;
        console.log(`[Notifier] failed to deliver: ${msg}`);
        return { success: false, error: msg };
      }
      return { success: true };
    } catch (e: any) {
      console.log(`[Notifier] exception: ${e.message}`);
      return { success: false, error: e.message };
    }
  }
}
