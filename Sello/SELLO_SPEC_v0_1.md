# SELLO — Spec de construcción v0.2
**Qué es:** verificador conductual independiente. Toma un agente externo, lo corre en una tarea bajo condiciones (limpias o adversariales) y emite un **veredicto firmado con procedencia**. No es un agente. Solo juzga y firma.
**Autor:** Iván Carbonell · ZapWeave
**Construcción:** Claude Code (código) + Claude Cowork (banco, corpus negativo, spec). **F0–F2 son 100% locales (Windows). El VPS NO se usa hasta F3.**
**Stack:** TypeScript/Node.js.
**Cambios v0.1→v0.2:** rutas de salvamento reales (recon Claude Code 09-jun); ed25519 + record firmado YA existen (se salvan, no se construyen); decisiones de migración resueltas; incidente de clave filtrada.

---

## 1. Salvamento (rutas reales, copiar de la copia LOCAL `C:\Users\angel\Desktop\OpenGravity`)

### COPIAR
**Los 5 graders** — `legacy\src\benchmark\graders\`, ya con interfaz uniforme `grade(output, task): GradingResult`:
- `json_schema_grader.ts`, `numeric_tolerance_grader.ts`, `numeric_preservation_grader.ts`, `safety_refusal_grader.ts`, `bvp_grader.ts`
- Arrastran `legacy\src\benchmark\types.ts` (BenchmarkTask / GradingResult / Verdict).

**Ledger + cripto** (la unidad más limpia, cero-deps) — `attestation-layer\src\`:
- `forensic\canonical.mjs` (sortKeysDeep, canonicalBytes, sha256)
- `forensic\recorder.mjs` (hash chain + verifyLedger + lock O_EXCL)
- `crypto\keys.mjs` (ed25519 sign/verify/fingerprint — YA EXISTE)
- `forensic\attestation.mjs` (record firmado = el PoBI de facto; es la base del veredicto)

**Banco BVP v0.1** — `legacy\src\banco\`:
- `tasks\pilot_agentic_v1_bvp.ts` (30 tareas, 6 categorías: trading 8, prediction_markets 5, industrial_ot 5, a2a_payments 4, autonomous_research 4, compliance 4; 5 adversariales)
- `types.ts`, `validator.ts`

### MATAR (no migrar)
`runAgentLoop`/alma de agente · dashboard CEO :18789 · n8n · Telegram · SIMULATION_MODE · sprawl 27 tools/MCP · gateway :9900 · los graders `.mjs` del attestation-layer (duplican a los `.ts`).

### INCIDENTE DE SEGURIDAD (resolver antes de codear)
- `attestation-layer\data\real_v2\keys\verifier_private.pem` está **commiteado en git → clave QUEMADA.** Sello genera **par nuevo**. Todas las firmas previas con la clave antigua se dan por **nulas para confianza** (la cadena de hash sigue valiendo como tamper-evidence, la firma como autoría no).
- No migrar `.env`, `.env.adapters`, `.claude\settings.local.json`. Rotar el n8n JWT, API key e internal token.

---

## 2. Decisiones de migración (resueltas — no re-preguntar)

1. **Interfaz Grader canónica:** la legacy `grade(output, task): GradingResult`. Los 5 `.ts` ya son homogéneos. Adaptar a una interfaz `Grader { id; grade(output, task): GradingResult }`.
2. **Routing de grader:** añadir **campo `grader` explícito por tarea** en el banco. Eliminar el router externo (adversarial->safety_refusal / resto->bvp_behavioral); se materializa como dato por tarea. Auditabilidad > implicitud.
3. **Formato del banco:** serializar el array TS a **JSONL** (`bank/pilot_agentic_v1.jsonl`), un objeto-tarea por línea, + loader mínimo. El JSONL es el artefacto canónico.
4. **Ledger:** converger en el schema de `attestation.mjs` (ed25519 + canonical + lock). Descartar el recorder duplicado.

---

## 3. Núcleo limpio

```
sello/
  core/
    ledger/        # canonical.mjs + recorder.mjs + attestation.mjs (salvados)
    crypto/        # keys.mjs (salvado) — CLAVE NUEVA, no la .pem filtrada
    verdict/       # schema PoBI (seccion 4), canonicalizacion, enum
  graders/         # los 5 .ts salvados tras interfaz Grader
  harness/
    adapters/      # cli-process (F0) | http-endpoint (F2)
  probes/          # perturbacion adversarial (F1; semilla del corpus negativo)
  bank/            # pilot_agentic_v1.jsonl + loader
  cli/             # sello run | verify | replay
  api/             # (F3) endpoint x402
```

Ley de diseño (Agent-Eval Checklist): el sujeto nunca ve la respuesta de referencia · el grader aislado del sujeto · veredicto reproducible bit a bit.

---

## 4. Veredicto PoBI (artefacto de salida; alinear con `attestation.mjs`)

```jsonc
{
  "subject":  { "agent_id": "...", "agent_artifact_hash": "...", "model": "...", "config_hash": "..." },
  "task":     { "task_id": "...", "task_hash": "...", "category": "...", "grader": "..." },
  "conditions": { "mode": "clean | perturbed", "probes": ["..."], "env_hash": "..." },
  "execution":  { "ts": "ISO-8601", "harness_version": "...", "runtime_ms": 0 },
  "result":   { "verdict": "PASS|FAIL|FORMAT_FAIL|CONTENT_FAIL|SAFETY_FAIL|TIMEOUT|ERROR|PENDING",
                "grader_id": "...", "evidence_hash": "...", "score": null },
  "provenance": { "task_source": "...", "agent_source": "..." },
  "integrity": { "prev_hash": "...", "this_hash": "...",
                 "verifier_pubkey": "<clave NUEVA>", "signature": "ed25519(...)" }
}
```
`this_hash = sha256(canonical(todo menos integrity.this_hash y signature))` (reusar `canonical.mjs`); `signature` sobre `this_hash`; `prev_hash` enlaza (reusar `recorder.mjs`). Proyeccion ERC-8004 -> mas adelante.

---

## 5. Fases

- **F0 (local):** scaffold -> salvar graders+ledger+cripto+banco -> CLAVE NUEVA -> schema PoBI -> `sello run <task> <cli-adapter>` emite veredicto firmado; `sello verify` comprueba firma+cadena -> serializar banco a JSONL con `grader` por tarea -> **REGRESION: 30/30 oraculo, 0/30 naive por CLI crudo.**
- **F1 (local):** capa `probes` (clean vs perturbed). El veredicto bajo perturbacion = integridad conductual. Semilla del corpus negativo.
- **F2 (local):** adapters `cli-process` + `http-endpoint` -> veredictos comparativos reales (Hermes/Shinobi/otros). Publicar incluso donde el propio pierda.
- **F3 (necesita host):** salida publica verificable + endpoint x402. Aqui se decide Contabo vs Oracle ARM (verificar compat ARM del ledger `.mjs`).

Schema freeze: no se toca el formato de veredicto ni banco hasta F0 con 30/30 ÷ 0/30 confirmado por CLI.
