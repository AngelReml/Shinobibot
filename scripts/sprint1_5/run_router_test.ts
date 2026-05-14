#!/usr/bin/env node
/**
 * Prueba funcional Sprint 1.5 — Enrutador semántico de modelos.
 *
 * 20 queries reales de complejidad variada (4 tiny, 5 simple, 5 medium,
 * 4 complex, 2 expert). Para cada una:
 *
 *   - Clasifica el tier.
 *   - Calcula coste estimado con router (modelo elegido por tier).
 *   - Calcula coste estimado SIN router (anchor opus-4.7 siempre).
 *   - Compara.
 *
 * Verdict: PASS si el router reduce el coste total ≥50% sobre el corpus
 * mixto y la clasificación de las 20 acierta en al menos 16 (precision
 * ≥80%).
 */

import { route, anchorCostUsd } from '../../src/coordinator/model_router.js';
import type { ComplexityTier } from '../../src/coordinator/query_complexity.js';

interface Case {
  q: string;
  expectedTier: ComplexityTier;
}

const QUERIES: Case[] = [
  // tiny (4)
  { q: 'hola', expectedTier: 'tiny' },
  { q: 'gracias', expectedTier: 'tiny' },
  { q: 'ok perfecto', expectedTier: 'tiny' },
  { q: 'adiós', expectedTier: 'tiny' },

  // simple (5)
  { q: '¿qué es TypeScript?', expectedTier: 'simple' },
  { q: 'cuándo se inventó Python', expectedTier: 'simple' },
  { q: 'explícame qué es una promesa en JS', expectedTier: 'simple' },
  { q: 'diferencia entre let y const', expectedTier: 'simple' },
  { q: 'qué hace npm install', expectedTier: 'simple' },

  // medium (5)
  { q: 'debuggea este error: TypeError cannot read property of undefined', expectedTier: 'medium' },
  { q: 'refactoriza esta función para que sea pura', expectedTier: 'medium' },
  { q: 'escribe tests unitarios para la clase Calculator', expectedTier: 'medium' },
  { q: 'implementa una función de búsqueda binaria en TypeScript', expectedTier: 'medium' },
  { q: 'configura una pipeline de GitHub Actions para CI', expectedTier: 'medium' },

  // complex (4)
  { q: 'compara React con Vue y Svelte para una app empresarial', expectedTier: 'complex' },
  { q: 'investiga el estado del arte en RAG con embeddings', expectedTier: 'complex' },
  { q: 'analiza profundamente este sistema y propón mejoras de rendimiento', expectedTier: 'complex' },
  { q: 'diseña la arquitectura de un sistema de notificaciones push', expectedTier: 'complex' },

  // expert (2)
  { q: 'audita la seguridad de este backend en busca de SQLi XSS RCE y exploits', expectedTier: 'expert' },
  { q: 'haz un threat model completo de la API y la arquitectura del cliente', expectedTier: 'expert' },
];

function fmt$(n: number): string {
  return '$' + n.toFixed(6);
}

async function main(): Promise<void> {
  // Forzamos router ON para esta prueba.
  process.env.SHINOBI_MODEL_ROUTER = '1';

  console.log('=== Sprint 1.5 — Model router (20 queries) ===\n');
  console.log('q'.padEnd(64) + ' expected   actual    model                            cost_router    cost_anchor');
  console.log('-'.repeat(170));

  let correctTier = 0;
  let totalRouterCost = 0;
  let totalAnchorCost = 0;

  for (const c of QUERIES) {
    const r = route({ input: c.q });
    const anchor = anchorCostUsd({ input: c.q });
    totalRouterCost += r.estimatedCostUsd;
    totalAnchorCost += anchor;
    const ok = r.tier === c.expectedTier ? 'OK' : 'XX';
    if (r.tier === c.expectedTier) correctTier++;
    const qShort = c.q.length > 60 ? c.q.slice(0, 57) + '...' : c.q;
    console.log(
      qShort.padEnd(64) + ' ' +
      c.expectedTier.padEnd(8) + ' ' +
      r.tier.padEnd(8) + ' ' + ok + '  ' +
      `${r.choice.provider}/${r.choice.model}`.padEnd(32) + ' ' +
      fmt$(r.estimatedCostUsd).padStart(12) + ' ' + fmt$(anchor).padStart(12),
    );
  }

  console.log('-'.repeat(170));
  console.log(`  Total router  : ${fmt$(totalRouterCost)}`);
  console.log(`  Total anchor  : ${fmt$(totalAnchorCost)}`);
  const saved = totalAnchorCost > 0 ? (1 - totalRouterCost / totalAnchorCost) : 0;
  console.log(`  Ahorro        : ${(saved * 100).toFixed(1)}%`);
  console.log(`  Tier precision: ${correctTier}/${QUERIES.length} = ${((correctTier / QUERIES.length) * 100).toFixed(0)}%`);

  // Criterios.
  const savingsPass = saved >= 0.5;
  const precisionPass = correctTier >= 16; // 80% de 20

  console.log('\n=== Verdict ===');
  console.log(`Ahorro ≥50%:           ${savingsPass ? 'PASS' : 'FAIL'} (${(saved * 100).toFixed(1)}%)`);
  console.log(`Precision tier ≥80%:   ${precisionPass ? 'PASS' : 'FAIL'} (${correctTier}/${QUERIES.length})`);

  process.exit(savingsPass && precisionPass ? 0 : 1);
}

main().catch((e) => {
  console.error('Router test crashed:', e?.stack ?? e);
  process.exit(2);
});
