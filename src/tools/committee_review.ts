/**
 * CommitteeReview Tool — dispara el comité evolutivo de revisión por roles.
 *
 * Antes, cuando una misión pedía un "debate de roles", una "revisión
 * multi-perspectiva" o un "veredicto de comité", el LLM lo fabulaba en texto
 * plano: inventaba nombres de roles y opiniones sin llamada real. Esta tool
 * fuerza que ese debate pase por Committee.ts:
 *   - roles elegidos dinámicamente del catálogo evolutivo según la tarea,
 *   - cada miembro es una llamada LLM real que emite un voto de riesgo,
 *   - los disensos se exponen sin promediar,
 *   - el mediador heurístico emite el veredicto final.
 *
 * El LLM debe llamar a esta tool en vez de simular el debate en su respuesta.
 */
import { type Tool, type ToolResult, registerTool } from './tool_registry.js';
import { Committee } from '../committee/Committee.js';
import { makeLLMClient } from '../reader/llm_adapter.js';

const committeeReviewTool: Tool = {
  name: 'committee_review',
  description:
    'Run a REAL multi-role committee review/debate over a report, document, decision, or codebase summary. ' +
    'Use this whenever the task asks for a roles debate, a multi-perspective audit, a panel of experts, or a ' +
    'committee verdict — NEVER simulate the debate in plain text. Roles (architect, security_auditor, ' +
    'design_critic, data_modeler, …) are picked dynamically; each is a real LLM call that votes on risk; ' +
    'dissents are surfaced without averaging and a mediator emits the final verdict.',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The report / document / decision / codebase summary the committee must review and debate.',
      },
      role_count: {
        type: 'number',
        description: 'How many roles to convene (default 3).',
      },
    },
    required: ['content'],
  },

  async execute(args: { content: string; role_count?: number }): Promise<ToolResult> {
    const content = typeof args?.content === 'string' ? args.content.trim() : '';
    if (!content) {
      return { success: false, output: '', error: 'committee_review requires a non-empty "content" to review.' };
    }

    try {
      const committee = new Committee({
        llm: makeLLMClient(),
        evolutive: true,
        taskDescription: content.slice(0, 4000),
        roleCount: typeof args?.role_count === 'number' && args.role_count >= 2 ? args.role_count : undefined,
      });
      const roles = committee.activeRoles();
      const result = await committee.review(content);

      const lines: string[] = [];
      lines.push(`Committee roles (dinámicos): ${roles.join(', ')}`);
      lines.push('');
      lines.push('── Votos de los miembros ──');
      for (const m of result.members) {
        if ('error' in m) {
          lines.push(`[${m.role}] ERROR: ${m.error}`);
        } else {
          lines.push(`[${m.role}] risk=${m.risk_level} — weaknesses: ${m.weaknesses.join(' | ') || '(none)'}`);
        }
      }

      if ('error' in result.synthesis) {
        return {
          success: false,
          output: lines.join('\n'),
          error: `committee synthesis failed: ${result.synthesis.error}`,
        };
      }

      const s = result.synthesis;
      lines.push('');
      lines.push(`── Veredicto ──  overall_risk=${s.overall_risk}`);
      if (s.mediator) {
        lines.push(
          `mediador: finalRisk=${s.mediator.finalRisk} confianza=${s.mediator.confidence} ` +
          `invokedLLM=${s.mediator.invokedLLM} — ${s.mediator.rationale}`,
        );
      }
      if (s.dissents.length) {
        lines.push('');
        lines.push('── Disensos ──');
        for (const d of s.dissents) {
          lines.push(`⚡ ${d.topic}`);
          for (const p of d.positions) lines.push(`   [${p.role}] ${p.position}`);
        }
      } else {
        lines.push('(sin disensos — miembros alineados)');
      }
      if (s.combined_recommendations.length) {
        lines.push('');
        lines.push('── Recomendaciones combinadas ──');
        for (const r of s.combined_recommendations) lines.push(`  → ${r}`);
      }

      return { success: true, output: lines.join('\n') };
    } catch (err: any) {
      return { success: false, output: '', error: `committee_review failed: ${err?.message ?? err}` };
    }
  },
};

registerTool(committeeReviewTool);
export default committeeReviewTool;
