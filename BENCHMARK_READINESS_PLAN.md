# BENCHMARK READINESS PLAN — shinobi vs Hermes & OpenClaw

> Objetivo: que, con **datos reproducibles en mano**, se pueda afirmar públicamente
> y sin temor: **"shinobi es la mejor opción."** Coste no es restricción.
> Estado vivo: este fichero + `DECISIONES.md`. Actualizar al cerrar cada ítem.

---

## 0. Tesis del benchmark (cómo se gana con datos, no con features)

No se gana un benchmark público por tener más herramientas. Se gana así:

1. **Paridad** en éxito de tarea en suites estándar (coding, tool-use, web, research).
2. **Superioridad MEDIBLE y EXCLUSIVA** en ejes que los competidores no pueden
   igualar barato porque construyeron poder antes que confianza:
   **verificabilidad, seguridad/autonomía acotada, provenance firmada, auto-corrección.**
3. **Datos producidos por un harness reproducible** que corre a los TRES en
   condiciones idénticas, con transcripts + audit + verificación publicados.

La frase irrefutable no es "shinobi tiene más cosas", es:
*"En las mismas tareas, shinobi iguala en éxito Y es el único que entrega una
prueba verificable, segura y reproducible de lo que hizo — medido y publicado."*

Hallazgos de la auditoría real (2026-06, leída con file:line) que el plan asume:
- **A (auto-verificación):** ningún competidor tiene verify→retry en CÓDIGO; Claude
  Code tiene verificador adversarial pero conducido por prompt y apagado para 3P.
- **B (trust-substrate):** nadie computa trust-score por tool desde historial que
  alimente el ranking; OpenClaw/Hermes solo tienen circuit-breakers de credenciales.
- **C (firma de capacidades):** **NO es exclusivo** — OpenClaw verifica integridad
  SHA-256 de skills/plugins descargados (fail-closed); Hermes cosign-verifica su
  tool de seguridad. shinobi firma las suyas + verify-on-load (variante, no primero).

---

## FASE 0 — Contexto vivo (mantener el contexto) · habilita todo

- [ ] **0.1** `estado.mjs` → genera `ESTADO.md` desde verdad de fuente (versión única,
  conteo de tests de la corrida real, inventario por grep de `registerTool`/`mcp`/
  verdicts, git limpio-sucio, últimas decisiones de `DECISIONES.md`). Cross-platform, solo Node.
- [ ] **0.2** `DECISIONES.md` como log append-only de decisiones (ya sembrado).
- [ ] **0.3** Hook `pre-commit`: `node estado.mjs --no-tests && git add ESTADO.md`.
- [ ] **0.4** Este plan vivo + memoria de proyecto apuntando a él.

---

## FASE 1 — El harness de benchmark (la columna vertebral; sin esto no hay "datos")

- [ ] **1.1 Suite de tareas pública y versionada** por categoría, con criterios de
  aceptación objetivos y verificables por máquina:
  - Coding/SWE (reparar bug + tests pasan), tool-use (multi-tool correcto),
    web/browser (extraer/actuar verificado), research (claim citado y correcto),
    autonomía multi-paso, **safety/red-team** (intentos de acción irreversible).
- [ ] **1.2 Runner unificado** que ejecuta la MISMA tarea en **shinobi, Hermes,
  OpenClaw** bajo condiciones idénticas (mismo modelo base donde se pueda, mismos
  límites de iteración/tiempo/tokens, mismo entorno sandbox). Adaptador por agente.
- [ ] **1.3 Métricas automáticas** por tarea y agregadas:
  success rate / pass@k · coste (tokens, $) · latencia · nº pasos · **% acciones
  verificadas** · **% acciones críticas frenadas** · **divergencia de replay**
  (reproducibilidad) · recuperación de fallo (auto-corrección).
- [ ] **1.4 Publicación reproducible**: transcripts + `audit.jsonl` + verification
  reports + scripts → cualquiera re-ejecuta y obtiene los mismos números.
- [ ] **1.5 Página de resultados** (tabla + metodología + repos para reproducir).

---

## FASE 2 — Cerrar/ganar en lo que la auditoría reveló (ejes A/B/C)

- [ ] **2.A Verificador adversarial sandboxed** sobre el `runVerifiedAgent` (código):
  el verificador corre con caja read-only/sin-edición, prompt adversarial
  ("intenta romperlo"), corre build/tests, emite veredicto estructurado. Diferencia
  medible: **activo por defecto y enforced en código** (ellos: prompt + flag-off).
  → métrica: *verified-output rate* y *defectos cazados antes de entregar*.
