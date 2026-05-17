# Arquitectura de memoria de Shinobi — separación de stores

> Fase 3 del bucle de aprendizaje. Define el rol de cada capa para que el
> bucle (Motor 1 / background review) escriba cada cosa en su sitio.

## El modelo de 3 vías (de Hermes, mapa §0)

| Dimensión | Qué captura | Forma |
|---|---|---|
| **Memoria** | *quién es el usuario* y *estado de operaciones* — preferencias, persona, hechos durables | hechos **declarativos** |
| **Skills** | *cómo hacer esta clase de tarea* — workflows, técnicas, fixes | **procedimientos** |
| **Recall** | episodios y hechos de sesiones pasadas | búsqueda |

**Regla dura:** memoria = hecho declarativo ("el usuario prefiere
respuestas concisas"); skill = procedimiento ("cómo revisar un PR").
Nunca mezclar. Lo procedimental que cae en memoria la envenena, porque la
memoria se re-inyecta cada turno como directiva.

## Las capas de Shinobi y su rol asignado

Shinobi tiene 4 estructuras de memoria. Esta es su responsabilidad ÚNICA:

### 1. `CuratedMemory` (`memory/curated_memory.ts`) → MEMORIA DECLARATIVA
- `USER.md` — perfil del usuario, **curado por humano**, estructurado en
  secciones. El bucle NO lo edita a ciegas.
- `MEMORY.md` — notas durables que **el agente añade** (`appendEnv`). Aquí
  escribe el background review. Inyectado en el system prompt cada turno.
- Es el store de hechos declarativos. El review pasa cada entrada por el
  guard `classifyMemoryEntry` (`learning/memory_separation.ts`): una
  entrada imperativa ("haz siempre X") se descarta — no es un hecho.

### 2. `MemoryStore` (`memory/memory_store.ts`) → RECALL
- SQLite + embeddings. `store()` / `recall()` con similitud vectorial.
- Es el **sustituto del `session_search` de Hermes**. Hermes usa SQLite
  FTS5 (full-text); Shinobi usa recall semántico vectorial — más potente
  para "qué hicimos parecido a esto". **Decisión: no se añade FTS5** — el
  recall vectorial cubre el caso "qué hicimos la semana pasada".
- Aquí NO van hechos declarativos del usuario (eso es `CuratedMemory`).

### 3. `Memory` (`db/memory.ts`) → TRANSCRIPT EFÍMERO
- `memory.json`, últimos ~30 turnos. Es el contexto conversacional
  inmediato que el orchestrator inyecta. NO es un store de aprendizaje —
  rota y se trunca. El background review LEE de aquí (el transcript a
  revisar), pero no escribe.

### 4. `MemoryProviderRegistry` (`memory/provider_registry.ts`) → EXTERNO, OPCIONAL
- Providers pluggables (in_memory, local_json, mem0…). Ortogonal al bucle.
- No participa del aprendizaje. Es infraestructura para integraciones.

### Skills (`skills/approved/`) → PROCEDIMIENTOS
- SKILL.md firmado y auditado. Lo escribe `skill_manager.proposeSkill`.

## Cómo escribe el bucle (Motor 1)

```
background review  ──┬─ hecho declarativo ──> CuratedMemory.appendEnv()  (MEMORY.md)
                     │                         (filtrado por classifyMemoryEntry)
                     └─ procedimiento ───────> skillManager.proposeSkill() (skills/pending/)
```

El review NUNCA escribe en `MemoryStore`, `Memory` ni en los providers
externos. Recall y transcript son de solo-lectura para el bucle.

## Resumen de la decisión

- **Memoria declarativa** → `CuratedMemory` (MEMORY.md). Guard de forma
  declarativa aplicado en la escritura.
- **Procedimientos** → skills.
- **Recall de lo pasado** → `MemoryStore` (vectorial). No se añade FTS5.
- `Memory` (transcript) y `MemoryProviderRegistry` (externo) quedan fuera
  del bucle de aprendizaje, con rol claramente acotado.
