// src/bench/config.ts
//
// Carga competidores externos desde bench.config.json. No fabricamos los flags
// de Hermes/OpenClaw: el operador declara el comando headless REAL de su install
// (lo averigua con `hermes --help` / el bin de OpenClaw) y sus API keys en env.
// Cada competidor se materializa como un CliAdapter, que el harness SALTA si su
// binario no está disponible.

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { CliAdapter, type CliAdapterConfig } from './adapters/cli_adapter.js';
import type { AgentAdapter } from './types.js';

export interface BenchConfig {
  competitors?: CliAdapterConfig[];
}

/** Lee bench.config.json (raíz del repo o ruta dada). Vacío si no existe/corrupto. */
export function loadBenchConfig(path?: string): BenchConfig {
  const p = path ? resolve(path) : resolve(process.cwd(), 'bench.config.json');
  if (!existsSync(p)) return {};
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** Construye los adaptadores de competidor declarados (filtra entradas inválidas). */
export function competitorAdapters(cfg: BenchConfig): AgentAdapter[] {
  return (Array.isArray(cfg.competitors) ? cfg.competitors : [])
    .filter((c) => c && typeof c.id === 'string' && typeof c.command === 'string')
    .map((c) => new CliAdapter(c));
}
