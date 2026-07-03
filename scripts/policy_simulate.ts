// P4 — dry-run: simula un perfil de policy contra efectos de ejemplo (por stdin).
// Uso: npm run policy:simulate -- <policy.json> [profile]   (efectos JSON por stdin)
//   effects (stdin): [{"kind":"shell","scope":"/ws"}, {"kind":"net","scope":"x.com"}]
import { readFileSync } from 'fs';
import { loadPolicy } from '../src/policy/engine.js';
import { simulateMission, type SimEffect } from '../src/policy/dryrun.js';

const [, , policyPath, profile] = process.argv;
if (!policyPath) { console.error('Uso: policy_simulate <policy.json> [profile]  (efectos JSON por stdin)'); process.exit(2); }
let effects: SimEffect[] = [];
try { effects = JSON.parse(readFileSync(0, 'utf-8') || '[]'); } catch { effects = []; }
const sim = simulateMission(loadPolicy(policyPath), { profile }, effects);
console.log(`Mandato resuelto${profile ? ` (perfil ${profile})` : ''}: [${sim.mandate.capabilities.join(', ') || '∅'}]`);
for (const d of sim.decisions) console.log(`  ${d.allowed ? 'ALLOW' : 'DENY '} ${d.kind}:${d.scope}`);
console.log(sim.allAllowed ? 'OK — la policy permite todos los efectos simulados.' : 'AVISO — la policy DENEGARÍA algún efecto.');
process.exit(sim.allAllowed ? 0 : 1);
