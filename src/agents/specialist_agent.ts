// src/agents/specialist_agent.ts
//
// Clase base de un agente especialista. Mantiene el contrato del Bloque 1:
// identidad, especialidad, caja de herramientas y prompt madre. La lógica de
// output (producir documentos, gráficos, investigación) la añaden las
// subclases en el Bloque 2 — en el Bloque 1 esto NO es un cascarón: ya
// valida el contrato, aplica §9 capa 3 y expone la caja de herramientas.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { DESTRUCTIVE_TOOLS } from '../security/approval.js';
import {
  AgentContractError,
  ToolNotAllowedError,
  type AgentLevel,
  type SpecialistAgentSpec,
  type SpecialistAgentInfo,
} from './types.js';

const PROMPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompts');

/** Quita el frontmatter de diseño (`---\n…\n---\n`) y devuelve el prompt. */
function stripFrontmatter(raw: string): string {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (m ? raw.slice(m[0].length) : raw).trim();
}

/** Devuelve el bloque de frontmatter de diseño (sin las marcas `---`). */
function extractFrontmatter(raw: string): string {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1].trim() : '';
}

export class SpecialistAgent {
  readonly id: string;
  readonly specialty: string;
  readonly level: AgentLevel;
  readonly allowedTools: readonly string[];
  readonly readsUntrustedInput: boolean;
  private readonly promptFilePath: string;
  private cachedPrompt: string | null = null;

  constructor(spec: SpecialistAgentSpec) {
    // ── Validación del contrato — un agente mal formado NO se instancia ──
    if (!spec.id || !/^[a-z][a-z0-9_]*$/.test(spec.id)) {
      throw new AgentContractError(`SpecialistAgent: id inválido ("${spec.id}"): usa snake_case.`);
    }
    if (!spec.specialty || !spec.specialty.trim() || /[\r\n]/.test(spec.specialty)) {
      throw new AgentContractError(`SpecialistAgent[${spec.id}]: specialty debe ser UNA frase no vacía.`);
    }
    if (!(['L1', 'L2', 'L3'] as const).includes(spec.level)) {
      throw new AgentContractError(`SpecialistAgent[${spec.id}]: level inválido ("${spec.level}").`);
    }
    if (!Array.isArray(spec.allowedTools) || spec.allowedTools.length === 0) {
      throw new AgentContractError(`SpecialistAgent[${spec.id}]: allowedTools no puede estar vacío (caja cerrada).`);
    }
    if (new Set(spec.allowedTools).size !== spec.allowedTools.length) {
      throw new AgentContractError(`SpecialistAgent[${spec.id}]: allowedTools tiene duplicados.`);
    }

    // ── §9 capa 3 — mínimo privilegio ──
    // Un agente que obtiene input externo no confiable (web) NO puede tener
    // herramientas irreversibles en su caja. Se valida AQUÍ, en construcción:
    // un agente mal configurado revienta al instanciarse, no en runtime.
    if (spec.readsUntrustedInput) {
      const forbidden = spec.allowedTools.filter(t => DESTRUCTIVE_TOOLS.has(t));
      if (forbidden.length > 0) {
        throw new AgentContractError(
          `SpecialistAgent[${spec.id}]: lee input externo no confiable y, por §9 capa 3, ` +
          `NO puede tener herramientas irreversibles en su caja. Ofensoras: ${forbidden.join(', ')}.`,
        );
      }
    }

    // ── Prompt madre — debe existir en disco; no se inventa ──
    const promptPath = path.join(PROMPTS_DIR, spec.promptFile);
    if (!fs.existsSync(promptPath)) {
      throw new AgentContractError(
        `SpecialistAgent[${spec.id}]: prompt madre no encontrado en ${promptPath}.`,
      );
    }

    this.id = spec.id;
    this.specialty = spec.specialty.trim();
    this.level = spec.level;
    this.allowedTools = Object.freeze([...spec.allowedTools]);
    this.readsUntrustedInput = spec.readsUntrustedInput;
    this.promptFilePath = promptPath;
  }

  /** True si `tool` está dentro de la caja del agente. */
  isToolAllowed(tool: string): boolean {
    return this.allowedTools.includes(tool);
  }

  /**
   * Verifica que `tool` está permitida; si no, lanza `ToolNotAllowedError`.
   * Es el guard que el Bloque 2 invoca antes de ejecutar cualquier tool —
   * un intento de usar algo fuera de la caja falla LIMPIO, sin efecto.
   */
  assertToolAllowed(tool: string): void {
    if (!this.isToolAllowed(tool)) {
      throw new ToolNotAllowedError(
        `[${this.id}] herramienta fuera de la caja: "${tool}". ` +
        `Permitidas: ${this.allowedTools.join(', ')}.`,
      );
    }
  }

  /** Prompt madre (system prompt) — el frontmatter de diseño se descarta. */
  promptMadre(): string {
    if (this.cachedPrompt == null) {
      this.cachedPrompt = stripFrontmatter(fs.readFileSync(this.promptFilePath, 'utf-8'));
    }
    return this.cachedPrompt;
  }

  /**
   * Registro de diseño del prompt madre: matriz §7 y checklist §13
   * documentados en el frontmatter del fichero. Para auditoría.
   */
  designRecord(): string {
    return extractFrontmatter(fs.readFileSync(this.promptFilePath, 'utf-8'));
  }

  /** Ruta absoluta del fichero de prompt madre. */
  get promptPath(): string {
    return this.promptFilePath;
  }

  /** Vista serializable del agente. */
  describe(): SpecialistAgentInfo {
    return {
      id: this.id,
      specialty: this.specialty,
      level: this.level,
      allowedTools: [...this.allowedTools],
      readsUntrustedInput: this.readsUntrustedInput,
    };
  }
}
