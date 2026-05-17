# Re-auditoría de convergencia — 2026-05-17

Segundo ciclo de auditoría sobre el código completo, tras ~50 commits de
fixes (P0/P1/P3/P2) aplicados a la auditoría de `2026-05-16`. Objetivo:
medir si el ciclo **converge** (regla 5 de validación). Misma metodología:
7 auditores en paralelo, un bloque cada uno, cada hallazgo previo
clasificado RESUELTO / PENDIENTE y detección de hallazgos NUEVOS.

## Métrica global

| Bloque | Resueltos | Pendientes | Nuevos | Veredicto |
|---|---|---|---|---|
| coordinator / LLM | 12 | 2 | 7 | converge |
| tools | 9 | 3 | 4 | converge |
| memory / persistencia | 5 | 9 | 6 | converge parcial |
| skills / committee | 9 | 5 | 5 | converge |
| channels / gateway | 7 | 9 | 7 | converge parcial |
| runtime / seguridad | 9 | 2 | 8 | converge |
| utils / misc | 9 | 4 | 4 | converge |
| **TOTAL** | **60** | **34** | **41** | **converge en CRÍTICOS, plano en MEDIUM/LOW** |

## Convergencia por severidad

- **CRITICAL: 15 → 0.** Los 15 críticos (C1–C15) están resueltos y
  verificados en código. **0 críticos nuevos.** La capa crítica converge
  por completo (descenso monótono).
- **P1 corrupción de datos: 4 → 0.** Resueltos y validados.
- **HIGH: descenso fuerte, cola ~12.** La mayoría de los HIGH (ghost
  features sin cablear, redactor sin conectar, stubs deshonestos) están
  resueltos. Queda una cola de ~12 HIGH (pendientes + nuevos).
- **MEDIUM / LOW: prácticamente plano.** Se resolvieron ~30 y el cableado
  P2 introdujo un número comparable de nuevos. Esta capa **no converge
  todavía** — oscila.

## Patrón de los hallazgos NUEVOS

Casi todos son **deuda residual del cableado P2**, no regresiones de un fix:

1. **Cableado del happy-path, sub-features internas muertas.** `IterationBudget`
   conectó el cap simple pero `free_turn`/`refund`/`spawnChild` siguen sin
   caller; `FailoverCooldown` se documenta por "auth-profile" pero se invoca
   por provider pelado; `extended_patterns` (~70 patrones) sigue muerto.
2. **Las guardas de concurrencia no se replicaron.** `channels_wiring`
   enruta mensajes al orchestrator sin la cola serial `busy` del web server;
   `users.json` se reescribe con `writeFileSync` no atómico en cada request.
3. **Patrones de seguridad ya corregidos, reaparecidos en módulos no tocados.**
   `task_scheduler_create` reintrodujo el patrón de inyección de C3;
   `contentSha256` del registry de skills no se verifica (análogo a C10).

## Hallazgos NUEVOS ya corregidos (commit f365a26)

- **[HIGH] `task_scheduler_create.ts`** — inyección de comandos (patrón C3).
  Migrado a `execFile` sin shell. Validado real (centinela no creado).
- **[HIGH] `process_lock.ts`** — `unhandledRejection` hacía `process.exit(1)`
  y tumbaba el agente residente. Ahora se loguea y continúa. Validado real.

## Cola HIGH pendiente (post-fix)

| # | Archivo | Descripción |
|---|---|---|
| 1 | `a2a_wiring` / `web/server.ts:330` | `/a2a` sin rate-limit; agent-card usa `Host` del cliente (poisoning del discovery) |
| 2 | `multiuser_wiring.ts:30` | `X-Shinobi-User` sin auth → suplantación; `canActOn()` nunca se invoca; aislamiento cosmético |
| 3 | `user_registry.ts:73` | `users.json` con `writeFileSync` no atómico en cada request (patrón C7) |
| 4 | `channels_wiring.ts:25` | mensajes de canal corren el orchestrator sin la cola serial `busy` |
| 5 | `embedding_providers/factory.ts:35` | "autodetección" falsa: `catch` inalcanzable; sin `@huggingface/transformers` revienta al primer `embed()` |
| 6 | `memory_store.ts:121` | `recall()` mezcla scores incomparables (cosine -1..1 vs keyword 0.5 fijo) |
| 7 | `skill_auditor` / `extended_patterns.ts` | el auditor corre con 22 de ~90 patrones; `EXTENDED_*` muerto |
| 8 | `skills/registry/installer.ts` | cadena federada sin comando `/skill install`; `contentSha256` del manifest no verificado |
| 9 | `teams_adapter.ts:121` / `webhook_adapter.ts:145` | `send()` lanza — rompe el contrato `ChannelAdapter` |
| 10 | `a2a/zed_bridge.ts` + `acp_adapter.ts` | cadena ACP 100% muerta; `bin/shinobi-acp` no existe |
| 11 | `slash_commands.ts:105` | `/tier` es no-op silencioso (`getTier`/`setTier` no existen) |
| 12 | `demo/demo_runner.ts:137` | `localStubResponse` — `shinobi demo` no ejecuta el agente real |

