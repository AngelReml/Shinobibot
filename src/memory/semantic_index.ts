// src/memory/semantic_index.ts
//
// Índice de recall semántico DERIVADO de la memoria en Markdown.
//
// memory/MEMORY.md es la única fuente de verdad de la memoria de usuario/
// entorno. `MemoryStore` (SQLite) deja de almacenar memoria propia: pasa a
// ser un índice de embeddings reconstruible. `rebuildSemanticIndex()` lee las
// entradas de MEMORY.md y las re-indexa en SQLite para que `recall()` siga
// dando búsqueda semántica encima de la memoria en texto plano.
//
// Se invoca en el arranque, justo después de `curatedMemory().loadAtBoot()`.
// El índice queda congelado para la sesión (coherente con el snapshot frozen
// de CuratedMemory): los cambios mid-sesión se ven al siguiente reinicio.

import { curatedMemory, type UserVaultRef } from './curated_memory.js';
import { sharedMemoryStore, type MemoryStore } from './memory_store.js';

export interface ReindexResult {
  ok: boolean;
  indexed: number;
  error?: string;
}

/**
 * Reconstruye el índice semántico desde memory/MEMORY.md. Best-effort: nunca
 * lanza — si falla, el recall semántico simplemente queda vacío y el resto de
 * la memoria (snapshot en texto) sigue funcionando.
 *
 * @param store - Opcional. Store aislado del usuario (getMemoryStore(userId)).
 *   Si se omite, usa el singleton compartido.
 * @param vault - ALTA-22 (auditoría 2026-07-01): opcional. Bóveda de la que
 *   leer las entradas (`curatedMemory(vault)`). ANTES, se leía SIEMPRE del
 *   singleton del owner (`curatedMemory()`) sin importar qué `store` se
 *   pasara — un `store` por-usuario acababa indexando las notas del OWNER
 *   bajo el nombre del usuario. Debe ir de la mano de `store`: mismo usuario
 *   en ambos, o el índice de un usuario contendría el contenido de otro.
 */
export async function rebuildSemanticIndex(store?: MemoryStore, vault?: UserVaultRef): Promise<ReindexResult> {
  try {
    const entries = curatedMemory(vault).memoryEntries();
    const indexed = await (store ?? sharedMemoryStore()).reindexFromMarkdown(entries);
    return { ok: true, indexed };
  } catch (e: any) {
    return { ok: false, indexed: 0, error: e?.message ?? String(e) };
  }
}
