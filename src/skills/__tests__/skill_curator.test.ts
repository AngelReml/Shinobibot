import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { loadUsage, setSkillState } from '../../learning/skill_telemetry.js';
import { SkillCurator } from '../skill_curator.js';

const usagePath = join(process.cwd(), 'skills', '.usage.json');
let backupContent: string | null = null;

beforeEach(() => {
  if (existsSync(usagePath)) {
    backupContent = readFileSync(usagePath, 'utf-8');
  } else {
    backupContent = null;
  }
});

afterEach(() => {
  if (backupContent !== null) {
    writeFileSync(usagePath, backupContent, 'utf-8');
  } else if (existsSync(usagePath)) {
    rmSync(usagePath);
  }
});

describe('SkillCurator', () => {
  it('correctly transitions stale and archived states for agent-created skills', () => {
    const now = new Date();
    
    // Create ages: one new, one old enough to be stale, one old enough to be archived
    const freshDate = now.toISOString();
    const oldDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40 days ago

    const mockUsage = {
      // 1. Fresh agent skill -> should remain active
      'fresh-agent-skill': {
        created_by: 'agent' as const,
        use_count: 5, view_count: 2, patch_count: 0,
        last_used_at: freshDate, last_viewed_at: freshDate, last_patched_at: null,
        created_at: freshDate,
        state: 'active' as const, pinned: false, archived_at: null
      },
      // 2. Old active agent skill -> should become stale
      'old-active-agent-skill': {
        created_by: 'agent' as const,
        use_count: 5, view_count: 2, patch_count: 0,
        last_used_at: oldDate, last_viewed_at: oldDate, last_patched_at: null,
        created_at: oldDate,
        state: 'active' as const, pinned: false, archived_at: null
      },
      // 3. Old stale agent skill -> should become archived
      'old-stale-agent-skill': {
        created_by: 'agent' as const,
        use_count: 5, view_count: 2, patch_count: 0,
        last_used_at: oldDate, last_viewed_at: oldDate, last_patched_at: null,
        created_at: oldDate,
        state: 'stale' as const, pinned: false, archived_at: null
      },
      // 4. Old active user skill -> should remain active (Curator does not touch user skills)
      'old-user-skill': {
        created_by: 'user' as const,
        use_count: 5, view_count: 2, patch_count: 0,
        last_used_at: oldDate, last_viewed_at: oldDate, last_patched_at: null,
        created_at: oldDate,
        state: 'active' as const, pinned: false, archived_at: null
      },
      // 5. Old active pinned agent skill -> should remain active (Pinned)
      'old-pinned-agent-skill': {
        created_by: 'agent' as const,
        use_count: 5, view_count: 2, patch_count: 0,
        last_used_at: oldDate, last_viewed_at: oldDate, last_patched_at: null,
        created_at: oldDate,
        state: 'active' as const, pinned: true, archived_at: null
      }
    };

    writeFileSync(usagePath, JSON.stringify(mockUsage, null, 2), 'utf-8');

    // Run curation with a 30-day stale age (30 days in ms)
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const res = SkillCurator.curate(thirtyDaysMs);

    expect(res.stale).toContain('old-active-agent-skill');
    expect(res.archived).toContain('old-stale-agent-skill');

    expect(res.stale).not.toContain('fresh-agent-skill');
    expect(res.stale).not.toContain('old-user-skill');
    expect(res.stale).not.toContain('old-pinned-agent-skill');

    // Load usage again and check persisted states
    const updated = loadUsage();
    expect(updated['fresh-agent-skill'].state).toBe('active');
    expect(updated['old-active-agent-skill'].state).toBe('stale');
    expect(updated['old-stale-agent-skill'].state).toBe('archived');
    expect(updated['old-user-skill'].state).toBe('active');
    expect(updated['old-pinned-agent-skill'].state).toBe('active');
  });
});
