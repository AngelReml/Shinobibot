# Cuarto ciclo de auditoría — medición de MEDIUM/LOW — 2026-05-17

Cuarto ciclo sobre el código completo, comparando contra
`docs/audits/2026-05-17_tercer_ciclo_convergencia.md`. 7 auditores en
paralelo. Foco pedido: **medir si MEDIUM/LOW por fin desciende** tras
resolver las 8 ghost features.

## Resultado directo: MEDIUM/LOW NO desciende

Tras el 3er ciclo predije que resolver las ghost features vaciaría la cola
MEDIUM/LOW. **Esa predicción fue incorrecta.** Los 7 bloques, sin
excepción, reportan MEDIUM/LOW **plano o al alza** — ninguno reporta un
descenso.

| Bloque | MEDIUM/LOW (3er→4º, abiertos) | Tendencia |
|---|---|---|
| coordinator/LLM | 5 → 11 | sube +6 |
| tools | 2 → 7 | sube +5 |
| memory/persistencia | 6 → 15 | sube +9 |
| skills/committee | 3 → 7 | sube +4 |
| channels/gateway | 6 → 11 | sube +5 |
| runtime/sandbox | 3 → 8 | MEDIUM plano, LOW +5 |
| utils/misc | 4 → 5 | MEDIUM −1, LOW +2 |

- **CRITICAL: 0** — cuarto ciclo consecutivo en 0, sin críticos nuevos.
- **HIGH: converge** — ~5 abiertos, casi todos de bajo impacto (6 adapters
  de mensajería que tragan excepciones, telegram fire-and-forget, recall
  O(n), skill_loader strip-regex). Ningún HIGH nuevo real.
- **MEDIUM/LOW: NO converge.** Por la contabilidad de los auditores sube
  fuerte; en agregado real (63 abiertos en el 3er ciclo → ~64 ahora) está
  **plano** — pero plano **es el fracaso de la predicción**: resolver las
  ghost features no lo bajó.

## Por qué la predicción falló

1. **Las ghost features eran HIGH, no MEDIUM/LOW.** Eran *módulos enteros*
   sin cablear. Resolverlas bajó HIGH. La cola MEDIUM/LOW se alimenta de
   otra fuente: deuda *de grano fino* — funciones muertas sueltas
   (`getRecentMemories`, `inlineCitations`, `reembedAll`, `dayKeysAsc`,
   `registry.summary`, `anchorCostUsd`, `KernelClient.startMission`…),
   timeouts que faltan, regex frágiles, comentarios desincronizados.
   Cablear módulos no toca nada de eso.

2. **Cada ciclo lee más profundo.** El 4º ciclo leyó función por función y
   línea por línea. Encontró deuda preexistente que los ciclos 1-3 nunca
   inspeccionaron a esa resolución. No es código escrito esta semana — es
   el mismo repo, visto con más aumento. El 3er informe ya lo predijo
   literalmente: "un 4º ciclo encontraría más de lo mismo".

3. **El propio cableado introdujo algo de deuda nueva.** Confirmado: el
   wiring de `deepDescend` deja `.shinobi-reader-cache/` dentro del repo
   sin gitignorear; el wiring de observability añadió un endpoint
   duplicado (ver abajo). "Feature muerta → deuda de integración", el
   intercambio que los ciclos 2 y 3 ya describieron.

## Corrección de honestidad sobre el 3er ciclo

El 4º ciclo (bloque utils) detectó que mi cierre del 3er ciclo declaró
**"observability cableada — GET /admin/dashboard montado"** y eso fue una
**afirmación incorrecta**: la ruta `/admin/dashboard` **ya estaba montada**
(`server.ts:311`, Sprint 2.4) junto con `/admin/metrics/json` y `/prom`.
Mi edit del 3er ciclo añadió un **segundo** `/admin/dashboard` idéntico
(`server.ts:329`) — código muerto, porque Express usa siempre el primero.

La causa: validé que `renderDashboardHtml()` devolvía HTML, pero no
verifiqué que la ruta no existiera ya. El harness probó la *función*, no
la *ruta*. Es exactamente el fallo que la regla de validación REAL busca
evitar. **Corregido en este commit**: el duplicado eliminado. observability
estaba — y sigue — correctamente montada; mi "cableado" fue un no-op.

## Veredicto

El ciclo de auditoría **ha llegado a su límite útil**. CRITICAL lleva 4
ciclos en 0; HIGH ha convergido. MEDIUM/LOW **no converge auditando** —
es un efecto de resolución de medida: cada pasada encuentra más deuda fina
preexistente. Un 5º ciclo encontraría más de lo mismo.

**Recomendación — no auditar más:**
1. La cola MEDIUM/LOW restante es una cola larga de deuda fina (código
   muerto + robustez menor). Su tratamiento NO es otra auditoría sino un
   barrido dirigido de eliminación de dead-code y, lo que importe,
   robustez puntual — o aceptarla como la cola natural de un repo maduro.
2. Cerrar los pocos MEDIUM con superficie real, no de grano fino:
   - `updater/install_update.ts:72` — el instalador se ejecuta sin
     verificar firma/hash si el manifest no trae `sha256` (seguridad).
   - `memory_store.ts:140` — memorias con score 0 entran al ranking.
   - `db/context_builder.ts` instancia su propio `new Memory()`: el fix
     C7 serializa por-instancia, dos instancias escriben el mismo fichero
     → C7 parcialmente sin cerrar.
   - `.shinobi-reader-cache/` debe ir a `.gitignore`.

CRITICAL 0 · HIGH convergido · MEDIUM/LOW: cola larga estable que el
auditar ya no reduce. El proyecto está sano en lo grave; lo que queda es
mantenimiento, no auditoría.
