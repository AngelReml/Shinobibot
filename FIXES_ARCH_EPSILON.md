# FIXES_ARCH_EPSILON — Huecos arquitectónicos resueltos

**Fecha:** 2026-06-26
**Agente:** Fix-Arch-Epsilon
**Scope:** FIX 1.1, 1.7, 1.8, 1.12, providers/openrouter, providers/vision

---

## FIX 1.1 — Aislamiento de memoria multi-usuario

**Archivo:** `src/memory/memory_store.ts`

**Problema:** `sharedMemoryStore()` era un singleton global; todos los usuarios compartían el mismo SQLite (`memory.db`), permitiendo contaminación cruzada de recall.

**Solución:** Se añade `getMemoryStore(userId: string): MemoryStore` con un `Map<string, MemoryStore>` como registro de instancias. Cada `userId` obtiene su propio SQLite en `<Shinobi>/users/<userId>/memory.db`. El directorio se crea si no existe. `sharedMemoryStore()` se mantiene intacto para compatibilidad con el modo single-owner.

---

## FIX 1.7 — Sistema de plugins nunca activado

**Archivos:** `src/tools/index.ts`, `src/plugins/hot_plug_registry.ts`

**Problema 1:** `loadAllPlugins()` (plugin_loader ESM con manifiestos explícitos) nunca se invocaba en el arranque. Los plugins del directorio `plugins/` eran ignorados.

**Solución:** Se añade al final de `tools/index.ts` una llamada no bloqueante a `loadAllPlugins(join(process.cwd(), 'plugins'))` con logging de resultados y errores.

**Problema 2:** `HotPlugRegistry` (sandbox isolated-vm para plugins no confiables) tenía todos sus timeouts en 500ms, rompiendo cualquier plugin async.

**Solución:** Los tres timeouts de `runSync`/`run` en `hot_plug_registry.ts` se elevan a 30000ms. Se añade comentario que designa `HotPlugRegistry` como el sandbox para plugins no confiables y `plugin_loader` como el cargador principal.

---

## FIX 1.8 — audio_transcribe sin validatePath

**Archivo:** `src/tools/audio_transcribe.ts`

**Problema:** `resolve(args.path)` producía un path absoluto pero no se validaba contra el workspace root. Un path como `../../../etc/passwd` pasaba sin error hasta llegar a `readFileSync`.

**Solución:** Se importa `validatePath` desde `../utils/permissions.js` (ya usada por `read_file.ts`) y se llama antes del `existsSync`. Si `pathCheck.allowed` es `false`, se devuelve `ToolResult` de error con el motivo. La aprobación manual por sesión (`approvePathForSession`) sigue funcionando como mecanismo de desbloqueo explícito.

---

## FIX 1.12 — gateway/llm.ts side-effect al importar

**Archivo:** `src/gateway/llm.ts`

**Problema:** `dotenv.config({ path: ..., override: true })` se ejecutaba como side-effect de nivel de módulo al importar el archivo, contaminando las variables de entorno de cualquier importador.

**Decisión:** El archivo tiene un importador activo (`src/reader/llm_adapter.ts`), por tanto NO se elimina. Solo se extirpa el `dotenv.config` y los imports `dotenv`/`createRequire`/`fileURLToPath`/`dirname`/`resolve` que eran exclusivos de ese bloque. La carga de `.env` es responsabilidad de los entrypoints.

---

## FIX providers — openrouter_client sin sanitización

**Archivo:** `src/providers/openrouter_client.ts`

**Problema:** A diferencia de `groq_client.ts` y `openai_client.ts`, `openrouter_client.ts` enviaba `payload.messages` directamente al provider sin pasar por `sanitizeOpenAiMessages()`. En modo failover, mensajes con campos `refusal`/`annotations` causaban HTTP 400.

**Solución:** Se importa `sanitizeOpenAiMessages` desde `./model_id.js` y se aplica en el body del `axios.post`: `messages: sanitizeOpenAiMessages(payload.messages)`.

---

## FIX providers — vision_client dominio ajeno

**Archivo:** `src/utils/vision_client.ts`

**Problema:** El header `HTTP-Referer: https://zapweave.com` hardcodeado referencia un dominio ajeno al proyecto.

**Solución:** Se reemplaza por `process.env.SHINOBI_OPENROUTER_REFERER ?? 'https://github.com/AngelReml/Shinobibot'`. El operador puede sobreescribirlo vía la variable de entorno `SHINOBI_OPENROUTER_REFERER`.

---

## Archivos modificados

| Archivo | Fix |
|---------|-----|
| `src/memory/memory_store.ts` | 1.1 — getMemoryStore(userId) |
| `src/tools/index.ts` | 1.7 — loadAllPlugins() en arranque |
| `src/plugins/hot_plug_registry.ts` | 1.7 — timeouts 500ms → 30000ms |
| `src/tools/audio_transcribe.ts` | 1.8 — validatePath antes de leer |
| `src/gateway/llm.ts` | 1.12 — eliminar dotenv side-effect |
| `src/providers/openrouter_client.ts` | providers — sanitizeOpenAiMessages |
| `src/utils/vision_client.ts` | providers — HTTP-Referer desde env var |
