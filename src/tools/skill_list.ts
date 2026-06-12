// skill_list.ts — lista skills locales (Fase 2, extirpación OG 2026-06-12)
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { skillManager } from '../skills/skill_manager.js';
import { SkillLoader } from '../skills/skill_loader.js';

const skillListTool: Tool = {
  name: 'skill_list',
  description: 'Lists locally available skills (pending + approved). Use this BEFORE requesting a new skill — one may already exist.',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['pending', 'approved', 'all'], description: 'Filter by status (default: all)' }
    },
    required: []
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const status = String(args.status ?? 'all');
    const sm = skillManager();
    const pending = status !== 'approved' ? sm.listPending() : [];
    const approved = status !== 'pending' ? sm.loadApproved() : { count: 0 };
    const mjs = status !== 'pending' ? SkillLoader.listApprovedFiles() : [];
    const lines: string[] = [];
    if (pending.length) {
      lines.push(`${pending.length} pending skill(s):`);
      pending.forEach((s: any) => lines.push(`  - ${s.id} | ${s.name} | ${(s.description || '').slice(0, 60)}`));
    }
    if ((approved as any).count) {
      lines.push(`${(approved as any).count} approved markdown skill(s)`);
    }
    if (mjs.length) {
      lines.push(`${mjs.length} approved executable skill(s): ${mjs.join(', ')}`);
    }
    if (!lines.length) lines.push('No local skills found.');
    return { success: true, output: lines.join('\n') };
  }
};

registerTool(skillListTool);
