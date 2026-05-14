/**
 * TUI principal de Shinobi. Layout:
 *
 *   ┌─────────────────────────────────────┐
 *   │ Shinobi 忍  [provider]  [tokens]    │
 *   ├─────────────────────────────────────┤
 *   │ <ToolEventLog: últimos 15 eventos> │
 *   ├─────────────────────────────────────┤
 *   │ Ctrl+C para salir                   │
 *   └─────────────────────────────────────┘
 *
 * Por simplicidad esta v1 muestra solo el log de tool events y un header.
 * Ink permite useInput para añadir un campo de prompt en una iteración
 * futura.
 */

import React from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { ToolEventLog } from './ToolEventLog.js';

export interface TuiProps {
  provider?: string;
  budget?: number;
}

export function Tui({ provider = 'opengravity', budget = 32000 }: TuiProps) {
  const app = useApp();

  useInput((_input, key) => {
    if (key.escape || (key.ctrl && _input === 'c')) {
      app.exit();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="red" paddingX={1}>
        <Text bold color="red">Shinobi 忍 </Text>
        <Text dimColor> provider={provider} budget={budget} tokens · ESC/Ctrl+C para salir</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold underline>Tool events</Text>
        <ToolEventLog />
      </Box>
    </Box>
  );
}
