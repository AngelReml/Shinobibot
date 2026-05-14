/**
 * Componente que se suscribe al toolEvents() bus y muestra los últimos N
 * eventos en una lista vertical con color por estado.
 *
 * Ink renderiza esto en cualquier terminal compatible con ANSI. Sin
 * scroll: si llegan más eventos que filas disponibles, los más viejos
 * se descartan.
 */

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { toolEvents, type ToolEvent } from '../coordinator/tool_events.js';

export interface ToolEventLogProps {
  maxEntries?: number;
}

export function ToolEventLog({ maxEntries = 15 }: ToolEventLogProps) {
  const [events, setEvents] = useState<ToolEvent[]>([]);

  useEffect(() => {
    const bus = toolEvents();
    const handler = (e: ToolEvent) => {
      setEvents(prev => {
        const next = [...prev, e];
        if (next.length > maxEntries) next.splice(0, next.length - maxEntries);
        return next;
      });
    };
    bus.on('tool_event', handler);
    return () => {
      bus.off('tool_event', handler);
    };
  }, [maxEntries]);

  if (events.length === 0) {
    return (
      <Box>
        <Text dimColor>Esperando tool events… (cualquier ejecución del orchestrator aparecerá aquí)</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {events.map((e, i) => (
        <ToolEventRow key={`${e.ts}-${i}`} event={e} />
      ))}
    </Box>
  );
}

function ToolEventRow({ event }: { event: ToolEvent }) {
  const time = event.ts.slice(11, 19); // HH:MM:SS
  if (event.kind === 'tool_started') {
    return (
      <Box>
        <Text color="cyan">[{time}] ▶ </Text>
        <Text bold>{event.tool}</Text>
        <Text dimColor> {event.argsPreview}</Text>
      </Box>
    );
  }
  // tool_completed
  const status = event.success ? '✓' : '✗';
  const color = event.success ? 'green' : 'red';
  return (
    <Box>
      <Text color={color}>[{time}] {status} </Text>
      <Text bold>{event.tool}</Text>
      <Text dimColor> ({event.durationMs}ms)</Text>
      {event.errorPreview ? <Text color="red"> {event.errorPreview}</Text> : null}
    </Box>
  );
}
