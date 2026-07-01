// F4.3 (2026-07-01) — depth=3 is declared in the `Depth` type (reserved) but
// has NO runtime implementation: `HierarchicalReader.read()` only branches on
// depth===1 vs "anything else", so depth=3 used to silently run the depth=2
// code path (sub-supervisors) without telling the caller. That is a silent
// degradation: the caller asked for a specific behavior and got a different,
// unannounced one.
//
// Fix: the constructor now throws UnsupportedDepthError synchronously when
// depth=3 is requested. depth=1 and depth=2 continue to work as before.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { HierarchicalReader, UnsupportedDepthError } from '../HierarchicalReader.js';
import type { LLMClient } from '../SubAgent.js';

function makeFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hier-depth-'));
  fs.writeFileSync(path.join(root, 'README.md'), '# fixture\n');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export const x = 1;\n');
  return root;
}

// Shape-detecting stub (same pattern as hierarchical.test.ts's makeStubLLM):
// HierarchicalReader issues three DIFFERENT JSON shapes across a read() call
// (leaf SubReport, intermediate branch SubReport, final RepoReport) — a stub
// that always returns the same shape makes the final synth fail validation
// and out.ok becomes false regardless of depth, which would falsely look like
// a depth-related regression. Detect by message content instead.
function stubLLM(): LLMClient {
  return {
    async chat(messages) {
      const sys = messages.find((m) => m.role === 'system')?.content ?? '';
      const user = messages.find((m) => m.role === 'user')?.content ?? '';

      if (user.startsWith('Sub-reports (JSON array):') || sys.includes('synthesizing N parallel sub-reports')) {
        return JSON.stringify({
          repo_purpose: 'test repo',
          architecture_summary: 'test',
          modules: [{ name: 'src', path: 'src', responsibility: 'app' }],
          entry_points: [{ file: 'src/index.ts', kind: 'library' }],
          risks: [],
          evidence: { subagent_count: 1, tokens_total: 0, duration_ms: 1, subreports_referenced: 1 },
        });
      }

      if (user.startsWith('Branch path:') || sys.includes('sub-supervisor consolidating')) {
        const branchMatch = user.match(/Branch path:\s*(\S+)/);
        const branch = branchMatch ? branchMatch[1] : 'unknown';
        return JSON.stringify({
          path: branch, purpose: `consolidated for ${branch}`,
          key_files: [], dependencies: { internal: [], external: [] }, concerns: [],
        });
      }

      const folderMatch = user.match(/Folder:\s*(\S+)/);
      const folder = folderMatch ? folderMatch[1] : 'leaf';
      return JSON.stringify({
        path: folder, purpose: `leaf ${folder}`,
        key_files: [], dependencies: { internal: [], external: [] }, concerns: [],
      });
    },
  };
}

describe('F4.3 — depth=3 is rejected explicitly, never silently degraded', () => {
  it('constructing a HierarchicalReader with depth=3 throws UnsupportedDepthError', () => {
    expect(() => new HierarchicalReader({ llm: stubLLM(), depth: 3 })).toThrow(UnsupportedDepthError);
  });

  it('the error message names depth=3 explicitly (not a generic failure)', () => {
    try {
      new HierarchicalReader({ llm: stubLLM(), depth: 3 });
      expect.unreachable('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(UnsupportedDepthError);
      expect(e.message).toMatch(/depth=3/);
      expect(e.message).toMatch(/no.*implementad/i);
    }
  });

  it('depth=1 still works (no regression)', async () => {
    const root = makeFixture();
    try {
      const r = new HierarchicalReader({ llm: stubLLM(), depth: 1 });
      const out = await r.read(root);
      expect(out.ok).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('depth=2 still works (no regression)', async () => {
    const root = makeFixture();
    try {
      const r = new HierarchicalReader({ llm: stubLLM(), depth: 2 });
      const out = await r.read(root);
      expect(out.ok).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('an out-of-type-range numeric depth (e.g. from untyped JS/JSON callers) is also rejected if it is 3', () => {
    // Simulates a caller that bypasses TypeScript's Depth union (e.g. JSON.parse
    // of a config file) and passes the raw number 3.
    const untypedOpts = { llm: stubLLM(), depth: 3 as any };
    expect(() => new HierarchicalReader(untypedOpts)).toThrow(UnsupportedDepthError);
  });
});
