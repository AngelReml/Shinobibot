# G0 — lo que solo puedes cerrar tú en tu máquina Windows

> El sandbox no tiene tus keys, tu Chrome, ni el toolchain Windows (better-sqlite3
> y esbuild son binarios nativos). Esto es el resto de G0, en orden de prioridad.
> Copia-pega y listo.

## 1. La GROQ_API_KEY en la historia es INTENCIONAL (no la rotes)

Decisión del operador (2026-06-10): la `GROQ_API_KEY` que vive en la historia es
un **tanque de arranque compartido a propósito** — para que cualquiera que clone
el repo tenga uso inmediato sin configurar nada. No es una fuga; es la rampa de
entrada a coste cero. **No hay que rotarla ni purgar la historia.**

Lo que sí importa de aquí en adelante es que **conectar Shinobi a otro cerebro
sea trivial**: un modelo local (Ollama / LM Studio / llama.cpp por su URL
OpenAI-compatible) o cualquier proveedor, con failover transparente. La key
compartida es el primer escalón, no el techo. (Diseño y comparativa con
swarm-ide: ver `DECISIONES.md`.)

## 2. Verificación Windows (la "primera acción" pendiente de FRONTERA F0)

```sh
npm run typecheck
npx vitest run \
  src/agents/__tests__/best_of_n.test.ts \
  src/reader/__tests__/multi_repo.test.ts \
  src/audit/__tests__/audit_chain.test.ts \
  src/agents/__tests__/provenance_v2.test.ts \
  src/runtime/__tests__/resource_governor.test.ts \
  src/runtime/__tests__/escalation.test.ts
# + la suite nueva de hoy:
npx vitest run src/bench/__tests__/harness.test.ts
```

Esperado: typecheck verde, 44 checks E5–E8 verdes, harness verde. Si algo rojo,
es señal real (el sandbox no pudo correr el grafo TS completo).

## 3. Regenerar el contexto y commitear (el hook hace el resto)

```sh
node context.mjs      # regenera AGENTS.md + CLAUDE.md con los 26 banners nuevos
node estado.mjs --no-tests
git add -A && git commit -m "G0: banners, plan sombra, suite S-POLICY, KPIs N0"
# El pre-commit regenera contexto, lo re-añade y escanea claves. Debería pasar limpio.
```

Tras esto, revisa que la tabla de módulos de `AGENTS.md` ya no tenga
`(añade un banner de cabecera)` salvo en `src/tui/` (pendiente conocido).

## 4. Lo que aún falta para cerrar G0 del todo (trabajo, no comandos)

- **Cablear E8 y E5 al orchestrator real** (`src/coordinator/orchestrator.ts`) —
  el pendiente declarado en DECISIONES. E5 tras flag (best-of-N en tareas duras),
  E8 como governor del runtime. Es lo único de G0 que es código de verdad, no
  higiene.
- Decidir `src/tui/` (crear `index.ts` o ajustar `context.mjs`).

## 5. Cuando G0 cierre → G1

- Instrumentar un **kind de aprobación propio** en el audit (hoy los 42 frenos del
  candado viven como `error` de tool_call; medir el voto "rastro" con precisión).
- Construir S-CODE (subset SWE-bench-lite) y S-GAIA (ya tienes `/opt/GAIA` en el
  Contabo + el scorer en `src/gaia/`).
- Validar el pool 0 € (Ollama local + free tiers reales de `src/providers/`) y
  correr el **primer harness-delta** con S-CODE.

---
*Generado en la sesión del plan sombra, 2026-06-10. El detalle vive en
`forja/2026-06.md`.*
