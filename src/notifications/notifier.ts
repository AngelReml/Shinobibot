import { OpenGravityClient } from '../cloud/opengravity_client.js';

export interface NotificationPayload {
  level: 'info' | 'warning' | 'error';
  title: string;
  body: string;
  context?: any;
}

export class Notifier {
  private static workflowId: string | null = null; // configurable via /notify setup

  public static setWorkflow(id: string | null): void {
    this.workflowId = id;
  }

  public static getWorkflow(): string | null {
    return this.workflowId;
  }

  public static async send(payload: NotificationPayload): Promise<{ success: boolean; error?: string }> {
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
