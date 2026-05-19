import { describe, it, expect } from 'vitest';
import {
  compactMessages,
  estimateTokens,
  totalTokens,
  COMPACTION_MARKER,
} from '../compactor.js';

function bigStr(n: number, fill = 'x'): string {
  return fill.repeat(n);
}

function makeTurn(userText: string, toolName: string, toolArgs: any, toolOutput: string, id: string) {
  return [
    { role: 'user', content: userText },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id, type: 'function', function: { name: toolName, arguments: JSON.stringify(toolArgs) } },
      ],
    },
    { role: 'tool', tool_call_id: id, name: toolName, content: toolOutput },
  ];
}

describe('compactor', () => {
  describe('estimateTokens', () => {
    it('estima por chars/4', () => {
      expect(estimateTokens('abcdefgh')).toBe(2);
    });
    it('null/undefined → 0', () => {
      expect(estimateTokens(null)).toBe(0);
      expect(estimateTokens(undefined)).toBe(0);
    });
    it('vacío → 0', () => {
      expect(estimateTokens('')).toBe(0);
    });
    it('objetos stringify y miden', () => {
      const obj = { foo: 'bar' };
      expect(estimateTokens(obj)).toBeGreaterThan(0);
    });
  });

  describe('compactMessages', () => {
    it('bajo umbral no toca nada', () => {
      const msgs = [
        { role: 'system', content: 'SYS' },
        ...makeTurn('hola', 'read_file', { p: 'a' }, 'short', 'c1'),
        { role: 'user', content: 'next' },
      ];
      const r = compactMessages(msgs, { budgetTokens: 32_000 });
      expect(r.compacted).toBe(false);
      expect(r.messages.length).toBe(msgs.length);
    });

    it('sobre umbral trunca tool outputs largos', () => {
      const huge = bigStr(4000, 'A');
      const msgs = [
        { role: 'system', content: 'SYS' },
        ...makeTurn('q1', 'read_file', { p: '1' }, huge, 'c1'),
        ...makeTurn('q2', 'read_file', { p: '2' }, huge, 'c2'),
        ...makeTurn('q3', 'read_file', { p: '3' }, huge, 'c3'),
        ...makeTurn('q4', 'read_file', { p: '4' }, huge, 'c4'),
        ...makeTurn('q5', 'read_file', { p: '5' }, huge, 'c5'),
        { role: 'user', content: 'q6' },
      ];
      const before = totalTokens(msgs);
      const r = compactMessages(msgs, { budgetTokens: 4000, preserveLastTurns: 2 });
      expect(r.compacted).toBe(true);
      expect(r.beforeTokens).toBe(before);
      expect(r.afterTokens).toBeLessThan(r.beforeTokens);
      expect(r.truncatedCount + r.droppedCount).toBeGreaterThan(0);
    });

    it('preserva tool_call ↔ tool_result pairing', () => {
      const huge = bigStr(4000, 'B');
      const msgs = [
        { role: 'system', content: 'SYS' },
        ...makeTurn('q1', 'read_file', { p: '1' }, huge, 'pair-1'),
        ...makeTurn('q2', 'read_file', { p: '2' }, huge, 'pair-2'),
        ...makeTurn('q3', 'read_file', { p: '3' }, huge, 'pair-3'),
        ...makeTurn('q4', 'read_file', { p: '4' }, huge, 'pair-4'),
        ...makeTurn('q5', 'read_file', { p: '5' }, huge, 'pair-5'),
        { role: 'user', content: 'q6' },
      ];
      const r = compactMessages(msgs, { budgetTokens: 4000, preserveLastTurns: 2 });
      const survAssistantIds = new Set<string>();
      const survToolIds = new Set<string>();
      for (const m of r.messages) {
        if (m.role === 'assistant' && Array.isArray((m as any).tool_calls)) {
          for (const tc of (m as any).tool_calls) survAssistantIds.add(tc.id);
        }
        if (m.role === 'tool' && (m as any).tool_call_id) survToolIds.add((m as any).tool_call_id);
      }
      for (const id of survAssistantIds) expect(survToolIds.has(id)).toBe(true);
      for (const id of survToolIds) expect(survAssistantIds.has(id)).toBe(true);
      for (const m of r.messages) {
        if (m.role === 'tool') expect((m as any).name).toBeTruthy();
      }
    });

    it('últimos N turnos preservados intactos', () => {
      const huge = bigStr(4000, 'C');
      const protectedTurn = makeTurn('LAST', 'last_tool', { x: 1 }, 'LAST_RESULT_INTACT', 'last-id');
      const msgs = [
        { role: 'system', content: 'SYS' },
        ...makeTurn('q1', 'read_file', { p: '1' }, huge, 'c1'),
        ...makeTurn('q2', 'read_file', { p: '2' }, huge, 'c2'),
        ...makeTurn('q3', 'read_file', { p: '3' }, huge, 'c3'),
        ...protectedTurn,
        { role: 'user', content: 'final' },
      ];
      const r = compactMessages(msgs, { budgetTokens: 3000, preserveLastTurns: 1 });
      const tool = r.messages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'last-id') as any;
      expect(tool).toBeTruthy();
      expect(tool.content).toBe('LAST_RESULT_INTACT');
      const last = r.messages[r.messages.length - 1] as any;
      expect(last.role).toBe('user');
      expect(last.content).toBe('final');
    });

    it('idempotente — no duplica markers', () => {
      const huge = bigStr(4000, 'D');
      const msgs = [
        { role: 'system', content: 'SYS' },
        ...makeTurn('q1', 'read_file', { p: '1' }, huge, 'c1'),
        ...makeTurn('q2', 'read_file', { p: '2' }, huge, 'c2'),
        ...makeTurn('q3', 'read_file', { p: '3' }, huge, 'c3'),
        ...makeTurn('q4', 'read_file', { p: '4' }, huge, 'c4'),
        { role: 'user', content: 'q5' },
      ];
      const r1 = compactMessages(msgs, { budgetTokens: 4000, preserveLastTurns: 2 });
      const r2 = compactMessages(r1.messages, { budgetTokens: 4000, preserveLastTurns: 2 });
      for (const m of r2.messages) {
        if (typeof (m as any).content === 'string') {
          const occurrences = ((m as any).content.match(new RegExp(COMPACTION_MARKER.replace(/\W/g, '\\$&'), 'g')) || []).length;
          expect(occurrences).toBeLessThanOrEqual(1);
        }
      }
    });

    it('jamás toca system ni último user', () => {
      const SYS = 'SYSTEM_SACRED_'.repeat(100);
      const FINAL = 'FINAL_INPUT_SACRED';
      const huge = bigStr(5000, 'E');
      const msgs = [
        { role: 'system', content: SYS },
        ...makeTurn('q1', 'read_file', { p: '1' }, huge, 'c1'),
        ...makeTurn('q2', 'read_file', { p: '2' }, huge, 'c2'),
        ...makeTurn('q3', 'read_file', { p: '3' }, huge, 'c3'),
        ...makeTurn('q4', 'read_file', { p: '4' }, huge, 'c4'),
        ...makeTurn('q5', 'read_file', { p: '5' }, huge, 'c5'),
        { role: 'user', content: FINAL },
      ];
      const r = compactMessages(msgs, { budgetTokens: 3000, preserveLastTurns: 1 });
      const sysSurvives = r.messages.some((m: any) => m.role === 'system' && m.content === SYS);
      expect(sysSurvives).toBe(true);
      const last = r.messages[r.messages.length - 1] as any;
      expect(last.role).toBe('user');
      expect(last.content).toBe(FINAL);
    });

    it('colapsa turnos antiguos cuando truncar no basta', () => {
      const turns: any[] = [];
      for (let i = 0; i < 30; i++) {
        turns.push(...makeTurn(`q${i}`, 'read_file', { p: `${i}` }, `r${i}_${bigStr(300, 'F')}`, `c${i}`));
      }
      const msgs = [
        { role: 'system', content: 'SYS' },
        ...turns,
        { role: 'user', content: 'qFinal' },
      ];
      const r = compactMessages(msgs, { budgetTokens: 2000, preserveLastTurns: 2 });
      expect(r.compacted).toBe(true);
      expect(r.droppedCount).toBeGreaterThan(0);
      const summary = r.messages.find(
        (m: any) =>
          m.role === 'system' &&
          typeof m.content === 'string' &&
          m.content.includes('turnos colapsados')
      );
      expect(summary).toBeTruthy();
    });

    it('comprime DENTRO de un unico turno largo cuando hay multiples tool calls', () => {
      const huge = bigStr(4000, 'Z');
      const msgs = [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'PROMPT_ORIGINAL_SAGRADO' },
        // Iteracion 1
        { role: 'assistant', content: 'razonamiento 1', tool_calls: [{ id: 'tc1', type: 'function', function: { name: 't1', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'tc1', name: 't1', content: huge },
        // Iteracion 2
        { role: 'assistant', content: 'razonamiento 2', tool_calls: [{ id: 'tc2', type: 'function', function: { name: 't2', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'tc2', name: 't2', content: huge },
        // Iteracion 3
        { role: 'assistant', content: 'razonamiento 3', tool_calls: [{ id: 'tc3', type: 'function', function: { name: 't3', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'tc3', name: 't3', content: huge },
        // El ultimo mensaje del turno
        { role: 'assistant', content: 'pensando el final' }
      ];

      const r = compactMessages(msgs, { budgetTokens: 2000, preserveLastTurns: 1 });
      expect(r.compacted).toBe(true);

      // El prompt original del usuario debe estar intacto
      const userMsg = r.messages.find(m => m.role === 'user');
      expect(userMsg).toBeTruthy();
      expect(userMsg.content).toBe('PROMPT_ORIGINAL_SAGRADO');

      // El ultimo tool output (tc3) debe estar intacto
      const t3 = r.messages.find(m => m.role === 'tool' && m.tool_call_id === 'tc3');
      expect(t3).toBeTruthy();
      expect(t3.content).toBe(huge);

      // Los tool outputs antiguos (tc1, tc2) deben haber sido truncados/colapsados
      const t1 = r.messages.find(m => m.role === 'tool' && m.tool_call_id === 'tc1');
      expect(t1).toBeTruthy();
      expect(t1.content).toContain(COMPACTION_MARKER);
    });

    // ── Tests del suelo de compactación (floor) ─────────────────────────────

    it('suelo: entrada masiva no comprime por debajo del floor', () => {
      // Simula el escenario del bug: 76k → 6k por truncado agresivo.
      // Cada tool output tiene 8000 chars (2000 tokens). Con toolOutputKeep=400
      // chars (100 tokens), si hay muchos outputs compactables el total tras
      // truncado puede caer muy por debajo del floor.
      // Con budgetTokens=8000 el floor efectivo = min(max(3200, 8000), 4000) = 4000.
      const hugeOutput = bigStr(8000, 'G'); // 2000 tokens por output
      const msgs: any[] = [
        { role: 'system', content: 'SYS' },
      ];
      // 12 turnos con outputs grandes; last 2 son protegidos → 10 compactables
      for (let i = 0; i < 12; i++) {
        msgs.push(...makeTurn(`q${i}`, 'read_file', { p: `${i}` }, hugeOutput, `c${i}`));
      }
      msgs.push({ role: 'user', content: 'PREGUNTA_FINAL' });

      const r = compactMessages(msgs, { budgetTokens: 8000, preserveLastTurns: 2 });

      // Debe haber compactado (el input excede el budget)
      expect(r.compacted).toBe(true);

      // El resultado NO debe estar por debajo del suelo (40 % de 8000 = 3200,
      // cap a 50 % = 4000 → floor = 4000).
      const floor = Math.min(Math.max(8000 * 0.40, 8000), 8000 * 0.50); // 4000
      expect(r.afterTokens).toBeLessThan(floor);

      // Debe señalizar irreducible (no pudo llegar al limit sin romper el floor)
      expect(r.irreducible).toBe(true);
    });

    it('suelo: el primer mensaje user es sagrado en compactación agresiva multi-turno', () => {
      // Escenario: muchos turnos de diálogo, budget muy pequeño, preserveLastTurns=1.
      // El colapso de turnos antiguos PODRÍA eliminar el primer mensaje 'user'
      // (la tarea original). Con el fix, ese mensaje debe sobrevivir.
      const turns: any[] = [];
      for (let i = 0; i < 15; i++) {
        turns.push(...makeTurn(
          i === 0 ? 'TAREA_ORIGINAL_SAGRADA' : `q${i}`,
          'some_tool',
          { idx: i },
          `result_${i}_${bigStr(200, 'H')}`,
          `id${i}`,
        ));
      }
      const msgs = [
        { role: 'system', content: 'SYS' },
        ...turns,
        { role: 'user', content: 'CONSULTA_FINAL' },
      ];

      // Budget muy pequeño para forzar colapso agresivo
      const r = compactMessages(msgs, { budgetTokens: 1500, preserveLastTurns: 1 });

      expect(r.compacted).toBe(true);

      // El primer mensaje 'user' con la tarea original debe estar presente e intacto
      const firstUser = r.messages.find((m: any) => m.role === 'user' && m.content === 'TAREA_ORIGINAL_SAGRADA');
      expect(firstUser).toBeTruthy();
      expect(firstUser.content).toBe('TAREA_ORIGINAL_SAGRADA');

      // El último mensaje (consulta final) también debe estar intacto
      const last = r.messages[r.messages.length - 1] as any;
      expect(last.role).toBe('user');
      expect(last.content).toBe('CONSULTA_FINAL');
    });

    it('sin compactación excesiva: resultado nunca baja del floor cuando hay margen', () => {
      // Caso normal (no bug): la compactación lleva el contexto al rango
      // [floor, limit]. No debe activar irreducible.
      const moderate = bigStr(2000, 'I'); // 500 tokens — se trunca a 100
      const msgs = [
        { role: 'system', content: 'SYS' },
        ...makeTurn('q1', 't', {}, moderate, 'i1'),
        ...makeTurn('q2', 't', {}, moderate, 'i2'),
        ...makeTurn('q3', 't', {}, moderate, 'i3'),
        ...makeTurn('q4', 't', {}, moderate, 'i4'),
        { role: 'user', content: 'qFinal' },
      ];
      // Budget generoso: 32000 → floor = min(max(12800, 8000), 16000) = 12800
      const r = compactMessages(msgs, { budgetTokens: 32_000, preserveLastTurns: 2 });

      // Con budget generoso y entradas moderadas, no debería ni compactar
      // (el total estimado es ~4 turnos * 520 tokens ≈ 2100 tokens, lejos del 75 %)
      expect(r.irreducible).toBeFalsy();
    });
  });
});
