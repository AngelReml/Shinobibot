# Quinto ciclo de auditoría — ¿se estabiliza MEDIUM/LOW? — 2026-05-17

Quinto ciclo sobre el código completo, comparando contra
`docs/audits/2026-05-17_cuarto_ciclo_convergencia.md`. 7 auditores en
paralelo. Pregunta a responder: **¿se ha estabilizado la cola MEDIUM/LOW?**
Criterio objetivo fijado de antemano: estabilización = el conteo de
hallazgos NUEVOS cae fuerte respecto al 4º ciclo.

A los auditores se les instruyó explícitamente no sesgar: "la
estabilización la dicen los números, no la voluntad de complacer".

## Respuesta: estabilización PARCIAL — MEDIUM sí, LOW no

| Bloque | Nuevos MEDIUM/LOW (5º ciclo) | Veredicto del bloque |
|---|---|---|
| coordinator/LLM | 1 MED + 3 LOW | estabilizado |
| tools | 1 MED + 4 LOW | no (plano) |
| memory/persistencia | 0 MED + 4 LOW | estabilizado |
| skills/committee | 1 MED + 4 LOW | no (plano) |
| channels/gateway | 0 MED + 6 LOW | MEDIUM sí, LOW no |
| runtime/sandbox | 0 MED + 5 LOW | MEDIUM sí, LOW no |
| utils/misc | 1 MED + 3 LOW | no (plano) |
| **TOTAL** | **~4 MED + ~29 LOW ≈ 33 nuevos** | **MEDIUM estabilizado, LOW no** |

- **CRITICAL: 0 nuevos** — quinto ciclo consecutivo en 0.
- **HIGH: 0 nuevos** — convergido.
- **MEDIUM: estabilizado.** ~4 nuevos en todo el repo (vs los de
  superficie real del 4º ciclo), y 3 de los 7 bloques reportan **0 MEDIUM
  nuevos**. El grano medio dejó de crecer.
- **LOW: NO estabilizado.** ~29 nuevos, **plano** respecto al 4º ciclo
  (~30). El conteo de LOW nuevos no cae.

## Lectura honesta del resultado

Al lanzar este ciclo planteé que el efecto de "resolución creciente"
podría haberse saturado tras 4 lecturas función-a-función. El resultado
dice que esa hipótesis **acertó a medias**:

- **Para MEDIUM, saturó.** Tras 4 ciclos ya no quedan defectos de grano
  medio sin descubrir. Los ~4 MEDIUM nuevos son menores y casi todos ya
  estaban nombrados genéricamente en informes previos.
- **Para LOW, NO saturó — y probablemente no lo hará.** Cada pasada
  encuentra otra capa de grano más fino: una función muerta más, un
  `clearTimeout` que falta, un comentario desincronizado, un fichero de
  runtime sin gitignorear. El conteo de LOW nuevos lleva 3 ciclos plano
  (~+30 cada vez). **La cola LOW es, para efectos prácticos, inagotable
  por auditoría** — no mide salud del código, mide profundidad de lectura.

**Conclusión definitiva:** el ciclo de auditoría ha terminado su trabajo
útil. CRITICAL/HIGH llevan 5 ciclos cerrados; MEDIUM se estabilizó. El
conteo de LOW no es ya una señal accionable: un 6º ciclo encontraría otros
~30 LOW de grano aún más fino, indefinidamente. **No se debe auditar más.**

## Los pocos hallazgos NUEVOS que sí importan

De los ~33 nuevos, solo 2 tienen superficie real; el resto es cola fina
(código muerto, robustez menor, higiene de ficheros de runtime):

- **[MEDIUM · seguridad] `request_new_skill` sin gate de aprobación.**
  `DESTRUCTIVE_TOOLS` (`approval.ts`) lista `'skill_request_generation'`
  (el nombre del archivo), pero la tool se registra como
  `'request_new_skill'`. `isDestructive()` recibe el nombre registrado →
  no lo encuentra → la tool se auto-ejecuta sin confirmación. Dispara
  generación remota de código vía OpenGravity. Mismo patrón que el gap de
  `task_scheduler_create` del 4º ciclo. Fix de 1 línea: corregir el nombre
  en `approval.ts`.
- **[MEDIUM · producto] cadena federada de skills sin caller.**
  `federatedSkillRegistry()` y `src/skills/sources/*` (`FederatedSkillRegistry`,
  `AgentSkillsSource`, `ClawHubSource`) no los invoca producción —
  `/skill install` usa `LocalRegistry`. Es la última ghost feature de
  módulo completo: decisión de producto — cablear a `runSkillInstall` o
  eliminar.

El resto (código muerto verificado: `resolveDefault`, `summary`, `probe`,
`reembedAll`, `getRecentMemories`, `inlineCitations`, `dayKeysAsc`,
`anchorCostUsd`, `offerDocument`; `clearTimeout` faltante en `obs_client`;
`.wa_session`/`.matrix_storage.json` sin gitignorear; un `[DIAG temporal]`
en `factory.ts`) es cola de mantenimiento — se cierra con un barrido
dirigido de dead-code, no con otra auditoría.

## Veredicto

**MEDIUM/LOW: estabilización parcial confirmada.** MEDIUM estabilizado
(~4 nuevos, ninguno grave). LOW no estabilizado pero su no-estabilización
es un artefacto de medida, no deuda creciente del código — y por eso el
auditar debe parar. El proyecto está sano: 0 críticos en 5 ciclos, HIGH
convergido, MEDIUM estabilizado. Quedan 2 ítems con superficie real
(`request_new_skill`, cadena federada) y una cola LOW de mantenimiento.
