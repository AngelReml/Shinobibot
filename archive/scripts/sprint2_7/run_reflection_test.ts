#!/usr/bin/env node
/**
 * Prueba funcional Sprint 2.7 — Auto-reflexión cada N mensajes.
 *
 * Simula una conversación de 30+ mensajes con contradicciones,
 * preferencias y repetición intencionales. Verifica:
 *
 *   - El intervalo dispara `shouldReflect` cada 10 mensajes.
 *   - El reporte detecta las 3 contradicciones inyectadas.
 *   - Detecta al menos 3 preferencias (like, dislike, always/prefer).
 *   - Detecta al menos 1 sugerencia de consolidación.
 *   - Escribe el reporte a disco como `reflections/<ts>.md`.
 *   - El markdown del reporte incluye todas las secciones esperadas.
 */

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryReflector, type ConversationMessage } from '../../src/context/memory_reflector.js';

let failed = 0;
function check(cond: boolean, label: string, detail?: string): void {
  if (cond) console.log(`  ok  ${label}${detail ? ` · ${detail}` : ''}`);
  else { console.log(`  FAIL ${label}${detail ? ` · ${detail}` : ''}`); failed++; }
}

function buildConversation(): ConversationMessage[] {
  // 30 mensajes con contradicciones intencionales + preferencias + repetición.
  // 18 user, 12 assistant. La heurística solo mira role=user.
  const msgs: ConversationMessage[] = [
    { role: 'user',      content: 'Hola, qué tal.' },
    { role: 'assistant', content: 'Hola, dime en qué te ayudo.' },
    { role: 'user',      content: 'Mi color favorito es azul.' },
    { role: 'assistant', content: 'Anotado.' },
    { role: 'user',      content: 'Necesito ayuda con un script de despliegue.' },
    { role: 'assistant', content: 'Cuéntame más.' },
    { role: 'user',      content: 'Me gusta TypeScript estricto.' },
    { role: 'assistant', content: 'OK.' },
    { role: 'user',      content: 'Siempre uso pnpm en lugar de npm.' },
    { role: 'assistant', content: 'Bien.' },
    // Mensaje 11 — primera contradicción.
    { role: 'user',      content: 'Mi color favorito no es azul.' },
    { role: 'assistant', content: 'Entendido, ¿cuál entonces?' },
    { role: 'user',      content: 'Mi color favorito es rojo.' },
    { role: 'assistant', content: 'Actualizado.' },
    { role: 'user',      content: 'No me gusta Jest.' },
    { role: 'assistant', content: 'OK.' },
    // Mensaje 17 — segunda contradicción (path).
    { role: 'user',      content: 'El archivo config está en /etc/myapp.conf' },
    { role: 'assistant', content: 'Lo recuerdo.' },
    { role: 'user',      content: 'El archivo config está en /home/me/.myapp.conf' },
    { role: 'assistant', content: 'Anotado, está en otra ubicación.' },
    // Mensaje 21 — preferencia "prefiero".
    { role: 'user',      content: 'Prefiero vitest sobre cualquier alternativa.' },
    { role: 'assistant', content: 'OK.' },
    // Mensaje 23 — tercera contradicción (lenguaje preferido).
    { role: 'user',      content: 'Mi lenguaje principal es Rust.' },
    { role: 'assistant', content: 'Anoto Rust como principal.' },
    { role: 'user',      content: 'Mi lenguaje principal es Go.' },
    { role: 'assistant', content: 'Corregido a Go.' },
    // Mensaje 27 — repetido (consolidación).
    { role: 'user',      content: 'Por favor, prepara el reporte semanal con la última métricas.' },
    { role: 'assistant', content: 'OK.' },
    { role: 'user',      content: 'Por favor, prepara el reporte semanal con la última métricas.' },
    { role: 'assistant', content: 'OK.' },
  ];
  return msgs;
}

