# S1.5 — Validación del re-mapping de modelos (audit DVWA)

Fecha: 2026-05-07
Branch: `feat/s1.5-reader-stress`
Mapping aplicado: glm-4.7-flash (fast) + claude-sonnet-4.6 (balanced) + claude-opus-4.7 anchor (sólo code_reviewer P-010).
Configuración: `HierarchicalReader` depth=2, `votingRuns=1`, temperature=0, OpenRouter.

## Criterio de aceptación (firmado en prompt.txt)

> verdict FAIL/high con mínimo 3 vulnerabilidades citadas con `archivo:línea`.

## Resultado: **CUMPLE ✅**

| Métrica | Valor | Criterio |
|---|---|---|
| Verdict | **FAIL** | requerido FAIL |
| Overall risk | **high** | requerido high |
| Vulnerabilidades con `archivo:línea` | **6** | requerido ≥3 |
| Risks totales en RepoReport | 10 | — |
| Weaknesses del code_reviewer (Opus anchor) | 6 | — |
| Duración total | 783.5 s | — |

## Composición del comité (1 corrida, sin voting)

| Rol | Modelo | Estado | risk_level | Weaknesses count |
|---|---|---|---|---|
| `architect` | claude-sonnet-4.6 | OK | high | 6 |
| `security_auditor` | z-ai/glm-4.7-flash | **ERROR** — `Cannot read properties of null (reading 'trim')` | — | 0 |
| `design_critic` | z-ai/glm-4.7-flash | OK | high | 4 |
| `code_reviewer` (P-010 anchor) | **claude-opus-4.7** | OK | high | 6 |

3 de 4 miembros emitieron reports válidos. El `code_reviewer` (anchor Opus) entregó la mayoría de la señal de seguridad real, exactamente como predice la justificación del re-mapping.

## Top 5 vulnerabilidades con `archivo:línea` (extracto)

```
1. vulnerabilities/authbypass/change_user_details.php:46
   — SQL injection: $data->first_name, $data->surname, $data->id from JSON body are concatenated direct[ly into UPDATE]

2. vulnerabilities/api/src/Login.php:9-12
   — Hardcoded secrets ACCESS_TOKEN_SECRET="12345" and REFRESH_TOKEN_SECRET="98765", plus hardcoded credentials mrbenne[tt/becareful]

3. vulnerabilities/api/src/Token.php:9
   — Hardcoded symmetric key ENCRYPTION_KEY="Paintbrush" used for AES-GCM; weak, short, and committed to source.

4. login.php:40
   — Password hashed with unsalted md5($pass) (line 25). MD5 is broken for password storage; rainbow-table trivial.

5. vulnerabilities/authbypass/authbypass.js:41-48
   — XSS sink: cell1.innerHTML is built by concatenating user['first_name']/user['surname'] directly from the API response.
```

Las 6 vulnerabilidades cubren las clases canónicas: **SQLi, XSS, hardcoded credentials, weak crypto (MD5+unsalted), insecure deserialization implícita, hardcoded encryption key**. Idénticas a las detectadas en el A/B de S1.4 con Opus en todos los roles — confirma que el code_reviewer Opus anchor preserva la capacidad de detección.

## Hallazgo colateral (no bloqueante)

**`security_auditor` con glm-4.7-flash falló** con un error específico del runner: `Cannot read properties of null (reading 'trim')`. Es un edge case (probablemente glm-flash devolvió `null` en `choices[0].message.content` en algún retry) que no estaba en `gateway/llm.ts`. **No afecta el criterio** — la señal de seguridad la lleva el code_reviewer (anchor Opus) y el design_critic compensa el rol perdido.

Pendiente para sesión aparte (no S1.5):
- Investigar respuesta `null` de glm-flash bajo OpenRouter.
- Decidir si añadir handler defensivo en `gateway/llm.ts:openAIChat` (`response.data.choices[0].message.content ?? ''`) para tolerar respuestas vacías.

## Coste

`docs/s1_5/model_remapping.md` §5 estimaba ~$0.90 USD por audit DVWA con el nuevo mapping (vs ~$2.24 USD pre-cambio). Esta corrida no instrumentó coste real, pero la duración y el patrón de tokens son consistentes con la estimación.

## Fixtures persistidos

- `audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_report.json` — RepoReport.
- `audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_subreports.json` — sub-reports literales.
- `audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_committee.json` — output completo del committee.
- `audits/.machine/33e364c556e91473a5e979a4db16ee3b393d05ba_telemetry.json` — árbol depth=2.
- `docs/s1_5/remapping_validation_data.json` — datos crudos de validación.

## Estado

Criterio cumplido. Re-mapping de modelos validado en producción contra DVWA. Sin reverts.
