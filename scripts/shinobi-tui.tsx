#!/usr/bin/env node
/**
 * Entry point del TUI Ink. Uso:
 *
 *   npx tsx scripts/shinobi-tui.ts
 *
 * Pensado como surface alternativa al WebChat para operadores que
 * prefieren terminal. Renderiza el feed de tool_events en tiempo real.
 */

import React from 'react';
import { render } from 'ink';
import { Tui } from '../src/tui/Tui.js';
import { currentProvider } from '../src/providers/provider_router.js';
import { installEgressRuntimeGuard } from '../src/egress/runtime_guard.js';

// F2.1 (CRIT-08, auditoría 2026-07-01) — mismo guard que scripts/shinobi.ts.
installEgressRuntimeGuard();

const budget = Number(process.env.SHINOBI_CONTEXT_BUDGET) || 32000;
const provider = currentProvider();

render(<Tui provider={provider} budget={budget} />);