async function main(): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'shinobi-refl-'));
  console.log('=== Sprint 2.7 — Auto-reflexión cada N mensajes ===');
  console.log(`Reports → ${tmpDir}`);

  try {
    const conversation = buildConversation();
    const reflector = new MemoryReflector({
      intervalMessages: 10,
      reflectionDir: tmpDir,
    });

    // Verifica el contador.
    console.log('\n--- Contador disparo cada 10 ---');
    const triggers: number[] = [];
    for (let i = 0; i < conversation.length; i++) {
      reflector.noteMessage();
      if (reflector.shouldReflect()) triggers.push(i + 1);
    }
    console.log(`  triggers en mensajes: ${triggers.join(', ')}`);
    check(triggers.length === 3, '3 disparos en 30 mensajes (cada 10)');
    check(triggers[0] === 10 && triggers[1] === 20 && triggers[2] === 30, 'disparos exactos en 10/20/30');

    // Reflexión sobre la conversación completa.
    console.log('\n--- Reflexión sobre 30 mensajes ---');
    const report = reflector.analyze(conversation, true);
    console.log(`  contradicciones: ${report.contradictions.length}`);
    for (const c of report.contradictions) console.log(`    - ${c.topic}: msg #${c.positiveIdx + 1} vs #${c.negativeIdx + 1}`);
    console.log(`  preferencias: ${report.preferences.length}`);
    for (const p of report.preferences) console.log(`    - [${p.kind}] ${p.subject}`);
    console.log(`  consolidación: ${report.consolidationHints.length}`);

    check(report.contradictions.length >= 3, `>= 3 contradicciones detectadas (real: ${report.contradictions.length})`);
    check(report.preferences.length >= 4, `>= 4 preferencias detectadas (real: ${report.preferences.length})`);
    check(report.consolidationHints.length >= 1, `>= 1 sugerencia consolidación (real: ${report.consolidationHints.length})`);

    // Reporte en disco.
    check(!!report.filePath, 'reporte escrito a disco');
    check(existsSync(report.filePath!), 'archivo del reporte existe');

    const md = readFileSync(report.filePath!, 'utf-8');
    console.log('\n--- Reporte markdown (primeras 20 líneas) ---');
    for (const line of md.split('\n').slice(0, 20)) console.log('    ' + line);

    check(md.includes('Contradicciones detectadas'), 'reporte incluye sección Contradicciones');
    check(md.includes('Preferencias inferidas'), 'reporte incluye sección Preferencias');
    check(md.includes('color'), 'reporte cita el topic color');
    check(md.includes('lenguaje'), 'reporte cita el topic lenguaje');
    check(md.includes('vitest'), 'reporte cita preferencia vitest');

    // Verificar contradicciones específicas.
    const colorOk = report.contradictions.some(c => c.topic.includes('color'));
    const langOk = report.contradictions.some(c => c.topic.includes('lenguaje'));
    const pathOk = report.contradictions.some(c => c.topic.includes('config'));
    check(colorOk, 'contradicción color (azul vs rojo)');
    check(langOk, 'contradicción lenguaje (Rust vs Go)');
    check(pathOk, 'contradicción path config');

    // Verificar preferencias específicas.
    const kinds = new Set(report.preferences.map(p => p.kind));
    check(kinds.has('like'), 'preferencia like (TypeScript)');
    check(kinds.has('dislike'), 'preferencia dislike (Jest)');
    check(kinds.has('always'), 'preferencia always (pnpm)');
    check(kinds.has('prefer'), 'preferencia prefer (vitest)');

    console.log('\n=== Summary ===');
    if (failed > 0) {
      console.log(`FAIL · ${failed} aserciones`);
      process.exit(1);
    }
    console.log('PASS · reflector detecta 3 contradicciones + 4 preferencias + repetición en 30 mensajes');
  } finally {
    try { if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => {
  console.error('Reflection test crashed:', e?.stack ?? e);
  process.exit(2);
});
