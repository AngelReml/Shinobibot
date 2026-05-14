/**
 * Query Complexity Classifier — clasifica una query del usuario en uno de
 * 5 tiers de complejidad para que el router decida qué modelo invocar.
 *
 * Sprint 1.5: Hermes enruta queries simples al modelo barato y reserva
 * los caros para tareas complejas. Shinobi tenía mapping solo por ROL
 * (architect=opus, security=opus, ux=sonnet). Esto añade clasificación
 * por COMPLEJIDAD DEL INPUT antes de elegir.
 *
 * Clasificación 100% heurística — cero round-trip al LLM. La pierde
 * comparada con un classifier LLM-based pero gana ~50ms por query y
 * cero coste. Para queries ambiguas, sube un tier (sesgo
 * conservador → modelo más capaz).
 *
 * Tiers:
 *   - tiny    : saludos, agradecimientos, OK/no → modelo más barato
 *   - simple  : preguntas factuales cortas, una sola idea
 *   - medium  : tareas multi-step (debug, refactor, escribir tests)
 *   - complex : auditoría, análisis multi-fuente, comparativas
 *   - expert  : security review, arquitectura profunda — anchor model
 */

export type ComplexityTier = 'tiny' | 'simple' | 'medium' | 'complex' | 'expert';

export interface ComplexityResult {
  tier: ComplexityTier;
  signals: string[];          // razones legibles de la clasificación
  inputChars: number;         // longitud cruda del input
  estimatedInputTokens: number;
  estimatedToolCalls: number; // 0–10 (heurística sobre lo que sugiere el texto)
}

export interface ClassifyOptions {
  /** Últimos turnos del usuario, para sesgar el tier con contexto. */
  recentUserTurns?: string[];
}

/** Patrones que disparan tier=expert. */
const EXPERT_PATTERNS: Array<{ rx: RegExp; reason: string }> = [
  { rx: /\b(audita|audit|auditar)[\w\s]*\b(seguridad|security|repo|repositorio)/i, reason: 'audit de seguridad/repo' },
  { rx: /\b(security|seguridad)[\w\s]*\b(review|revisi[óo]n|análisis)/i, reason: 'security review' },
  { rx: /\b(vulnerab|sqli|xss|rce|cve|exploit|attack[a-z]* surface)/i, reason: 'vulnerabilidades específicas' },
  { rx: /\b(architecture|arquitectura)[\w\s]*\b(review|critique|profund|completa)/i, reason: 'arquitectura profunda' },
  { rx: /\b(threat\s+model|threat[\s-]?modeling|modelo\s+de\s+amenazas)/i, reason: 'threat modeling' },
  { rx: /\b(crypto|criptograf[íi]a)[\w\s]*\b(audit|review|implement)/i, reason: 'criptografía' },
];

/** Patrones que disparan tier=complex. */
const COMPLEX_PATTERNS: Array<{ rx: RegExp; reason: string }> = [
  { rx: /\b(compara|compare)\b[\w\s]*\b(con|vs|frente|against)\b/i, reason: 'comparativa explícita' },
  { rx: /\b(investiga|research|investigaci[oó]n|state of the art)\b/i, reason: 'investigación' },
  { rx: /\b(analiza|analy[sz]e|evalua|evalúa)\b[\w\s]*\b(profund|completo|exhaust)/i, reason: 'análisis profundo' },
  { rx: /\b(plan|roadmap|estrategia)\b[\w\s]*\b(multi-|long|trimestre|3 meses|extensiv)/i, reason: 'plan estratégico extenso' },
  { rx: /\b(refactor|refactoriza)[\w\s]*\b(arquitectura|architecture|capa|layer|módulo|module)/i, reason: 'refactor arquitectónico' },
  { rx: /\b(diseñ|design)[\w\s]*\b(sistema|system|api|protocolo|protocol)/i, reason: 'diseño de sistema/API' },
];

/** Patrones que disparan tier=medium. */
const MEDIUM_PATTERNS: Array<{ rx: RegExp; reason: string }> = [
  { rx: /\b(debug|debuggea|debugea|fix\s+bug|arregla|corrige)/i, reason: 'debugging' },
  { rx: /\b(refactor|refactoriza)\b/i, reason: 'refactor genérico' },
  { rx: /\b(implementa|implement|write|escribe|crea|genera)\b[\w\s]*\b(funci[oó]n|function|tests|class|módulo)/i, reason: 'implementación' },
  { rx: /\b(integra|integration|conecta|connect)\b[\w\s]*\b(api|servicio|service|webhook)/i, reason: 'integración' },
  { rx: /\b(setup|configura|configuration)/i, reason: 'configuración' },
  { rx: /\b(deploy|despliega|deployment|build)\b/i, reason: 'deployment' },
  { rx: /\b(migra|migration|migrate)\b/i, reason: 'migración' },
  { rx: /\b(optimiza|optimi[sz]e|performance|rendimiento)\b/i, reason: 'optimización' },
];

