# DECISIONES — shinobi (log vivo, append-only, lo más reciente arriba)

## 2026-06-08 · Plan de preparación para benchmark público
- Objetivo fijado: shinobi debe poder afirmarse "mejor opción" con DATOS reproducibles
  vs Hermes (Nous) y OpenClaw, en benchmark público. Coste no es restricción.
- Plan completo en `BENCHMARK_READINESS_PLAN.md` (6 fases + claims irrefutables).
- Tesis: ganar por verificabilidad/seguridad/provenance/auto-corrección MEDIDAS, no
  por nº de features; producir los datos con un harness que corre a los 3 en igualdad.

## 2026-06-08 · Auditoría REAL de competidores (corrige claims previos)
- Auditados con file:line (no grep ciego) OpenClaw, Hermes, Claude Code-leak para 3
  capacidades. Resultado que CORRIGE mis "🥇 único":
  - **A auto-verificación**: nadie en código; Claude Code tiene verificador adversarial
    pero por prompt y flag-off para terceros. shinobi: única en CÓDIGO+default (grado).
  - **B trust-substrate**: nadie computa trust-score por tool desde historial→ranking;
    OpenClaw/Hermes solo circuit-breakers de credenciales. shinobi: lidera esta forma.
  - **C firma de capacidades**: NO exclusivo — OpenClaw verifica integridad SHA-256 de
    skills/plugins descargados (fail-closed); Hermes cosign su tool. shinobi: variante.
- Lección reforzada: no afirmar "único"/"verificado" sin auditar con la misma
  profundidad. Probar ausencia es caro; "no encontrado" ≠ "ausente".

## 2026-06-07/08 · Construido y validado esta tanda (todo en main, pusheado)
- Cimiento: agent_loop · spawn_agent · E1 (verifier+verified_agent) · worktrees · sandbox.
- Motores: E2 fábrica de skills firmadas+auditadas · E3 audit-as-substrate (trust) ·
  E4 enjambre · ToolSearch sobre E3 · deferred-tools · Team (paralelo real, ALS) ·
  MCP (cliente) · LSP (diagnósticos al escribir) · capa de confianza en canales (pairing+HMAC).
- Seguridad: gate de aprobación SELECTIVO (clase crítica: credenciales/secreto/cuenta/
  gasto + borrado masivo) reconvirtiendo el no-op FIX-002; fail-safe deniega sin asker.
- Auditoría FIX-004 (trunca memoria), FIX-006 (logs gateados), FIX-007 (.gitignore);
  FIX-005 moot. 3 bugs de producción de paso (loop-detector inerte, NUL en server.ts,
  isDockerAvailable sin daemon).
- Estado: ~1117 tests + 1 skip, typecheck limpio. main ↔ origin/main sincronizado.
- Smokes reales: MCP stdio, deferred end-to-end, LSP (tsc real), canal+pairing+orchestrator.

## Decisión abierta (pendiente del usuario)
- ¿Relajar el hard-block de `run_command` para que un borrado recursivo APROBADO se
  ejecute (coherencia "me pide permiso, yo acepto"), o mantener el doble freno actual?
