// Tipos ambientales del repo — contrato mínimo de las skills .mjs cargadas dinámicamente.
// default.execute(args) → { success, output?, error? }; evita TS7016 en los import('*.mjs').
/**
 * Declaración ambiental para skills .mjs cargadas dinámicamente
 * (skills/desktop/*, skills/composite/*). Sin esto, cada `import('….mjs')`
 * produce TS7016 (implicit any). Tipamos el contrato mínimo real que exponen:
 * `default.execute(args) → { success, output?, error? }`.
 */
declare module '*.mjs' {
  const skill: {
    execute: (args?: Record<string, unknown>) => Promise<{
      success: boolean;
      output?: string;
      error?: string;
    }>;
  };
  export default skill;
}
