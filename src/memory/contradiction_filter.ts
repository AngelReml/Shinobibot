// src/memory/contradiction_filter.ts

import { sharedMemoryStore } from './memory_store.js';

export class ContradictionFilter {
  /**
   * Compares a proposed new fact against existing memories semantically.
   * If a direct contradiction is detected, it returns hasConflict: true.
   */
  public static async check(newFact: string): Promise<{
    hasConflict: boolean;
    reason?: string;
    conflictingFact?: string;
  }> {
    const store = sharedMemoryStore();
    
    // Recall top semantically related memories
    let related: any[] = [];
    try {
      related = await store.recall({
        query: newFact,
        limit: 5,
        min_score: 0.55 // reasonable threshold for related concepts
      });
    } catch (e: any) {
      console.warn('[ContradictionFilter] Failed to query semantic store:', e.message);
    }
    
    if (!related || related.length === 0) {
      return { hasConflict: false };
    }

    // Cognitive LLM validation to detect direct contradictions
    try {
      // Lazy import to avoid circular dependencies
      const { invokeLLM } = await import('../providers/provider_router.js');

      const prompt = `Analiza si hay una contradicción lógica o conflicto directo entre el nuevo hecho y alguno de los hechos existentes.
Un conflicto es cuando ambos hechos no pueden ser verdad al mismo tiempo (ej: "Le gusta el café" vs "Odia el café", "Usa Windows" vs "Usa Linux").
Si no hay conflicto o son complementarios, responde "NO_CONFLICT".
Si hay un conflicto directo, responde indicando cuál es el conflicto en una sola frase breve y clara.

Hechos existentes:
${related.map((r, i) => `- [${i}]: "${r.entry.content}"`).join('\n')}

Nuevo hecho propuesto:
"${newFact}"

Respuesta (NO_CONFLICT o la frase de contradicción):`;

      const response = await invokeLLM([
        { role: 'system', content: 'Eres un validador de consistencia lógica de memoria. Sé preciso y conciso.' },
        { role: 'user', content: prompt }
      ], { tier: 'fast' });

      const reply = (response.content || '').trim();
      if (reply.includes('NO_CONFLICT')) {
        return { hasConflict: false };
      }

      // Find which existing fact was the conflicting one
      let conflictingFact = related[0]?.entry.content;
      for (let i = 0; i < related.length; i++) {
        if (reply.includes(`[${i}]`) || reply.toLowerCase().includes(related[i].entry.content.toLowerCase().slice(0, 15))) {
          conflictingFact = related[i].entry.content;
          break;
        }
      }

      return {
        hasConflict: true,
        reason: reply,
        conflictingFact
      };
    } catch (e: any) {
      // Fallback to heuristic check if LLM check is unavailable or fails
      console.warn('[ContradictionFilter] LLM check failed, falling back to heuristics:', e.message);
      return this.checkHeuristically(newFact, related.map(r => r.entry.content));
    }
  }

  public static checkHeuristically(newFact: string, existing: string[]): {
    hasConflict: boolean;
    reason?: string;
    conflictingFact?: string;
  } {
    const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9áéíóúñ]/g, ' ');
    const newWords = clean(newFact).split(' ');
    
    // Negative vs Positive matchers
    const hasOdia = newWords.includes('odia') || newWords.includes('disgusta') || newWords.includes('detesta') || newWords.includes('no') || newWords.includes('tampoco');
    const hasGusta = newWords.includes('gusta') || newWords.includes('prefiere') || newWords.includes('ama') || newWords.includes('encanta') || newWords.includes('adora');

    const ignoreWords = new Set([
      'usuario', 'desarrollador', 'desarrollo', 'programar', 'escribir', 'hacer', 
      'usar', 'gusta', 'prefiere', 'odia', 'detesta', 'disgusta', 'tiene', 
      'quiero', 'quiere', 'gustan', 'gustas', 'encanta', 'encantan'
    ]);

    for (const fact of existing) {
      const factWords = clean(fact).split(' ');
      const factOdia = factWords.includes('odia') || factWords.includes('disgusta') || factWords.includes('detesta') || factWords.includes('no') || factWords.includes('tampoco');
      const factGusta = factWords.includes('gusta') || factWords.includes('prefiere') || factWords.includes('ama') || factWords.includes('encanta') || factWords.includes('adora');

      // Find overlap of nouns/verbs, filtering out generic stopwords
      const commonKeywords = newWords.filter(w => w.length > 3 && factWords.includes(w) && !ignoreWords.has(w));
      if (commonKeywords.length > 0) {
        if ((hasOdia && factGusta) || (hasGusta && factOdia)) {
          return {
            hasConflict: true,
            reason: `Conflicto heurístico detectado sobre: ${commonKeywords.join(', ')}`,
            conflictingFact: fact
          };
        }
      }
    }

    return { hasConflict: false };
  }
}
