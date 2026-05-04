# AuditGravity — positioning B2B

Documento técnico-comercial. Audiencia: equipo interno, partners, journalists, primeros pilotos. **No copy de landing** — eso vive en `web/audit/index.html`.

Fecha: 2026-05-04
Naming: **AuditGravity** (decisión D1).

## D2.1 — Value proposition

> **Auditoría externa, verificable y forense de agentes autónomos.**
>
> AuditGravity ejecuta tareas de benchmark contra un agente externo (LLM, agente Hermes/Shinobi, custom assistant), graba cada llamada en una hash-chain inmutable y emite veredictos PASS/FAIL con prueba criptográfica. La empresa cliente puede demostrar a su CISO, regulador o cliente final que su agente cumple X requisitos en Y dataset, **sin tener que confiar en el proveedor del agente**.

Tres capas:

1. **Bench**: benchmark estandarizado (`shinobi-bench v1`, 30 tareas) + bench privados que el cliente define.
2. **Verifier**: ejecución determinista + verificadores puros (regex/JSON/SHA-256) → veredicto reproducible.
3. **Ledger**: hash-chain SHA-256 (genesis → entry_n) firmada por el kernel; el cliente puede recomputar el hash localmente y validar que nada se editó después de los hechos.

Diferencia categórica vs observability/eval tools del mercado:

- **No somos un dashboard de tokens y latencia**. Somos un *tribunal*: emitimos veredictos verificables.
- **No requerimos que el agente esté en nuestra cloud**. El agente bajo auditoría sigue donde esté (OpenAI, Anthropic, Bedrock, on-prem). AuditGravity habla con él vía HTTP/SDK.
- **Forensic-first**: cada audit run es un documento canónico (UUID + prompt SHA-256 + timestamps + verdict + hash chain) que el cliente puede usar en una auditoría externa, demanda o respuesta a un incidente.

## D2.2 — 5 casos de uso vertical

### 1. Banca y servicios financieros

- **Pain**: agentes que asisten en KYC/AML, scoring crediticio o customer-service generan respuestas no auditables. La FCA / OCC / banco central exige trazabilidad por decisión.
- **AuditGravity**: bench privado con N tareas representativas de cada decisión regulada; cada llamada del agente queda en hash chain; el banco genera reportes mensuales firmados que demuestran tasa de cumplimiento.
- **Value lever**: evita multas + acelera certificación interna.

### 2. Healthcare

- **Pain**: agentes que sugieren diagnósticos, triage o codifican procedimientos médicos (CIE-10/SNOMED). HIPAA/GDPR + responsabilidad clínica obligan a probar que el agente no inventó datos.
- **AuditGravity**: bench con casos clínicos sintéticos + verificación contra ontología; ledger demuestra qué versión del agente respondió qué a quién.
- **Value lever**: defensa legal en caso de mala praxis del agente, certificación FDA/CE para sistemas SaMD.

### 3. Legal / abogacía

- **Pain**: firmas que usan agentes para redacción/búsqueda de jurisprudencia se exponen a "alucinaciones" citando casos inexistentes (Mata vs Avianca, 2023). Necesitan firmar que cada cita fue verificada.
- **AuditGravity**: verificadores que cruzan citas con bases reales (CourtListener, JusticiaES) + hash chain por documento generado.
- **Value lever**: seguro de responsabilidad reducible + defensa frente a malpractice.

### 4. Gobierno / sector público

- **Pain**: AI Act EU obliga a clasificar sistemas de IA y documentar auditorías para sistemas "alto riesgo" (educación, empleo, justicia). Sin trazabilidad no se puede certificar.
- **AuditGravity**: bench público + privado con verdicts firmados; outputs aceptables para Notified Body bajo el Annex IV del AI Act.
- **Value lever**: vía única para que un Ministerio o Ayuntamiento pueda usar agentes generativos cumpliendo regulación.

### 5. SaaS B2B (vertical agnostic)

