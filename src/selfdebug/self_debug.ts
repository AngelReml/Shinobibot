/**
 * Self-Debug — cuando una tool falla, en vez de dejar al humano descifrar
 * el stack trace, Shinobi produce un *diagnostic report* estructurado:
 *
 *   - rootCauseHypotheses[]: lista de causas probables (heurística sobre
 *     mensaje de error + tool name + args), con `confidence` 0-1.
 *   - fixSuggestions[]: acciones concretas que podría aplicar el operador
 *     o Shinobi (con gate de confirmación para acciones destructivas).
 *   - relatedAuditEntries: eventos recientes en audit.jsonl que tocan la
 *     misma tool o el mismo argsHash (correlación temporal).
 *
 * Heurística pura — no llama LLM por defecto. El operador puede pasar
 * un `llmAdvisor` opcional si quiere segunda opinión.
 *
 * Diferenciador: Hermes no tiene self-debug (errores tal cual). OpenClaw
 * tampoco. Shinobi convierte cada fallo en feedback accionable.
 */

import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';

export interface DebugInput {
  tool: string;
  args: unknown;
  error: string;
  stack?: string;
  /** Path al audit.jsonl para correlación. Si falta, se omite ese campo. */
  auditLogPath?: string;
  /** Número máx de eventos pasados a correlacionar. */
  correlationWindow?: number;
}

export interface RootCauseHypothesis {
  cause: string;
  confidence: number;
  evidence: string;
}

export interface FixSuggestion {
  action: string;
  /** Si requiere confirmación humana antes de ejecutar. */
  destructive: boolean;
  /** Comando o instrucción concreta. */
  detail: string;
}

export interface DiagnosticReport {
  tool: string;
  rootCauseHypotheses: RootCauseHypothesis[];
  fixSuggestions: FixSuggestion[];
  relatedAuditEntries: Array<{ ts: string; tool: string; success: boolean; argsHash: string }>;
}

interface ErrorPattern {
  /** RegExp aplicado a `error.toLowerCase()`. */
  pattern: RegExp;
  cause: string;
  confidence: number;
  fix: FixSuggestion;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    pattern: /enoent|no such file|file not found|cannot find module/i,
    cause: 'Recurso no existe en el filesystem o el path es incorrecto.',
    confidence: 0.85,
    fix: {
      action: 'Verificar path y crear/instalar el recurso',
      destructive: false,
      detail: 'Comprueba que la ruta sea correcta. Si es un módulo, instálalo con `npm install`.',
    },
  },
  {
    pattern: /eacces|permission denied|operation not permitted/i,
    cause: 'Permisos insuficientes (UAC/chmod) sobre el recurso.',
    confidence: 0.85,
    fix: {
      action: 'Ejecutar con permisos elevados o ajustar ACL',
      destructive: false,
      detail: 'En Windows, lanza como administrador. En Unix, `chmod` o `chown`.',
    },
  },
  {
    pattern: /econnrefused|connect ECONNREFUSED|connection refused/i,
    cause: 'Servicio destino no está escuchando en ese host:puerto.',
    confidence: 0.9,
    fix: {
      action: 'Levantar el servicio o verificar host/puerto',
      destructive: false,
      detail: 'Verifica con `netstat -an | findstr LISTENING` (Windows) o `ss -tlnp` (Linux).',
    },
  },
  {
    pattern: /etimedout|timeout|timed out/i,
    cause: 'La operación excedió el budget de tiempo.',
    confidence: 0.8,
    fix: {
      action: 'Aumentar timeout o investigar lentitud',
      destructive: false,
      detail: 'Sube `timeoutMs` en la tool, o investiga por qué tarda (red, CPU, lock).',
    },
  },
  {
    pattern: /rate limit|rate_limit|429|too many requests/i,
    cause: 'Proveedor LLM o servicio devolvió rate limit.',
    confidence: 0.95,
    fix: {
      action: 'Esperar + reintentar con backoff, o cambiar de proveedor',
      destructive: false,
      detail: 'Activa failover cross-provider o reduce frecuencia de calls.',
    },
  },
  {
    pattern: /unauthorized|401|invalid.*api.*key|authentication failed/i,
    cause: 'API key inválida, expirada o no configurada.',
    confidence: 0.95,
    fix: {
      action: 'Re-configurar la API key en .env',
      destructive: false,
      detail: 'Revisa tu .env. Vars típicas: ANTHROPIC_API_KEY, OPENAI_API_KEY.',
    },
  },
  {
    pattern: /sqlite_busy|database is locked/i,
    cause: 'Otra escritura tiene el lock sobre la DB SQLite.',
    confidence: 0.9,
    fix: {
      action: 'Cerrar procesos que sostengan el lock',
      destructive: false,
      detail: 'Busca shm/wal sidecar files; mata el proceso que abrió la conexión.',
    },
  },
  {
    pattern: /json parse|unexpected token|invalid json/i,
    cause: 'Output de tool/LLM no es JSON válido.',
    confidence: 0.85,
    fix: {
      action: 'Inspeccionar el output crudo y endurecer el parser',
      destructive: false,
      detail: 'Loguea el raw output. Considera tolerancia a fenced code blocks.',
    },
  },
  {
    pattern: /loop_detected|loop_no_progress/i,
    cause: 'Loop detector v2 abortó por repetición de tool calls.',
    confidence: 1,
    fix: {
      action: 'Revisar la estrategia del agente y/o capa 3',
      destructive: false,
      detail: 'Mira los últimos tool_call del audit.jsonl; cambia approach o pide ayuda.',
    },
  },
  {
    pattern: /memory.*not.*found|missing.*token|context.*length/i,
    cause: 'Contexto excedido o memoria persistente no encontrada.',
    confidence: 0.7,
    fix: {
      action: 'Resumir historial o cargar memoria correcta',
      destructive: false,
      detail: 'Aplica el contextual compactor o verifica memory_store.',
    },
  },
];

