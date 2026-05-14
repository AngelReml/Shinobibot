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
  });
});
