/**
 * GOLDEN SET — Bloque 1: abstracción de agente especialista.
 *
 * Oráculo objetivo de cierre del Bloque 1. 15 casos deterministas (sin LLM,
 * el Bloque 1 no ejecuta agentes): contrato SpecialistAgent, caja de
 * herramientas, validación §9 capa 3, prompts madre y registro.
 *
 * Caso adversarial incluido (#6, #13): un agente intenta usar una
 * herramienta fuera de su caja → debe fallar limpio (ToolNotAllowedError).
 *
 * Rúbrica: BINARIA. Cada caso pasa o falla. Cierre = 15/15.
 * Regresión crítica: cualquier caso que pase y luego falle bloquea el cierre.
 *
 * Run: npx tsx scripts/audit_validation/block1_agents_golden.ts
 */
import {
  SpecialistAgent,
  ResearchAgent,
  DocsAgent,
  DataAgent,
  listSpecialistAgents,
  getSpecialistAgent,
  AgentContractError,
  ToolNotAllowedError,
} from '../../src/agents/index.js';
import { DESTRUCTIVE_TOOLS } from '../../src/security/approval.js';
import listSpecialistAgentsTool from '../../src/tools/list_specialist_agents.js';

let pass = 0, fail = 0;
function check(id: string, name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`[PASS] ${id} — ${name}`); }
  else { fail++; console.log(`[FAIL] ${id} — ${name} :: ${detail}`); }
}
/** Devuelve true si `fn` lanza un error del tipo esperado. */
function throwsKind(fn: () => unknown, kind: string): { ok: boolean; detail: string } {
  try { fn(); return { ok: false, detail: 'no lanzó' }; }
  catch (e: any) { return { ok: e?.name === kind, detail: `lanzó ${e?.name}: ${e?.message?.slice(0, 80)}` }; }
}

async function main() {
  const research = new ResearchAgent();
  const docs = new DocsAgent();
  const data = new DataAgent();

  // 01 — ResearchAgent instanciable, identidad y nivel correctos.
  check('G01', 'ResearchAgent instanciable, id+level',
    research.id === 'research_agent' && research.level === 'L2',
    `id=${research.id} level=${research.level}`);

  // 02 — DocsAgent instanciable, identidad y nivel correctos.
  check('G02', 'DocsAgent instanciable, id+level',
    docs.id === 'docs_agent' && docs.level === 'L2', `id=${docs.id} level=${docs.level}`);

  // 03 — DataAgent instanciable, identidad y nivel correctos.
  check('G03', 'DataAgent instanciable, id+level',
    data.id === 'data_agent' && data.level === 'L2', `id=${data.id} level=${data.level}`);

  // 04 — El registro expone exactamente los 3 agentes.
  const reg = listSpecialistAgents();
  check('G04', 'registro expone 3 agentes',
    reg.length === 3 && !!getSpecialistAgent('research_agent') && !!getSpecialistAgent('docs_agent') && !!getSpecialistAgent('data_agent'),
    `${reg.length} agentes: ${reg.map(a => a.id).join(',')}`);

  // 05 — ResearchAgent tiene web_search en su caja.
  check('G05', 'ResearchAgent permite web_search',
    research.isToolAllowed('web_search') === true, `isToolAllowed=${research.isToolAllowed('web_search')}`);

  // 06 — ADVERSARIAL: ResearchAgent intenta usar run_command (fuera de caja) → falla limpio.
  {
    const r = throwsKind(() => research.assertToolAllowed('run_command'), 'ToolNotAllowedError');
    check('G06', 'ADVERSARIAL ResearchAgent→run_command falla limpio', r.ok, r.detail);
  }

  // 07 — §9 capa 3: un agente que lee input no confiable NO puede tener
  //      tools irreversibles → el contrato lo rechaza en construcción.
  {
    const r = throwsKind(() => new SpecialistAgent({
      id: 'bad_agent', specialty: 'Agente mal configurado para el test.', level: 'L2',
      allowedTools: ['web_search', 'write_file'], promptFile: 'research_agent.md',
      readsUntrustedInput: true,
    }), 'AgentContractError');
    check('G07', '§9 capa 3: agente untrusted + tool irreversible rechazado', r.ok, r.detail);
  }

  // 08 — La caja de ResearchAgent NO contiene ninguna tool irreversible.
  {
    const offenders = research.allowedTools.filter(t => DESTRUCTIVE_TOOLS.has(t));
    check('G08', 'caja de ResearchAgent sin tools irreversibles', offenders.length === 0,
      `irreversibles en caja: ${offenders.join(',') || 'ninguna'}`);
  }

  // 09 — promptMadre() no vacío y con el frontmatter de diseño ya descartado.
  {
    const ok = [research, docs, data].every(a => {
      const p = a.promptMadre();
      return p.length > 200 && !p.startsWith('---');
    });
    check('G09', 'promptMadre cargado de fichero, frontmatter descartado', ok,
      `research=${research.promptMadre().length} docs=${docs.promptMadre().length} data=${data.promptMadre().length} chars`);
  }

  // 10 — designRecord() documenta la matriz §7 y el checklist §13.
  {
    const ok = [research, docs, data].every(a => {
      const d = a.designRecord();
      return d.includes('matrix_7') && d.includes('matrix_result') && d.includes('checklist_13') && /level:\s*L2/.test(d);
    });
    check('G10', 'cada prompt madre documenta matriz §7 + checklist §13', ok, 'frontmatter de diseño verificado');
  }

  // 11 — specialty es UNA frase: no vacía, sin saltos de línea, termina en punto.
  {
    const ok = [research, docs, data].every(a =>
      a.specialty.length > 0 && !/[\r\n]/.test(a.specialty) && a.specialty.trim().endsWith('.'));
    check('G11', 'specialty es una sola frase', ok,
      [research, docs, data].map(a => `${a.id}:${a.specialty.length}c`).join(' '));
  }

  // 12 — La tool list_specialist_agents devuelve los 3 agentes.
  {
    const res = await listSpecialistAgentsTool.execute({});
    const ok = res.success && res.output.includes('research_agent') &&
      res.output.includes('docs_agent') && res.output.includes('data_agent') &&
      res.output.includes('registrados: 3');
    check('G12', 'tool list_specialist_agents lista los 3 agentes', ok, res.output.split('\n')[0]);
  }

  // 13 — ADVERSARIAL 2: DocsAgent intenta usar web_search (fuera de su caja) → falla limpio.
  {
    const r = throwsKind(() => docs.assertToolAllowed('web_search'), 'ToolNotAllowedError');
    check('G13', 'ADVERSARIAL DocsAgent→web_search falla limpio', r.ok, r.detail);
  }

  // 14 — El contrato rechaza un spec inválido (caja vacía).
  {
    const r = throwsKind(() => new SpecialistAgent({
      id: 'empty_box', specialty: 'Sin herramientas.', level: 'L1',
      allowedTools: [], promptFile: 'research_agent.md', readsUntrustedInput: false,
    }), 'AgentContractError');
    check('G14', 'contrato rechaza caja de herramientas vacía', r.ok, r.detail);
  }

  // 15 — El prompt madre de ResearchAgent tiene el bloque anti-injection §9 capa 1.
  {
    const p = research.promptMadre();
    check('G15', 'prompt madre de ResearchAgent blinda input no confiable (§9 capa 1)',
      p.includes('<web_results>') && /untrusted/i.test(p) && /never\s+to\s+obey|never to follow/i.test(p),
      'bloque <web_results> + advertencia anti-injection presente');
  }

  console.log(`\n=== GOLDEN SET BLOQUE 1: ${pass}/${pass + fail} PASS ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
