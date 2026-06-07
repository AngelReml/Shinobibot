// src/browser/types.ts
// Tipos compartidos del subsistema de navegador "Kage".
// Ver docs/BROWSER_SUBSYSTEM.md.

/** Un elemento interactivo descubierto por el observer, con ref estable. */
export interface ElementRef {
  /** Entero estable dentro de un snapshot; se materializa como data-kage-ref="N". */
  ref: number;
  /** Etiqueta legible para el LLM (texto visible o accessible name). */
  label: string;
  /** Rol semántico aproximado: link, button, input, select, checkbox, etc. */
  role: string;
  /** Pista de tipo para inputs (email, password, search, submit…). */
  hint?: string;
  /** true si el observer lo marca como sensible (password, pago, etc.). */
  sensitive?: boolean;
}

/** Resultado de observar la pestaña activa. */
export interface Snapshot {
  url: string;
  title: string;
  elements: ElementRef[];
  /** Texto ya formateado y listo para inyectar al LLM. */
  text: string;
  /** Screenshot reducido en base64 (jpeg) si se pidió. */
  screenshotB64?: string;
}

/** Señales capturadas para verificar el efecto de una acción. */
export interface VerifySignals {
  urlBefore: string;
  urlAfter: string;
  domMutations: number;
  targetDetached: boolean;
  screenHashBefore: string;
  screenHashAfter: string;
}

/** Veredicto de verificación derivado de las señales. */
export interface Verdict {
  verified: boolean;
  why: string;
}

/** Comando de acción que el actor sabe ejecutar. */
export interface ActCommand {
  action: 'click' | 'type' | 'select' | 'scroll' | 'navigate' | 'press' | 'click_xy';
  /** ref del elemento objetivo (para click/type/select/press). */
  ref?: number;
  /** texto a escribir (type) o valor a seleccionar (select). */
  text?: string;
  /** URL (navigate). */
  url?: string;
  /** tecla (press): Enter, Escape, Tab… */
  key?: string;
  /** desplazamiento en px (scroll, positivo = abajo). */
  dy?: number;
  /** coordenadas para click_xy (fallback canvas/WebGL). */
  x?: number;
  y?: number;
  /** si true, devuelve un snapshot nuevo tras la acción. */
  reobserve?: boolean;
}

/** Resultado de una acción, con verificación incorporada. */
export interface ActResult {
  ok: boolean;
  action: string;
  detail: string;
  verdict: Verdict;
  /** snapshot nuevo si se pidió reobserve. */
  snapshot?: Snapshot;
  error?: string;
}
