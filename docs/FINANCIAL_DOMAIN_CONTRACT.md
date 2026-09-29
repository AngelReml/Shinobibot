# Contrato del dominio financiero (Kangeiko) — Fases 0 y 1

Código: `src/kangeiko/domains/finance/`. Tests: `src/kangeiko/__tests__/finance_*.test.ts`.

Esta versión todavía no ejecuta nada. No hay simulador, estrategia ni conexión a un exchange. Contiene:
- qué es un dato, una decisión y un recibo válidos (Fase 0);
- el único punto por el que pasaría una orden, con sus límites y su kill switch (Fase 1).

**Venue objetivo: Paradex** (perpetuos). El adaptador de datos de Paradex llega con la PaperArena (Fase 2). Hasta entonces, los fixtures usan `fixture-venue`.

## Mandamientos

1. **Fail-closed.** Si falta un dato, un reloj, un mandato o evidencia, no hay orden.
2. **Live no existe.** `LIVE_TRADING` con cualquier valor distinto de vacío, `0`, `false`, `off` o `no` hace fallar el arranque. No hay adaptador live.
3. **Apagado por defecto.** `FINANCE_ENABLED` vale `false` si no se define.
4. **Sin red ni credenciales.** El dominio no importa clientes de red ni lee secretos. Los tests lo comprueban.
5. **Todo se registra.** Cada intento, sea aceptado, rechazado o bloqueado, deja una decisión y un recibo firmado.
6. **El ledger no se reescribe.** Si la cadena no verifica, no se añade nada ni arranca el gateway.
7. **El core manda.** La estrategia solo tiene `submit(intent)`. No ve el mandato, el techo, el kill switch ni el ledger.

## Entidades

Todas llevan `id`, `created_at`, `schema_version` (= 1) y `source`.

| Entidad | Qué garantiza |
|---|---|
| `MarketSnapshot` | Timestamps de proveedor y de recepción, `payload_hash` sha256, `venue` y `quality` ∈ `verified \| stale \| missing \| synthetic`. Libro no cruzado; mid dentro del spread. |
| `StrategySpec` | Hipótesis falsable, universo, reglas, costes asumidos, periodos train/validation/forward, hash del artefacto y estado. |
| `StrategyMandate` | Venue, universo, límites (ver abajo), factores y ventana de vigencia `[valid_from, valid_until)`. |
| `OrderIntent` | Lo único que envía una estrategia. Campos cerrados; `stop_price` obligatorio; `seq` creciente. |
| `DecisionRecord` | Referencia al intent, snapshot y mandato, más `gateway.{decision, code, reason, evidence}`. Si es `accepted`, exige intent, snapshot y mandato, tanto en el tipo como en el validador. |
| `TradeReceipt` | Intención, orden, fill, costes, PnL, exposición, `prev_receipt_hash` y `content_hash`. El gateway lo firma con Ed25519 (`SignedTradeReceipt`). |

## Los tres techos de riesgo

1. **Techo del core (`RiskCaps`).** Lo fija el operador al construir el gateway y no tiene valores por defecto. Queda congelado. Si un mandato lo supera en algún campo, el gateway no arranca.
2. **Mandato.** Se valida, se copia y se congela en profundidad al arrancar. Cambiar el objeto original después no afecta al gateway.
3. **Intent.** No puede traer límites propios: cualquier campo extra se bloquea (`UNKNOWN_FIELDS`).

## Recorrido de un intent por el gateway

Se detiene en el primer fallo. Cada fallo se registra, salvo los de reloj del gateway.

1. Reloj del gateway inválido o que retrocede → `blocked`. Además enclava el kill switch y no emite recibo, porque no hay marca de tiempo fiable.
2. Kill switch enclavado → `blocked KILL_SWITCH`.
3. Campos extra → `blocked UNKNOWN_FIELDS`. Intent malformado → `blocked INVALID_INTENT`. Otra estrategia → `blocked STRATEGY_MISMATCH`.
4. `intent_id` ya visto → `rejected DUPLICATE_INTENT`. `seq` menor o igual que la última → `rejected OUT_OF_ORDER`. Cada `intent_id` es de un solo uso, aunque el intento se rechazara.
5. Desfase entre el reloj y `created_at` mayor que `max_clock_skew_ms` → `blocked CLOCK_SKEW`.
6. Fallo al leer datos de mercado → `blocked MARKET_DATA_FAILURE`. Luego vienen las precondiciones de la Fase 0, todas `blocked`:
   `MISSING_MANDATE` → `INVALID_MANDATE` → `MANDATE_STRATEGY_MISMATCH` → `MANDATE_NOT_ACTIVE` → `MISSING_SNAPSHOT` → `INVALID_SNAPSHOT` → `SNAPSHOT_INSTRUMENT_MISMATCH` → `SNAPSHOT_VENUE_MISMATCH` → `INSTRUMENT_OUTSIDE_UNIVERSE` → `SNAPSHOT_QUALITY` → `SNAPSHOT_FROM_FUTURE` → `SNAPSHOT_STALE`.
7. Estado de cartera ilegible o inválido → `blocked UNKNOWN_STATE`.
8. RiskCore, en este orden:

