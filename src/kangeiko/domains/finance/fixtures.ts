// Cargador de fixtures deterministas del dominio financiero: devuelve `unknown` para obligar a validar.

import { readFileSync } from 'fs';

export type FinanceFixtureName =
  | 'market_snapshot_verified'
  | 'market_snapshot_stale'
  | 'strategy_mandate_conservative'
  | 'decision_record_blocked';

export function loadFinanceFixture(name: FinanceFixtureName): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf-8'));
}