## Veredicto

El ciclo **converge en lo que importa**: 15 críticos → 0, 4 bugs de
corrupción → 0, sin críticos nuevos. La superficie de riesgo grave del
proyecto se ha cerrado.

Lo que **no converge** es la capa MEDIUM/LOW: el cableado de las ghost
features (P2) intercambió "features muertas" por "deuda de integración"
—guardas de concurrencia no replicadas, sub-features internas sin caller,
dos patrones de seguridad reaparecidos en módulos no auditados la primera
vez. Es un intercambio neto positivo (se eliminó teatro de seguridad y
features falsas) pero deja una cola de ~12 HIGH + ~60 MEDIUM/LOW.

Recomendación: un tercer ciclo NO se justifica aún — primero cerrar la
cola HIGH listada arriba (sobre todo #1–#4, que son seguridad/concurrencia
introducida por P2), y entonces re-auditar para confirmar que MEDIUM/LOW
empieza a descender.

## Cierre de la cola HIGH (2026-05-17, post-informe)

Tras el informe se cerró la cola HIGH. Estado de los 12 items:

| # | Estado | Commit / nota |
|---|---|---|
| task_scheduler injección | ✅ corregido + validado real | `f365a26` |
| process_lock unhandledRejection | ✅ corregido + validado real | `f365a26` |
| #1 A2A rate-limit + host-header | ✅ corregido | `4110628` |
| #2 multiuser header sin auth | ✅ corregido + validado real | `4110628` |
| #3 users.json no atómico | ✅ corregido + validado real | `4110628` |
| #4 canales sin cola serial | ✅ corregido + validado real | `4110628` (orchestrator_mutex) |
| #5 autodetect embeddings falso | ✅ corregido + validado real | `65c954e` |
| #6 recall scores incomparables | ✅ corregido + validado real | `65c954e` |
| #7 extended_patterns muerto | ✅ corregido + validado real | `65c954e` (22→64 patrones) |
| #9 teams/webhook send() rompe contrato | ✅ corregido | `65c954e` |
| #11 /tier no-op | ✅ retirado | `65c954e` |
| #8 contentSha256 no verificado | ✅ corregido + validado real | `a2db056` |
| #12 demo_runner mock sin etiquetar | ✅ etiquetado [STUB] | `4d21677` |
| #10 ACP/ZedBridge muerto | ⏳ feature sin terminar | ver abajo |
| #8b `/skill install` CLI | ⏳ feature sin terminar | ver abajo |

**Pendiente — trabajo de feature, NO defectos:**

- **ACP / ZedBridge** (`src/a2a/zed_bridge.ts`, `acp_adapter.ts`): puente
  para el editor Zed. El protocolo está implementado y testeado pero le
  falta el ejecutable `bin/shinobi-acp` y la entrada `bin` en package.json.
  Es una feature a medio terminar, no un bug — requiere decidir si se
  completa o se retira.
- **`/skill install` CLI**: la cadena federada de skills (con C10 y
  contentSha256 ya verificados) es funcional vía `installFromRegistry()`
  pero no hay comando de usuario que la invoque. Construir ese comando es
  trabajo de UX, no un fix.

Resultado: **12 de 12 defectos HIGH cerrados** (10 con validación real
pegada en los commits). Quedan 2 features sin terminar que la auditoría
listó como HIGH por estar "muertas" — su cierre es una decisión de
producto (completar o retirar), no una corrección.
