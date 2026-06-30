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
  action:
    | 'click' | 'type' | 'select' | 'scroll' | 'navigate' | 'press' | 'click_xy'
    | 'back' | 'forward' | 'wait_for' | 'upload' | 'iframe';
  /** ref del elemento objetivo (para click/type/select/press/upload). */
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
  /** selector CSS a esperar (wait_for). Omitir = esperar networkidle. */
  selector?: string;
  /** timeout en ms para wait_for (default 15 000). */
  timeout?: number;
  /** rutas absolutas de archivos a subir (upload). */
  files?: string[];
  /** substring de la URL del iframe a activar (iframe). */
  src?: string;
  /** índice 0-based del iframe en la página (iframe; alternativa a src). */
  index?: number;
  /** si true, devuelve un snapshot nuevo tras la acción. */
  reobserve?: boolean;

  // ── Selector fallback para click sin ref previo (sin necesidad de browser_observe) ──
  /** texto visible del elemento a clicar (alternativa a ref). */
  button_text?: string;
  /** selector CSS del elemento a clicar (alternativa a ref). */
  css_selector?: string;
  /** aria-label del elemento a clicar (alternativa a ref). */
  aria_label?: string;
  /** posición 1-indexed cuando css_selector o button_text devuelve múltiples (default 1). */
  nth?: number;

  // ── Scroll en múltiples ciclos (para contenido lazy-loaded) ──────────────────
  /** número de ciclos de scroll (default 1). */
  scroll_count?: number;
  /** ms entre ciclos de scroll (default 1 500). */
  wait_between_ms?: number;
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
