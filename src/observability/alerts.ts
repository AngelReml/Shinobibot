/**
 * Alerts — reglas configurables que disparan webhooks (Slack, Discord,
 * etc.) cuando ciertos eventos del agente cruzan un umbral. Sprint 2.4.
 *
 * Tipo de reglas soportadas:
 *
 *   - `event_count`  : si N eventos de tipo X ocurren en una ventana de
 *                      M segundos, dispara.
 *   - `metric_above` : si un gauge/counter supera un umbral, dispara.
 *   - `event_match`  : si un evento matchea una expresión, dispara
 *                      inmediatamente (one-shot, sin window).
 *
 * Diseño:
 *
 *   - Reglas se cargan desde `SHINOBI_ALERTS_PATH` (JSON file) o
 *     programáticamente via `alertRouter().register()`.
 *   - Webhooks se mandan via fetch nativo de Node 18+ (sin axios). Si
 *     falla, registra el error pero NO lanza (alerts son
 *     best-effort).
 *   - Anti-spam: cada regla tiene `cooldownSec` (default 60s) para no
 *     inundar el canal con un mismo problema.
 */

export interface AlertRule {
  id: string;
  kind: 'event_count' | 'metric_above' | 'event_match';
  /** El evento o métrica de interés. */
  target: string;
  /** Para event_count: cuántas instancias en `windowSec` disparan. */
  threshold?: number;
  /** Para event_count: tamaño de la ventana en segundos. */
  windowSec?: number;
  /** Para metric_above: valor por encima del cual disparar. */
  valueAbove?: number;
  /** Para event_match: substring que debe contener el payload string. */
  match?: string;
  /** Webhook destino (formato Slack/Discord webhook). */
  webhookUrl: string;
  /** Cooldown anti-spam. Default 60s. */
  cooldownSec?: number;
  /** Mensaje plantilla. Soporta `{target}`, `{value}`, `{timestamp}`. */
  template?: string;
}

export interface AlertEvent {
  /** Identificador del evento (loop_abort, tool_call_failed, etc.). */
  kind: string;
  /** Payload arbitrario serializable. */
  payload?: Record<string, unknown>;
  /** Timestamp (default = now). */
  ts?: string;
}

interface FireRecord {
  ruleId: string;
  ts: number; // unix ms
}

export interface FireOutcome {
  ruleId: string;
  fired: boolean;
  reason?: string;
}

const DEFAULT_COOLDOWN_SEC = 60;

export class AlertRouter {
  private readonly rules = new Map<string, AlertRule>();
  private readonly events: Array<{ kind: string; ts: number }> = [];
  private readonly lastFire = new Map<string, FireRecord>();
  /** Override del sender para tests. */
  public sender: (url: string, body: any) => Promise<{ ok: boolean; status?: number; error?: string }>;

  constructor() {
    this.sender = defaultWebhookSender;
  }

  register(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
  }
  unregister(id: string): boolean {
    return this.rules.delete(id);
  }
  list(): AlertRule[] {
    return [...this.rules.values()];
  }
  reset(): void {
    this.rules.clear();
    this.events.length = 0;
    this.lastFire.clear();
  }

  /** Registra evento + evalúa reglas event_count / event_match. */
  async onEvent(event: AlertEvent): Promise<FireOutcome[]> {
    const ts = event.ts ? Date.parse(event.ts) : Date.now();
    this.events.push({ kind: event.kind, ts });
    // Garbage-collect eventos viejos (>1h).
    const cutoff = ts - 3600_000;
    while (this.events.length > 0 && this.events[0].ts < cutoff) this.events.shift();

    const outcomes: FireOutcome[] = [];
    for (const rule of this.rules.values()) {
      if (rule.kind === 'metric_above') continue;
      const should = rule.kind === 'event_count'
        ? this.evalEventCount(rule, ts)
        : this.evalEventMatch(rule, event);
      outcomes.push(await this.maybeFire(rule, should.fire, should.reason ?? '', { event }));
    }
    return outcomes;
  }

  /** Llamado periódicamente por el caller con el snapshot de metrics. */
  async evaluateMetric(metricName: string, currentValue: number): Promise<FireOutcome[]> {
    const ts = Date.now();
    const outcomes: FireOutcome[] = [];
    for (const rule of this.rules.values()) {
      if (rule.kind !== 'metric_above') continue;
      if (rule.target !== metricName) continue;
      const fire = currentValue > (rule.valueAbove ?? 0);
      outcomes.push(await this.maybeFire(
        rule,
        fire,
        `value=${currentValue} > threshold=${rule.valueAbove}`,
        { metricName, currentValue, ts: new Date(ts).toISOString() },
      ));
    }
    return outcomes;
  }

  private evalEventCount(rule: AlertRule, ts: number): { fire: boolean; reason?: string } {
    const windowSec = rule.windowSec ?? 60;
    const threshold = rule.threshold ?? 1;
    const cutoff = ts - windowSec * 1000;
    const count = this.events.filter(e => e.kind === rule.target && e.ts >= cutoff).length;
    if (count >= threshold) {
      return { fire: true, reason: `count=${count} >= ${threshold} in ${windowSec}s` };
    }
    return { fire: false };
  }

  private evalEventMatch(rule: AlertRule, event: AlertEvent): { fire: boolean; reason?: string } {
    if (event.kind !== rule.target) return { fire: false };
    if (!rule.match) return { fire: true, reason: 'event match (no payload filter)' };
    const payloadStr = JSON.stringify(event.payload ?? {});
    if (payloadStr.toLowerCase().includes(rule.match.toLowerCase())) {
      return { fire: true, reason: `payload contiene "${rule.match}"` };
    }
    return { fire: false };
  }

  private async maybeFire(rule: AlertRule, should: boolean, reason: string, ctx: any): Promise<FireOutcome> {
    if (!should) return { ruleId: rule.id, fired: false };
    const now = Date.now();
    const cooldownMs = (rule.cooldownSec ?? DEFAULT_COOLDOWN_SEC) * 1000;
    const last = this.lastFire.get(rule.id);
    if (last && now - last.ts < cooldownMs) {
      return { ruleId: rule.id, fired: false, reason: 'cooldown' };
    }
    const message = renderTemplate(rule, { reason, ctx });
    const r = await this.sender(rule.webhookUrl, { text: message }).catch(e => ({ ok: false, error: String(e?.message ?? e) }));
    if (r.ok) {
      this.lastFire.set(rule.id, { ruleId: rule.id, ts: now });
      return { ruleId: rule.id, fired: true, reason };
    }
    const ra = r as any;
    return { ruleId: rule.id, fired: false, reason: `webhook failed: ${ra.error ?? ra.status ?? 'unknown'}` };
  }
}

function renderTemplate(rule: AlertRule, ctx: { reason: string; ctx: any }): string {
  const tpl = rule.template ?? '[Shinobi alert] {id} fired on {target}: {reason}';
  return tpl
    .replace('{id}', rule.id)
    .replace('{target}', rule.target)
    .replace('{reason}', ctx.reason)
    .replace('{value}', String(ctx.ctx?.currentValue ?? ''))
    .replace('{timestamp}', new Date().toISOString());
}

async function defaultWebhookSender(url: string, body: any): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    // Node 18+ tiene fetch global. Si no, esto rompe en build-time pero
    // tsx no compila — solo el runtime puede fallar y lo capturamos.
    const resp = await (globalThis as any).fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: resp.ok, status: resp.status };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

let _global: AlertRouter | null = null;
export function alertRouter(): AlertRouter {
  if (!_global) _global = new AlertRouter();
  return _global;
}
export function _resetAlertRouter(): void {
  _global = null;
}