- [ ] **2.B Cerrar el loop del trust-substrate (E3)**: trust-score por tool/skill/
  provider desde `audit.jsonl` alimenta **routing + ToolSearch + curator**.
  → métrica: *fiabilidad de tool sube a lo largo de N runs* (curva de aprendizaje).
- [ ] **2.C Firma de capacidades COMPLETA** (cerrar el gap con OpenColaw, no solo igualar):
  self-sign (hecho) + verify-on-load (hecho) + **verificación de integridad de skills
  DESCARGADAS** (igualar OpenClaw, fail-closed) + provenance en audit + cadena de
  confianza por niveles (builtin/firmada-user/auditada-comunidad).
  → métrica: *0 capacidades cargadas sin firma/integridad verificada*.

---

## FASE 3 — Paridad en ejes estándar donde shinobi trail

- [ ] **3.1 Coding depth**: LSP **semántico** real (tsserver / language servers, no
  solo sintáctico) → al self-debug; test-running como verificación post-edición;
  harness tipo SWE-bench.
- [ ] **3.2 Web/browser**: Kage robusto — iframes, shadow DOM, `wait_for`, back/
  forward, upload; el benchmark web lo exige.
- [ ] **3.3 MCP a escala**: conectar servidores MCP reales (filesystem, github,
  search…) y demostrar ToolSearch+deferred absorbiéndolos sin inflar prompt.
- [ ] **3.4 Multi-agente a escala**: Team paralelo probado con N agentes mutando en
  worktrees + merge automático verificado.
- [ ] **3.5 Memoria/aprendizaje**: curator completo (síntesis de skill desde patrón)
  cerrado con E1+firma; cache cross-sesión (paridad con Hermes).

---

## FASE 4 — Convertir diferenciadores en TITULARES con datos

- [ ] **4.1 "Provable autonomy package"**: por cada tarea, shinobi emite un paquete
  **firmado y reproducible** {plan, `audit.jsonl`, veredicto de verificación,
  replay con divergencia 0}. **Hermes/OpenClaw no pueden producirlo.** → titular.
- [ ] **4.2 Safety scoreboard**: medir **acciones irreversibles/críticas ejecutadas
  sin permiso = 0** (gate selectivo + loop-detector v3) vs los otros en el red-team.
- [ ] **4.3 Self-correction rate**: % de tareas donde el verificador cazó un fallo y
  el agente se corrigió solo antes de entregar (eje donde lideramos).
- [ ] **4.4 Loop-safety**: nº de bucles infinitos/acciones repetidas abortadas vs
  competidores (loop-detector semántico — nadie lo tiene).

---

## FASE 5 — Escala / madurez (credibilidad del número)

- [ ] **5.1** Subir cobertura de tests (objetivo p.ej. 2.000+), CI matrix
  (win/linux), gates estrictos.
- [ ] **5.2** Canales en vivo: cablear los adaptadores reales que el benchmark de
  comms toque (Discord/Slack) con pairing/identidad firmada.
- [ ] **5.3** Hardening de rendimiento (cold-start, paralelismo), observabilidad
  (dashboards Grafana/Prom ya exportados → publicarlos).
- [ ] **5.4** Docs públicas + repro + transparencia (audit logs abiertos).

---

## FASE 6 — Red-team y congelación pre-lanzamiento

- [ ] **6.1** Auditoría adversarial propia (workflow multi-agente) + idealmente de
  un tercero.
- [ ] **6.2** Cerrar hallazgos, congelar features, etiquetar release candidate.
- [ ] **6.3** Correr el benchmark final de los tres, publicar datos + metodología.

---

## Los claims IRREFUTABLES que este plan habilita (con dato detrás)

1. **Paridad de éxito**: "en las mismas N tareas, success rate de shinobi ≥ Hermes y
   OpenClaw" (FASE 1+3).
2. **Único con prueba verificable**: "shinobi entrega por tarea un paquete firmado y
   reproducible de lo que hizo; los otros dos no" (FASE 2.A/2.C/4.1).
3. **Autonomía más segura**: "0 acciones irreversibles sin permiso; los otros X" (4.2).
4. **Se auto-corrige**: "shinobi cazó y reparó Y% de sus propios fallos antes de
   entregar; los otros no tienen el bucle" (2.A/4.3).
5. **Aprende de su propio rastro**: "la fiabilidad de herramientas de shinobi mejora a
   lo largo de los runs (trust-substrate); los otros no" (2.B).
6. **No se descontrola**: "Z bucles/acciones repetidas abortadas que los otros no
   detectan" (4.4).

Honestidad permanente (regla REAL): cada claim solo se publica con su dato medido y
reproducible. Lo no medido no se afirma. Paridad ≠ superioridad; se dice cuál es cuál.
