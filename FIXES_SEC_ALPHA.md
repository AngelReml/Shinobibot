# FIXES_SEC_ALPHA — Correcciones de seguridad críticas (Fase 0)

**Fecha:** 2026-06-26
**Agente:** Fix-Sec-Alpha
**Items cubiertos:** 0.1, 0.2 (×2 bugs), 0.3, 0.14

---

## FIX 0.1 — Timeout aprueba solo

**Archivo:** `src/coordinator/orchestrator.ts`

**Bug:** `timeoutPromise` hacía `resolve(true)` al expirar el timeout de aprobación, auto-aprobando operaciones destructivas si nadie respondía.

**Fix aplicado:**
- Añadida variable `timeoutApprove` que lee `SHINOBI_APPROVAL_TIMEOUT_ACTION` (default `'deny'`).
- El `setTimeout` llama ahora `resolve(timeoutApprove)` — por defecto resuelve `false` (deniega).
- Cambiada condición `if (!approved && !isTimeout)` → `if (!approved)`: con la condición anterior, un timeout que resolvía `false` seguía ejecutando la tool porque `!isTimeout` era `false`.
- Mensajes de log y error distinguen ahora entre denegación por timeout y denegación por usuario.

**Env var nueva:** `SHINOBI_APPROVAL_TIMEOUT_ACTION=approve` restituye el comportamiento antiguo (auto-aprobación en timeout) para casos de uso explícitamente desatendidos.

---

## FIX 0.2 — Bypass "always" entre conversaciones (2 sub-bugs)

### Bug 2a — `sessionAlwaysApproved` bypasseaba rutas críticas

**Archivo:** `src/security/approval.ts`

**Bug:** El check `sessionAlwaysApproved.has(input.toolName)` ocurría antes de verificar si la ruta de destino es crítica (`.env`, `.ssh`, certs…). Un usuario que hubiese dicho "siempre" a `write_file` en una sesión permitía escrituras sin restricción a cualquier ruta protegida.

**Fix aplicado (líneas ~270-279):**
- Añadido check `isCriticalPath` que evalúa si la tool es `write_file`/`edit_file` y la ruta coincide con alguno de los `CRITICAL_PATH_PATTERNS`.
- `sessionAlwaysApproved` solo hace bypass si `!isCriticalPath`. Las rutas críticas siempre preguntan.

### Bug 2b — `sessionAlwaysApproved` persistía entre conversaciones

**Archivo:** `src/coordinator/orchestrator.ts`

**Bug:** `setConversation()` no llamaba a `clearSessionApprovals()` al cambiar de conversación. El conjunto de "siempre aprobar" de una conversación se arrastraba a las siguientes.

**Fix aplicado:**
- Añadido `clearSessionApprovals` al import de `security/approval.js`.
- Llamada a `clearSessionApprovals()` al inicio de `setConversation()`, justo tras descartar el cambio si la conversación ya es la misma.

---

## FIX 0.3 — SwarmWorker sin gate de aprobación

**Archivo:** `src/coordinator/swarm_worker.ts`

**Bug:** `SwarmWorker.executeEphemeralLoop()` llamaba a `tool.execute(parsedArgs)` directamente, sin pasar por `isDestructive()` ni `requestApproval()`. En modo headless (sin asker registrado), cualquier tool se ejecutaba sin restricción.

**Fix aplicado:**
- Añadido import de `{ isDestructive, requestApproval }` desde `../security/approval.js`.
- Antes de `tool.execute(parsedArgs)`, se evalúa `isDestructive(fnName, parsedArgs)`.
- Si la acción es destructiva, se llama a `requestApproval()`. En swarm headless `_asker` es `null`, por lo que `requestApproval` deniega automáticamente (fail-safe).
- Si se deniega, `toolResult` recibe un JSON de error explicativo y la tool no se ejecuta; el flujo continúa para que el LLM vea el rechazo y se adapte.

---

## FIX 0.14 — Integridad en 'off' por defecto

**Archivo:** `src/integrity/engine.ts`

**Bug:** `integrityMode()` usaba `process.env.SHINOBI_INTEGRITY ?? 'off'`, dejando la capa de integridad desactivada a menos que el operador la activara explícitamente. Todas las instalaciones nuevas arrancaban sin ningún check de integridad.

**Fix aplicado:**
- Default cambiado de `'off'` a `'flag'`: detecta y registra violaciones sin bloquear (comportamiento aditivo, no disruptivo).
- `'off'` solo se activa ahora con `SHINOBI_INTEGRITY=off` explícito.
- Lógica: si el valor es `'off'` devuelve `'off'`; si es `'enforce'` devuelve `'enforce'`; cualquier otro valor (incluyendo el default `'flag'`) devuelve `'flag'`.

**Archivo `.env.example` actualizado** con comentarios para `SHINOBI_INTEGRITY` y `SHINOBI_APPROVAL_TIMEOUT_ACTION`.

---

## Archivos modificados

| Archivo | Fix(s) |
|---|---|
| `src/coordinator/orchestrator.ts` | 0.1 (timeout deny), 0.2b (clearSessionApprovals en setConversation) |
| `src/security/approval.ts` | 0.2a (critical path antes de sessionAlwaysApproved) |
| `src/coordinator/swarm_worker.ts` | 0.3 (approval gate en executeEphemeralLoop) |
| `src/integrity/engine.ts` | 0.14 (default 'flag' en lugar de 'off') |
| `.env.example` | 0.1 + 0.14 (documentación de nuevas env vars) |
