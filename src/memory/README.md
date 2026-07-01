# `src/memory/` — tres sistemas, un nombre

F6.3 (auditoría 2026-07-01, severidad Baja — deuda arquitectónica, no bug: la
integridad de escritura de cada subsistema es sólida). "Memoria" significa
tres cosas distintas en este directorio. Ninguna es redundante — cada una
resuelve una necesidad real y distinta — pero comparten nombre, lo que
confunde a un mantenedor nuevo. Esta guía existe para que no haga falta leer
los 38 ficheros para saber cuál tocar.

## 1. Bóveda Markdown curada (`curated_memory.ts`, `markdown_store.ts`, `memory_md_parser.ts`)

**Qué es:** dos archivos Markdown planos en `memory/` en la raíz del
proyecto del usuario — `USER.md` (quién es el usuario, sus preferencias) y
`MEMORY.md` (notas curadas sobre el entorno/proyecto). Es la ÚNICA FUENTE DE
VERDAD de la memoria persistente: legible y editable a mano por el usuario,
con escritura atómica (`.tmp` + rename) y límite de tamaño por archivo
(`charLimit`).

**Úsalo cuando:** necesites leer o escribir una nota curada, con procedencia
clara, que el usuario pueda auditar/editar directamente abriendo un `.md`.

**Módulos:** `curated_memory.ts` (orquesta boot/load), `markdown_store.ts`
(un `MarkdownStore` = un archivo `.md`), `memory_md_parser.ts` (formato
Hermes-style con secciones opcionales).

## 2. Índice de recall semántico (`memory_store.ts`, `semantic_index.ts`, `embedding_provider.ts`, `embedding_providers/`, `embedding_math.ts`, `l1_cache.ts`, `memory_citations.ts`, `contradiction_filter.ts`, `threat_scan.ts`)

**Qué es:** un índice SQLite (`MemoryStore`, better-sqlite3) que NO almacena
memoria propia — es **derivado** de `MEMORY.md` (ver banner de
`semantic_index.ts`: "MEMORY.md es la única fuente de verdad... MemoryStore
deja de almacenar memoria propia"). Se reconstruye desde el Markdown para dar
recall semántico rápido (embeddings + coseno) sin que el Markdown deje de ser
la fuente editable.

**Úsalo cuando:** necesites *buscar* semánticamente ("¿qué sabe Shinobi sobre
X?") en vez de leer/escribir una nota puntual. Nunca escribas memoria nueva
aquí directamente — escribe en la bóveda Markdown (arriba) y deja que el
índice se reconstruya.

**Módulos de soporte:** `embedding_provider.ts` + `embedding_providers/`
(backends hash/local/openai intercambiables), `embedding_math.ts` (coseno,
única implementación tras F0.6 — antes había dos copias idénticas),
`l1_cache.ts` (caché de recall en caliente), `memory_citations.ts` (formatea
la procedencia de cada resultado), `contradiction_filter.ts` (detecta notas
que se contradicen), `threat_scan.ts` (escanea contenido ANTES de aceptarlo
en memoria — el contenido se inyecta al system prompt cada turno, así que un
payload de prompt-injection aquí es tan peligroso como uno en la entrada del
usuario).

## 3. Providers conversacionales (`provider_registry.ts` + `providers/`)

**Qué es:** el historial de mensajes de una conversación (no notas
curadas). Backend intercambiable vía `SHINOBI_MEMORY_PROVIDER`: `local`
(JSON en disco, default), `in_memory` (volátil, tests), `mem0` (mem0.ai,
requiere `MEM0_API_KEY`), `supermemory` (supermemory.ai, requiere
`SUPERMEMORY_API_KEY`).

**Úsalo cuando:** necesites el historial de turnos de una sesión de chat —
esto es infraestructura de conversación, no conocimiento curado ni recall
semántico. No confundir con `db/memory.ts` (historial persistente L1, otra
capa relacionada pero distinta — ver `src/db/`).

## Cuándo usar cuál (resumen de una línea)

| Necesito... | Uso |
|---|---|
| Leer/escribir una nota que el usuario pueda editar a mano | Bóveda Markdown (1) |
| Buscar semánticamente "qué sabe Shinobi sobre X" | Índice de recall (2) |
| Guardar/leer el historial de turnos de esta conversación | Provider conversacional (3) |

## Por qué no se unificó bajo una sola API (todavía)

El plan de remediación (F6.3) contempla una fachada única (`Memory`) que
enrute a los tres backends ocultando la fragmentación a los callers — es la
opción "L" (unificar). Esta guía es la opción "S" (documentar la separación
sin tocar código): resuelve la confusión de un mantenedor nuevo sin el riesgo
de reescribir 38 ficheros que hoy funcionan correctamente cada uno en su
dominio. Si el proyecto crece y la fragmentación empieza a doler en la
práctica (no solo en la lectura), la fachada unificada sigue siendo la vía
natural — ver F6.3 en el plan de remediación para el diseño propuesto.