function lowerOf(s?: string): string {
  return (s || '').toLowerCase();
}

function hashArgs(args: unknown): string {
  try {
    return createHash('sha256').update(JSON.stringify(args)).digest('hex');
  } catch {
    return 'unhashable';
  }
}

export function diagnoseError(input: DebugInput): DiagnosticReport {
  const errLower = lowerOf(input.error) + ' ' + lowerOf(input.stack);
  const hypotheses: RootCauseHypothesis[] = [];
  const fixes: FixSuggestion[] = [];

  for (const p of ERROR_PATTERNS) {
    if (p.pattern.test(errLower)) {
      hypotheses.push({
        cause: p.cause,
        confidence: p.confidence,
        evidence: input.error?.slice(0, 200) ?? '',
      });
      fixes.push(p.fix);
    }
  }

  if (hypotheses.length === 0) {
    hypotheses.push({
      cause: 'Causa no clasificada por heurística — revisar stack trace manualmente.',
      confidence: 0.2,
      evidence: (input.error || '').slice(0, 200),
    });
    fixes.push({
      action: 'Inspeccionar manualmente y registrar nuevo patrón',
      destructive: false,
      detail: 'Si el patrón es recurrente, añádelo a ERROR_PATTERNS en src/selfdebug/self_debug.ts.',
    });
  }

  return {
    tool: input.tool,
    rootCauseHypotheses: hypotheses,
    fixSuggestions: fixes,
    relatedAuditEntries: correlateAudit(input),
  };
}

function correlateAudit(input: DebugInput): Array<{
  ts: string; tool: string; success: boolean; argsHash: string;
}> {
  if (!input.auditLogPath || !existsSync(input.auditLogPath)) return [];
  const window = input.correlationWindow ?? 50;
  const targetHash = hashArgs(input.args);

  let raw: string;
  try { raw = readFileSync(input.auditLogPath, 'utf-8'); }
  catch { return []; }

  const lines = raw.split('\n').filter(Boolean);
  const out: Array<{ ts: string; tool: string; success: boolean; argsHash: string }> = [];
  for (let i = lines.length - 1; i >= 0 && out.length < window; i--) {
    try {
      const ev = JSON.parse(lines[i] as string);
      if (ev.kind === 'tool_call' && (ev.tool === input.tool || ev.argsHash === targetHash)) {
        out.push({
          ts: ev.ts,
          tool: ev.tool,
          success: ev.success,
          argsHash: ev.argsHash,
        });
      }
    } catch { /* skip malformed */ }
  }
  return out.reverse();
}

export function formatReport(r: DiagnosticReport): string {
  const lines: string[] = [];
  lines.push(`# Self-Debug Report · tool=${r.tool}`);
  lines.push('');
  lines.push('## Hipótesis de causa raíz');
  for (const h of r.rootCauseHypotheses) {
    lines.push(`- (${(h.confidence * 100).toFixed(0)}%) ${h.cause}`);
    if (h.evidence) lines.push(`  evidencia: \`${h.evidence}\``);
  }
  lines.push('');
  lines.push('## Sugerencias de fix');
  for (const f of r.fixSuggestions) {
    const flag = f.destructive ? ' [DESTRUCTIVO — requiere confirmación]' : '';
    lines.push(`- ${f.action}${flag}`);
    lines.push(`  ${f.detail}`);
  }
  if (r.relatedAuditEntries.length > 0) {
    lines.push('');
    lines.push('## Auditoría relacionada');
    for (const e of r.relatedAuditEntries.slice(-10)) {
      lines.push(`- ${e.ts} · ${e.tool} · success=${e.success}`);
    }
  }
  return lines.join('\n');
}
