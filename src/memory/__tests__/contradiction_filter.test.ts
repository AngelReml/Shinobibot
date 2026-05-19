// src/memory/__tests__/contradiction_filter.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContradictionFilter } from '../contradiction_filter.js';
import { sharedMemoryStore } from '../memory_store.js';

// Mock sharedMemoryStore and invokeLLM
vi.mock('../memory_store.js', () => {
  return {
    sharedMemoryStore: vi.fn()
  };
});

vi.mock('../../providers/provider_router.js', () => {
  return {
    invokeLLM: vi.fn()
  };
});

describe('ContradictionFilter', () => {
  let mockRecall: any;

  beforeEach(() => {
    mockRecall = vi.fn().mockResolvedValue([]);
    (sharedMemoryStore as any).mockReturnValue({
      recall: mockRecall
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Heuristic checking (fallback)', () => {
    it('detects simple conflicts in hobbies / preferences', () => {
      const existing = ['Al usuario le gusta programar en Rust', 'Le encanta el café'];
      
      const check1 = ContradictionFilter.checkHeuristically('Al usuario no le gusta programar en Rust', existing);
      expect(check1.hasConflict).toBe(true);
      expect(check1.conflictingFact).toBe('Al usuario le gusta programar en Rust');

      const check2 = ContradictionFilter.checkHeuristically('El usuario odia el café', existing);
      expect(check2.hasConflict).toBe(true);
      expect(check2.conflictingFact).toBe('Le encanta el café');

      const check3 = ContradictionFilter.checkHeuristically('Prefiere programar en TypeScript', existing);
      expect(check3.hasConflict).toBe(false);
    });
  });

  describe('Full semantic check (LLM)', () => {
    it('returns hasConflict false if no semantically related memories are retrieved', async () => {
      mockRecall.mockResolvedValue([]);
      const check = await ContradictionFilter.check('Quiero cenar pizza');
      expect(check.hasConflict).toBe(false);
    });

    it('returns hasConflict false when LLM replies NO_CONFLICT', async () => {
      mockRecall.mockResolvedValue([
        { entry: { content: 'Usa la zona horaria UTC-5' } }
      ]);
      const { invokeLLM } = await import('../../providers/provider_router.js');
      (invokeLLM as any).mockResolvedValue({ content: 'NO_CONFLICT' });

      const check = await ContradictionFilter.check('Vive en Lima');
      expect(check.hasConflict).toBe(false);
    });

    it('returns hasConflict true when LLM detects a contradiction', async () => {
      mockRecall.mockResolvedValue([
        { entry: { content: 'Prefiere programar usando Windows' } }
      ]);
      const { invokeLLM } = await import('../../providers/provider_router.js');
      (invokeLLM as any).mockResolvedValue({ content: 'Conflicto detectado: El usuario prefiere Windows pero ahora propone usar macOS' });

      const check = await ContradictionFilter.check('Solo uso macOS para desarrollar');
      expect(check.hasConflict).toBe(true);
      expect(check.conflictingFact).toBe('Prefiere programar usando Windows');
      expect(check.reason).toContain('Conflicto detectado');
    });
  });
});
