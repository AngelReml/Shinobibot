#!/usr/bin/env node
/**
 * FASE V4.5 — prueba funcional real de Sentinel.
 *
 * El plan describe pasos manuales ("Iván añade un canal"). En modo
 * autónomo usamos una fuente pública REAL que no necesita API key:
 * el repo GitHub `ggml-org/whisper.cpp` (releases vía GitHub API).
 *
 * Flujo E2E:
 *   1. Watcher chequea la fuente real → archiva releases en data/.
 *   2. Indexa en un InMemoryProvider.
 *   3. /sentinel ask sobre un tema → resultados ordenados por score.
 *   4. /sentinel deep sobre un item → propuesta estructurada.
 *   5. /sentinel forward al council → veredicto + decisión en disco.
 *   6. /sentinel digest → boletín.
 *
 * deep/forward usan un LLM stub determinista (no quemamos tokens; la
 * lógica de pipeline es lo que se valida). El watcher SÍ hace red real.
 */

import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { handleSentinel } from '../../src/sentinel/sentinel_command.js';
import { InMemoryProvider } from '../../src/memory/providers/in_memory.js';

let failed = 0;
function check(cond: boolean, label: string): void {
  if (cond) console.log(`  ok  ${label}`);
  else { console.log(`  FAIL ${label}`); failed++; }
}

async function main(): Promise<void> {
  console.log('=== FASE V4.5 — prueba funcional de Sentinel ===');
  const work = mkdtempSync(join(tmpdir(), 'sentinel-fn-'));
  const out: string[] = [];
  const sink = (l: string): void => { out.push(l); };

  try {
    // Config: una fuente GitHub pública real.
    const configDir = join(work, 'config');
    mkdirSync(configDir, { recursive: true });
    const sourcesYaml = join(configDir, 'sources.yaml');
    writeFileSync(sourcesYaml, [
      'sources:',
      '  - type: github_repo',
      '    id: ggml-org/whisper.cpp',
      '    name: whisper.cpp releases',
      '    interval: 1w',
      '    whisper_threshold_minutes: 5',
    ].join('\n'), 'utf-8');

    const paths = {
      sourcesYaml,
      dataDir: join(work, 'data'),
      decisionsDir: join(work, 'decisions'),
    };
    const provider = new InMemoryProvider();

    // LLM stubs deterministas.
    const proposalLLM = async (_p: string): Promise<string> => JSON.stringify({
      title: 'Adoptar mejoras de whisper.cpp en el STT de Shinobi',
      description: 'whisper.cpp publicó una release. Podría mejorar la transcripción local. Evaluar el changelog.',
      shinobiArea: 'src/stt/whisper_cpp_provider.ts',
      effort: 'M',
      risks: ['Cambios de flags CLI entre versiones'],
    });
    const councilLLM = async (system: string): Promise<string> => JSON.stringify({
      stance: 'favorable',
      note: `${system.slice(0, 18)}… viable`,
    });

    const deps = { paths, provider, proposalLLM, councilLLM, out: sink };

    // ── 1. watch (red real contra GitHub) ──
    console.log('\n--- 1. /sentinel watch (fuente GitHub real) ---');
    out.length = 0;
    await handleSentinel('watch', deps);
    for (const l of out) console.log(`  ${l}`);
    const watchOk = out.some((l) => /items nuevos archivados/.test(l));
    check(watchOk, 'watcher archivó items reales de whisper.cpp');
    const rawDir = join(paths.dataDir, 'raw');
    check(existsSync(rawDir) && readdirSync(rawDir).length > 0, 'data/sentinel/raw/ tiene contenido');

    // ── 2. list ──
    console.log('\n--- 2. /sentinel list ---');
    out.length = 0;
    await handleSentinel('list 2000-01-01', deps);
    const listLines = out.filter((l) => /whisper/.test(l));
    check(listLines.length > 0, 'list muestra items archivados');
    // Captura un itemId real para deep.
    const firstItem = out.find((l) => /ggml-org\/whisper\.cpp/.test(l));
    const itemId = firstItem?.trim().split('·').pop()?.trim() ?? '';
    console.log(`  itemId capturado: ${itemId}`);

    // ── 3. ask ──
    console.log('\n--- 3. /sentinel ask "transcripción de audio" ---');
    out.length = 0;
    await handleSentinel('ask transcripción audio whisper modelo', deps);
    for (const l of out.slice(0, 8)) console.log(`  ${l}`);
    check(out.some((l) => /Top \d+ para/.test(l)) || out.some((l) => /Sin resultados/.test(l)),
      'ask respondió (resultados o vacío explícito)');

    // ── 4. deep ──
    console.log('\n--- 4. /sentinel deep ---');
    out.length = 0;
    await handleSentinel(`deep ${itemId}`, deps);
    for (const l of out) console.log(`  ${l}`);
    const propLine = out.find((l) => /Propuesta extraída:/.test(l));
    check(!!propLine, 'deep extrajo una propuesta');
    const proposalId = propLine?.split(':').pop()?.trim() ?? '';
    console.log(`  proposalId: ${proposalId}`);

    // ── 5. forward ──
    console.log('\n--- 5. /sentinel forward (council) ---');
    out.length = 0;
    await handleSentinel(`forward ${proposalId}`, deps);
    for (const l of out) console.log(`  ${l}`);
    check(out.some((l) => /Veredicto del council:/.test(l)), 'council emitió veredicto');
    check(existsSync(paths.decisionsDir) && readdirSync(paths.decisionsDir).length > 0,
      'decisión registrada en docs/sentinel/decisions/');

    // ── 6. digest ──
    console.log('\n--- 6. /sentinel digest ---');
    out.length = 0;
    await handleSentinel('digest --week', deps);
    for (const l of out) console.log(`  ${l}`);
    check(out.some((l) => /Sentinel digest/.test(l)), 'digest generado');
    check(out.some((l) => /Items archivados:/.test(l)), 'digest reporta items archivados');

    console.log('\n=== Summary ===');
    if (failed > 0) { console.log(`FAIL · ${failed} aserciones`); process.exit(1); }
    console.log('PASS · Sentinel E2E: watch real + index + ask + deep + forward + digest');
  } finally {
    try { if (existsSync(work)) rmSync(work, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => {
  console.error('V4.5 funcional crashed:', e?.stack ?? e);
  process.exit(2);
});