- **Pain**: una startup vende un agente como feature ("AI copilot") y los clientes enterprise piden SOC 2 / ISO 27001-like evidence. El equipo no tiene tooling.
- **AuditGravity**: SDK Python/Node + webhook que registra cada llamada del agente en producción; dashboard mensual de tasa de PASS por categoría; export al cliente final.
- **Value lever**: feature "verifiable AI" como diferencial; cierra ventas enterprise que de otro modo se caen en el security review.

## D2.3 — Comparativa con LangSmith / Helicone / Braintrust

| Criterio | LangSmith | Helicone | Braintrust | **AuditGravity** |
|---|---|---|---|---|
| Categoría | Observability + eval para LangChain | Proxy LLM + dashboard de uso | Eval framework + dashboard | **Audit/forensic con verdicts firmados** |
| Output principal | traces + métricas + datasets | latencia, coste, replays | scores numéricos por experimento | **veredicto PASS/FAIL + hash chain inmutable** |
| Integración | LangChain-first (otros via wrap) | proxy HTTP transparente | SDK propio + UI | **HTTP nativo + OpenAI-compat proxy + SDK** |
| Hash chain / ledger | ❌ | ❌ | ❌ | ✅ SHA-256 chain genesis-anchored |
| Verificadores deterministas | parcial (eval custom) | ❌ | sí, vía SDK | ✅ 28 verificadores incluidos + custom |
| Self-host posible | ✅ (paga) | ✅ (open source) | parcial | ✅ kernel open core |
| Vertical compliance focus | no | no | no | ✅ banca/healthcare/legal/gov |
| Standalone agents (no LLM puro) | parcial | no | parcial | ✅ Hermes / Shinobi / Operator / Codex |
| Pricing model | per trace / mes | por requests | per row / mes | **per audit run + enterprise contract** |

### Conclusión

LangSmith/Helicone/Braintrust son **herramientas de devs LLM**: optimizan iteración, debugging, latencia, coste. AuditGravity es una **herramienta de compliance/legal**: produce evidencia firmada que un tercero puede recomputar. No competimos por el mismo presupuesto: ellos compiten por DevX budget, nosotros por Compliance/Risk budget. La integración natural es **complementaria** (un equipo serio puede tener LangSmith para iteración + AuditGravity para producir auditorías).

## Diferenciadores defendibles

1. **Forensic ledger SHA-256** ya en producción (ver `OpenGravity/src/forensic/recorder.ts` y la chain de ShinobiBench). Reproducible localmente.
2. **Bench público open** (`shinobi-bench`, MIT) — los clientes pueden adoptar el formato y aportar verticals sin licencia.
3. **Agnóstico de framework**: el cliente apunta su agente (HTTP endpoint o OpenAI-compatible proxy) y AuditGravity lo audita sin que el cliente reescriba su pipeline.
4. **Self-improvement loop documentado** (eje C cerrado): el bench identifica gaps y propone parches verificables — diferencia frente a "evals" que sólo reportan.

## Estrategia go-to-market (alto nivel)

- Top of funnel: blog técnico + landing `audit.zapweave.com` + comparativa explícita.
- Mid funnel: 5 pilotos no-pagados firmados con NDA (1 por vertical) que produzcan reportes públicos sintéticos.
- Bottom funnel: contrato anual ≥ €25k/cliente con SLA + bench privado dedicado.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Confusión LangSmith ↔ AuditGravity | landing copy explícita "no somos un eval/observability tool"; comparativa pública. |
| AI Act se diluye o retrasa | foco en SaaS B2B (caso 5) que tiene urgencia inmediata por SOC2/ISO sin esperar regulador. |
| Provider de LLM (Anthropic/OpenAI) lanza su propia auditoría | AuditGravity es **multi-provider** y self-hosted; ese es el moat — un cliente regulado no acepta auditoría hecha por la misma empresa que provee el LLM. |
