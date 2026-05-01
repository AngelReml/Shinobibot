# Documentación Shinobi — Sistema de Contexto Persistente

Este directorio existe para que cualquier sesión nueva (con cualquier IA, modelo o asistente) pueda leer un puñado de archivos y tener contexto absoluto del proyecto sin que Iván tenga que repetir nada.

## Orden de lectura recomendado para una IA nueva

1. `00_identity.md` — Quién es Iván, cómo trabaja, reglas operativas
2. `01_ecosystem.md` — Arquitectura real: Shinobi + OpenGravity + Comet + Kernel
3. `02_roadmap.md` — Roadmap por fases (Eje A producto, B capacidad, C visibilidad)
4. `03_state.md` — Estado actual: qué está hecho, qué está roto, qué viene después
5. `04_pending.md` — Pendientes técnicas conocidas con causa raíz
6. `05_decisions.md` — Decisiones arquitectónicas tomadas y razonadas
7. `sessions/` — Log cronológico de sesiones de trabajo (la más reciente arriba)

## Cómo se usa

- **Al empezar una sesión nueva:** la IA lee 00 → 05 y la última session.
- **Al cerrar una sesión:** se añade nueva entrada en `sessions/` con fecha.
- **Cuando se toma una decisión arquitectónica:** se añade en `decisions/` un archivo numerado.
- **Cuando se cierra una pendiente:** se mueve de `04_pending.md` a `sessions/` con fecha de resolución.

## Reglas para escritura

- Datos crudos, no marketing.
- Errores explícitos, no eufemismos.
- Decisiones con motivo, no solo resultado.
- Si algo está roto, decirlo. Si algo se asume, marcarlo.
