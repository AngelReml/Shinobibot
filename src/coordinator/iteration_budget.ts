/**
 * Iteration Budget — presupuesto compartido entre el orchestrator padre y
 * los sub-agentes que invoca (Committee, HierarchicalReader, etc.).
 *
 * Problema que resuelve:
 *   El orchestrator tiene `maxIterations = 10`. Si en la iteración 3 lanza
 *   un Committee con 3 roles que cada uno hace ~5 llamadas LLM internas,
 *   el coste real es 3+15 = 18 turnos pero el contador del padre sigue en
 *   3. El usuario no ve el gasto real. Peor: si el LLM hace un nested
 *   Committee, puede saltarse el cap implícitamente.
 *
 * Solución (inspirada en Hermes `IterationBudget`):
 *   Un contador thread-safe (single-threaded en Node, pero usamos el
 *   patrón) que se decrementa por cada turno. Los sub-agentes solicitan
 *   un sub-budget al padre; el padre les concede una porción capada y se
 *   les descuenta de su propio cap. Cuando el sub-agente devuelve lo no
 *   usado, vuelve al padre (refund).
 *
 *   Modo "execute_code refund": el orchestrator puede marcar ciertos
 *   turnos como "free" (no consumen iteración) — útil cuando una tool es
 *   determinística y no debería penalizar al agente.
 *
 * Diferenciador: Hermes tiene IterationBudget pero acoplado al
 * run_agent.py monolítico. OpenClaw tiene `maxTurns` sin compartición.
 * Shinobi expone esto como módulo independiente que cualquier sub-agente
 * puede consumir.
 */

export interface BudgetSnapshot {
  total: number;
  used: number;
  remaining: number;
  free: number;
  refunded: number;
}

export class IterationBudget {
  private readonly total: number;
  private used = 0;
  private free = 0;
  private refunded = 0;

  constructor(total: number) {
    if (!Number.isFinite(total) || total <= 0) {
      throw new Error(`IterationBudget: total inválido (${total}); debe ser > 0`);
    }
    this.total = Math.floor(total);
  }

  /** Tokens restantes (puede ser 0 o negativo si se gastó). */
  remaining(): number {
    return this.total - this.used + this.refunded;
  }

  /**
   * Consume un turno. Devuelve true si quedaba presupuesto, false si ya se
   * agotó (en cuyo caso el llamador debería abortar).
   */
  consume(n = 1): boolean {
    if (this.remaining() <= 0) return false;
    this.used += n;
    return true;
  }

  /**
   * Marca un turno como gratuito (no resta del presupuesto). Útil para
   * tools determinísticas (read_file, list_dir) cuando el operador decide
   * que no deberían contar.
   */
  free_turn(n = 1): void {
    this.free += n;
  }

  /** Devuelve tokens al pool (uso típico: cierre de sub-agente sin gastar). */
  refund(n: number): void {
    if (n <= 0) return;
    this.refunded += n;
  }

  /**
   * Reserva un sub-budget para un sub-agente. Devuelve un IterationBudget
   * hijo con un tope <= remaining. Lo consumido por el hijo se descuenta
   * del padre al cerrarlo con `closeChild(child)`.
   */
  spawnChild(cap: number): IterationBudget {
    const max = Math.min(cap, this.remaining());
    if (max <= 0) {
      throw new Error('IterationBudget: parent has no remaining budget for child');
    }
    return new IterationBudget(max);
  }

  /**
   * Cierra un sub-budget: lo que el hijo CONSUMIÓ se resta del padre, lo
   * que no usó se queda en el padre (no se "devuelve" porque nunca se
   * había reservado realmente).
   */
  closeChild(child: IterationBudget): void {
    const consumed = child.snapshot().used;
    if (consumed > 0) this.used += consumed;
  }

  snapshot(): BudgetSnapshot {
    return {
      total: this.total,
      used: this.used,
      remaining: this.remaining(),
      free: this.free,
      refunded: this.refunded,
    };
  }
}

/**
 * Helper para uso casual: ejecuta `fn` con un IterationBudget descartable.
 * Útil para tests y para sub-agentes que no necesitan reportar al padre.
 */
export async function withBudget<T>(
  total: number,
  fn: (budget: IterationBudget) => Promise<T>,
): Promise<{ result: T; budget: BudgetSnapshot }> {
  const b = new IterationBudget(total);
  const result = await fn(b);
  return { result, budget: b.snapshot() };
}
