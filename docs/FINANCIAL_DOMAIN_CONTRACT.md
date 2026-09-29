# Contrato del dominio financiero (Kangeiko) — Fase 0

Código: `src/kangeiko/domains/finance/`. Tests: `src/kangeiko/__tests__/finance_*.test.ts`.

Esta versión no opera. No hay estrategia, gateway de riesgo, simulador ni conexión a ningún exchange. Solo define qué es un dato, una decisión y un recibo válidos, y deja un rastro que no se puede alterar sin que se note.

## Mandamientos

1. **Fail-closed.** Si falta un dato, un reloj, un mandato o evidencia, no hay orden.
2. **Live no existe.** `LIVE_TRADING` con cualquier valor distinto de vacío, `0`, `false`, `off` o `no` hace fallar el arranque. No hay adaptador live.
3. **Apagado por defecto.** `FINANCE_ENABLED` vale `false` si no se define.
4. **Sin red ni credenciales.** El dominio no importa clientes de red ni lee secretos. Los tests lo comprueban.
5. **Todo se registra.** Las decisiones rechazadas o bloqueadas también entran en el ledger.
6. **El ledger no se reescribe.** Si la cadena no verifica, no se añade nada encima.

## Entidades

Todas llevan `id`, `created_at`, `schema_version` (= 1) y `source`.

| Entidad | Qué garantiza |
|---|---|
| `MarketSnapshot` | Timestamps de proveedor y de recepción, `payload_hash` sha256 y `quality` ∈ `verified \| stale \| missing \| synthetic`. Libro no cruzado; mid dentro del spread. |
| `StrategySpec` | Hipótesis falsable, universo, reglas, costes asumidos, periodos train/validation/forward, hash del artefacto y estado. |
| `StrategyMandate` | Universo, límites positivos, `max_drawdown` ∈ (0, 1], antigüedad máxima del snapshot y ventana de vigencia `[valid_from, valid_until)`. |
| `DecisionRecord` | Si es `accepted`, exige snapshot, hash y mandato (en el tipo y en el validador). Si es `rejected` o `blocked`, se registra aunque falten. |
| `TradeReceipt` | Intención, orden, fill, costes, PnL, exposición y `prev_receipt_hash`. Tiene `content_hash` con claves ordenadas. La firma Ed25519 llega en la Fase 1. |

Los fixtures (`fixtures/*.json`) llevan `source: "fixture:deterministic"` y `venue: "fixture-venue"`: no son datos reales de mercado.

## Precondiciones para abrir una orden

`checkOrderPreconditions` las evalúa en este orden y se detiene en la primera que falla:

`INVALID_CLOCK` → `MISSING_MANDATE` → `INVALID_MANDATE` → `MANDATE_STRATEGY_MISMATCH` → `MANDATE_NOT_ACTIVE` → `MISSING_SNAPSHOT` → `INVALID_SNAPSHOT` → `SNAPSHOT_INSTRUMENT_MISMATCH` → `INSTRUMENT_OUTSIDE_UNIVERSE` → `SNAPSHOT_QUALITY` → `SNAPSHOT_FROM_FUTURE` → `SNAPSHOT_STALE`

La antigüedad se mide desde `provider_ts`. El límite es inclusivo: exactamente `max_snapshot_age_ms` pasa, y 1 ms más no. Los límites de pérdida, exposición y kill switch son del RiskCore (Fase 1), no de aquí.

## Invariantes del recibo

- Una decisión `rejected` o `blocked` no tiene orden, fill, costes ni PnL.
- No hay fill sin orden.
- No hay PnL sin fill y sin costes declarados.
- PnL neto = bruto − comisiones − funding. El slippage ya está dentro del precio de fill.
- Un recibo que viola una invariante no verifica, aunque su hash se haya recalculado.

## Estados de una estrategia

```
candidate → incubating | rejected
incubating → certified | rejected | retired
certified → active | paused | retired
active → paused | retired
paused → incubating | retired
retired, rejected → (terminales)
```

Una estrategia solo llega a `active` desde `certified`. Una pausada vuelve a incubación y se re-certifica: nunca se reactiva en silencio. La decisión del comité para pasar a `active` es de la Fase 5.

## Ledger

- Cada línea JSONL contiene `seq`, `kind`, `entity_id`, `recorded_at` y el `payload` completo. Al final lleva `prevHash` y `chainHash = sha256(prevHash + sha256(contenido))`. Usa las primitivas de `src/audit/audit_chain.ts`.
- La génesis propia (`SHINOBI_FINANCE_LEDGER_GENESIS_v1`) impide colar líneas del audit general.
- `finance_ledger_verifier.ts` verifica solo con el texto y no importa el escritor.
- **Detecta sin ancla externa:** edición, inserción, borrado intermedio, reordenación y líneas sin campos de cadena.
- **Solo con ancla externa** (`root` o `entries` guardados fuera): borrado de las últimas líneas. Quien pueda reescribir el fichero entero también puede recalcular la cadena, así que la raíz debe anclarse fuera del disco (recibo firmado, commit, tercero).

## Fuera de la Fase 0

RiskCore y OrderGateway (Fase 1), PaperArena y estrategia de referencia (Fase 2), `FinancialDomain` conectado al bucle de Kangeiko (Fase 3), calibración (Fase 4), comité y shadow mode (Fase 5), capital real (Fase 6, solo con aprobación explícita).
