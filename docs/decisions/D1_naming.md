# D1 — Naming del producto B2B (rebrand OpenGravity)

Fecha: 2026-05-04
Autor: AngelReml
Status: **decidido — AuditGravity**

## Contexto

OpenGravity es el kernel técnico (verificación + auditoría de agentes). El producto B2B necesita un nombre orientado a compradores enterprise (compliance officers, security/audit, CTO de SaaS). El roadmap (`Tareas..txt`) parte del candidato **AgentAudit**, pero esa marca y dominio están ocupados (ver tabla más abajo). D1 es la decisión sobre qué nombre adoptar antes de positioning, landing y SDKs.

## Criterios de decisión

1. **`.com` libre** (no `.io`, no `.ai` — los compradores enterprise siguen confiando en `.com`).
2. **Handle GitHub libre** (ecosistema OSS).
3. Pronunciable y memorable en EN/ES.
4. Telegrafía la categoría: verification / audit / observability / forensic.
5. **No colisiona** con SaaS de evaluación de agentes existentes (LangSmith, Helicone, Braintrust, Langfuse, Promptlayer, AgentOps, OpenAI Evals).
6. Continuidad opcional con la marca existente "OpenGravity" (kernel ya desplegado en `kernel.zapweave.com`).

## Brainstorm — 10 candidatos

| # | Nombre | Idea / origen |
|---|--------|---------------|
| 1 | AgentAudit | literal del roadmap |
| 2 | AuditMesh | malla de auditores conectados |
| 3 | ProofRail | "proof on rails" — verificable por defecto |
| 4 | AgentLedger | hash chain como ledger inmutable |
| 5 | **AuditGravity** | continuidad OpenGravity, "audit pulled by gravity" |
| 6 | AgentForensic | tono enterprise, claridad de categoría |
| 7 | Vouchedge | vouch + edge — vouchsafe at the edge |
| 8 | ProofGravity | hermana de AuditGravity, foco "proof" |
| 9 | ShinobiAudit | submarca del cliente Shinobi |
| 10 | LedgerSound | "sound" como en sound engineering |

## D1.2 — Disponibilidad `.com` (RDAP Verisign, 2026-05-04)

Comando usado: `curl https://rdap.verisign.com/com/v1/domain/<name>.com` — `404` = libre, `200` = registrado.

| Candidato | `.com` | Notas |
|-----------|--------|-------|
| AgentAudit | ❌ 200 | tomado |
| AuditMesh | ❌ 200 | tomado |
| ProofRail | ❌ 200 | tomado |
| AgentLedger | ❌ 200 | tomado |
| **AuditGravity** | ✅ 404 | **libre** |
| AgentForensic | ✅ 404 | libre |
| Vouchedge | ✅ 404 | libre |
| ProofGravity | ✅ 404 | libre |
| ShinobiAudit | ✅ 404 | libre |
| LedgerSound | ✅ 404 | libre |

## D1.3 — Handle GitHub (top 5 con `.com` libre)

Comando: `gh api users/<handle>` (HTTP 404 = libre).

| Handle | GitHub |
|--------|--------|
| `auditgravity` | ✅ libre |
| `agentforensic` | ✅ libre |
| `vouchedge` | ✅ libre |
| `proofgravity` | ✅ libre |
| `shinobiaudit` | ✅ libre |

## D1.4 — Tabla decisión final

| Criterio | AuditGravity | AgentForensic | Vouchedge | ProofGravity | ShinobiAudit |
|---|---|---|---|---|---|
| `.com` libre | ✅ | ✅ | ✅ | ✅ | ✅ |
| GH handle libre | ✅ | ✅ | ✅ | ✅ | ✅ |
| Pronunciable EN/ES | ✅ | ✅ | ⚠ (ambiguo "vouch") | ✅ | ⚠ (Shinobi requiere contexto) |
| Telegrafía categoría | ✅ "audit" | ✅ "forensic" | ⚠ vago | ⚠ "proof" más débil | ⚠ "audit" + ruido marca |
| No colisión SaaS | ✅ | ✅ | ✅ | ✅ | ⚠ ata el B2B al cliente Shinobi |
| Continuidad OpenGravity | ✅ kernel + audit + gravity | — | — | ✅ pero menos directo | — |
| Memorable | ✅ alta | ⚠ largo | ⚠ neologismo | ⚠ confunde con AuditGravity | ⚠ submarca |

**Decisión: `AuditGravity`.**

Razones:
1. Único candidato que conserva la equity de OpenGravity (kernel ya desplegado, dominio raíz `zapweave.com` con subdominio `kernel.`). El B2B vive en `audit.zapweave.com` y el producto se llama AuditGravity — el cliente Enterprise asocia "kernel + audit" sin esfuerzo.
2. .com libre, GitHub libre. Cero fricción.
3. Memorable y pronunciable en ambos idiomas.
4. La categoría queda explícita: "audit" + el sustantivo técnico "gravity" como referencia al kernel ya productizado.
5. Las alternativas viables (AgentForensic, Vouchedge) ofrecen cero ventaja sobre AuditGravity y rompen continuidad.

Riesgo principal: confusión interna entre **OpenGravity** (kernel técnico) y **AuditGravity** (producto B2B). Mitigación: documentación deja claro que OpenGravity es el motor open-source y AuditGravity es la oferta comercial sobre ese motor.

## Acción para el usuario (manual)

- [ ] Comprar `auditgravity.com` (registrar en proveedor habitual del usuario).
- [ ] Reservar handle GitHub `auditgravity` (org o usuario).
- [ ] Configurar DNS para subdominio `audit.zapweave.com` apuntando al frontend cuando D3 esté listo.

Tracking en `docs/manual_actions.md`.

## Implicaciones para D2/D3/D4

- Landing en `web/audit/` con copy basado en **AuditGravity**.
- SDKs `agentaudit-py` / `agentaudit-node` quedan **renombrados a `auditgravity-py` / `auditgravity-node`** desde el commit D4.
- Endpoint propuesto `/v1/audit/event` y proxy `/v1/chat/completions` viven en `kernel.zapweave.com` por ahora; el rebrand de subdominio (`audit.zapweave.com`) reservado a la landing y formularios públicos.
