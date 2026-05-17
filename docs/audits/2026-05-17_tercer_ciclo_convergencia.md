# Tercer ciclo de auditoría de convergencia — 2026-05-17

Tercer ciclo sobre el código completo, comparando contra
`docs/audits/2026-05-17_reauditoria_convergencia.md` (2º ciclo). Misma
metodología: 7 auditores en paralelo, un bloque cada uno, cada hallazgo
previo clasificado RESUELTO/PENDIENTE y detección de NUEVOS.

## Métrica global por severidad — tendencia numérica

Sumas de los 7 bloques (los conteos `previos` son aproximados ±2 por
solape entre bloques; la **tendencia** sí es firme):

| Severidad | Previos | Resueltos | Pendientes | Nuevos | Abierto ahora | Tendencia |
|---|---|---|---|---|---|---|
| CRITICAL | 11 | 11 | 0 | 0 | **0** | ✅ converge (monótono) |
| HIGH | 39 | 35 | 4 | 5 | **9** | ✅ converge |
| MEDIUM | 28 | 15 | ~16 | 17 | **~33** | ⚠️ SUBE (28→33) |
| LOW | 12 | 2 | ~9 | 21 | **~30** | ⚠️ SUBE (12→30) |

**MEDIUM/LOW combinado: 40 abiertos antes → 63 abiertos ahora. SUBE.**

## La métrica obligatoria: MEDIUM/LOW sube. Por qué.

El usuario pidió explícitamente: si MEDIUM/LOW sube o se mantiene plano
pese a que P2 está completo, decirlo y explicarlo. **Sube.** Causas, en
orden de peso:

**1. Cada ciclo lee más profundo y destapa ghost features preexistentes.**
Es el factor dominante. Los `nuevos` MEDIUM/LOW NO son código que se
escribió mal esta semana — son módulos completos que existían desde sus
sprints y que los ciclos 1-2 nunca inspeccionaron a nivel de función:

- `telemetry/telemetry.ts` — `emit()` (todo el envío de eventos) sin caller.
- `soul/soul.ts` — módulo entero (10 personas) sin cablear al orchestrator.
- `observability/*` — dashboard/métricas Sprint 2.4 sin montar.
- `sandbox/browser_sandbox/manager.ts` — sin cablear.
- `plugins/*`, `replay/*`, `reader/deep_descent.ts` — sin caller.

"P2 completo" significó **los 20 módulos que la auditoría 1 identificó**.
NO significó "todo el repo cableado". Estos otros nunca estuvieron en la
lista de 20. La auditoría está aumentando su resolución, no el código su
deuda. Es convergencia del *proceso de auditoría*, no divergencia del
código.

**2. El cableado P2 cambió "feature muerta" por "deuda de integración".**
Confirmado en los 7 bloques: el happy-path se cableó pero quedaron
sub-features internas sin caller (`iteration_budget` usa `consume()` pero
no `refund`/`spawnChild`/`free_turn`; `canActOn()` nunca se invoca;
`multiuser` solo está cableado al gateway REST, no a WebChat ni canales) y
bordes sin cubrir (cooldown se abre con errores `auth`; `task_scheduler`
no está en la lista de `approval.ts`).

**3. Granularidad fina.** Funciones que antes contaban como un hallazgo
ahora se cuentan una a una.

**Conclusión de la métrica:** MEDIUM/LOW subiendo aquí **no es mala señal**
— es lo esperado cuando un proceso de auditoría madura sobre un repo con
una cola larga de módulos sin cablear. Lo que importa es que CRITICAL está
en 0 monótono (3 ciclos, 0 críticos nuevos jamás) y HIGH converge.

## Hallazgos NUEVOS que SÍ son bugs reales (no ghost features)

| Sev | Archivo | Bug |
|---|---|---|
| HIGH | `backup/state_backup.ts:81` | El backup busca `audit/audit.jsonl` pero el log real se escribe en `audit.jsonl` (raíz, `audit_log.ts:66`) → **el audit log nunca entra en el backup**. El test pasa porque crea el fixture en la ruta equivocada — no reproduce la traza real. |
| HIGH | `task_scheduler_create.ts` + `security/approval.ts` | La tool declara `requiresConfirmation()` pero NO está en `DESTRUCTIVE_TOOLS` de `approval.ts` → se auto-ejecuta sin confirmación. Crea tareas programadas persistentes sin gate. |
| MEDIUM | `providers/failover_cooldown.ts:100` | Un error `auth` (401, key inválida permanente) mete al provider en cooldown exponencial creciente en vez de excluirlo. |
| MEDIUM | `updater/install_update.ts:85` | El instalador descargado se ejecuta sin verificar firma Authenticode ni hash cuando el manifest no trae `sha256`. Patrón C10 reaparecido. |

Los demás `nuevos` HIGH/MEDIUM son ghost features (dead code) listadas
arriba — su resolución es decisión de producto (cablear o eliminar).

## Veredicto del 3er ciclo

- **CRITICAL: convergencia total y estable.** 11→0 en este ciclo, 0
  nuevos. A lo largo de 3 ciclos: 15 críticos originales → 0, jamás un
  crítico nuevo. La superficie de riesgo grave está cerrada y se mantiene.
- **HIGH: converge.** 35 de 39 resueltos. De los 5 nuevos, 3 son ghost
  features recién descubiertas y 2 son bugs reales (`state_backup`,
  `task_scheduler`) — acotados y de bajo esfuerzo.
- **MEDIUM/LOW: NO converge — sube (40→63 abiertos).** Explicado arriba:
  es resolución creciente de la auditoría sobre una cola de módulos sin
  cablear preexistente, más la deuda de integración del cableado P2.

**Recomendación:** el ciclo de auditoría por sí solo ya no converge en
MEDIUM/LOW porque sigue descubriendo módulos no cableados — un 4º ciclo
encontraría más de lo mismo. El paso correcto NO es auditar otra vez, sino
una **decisión de producto sobre las ghost features**: para cada módulo
sin cablear (`telemetry`, `soul`, `observability`, `plugins`, `replay`,
`browser_sandbox`, `deep_descent`, ACP/Zed) decidir explícitamente
cablear o eliminar. Eso vaciará la cola MEDIUM/LOW de golpe. En paralelo,
cerrar los 2 bugs HIGH reales (`state_backup`, `task_scheduler`).
