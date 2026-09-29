// Flags del dominio financiero: apagado por defecto y sin ninguna ruta a trading real en esta versión.

export interface FinanceConfig {
  readonly financeEnabled: boolean;
  readonly liveTrading: false;
}

export class LiveTradingUnavailableError extends Error {
  constructor(value: string) {
    super(`LIVE_TRADING=${JSON.stringify(value)} rechazado: esta versión no tiene adaptador live (fail-closed).`);
    this.name = 'LiveTradingUnavailableError';
  }
}

const OFF_VALUES = new Set(['', '0', 'false', 'off', 'no']);

export function readFinanceConfig(env: NodeJS.ProcessEnv = process.env): FinanceConfig {
  // Cualquier valor que no sea explícitamente "apagado" se trata como una petición de live y se rechaza.
  const live = (env.LIVE_TRADING ?? '').trim().toLowerCase();
  if (!OFF_VALUES.has(live)) throw new LiveTradingUnavailableError(env.LIVE_TRADING ?? '');
  const finance = (env.FINANCE_ENABLED ?? '').trim().toLowerCase();
  return { financeEnabled: finance === '1' || finance === 'true' || finance === 'on', liveTrading: false };
}
