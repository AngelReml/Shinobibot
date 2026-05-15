/**
 * Pieza 2 — Indexación semántica.
 *
 * Cada item archivado por el watcher se guarda en el MemoryProvider
 * activo con tag `sentinel` + metadata (source_id, fecha, link al raw,
 * duración). La búsqueda semántica del provider funciona sin cambios.
 */

import type { MemoryProvider, MemoryMessage } from '../memory/providers/types.js';
import type { SentinelItem } from './types.js';

export const SENTINEL_TAG = 'sentinel';

/** Indexa un item en el provider. Devuelve el id asignado. */
export async function indexItem(
  provider: MemoryProvider,
  item: SentinelItem,
  rawPath: string,
): Promise<string> {
  const msg: MemoryMessage = {
    role: 'system',
    // El contenido buscable: título + texto bruto (cap razonable).
    content: `${item.title}\n\n${item.rawText}`.slice(0, 8000),
    ts: item.publishedAt,
    metadata: {
      tag: SENTINEL_TAG,
      itemId: item.itemId,
      sourceId: item.sourceId,
      sourceType: item.sourceType,
      sourceName: item.sourceName,
      url: item.url,
      rawPath,
      publishedAt: item.publishedAt,
      durationMinutes: item.durationMinutes ?? null,
      transcriptSource: item.transcriptSource,
    },
  };
  return provider.store(msg);
}

/** Indexa un lote. Devuelve cuántos se indexaron OK. */
export async function indexBatch(
  provider: MemoryProvider,
  items: Array<{ item: SentinelItem; rawPath: string }>,
): Promise<{ indexed: number; errors: string[] }> {
  let indexed = 0;
  const errors: string[] = [];
  for (const { item, rawPath } of items) {
    try {
      await indexItem(provider, item, rawPath);
      indexed++;
    } catch (e: any) {
      errors.push(`${item.itemId}: ${e?.message ?? e}`);
    }
  }
  return { indexed, errors };
}

/** True si un recall hit pertenece a Sentinel. */
export function isSentinelHit(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.tag === SENTINEL_TAG;
}
