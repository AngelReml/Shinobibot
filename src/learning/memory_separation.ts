/**
 * Fase 3 del bucle de aprendizaje — separación de stores.
 *
 * Regla de Hermes (mapa §0): memoria = HECHOS DECLARATIVOS ("el usuario
 * prefiere respuestas concisas"); skills = PROCEDIMIENTOS ("cómo revisar un
 * PR"). Nunca mezclar. Una entrada de memoria en modo imperativo ("responde
 * siempre conciso") se re-inyecta cada turno como directiva y pisa la
 * petición real del usuario — es el pitfall #4 del plan.
 *
 * El prompt de review ya instruye la forma declarativa; este guard es el
 * cinturón de seguridad en el punto de escritura: el background review
 * descarta las entradas imperativas en vez de envenenar MEMORY.md.
 */

export interface MemoryClassification {
  /** 'declarative' = apto para MEMORY.md · 'imperative' = directiva, se rechaza. */
  kind: 'declarative' | 'imperative';
  /** true si la entrada es un hecho declarativo apto para memoria. */
  ok: boolean;
  reason?: string;
}

/**
 * Marcadores de ARRANQUE imperativo/directivo. Un hecho declarativo nombra
 * al sujeto primero ("el usuario…", "user's…", "the project…"); una orden
 * empieza por adverbio de mando o por el VERBO desnudo. Heurística de buena
 * precisión, NO exhaustiva: el prompt del review es la defensa primaria;
 * este guard es la red secundaria en el punto de escritura.
 */
const IMPERATIVE_START =
  /^\s*(always\b|never\b|do not\b|don'?t\b|make sure\b|ensure\b|avoid\b|keep\b|respond\b|reply\b|use\b|prefer\b|write\b|give\b|limit\b|format\b|stop\b|focus\b|siempre\b|nunca\b|jamás\b|usa\b|evita\b|responde\b|escribe\b|prioriza\b|limita\b|no\s+(hagas|uses|pongas|respondas|escribas|olvides|vuelvas))/i;

/**
 * Clasifica una entrada candidata a memoria declarativa.
 * No lanza; una entrada vacía se trata como no apta.
 */
export function classifyMemoryEntry(text: string): MemoryClassification {
  const t = (text || '').trim();
  if (!t) {
    return { kind: 'imperative', ok: false, reason: 'entrada vacía' };
  }
  if (IMPERATIVE_START.test(t)) {
    return {
      kind: 'imperative',
      ok: false,
      reason: 'entrada imperativa/directiva — la memoria debe ser un hecho ' +
        'declarativo ("el usuario prefiere X"), no una orden ("haz siempre X"); ' +
        'una orden en memoria se re-lee cada turno y pisa la petición actual',
    };
  }
  return { kind: 'declarative', ok: true };
}