| Código | Tipo | Regla |
|---|---|---|
| `MAX_DRAWDOWN` (actual) | blocked + enclava | drawdown actual ≥ `max_drawdown`. Se comprueba primero, porque depende solo del estado. |
| `MAX_ORDERS_PER_DAY` | rejected | órdenes aceptadas hoy (día UTC, contadas por el gateway) ≥ límite |
| `NO_QUOTE` | blocked | falta bid o ask |
| `INVALID_STOP` | rejected | el stop no queda del lado que protege |
| `MAX_SLIPPAGE` | rejected | slippage esperado > `max_slippage_bps` |
| `NO_LIQUIDITY_DATA` | blocked | el snapshot no trae profundidad |
| `INSUFFICIENT_LIQUIDITY` | rejected | cantidad > profundidad visible del lado consumido × `max_depth_fraction` |
| `MAX_LOSS_PER_TRADE` | rejected | peor caso = cantidad × \|entrada − stop\| + nocional × slippage |
| `MAX_LOSS_PER_DAY` / `_CYCLE` | rejected | pérdida ya realizada + peor caso. Un día con beneficio no amplía el presupuesto. |
| `MAX_DRAWDOWN` (proyectado) | rejected | drawdown si ocurriera el peor caso |
| `MAX_POSITION` | rejected | \|posición del instrumento tras la orden\| |
| `MAX_GROSS_EXPOSURE` / `MAX_NET_EXPOSURE` | rejected | suma de \|posiciones\| / \|suma de posiciones\| |
| `MAX_FACTOR_EXPOSURE` | rejected | \|suma de posiciones de los instrumentos del factor\| |
| `MAX_OPEN_POSITIONS` | rejected | posiciones distintas de cero tras la orden |

Estar exactamente en el límite se permite; pasarse, no. La comparación tolera ruido de coma flotante. `blocked` significa que falta algo o no es fiable; `rejected`, que la petición es válida pero no cabe. El peor caso aún no incluye comisiones: el modelo de costes de Paradex llega en la Fase 2.

Las posiciones se expresan como nocional con signo (positivo = largo). El estado de cartera lo aporta el operador, nunca la estrategia.

## Kill switch

- Se enclava por: orden del operador, drawdown agotado, reloj del gateway inservible o fallo del ledger.
- Mientras está enclavado, todo intento se bloquea y se sigue registrando.
- Solo se desenclava con `resetKillSwitch({ operator, reason, confirm: 'RESET_KILL_SWITCH' })`, que queda en el ledger. Si no se puede registrar el reset, sigue enclavado. Si el drawdown sigue agotado, el siguiente intent lo vuelve a enclavar.
- Sobrevive a un reinicio: el estado se reconstruye desde el ledger.

## Reinicio

Al construirse, el gateway verifica el ledger. Si está corrupto, no arranca. Si está bien, reconstruye desde él los intents vistos, la última `seq`, las órdenes aceptadas por día, el último `content_hash` de recibo y el estado del kill switch. Un intent repetido sigue siendo duplicado después de reiniciar.

## Invariantes del recibo

- Una decisión aceptada exige intent. Un intent malformado deja `intent: null`.
- Una decisión `rejected` o `blocked` no tiene orden, fill, costes ni PnL.
- No hay fill sin orden, ni PnL sin fill y sin costes declarados.
- PnL neto = bruto − comisiones − funding. El slippage ya está dentro del precio de fill.
- `verifySignedTradeReceipt(r, publicaEsperada)` comprueba hash, invariantes y firma, y exige que firme esa identidad.

## Estados de una estrategia

```
candidate → incubating | rejected
incubating → certified | rejected | retired
certified → active | paused | retired
active → paused | retired
paused → incubating | retired
retired, rejected → (terminales)
```

## Ledger

- Cada línea JSONL contiene `seq`, `kind`, `entity_id`, `recorded_at` y el `payload` completo. Al final lleva `prevHash` y `chainHash = sha256(prevHash + sha256(contenido))`. Usa las primitivas de `src/audit/audit_chain.ts`.
- Tipos de evento: `market_snapshot`, `strategy_spec`, `strategy_mandate`, `decision`, `trade_receipt`, `strategy_transition`, `kill_switch`.
- La génesis propia (`SHINOBI_FINANCE_LEDGER_GENESIS_v1`) impide colar líneas del audit general.
- `finance_ledger_verifier.ts` verifica solo con el texto y no importa el escritor.
- **Detecta sin ancla externa:** edición, inserción, borrado intermedio, reordenación y líneas sin campos de cadena.
- **Solo con ancla externa** (`root` o `entries` guardados fuera): borrado de las últimas líneas. Quien pueda reescribir el fichero entero también puede recalcular la cadena, así que la raíz debe anclarse fuera del disco (recibo firmado, commit, tercero).

## Paradex (a verificar contra su documentación al empezar la Fase 2)

- Datos de mercado públicos sin autenticación: la PaperArena puede usarlos sin credenciales.
- Existe testnet: es el "entorno equivalente" donde probar los límites antes de cualquier capital.
- Perpetuos: el funding es un coste. Las comisiones maker/taker se tomarán de su documentación.
- La clave privada nunca entra en Shinobi. Shinobi solo lee datos de mercado.

## Fuera de estas fases

PaperArena, estrategia de referencia y adaptador de datos de Paradex (Fase 2); `FinancialDomain` conectado al bucle de Kangeiko (Fase 3); calibración (Fase 4); comité y shadow mode (Fase 5); capital real (Fase 6, solo con aprobación explícita).