/** Patrones que disparan tier=tiny (small talk). */
const TINY_PATTERNS: Array<{ rx: RegExp; reason: string }> = [
  { rx: /^\s*(hola|hi|hello|buenas|hey|qué tal|qué hay|saludos|ola)[\s!.,?]*$/i, reason: 'saludo' },
  { rx: /^\s*(gracias|thanks|thank you|ty|ok|okay|vale|listo|ya|perfecto|bien|genial)[\s!.,?]*$/i, reason: 'confirmación/agradecimiento' },
  { rx: /^\s*(adi[oó]s|bye|hasta luego|chao|nos vemos)[\s!.,?]*$/i, reason: 'despedida' },
  { rx: /^\s*(s[ií]|no|claro|cierto|exacto|correcto|de acuerdo)[\s!.,?]*$/i, reason: 'sí/no corto' },
];

/** Tools que el input puede sugerir. Cada match suma estimatedToolCalls. */
const TOOL_KEYWORDS: Array<{ rx: RegExp; tool: string }> = [
  { rx: /\b(archivo|file|fichero|read|lee|abre)\b/i, tool: 'read_file' },
  { rx: /\b(escribe|escribir|write|create)\s+(en|un|el|la|al)/i, tool: 'write_file' },
  { rx: /\b(modifica|edita|actualiza|update|edit)\b/i, tool: 'edit_file' },
  { rx: /\b(busca|search|encuentra|grep)\b/i, tool: 'search_files' },
  { rx: /\b(comando|run|ejecuta|terminal|cmd|powershell)\b/i, tool: 'run_command' },
  { rx: /\b(navega|browse|browser|abre la web|sitio|website|url)\b/i, tool: 'browser' },
  { rx: /\b(web search|busca en internet|googlea|search on the web)\b/i, tool: 'web_search' },
  { rx: /\b(documento|docx|pdf|excel|word|markdown md)\b/i, tool: 'generate_document' },
  { rx: /\b(memoria|recuerda|recall|memory)\b/i, tool: 'memory' },
  { rx: /\b(committee|consenso|voting|auditoría)\b/i, tool: 'committee' },
  { rx: /\b(skill|habilidad|instala)\b[\w\s]*\b(skill|habilidad)/i, tool: 'skills' },
];

/** Aprox: 4 chars ≈ 1 token. */
function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}

/** Sube de tier. tiny → simple → medium → complex → expert. */
function up(t: ComplexityTier): ComplexityTier {
  switch (t) {
    case 'tiny': return 'simple';
    case 'simple': return 'medium';
    case 'medium': return 'complex';
    case 'complex': return 'expert';
    case 'expert': return 'expert';
  }
}

export function classifyComplexity(input: string, opts: ClassifyOptions = {}): ComplexityResult {
  const text = (input ?? '').trim();
  const chars = text.length;
  const tokens = estimateTokens(text);
  const signals: string[] = [];

  // Tool estimation
  const toolsMatched = new Set<string>();
  for (const k of TOOL_KEYWORDS) {
    if (k.rx.test(text)) toolsMatched.add(k.tool);
  }
  const estimatedToolCalls = Math.min(10, toolsMatched.size);

  // Pattern matching, en orden de prioridad: expert > complex > medium > tiny.
  let tier: ComplexityTier;

  let matchedExpert = false;
  for (const p of EXPERT_PATTERNS) {
    if (p.rx.test(text)) { signals.push(`expert: ${p.reason}`); matchedExpert = true; }
  }
  let matchedComplex = false;
  for (const p of COMPLEX_PATTERNS) {
    if (p.rx.test(text)) { signals.push(`complex: ${p.reason}`); matchedComplex = true; }
  }
  let matchedMedium = false;
  for (const p of MEDIUM_PATTERNS) {
    if (p.rx.test(text)) { signals.push(`medium: ${p.reason}`); matchedMedium = true; }
  }
  let matchedTiny = false;
  for (const p of TINY_PATTERNS) {
    if (p.rx.test(text)) { signals.push(`tiny: ${p.reason}`); matchedTiny = true; }
  }

  if (matchedExpert) tier = 'expert';
  else if (matchedComplex) tier = 'complex';
  else if (matchedMedium) tier = 'medium';
  else if (matchedTiny && estimatedToolCalls === 0) tier = 'tiny';
  else tier = 'simple';

  // Modificadores por longitud + tools.
  if (chars > 1500 && tier === 'simple') { tier = 'medium'; signals.push('length: input >1500 chars'); }
  if (chars > 4000 && tier === 'medium') { tier = 'complex'; signals.push('length: input >4000 chars'); }
  if (estimatedToolCalls >= 4 && tier !== 'expert') {
    tier = up(tier);
    signals.push(`tools: ${estimatedToolCalls} herramientas estimadas`);
  }

  // Si el contexto previo es complejo (las últimas 2 user turns son
  // grandes), no bajamos a tiny aunque el último mensaje sea corto.
  const recent = opts.recentUserTurns ?? [];
  const lastTwo = recent.slice(-2);
  const recentLong = lastTwo.some(t => (t?.length ?? 0) > 800);
  if (recentLong && tier === 'tiny') {
    tier = 'simple';
    signals.push('context: turno previo largo');
  }

  return {
    tier,
    signals,
    inputChars: chars,
    estimatedInputTokens: tokens,
    estimatedToolCalls,
  };
}
