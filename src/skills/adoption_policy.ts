// Puerta de adopción de skills en LENGUAJE LLANO.
//
// El problema real: hoy una skill que el agente fabrica se queda en `pending/` hasta
// que alguien llama `approve(id)`. Un usuario no técnico nunca lo hace — así que o se
// atasca, o se le pide "aprueba esta skill" (algo que no puede juzgar). Ninguna de las
// dos ayuda. Esta política decide, sin fricción y con seguridad real:
//
//   - Si la skill PASÓ todas las pruebas automáticas (certificada por el oráculo de
//     casos ocultos + scanner de inyección limpio) Y NO pide efectos (es pura/jaulada:
//     no toca fs/red/shell), se GUARDA sola y se registra en lenguaje llano. La prueba
//     automática ES la puerta; no se molesta al usuario con algo que ya está probado.
//   - Si pide efectos (permisos sobre el sistema), se PREGUNTA en lenguaje normal
//     ("aprendí a X pero necesita permiso para Y, ¿lo dejo?"), no en jerga técnica.
//   - Si el scanner de amenazas NO está limpio, se RECHAZA (nunca se guarda ni se
//     ofrece una skill con posible inyección). Fail-closed.
//
// Puro y determinista: sin IO, sin LLM. Lo consume quien reciba el evento skill_proposed.

/** Lo mínimo que hay que saber de una skill para decidir su adopción. */
export interface AdoptionCandidate {
  readonly name: string;
  readonly description: string;
  /** Pasó el oráculo de casos ocultos (hace lo que dice, probado). */
  readonly certified: boolean;
  /** Pide permisos sobre el sistema (fs/red/shell): NO es pura/jaulada. */
  readonly requestsEffects: boolean;
  /** El scanner de inyección la dio por limpia. */
  readonly threatScanClean: boolean;
  /** Descripción llana de los permisos que pide (para el mensaje al usuario). */
  readonly effectsSummary?: string;
}

export type AdoptionVerdict = 'auto_keep' | 'ask_user' | 'reject';

export interface AdoptionDecision {
  readonly verdict: AdoptionVerdict;
  readonly reason: string;
  /** Mensaje en lenguaje llano para el usuario (registro o pregunta). */
  readonly plainMessage: string;
}

/**
 * Decide cómo se adopta una skill. Fail-closed: sin certificar o con el scanner sucio,
 * nunca se guarda sola. Puro.
 */
export function decideAdoption(c: AdoptionCandidate): AdoptionDecision {
  if (!c.threatScanClean) {
    return {
      verdict: 'reject',
      reason: 'threat_scan_failed',
      plainMessage: `Descarté una habilidad («${c.description}») porque no pasó el control de seguridad.`,
    };
  }
  if (!c.certified) {
    return {
      verdict: 'reject',
      reason: 'not_certified',
      plainMessage: `Descarté una habilidad («${c.description}») porque no logré probar que funcione de verdad.`,
    };
  }
  if (c.requestsEffects) {
    const q = c.effectsSummary && c.effectsSummary.trim().length > 0 ? c.effectsSummary.trim() : 'tocar cosas de tu sistema';
    return {
      verdict: 'ask_user',
      reason: 'requests_effects',
      plainMessage: `Aprendí a «${c.description}», pero para funcionar necesita permiso para ${q}. ¿La dejo? (sí / no)`,
    };
  }
  return {
    verdict: 'auto_keep',
    reason: 'certified_and_pure',
    plainMessage: `Aprendí a «${c.description}» y la guardé. Pasó todas las pruebas y no toca nada de tu sistema — puedes quitarla cuando quieras.`,
  };
}
