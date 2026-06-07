#!/usr/bin/env node
/**
 * Prueba funcional Sprint 2.6 — Auto-skill generation por patrones.
 *
 * Simula 3 sesiones del usuario donde repite la misma secuencia de
 * tools. El detector debe proponer una skill firmable en la 3ª.
 *
 * Adicional: verifica que el draft generado se serializa correctamente
 * con `serializeSkillMd`, se firma con `signSkillText`, y verifica
 * positivamente con `verifySkillText`.
 */

import { UsagePatternDetector } from '../../src/skills/usage_pattern_detector.js';
import { serializeSkillMd } from '../../src/skills/skill_md_parser.js';
import { signSkillText, verifySkillText } from '../../src/skills/skill_signing.js';

let failed = 0;
function check(cond: boolean, label: string, detail?: string): void {
  if (cond) console.log(`  ok  ${label}${detail ? ` · ${detail}` : ''}`);
  else { console.log(`  FAIL ${label}${detail ? ` · ${detail}` : ''}`); failed++; }
}

async function main(): Promise<void> {
  console.log('=== Sprint 2.6 — Auto-skill generation por patrones ===');

  const d = new UsagePatternDetector();

  console.log('\n--- Simulación: usuario hace 3 refactors siguiendo la misma secuencia ---');
  const sequence = ['read_file', 'search_files', 'edit_file', 'run_command'];

  let proposal: ReturnType<typeof d.recordSequence> = { proposed: false };
  for (let i = 1; i <= 3; i++) {
    proposal = d.recordSequence(sequence);
    console.log(`  iter ${i}: count=${proposal.record?.count}  proposed=${proposal.proposed}`);
  }
  check(proposal.proposed, 'propone skill en la 3ª iteración');
  check(!!proposal.draft, 'draft generado');

  console.log('\n--- Inspect del draft ---');
  const draft = proposal.draft!;
  console.log(`  name: ${draft.frontmatter.name}`);
  console.log(`  status: ${draft.frontmatter.status}`);
  console.log(`  source: ${draft.frontmatter.source} / ${draft.frontmatter.source_kind}`);
  console.log(`  hash: ${draft.frontmatter.source_pattern_hash}`);
  check(String(draft.frontmatter.name).startsWith('auto-pattern-'), 'name comienza con auto-pattern-');
  check(draft.frontmatter.status === 'pending_confirmation', 'status pending_confirmation');
  check(draft.frontmatter.source === 'auto' && draft.frontmatter.source_kind === 'usage_pattern', 'source correcto');

  console.log('\n--- Body del draft (primeras 6 líneas) ---');
  for (const line of draft.body.split('\n').slice(0, 6)) console.log('    ' + line);
  for (const t of sequence) {
    check(draft.body.includes(t), `body menciona la tool ${t}`);
  }

  console.log('\n--- Round-trip: serialize → sign → verify ---');
  const text = serializeSkillMd(draft);
  const signed = signSkillText(text, { author: 'auto-pattern' });
  const v = verifySkillText(signed);
  console.log(`  signature: valid=${v.valid}`);
  check(v.valid, 'draft firmado verifica positivamente');

  console.log('\n--- 4ª iteración no vuelve a proponer ---');
  const again = d.recordSequence(sequence);
  console.log(`  iter 4: count=${again.record?.count}  proposed=${again.proposed}`);
  check(!again.proposed, '4ª iteración NO re-propone (anti-spam)');
  check(again.record?.count === 4, 'count llega a 4');

  console.log('\n--- Secuencia distinta no usa el mismo bucket ---');
  const other = d.recordSequence(['list_dir', 'read_file']);
  check(!other.proposed, 'patrón nuevo, no propone');
  check(other.record?.count === 1, 'count = 1 para el nuevo patrón');
  check(d.snapshot().length === 2, 'snapshot tiene 2 patrones');

  console.log('\n=== Summary ===');
  if (failed > 0) {
    console.log(`FAIL · ${failed} aserciones`);
    process.exit(1);
  }
  console.log('PASS · detector propone skill firmable tras 3 repeticiones, sin re-proponer');
}

main().catch((e) => {
  console.error('Auto-skill test crashed:', e?.stack ?? e);
  process.exit(2);
});
