import { OpenGravityClient } from '../cloud/opengravity_client.js';

export interface NotificationPayload {
  level: 'info' | 'warning' | 'error';
  title: string;
  body: string;
  context?: any;
}

/**
 * Notifier — emite alertas operacionales (misiones fallidas, loops
 * críticos, etc.) hacia un workflow externo de OpenGravity.
 *
 * **Silenciado por defecto** (Sprint 2.5, decisión del operador 2026-05-15):
 * tras un incidente en el que el resident_loop disparaba un email por
 * cada 3 fallos consecutivos de una misión recurrente y saturaba la
 * bandeja del usuario, el notifier solo invoca el workflow externo
 * cuando `SHINOBI_NOTIFY_ENABLED=1` está explícito.
 *
 * Si el notifier está silenciado, `send()`:
 *   - Loguea a stdout con prefijo `[Notifier:muted]`.
 *   - Devuelve `{ success: true, muted: true }` para no interrumpir
 *     callers que verifican `success`.
 *
 * Compatibilidad:
 *   - `setWorkflow(id)` sigue funcionando (back-compat con `/notify`).
 *   - Para reactivar emails: `SHINOBI_NOTIFY_ENABLED=1` en `.env`.
 */
export class Notifier {
  private static workflowId: string | null = null; // configurable via /notify setup

  public static setWorkflow(id: string | null): void {
    this.workflowId = id;
  }

  public static getWorkflow(): string | null {
    return this.workflowId;
  }

  /** True si el operador activó explícitamente el envío externo. */
  public static isEnabled(): boolean {
    return process.env.SHINOBI_NOTIFY_ENABLED === '1';
  }

  public static async send(payload: NotificationPayload): Promise<{ success: boolean; error?: string; muted?: boolean }> {
    // Silenciado por defecto: SOLO loguea, NO invoca workflow externo.
    if (!this.isEnabled()) {
      console.log(`[Notifier:muted] ${payload.level.toUpperCase()}: ${payload.title} — ${payload.body.substring(0, 200)}`);
      return { success: true, muted: true };
    }
    if (!this.workflowId) {
      console.log(`[Notifier] (no workflow set) ${payload.level.toUpperCase()}: ${payload.title} — ${payload.body.substring(0, 200)}`);
      return { success: true };
    }
    try {
      const r = await OpenGravityClient.invokeWorkflow(this.workflowId, {
        level: payload.level,
        title: payload.title,
        body: payload.body,
        context: payload.context,
        timestamp: new Date().toISOString()
      });
      if (!r.success) {
        console.log(`[Notifier] failed to deliver: ${r.error}`);
        return { success: false, error: r.error };
      }
      return { success: true };
    } catch (e: any) {
      console.log(`[Notifier] exception: ${e.message}`);
      return { success: false, error: e.message };
    }
  }
}
