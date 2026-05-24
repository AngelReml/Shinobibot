// Allow TypeScript to import .mjs skill bundles dynamically without a per-skill .d.ts.
declare module '*.mjs' {
  const value: unknown;
  export default value;
}
