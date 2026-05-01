# Mission Schema — Shinobi Eje B Fase 0

## Propósito
Define la estructura mínima de una misión autónoma que Shinobi puede recibir, ejecutar, y de la que puede pivotar o escalar al humano cuando se atasca.

## Schema

```typescript
interface Mission {
  id: string;                    // UUID v4
  objective: string;             // Objetivo en lenguaje natural
  agents_deployed: string[];     // Roles desplegados (vacío si solo orchestrator)
  permissions: {
    file_write: boolean;
    network: boolean;
    shell: boolean;
    browser_dom: boolean;
  };
  max_attempts: number;          // Default: 3
  current_attempts: number;      // Incrementa con cada fallo
  failed_strategies: string[];   // Estrategias que ya fallaron, para no repetir
  pivot_strategy: 'regenerate_plan' | 'change_agent' | 'escalate_human';
  human_escalation_required: boolean;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'awaiting_human';
  created_at: number;
  updated_at: number;
}
```

## Reglas de pivot

1. Intento 1 falla → registra `failed_strategy`, retry con misma estrategia
2. Intento 2 falla → registra `failed_strategy`, regenera plan evitando estrategias fallidas
3. Intento 3 falla → cambia de agente o estrategia raíz
4. Intento 4-5 falla → escala al humano, status `awaiting_human`

## Reglas de escalado humano

Acciones que SIEMPRE requieren confirmación humana antes de ejecutar:
- Compras o transacciones financieras
- Envío de mensajes a personas reales (LinkedIn, email, Slack)
- Eliminación irreversible de archivos o registros
- Modificación de credenciales o permisos
- Publicación de contenido público

## Estado actual de implementación

- Schema documentado: SÍ
- Schema implementado en código: NO (Fase 1 Eje B)
- Pivot automático: NO (Fase 1 Eje B)
- Test de bucle: SÍ, en `scripts/loop_detection_test.ts`
