# Sesión de Desarrollo: Bloque 5 Fase C — Integración Skills en Shinobi con Revisión Humana
**Fecha:** 2026-05-02

## Componentes Creados

### Tools Nuevas en Shinobi
- **`skill_list`** (`src/tools/skill_list.ts`): Lista skills del catálogo de OpenGravity. Filtrable por status.
- **`request_new_skill`** (`src/tools/skill_request_generation.ts`): Solicita a OpenGravity la generación de una skill nueva via LLM. El resultado queda en el catálogo pero NO se carga automáticamente.

### SkillLoader (`src/skills/skill_loader.ts`)
- **`approveAndLoad(skillId)`**: Descarga código de OpenGravity, verifica que el status sea `verified` o `promoted`, transforma TS→JS (regex naive), guarda como `.mjs` en `%APPDATA%/Shinobi/approved_skills/`, y ejecuta `import()` dinámico.
- **`listApprovedFiles()`**: Lista los archivos `.mjs` aprobados localmente.
- **`reloadAllApproved()`**: Re-carga todas las skills aprobadas al iniciar Shinobi.

### Comandos CLI `/skill`
- `/skill list` — Lista skills del catálogo remoto.
- `/skill approve <id>` — Descarga, transforma y carga una skill verified.
- `/skill list-approved` — Lista skills aprobadas localmente.
- `/skill reload` — Re-carga todas las skills aprobadas.

### Auto-carga al Arrancar
En `scripts/shinobi.ts`, se invoca `SkillLoader.reloadAllApproved()` antes del bucle principal del CLI. Las skills aprobadas en sesiones anteriores se restauran automáticamente.

## Seguridad: Revisión Humana Obligatoria
- **NUNCA** se carga código en runtime sin que el humano ejecute `/skill approve <id>`.
- El LLM puede sugerir usar una skill nueva, pero la decisión final es humana.
- Skills con status `unverified` o `rejected` son **rechazadas** por el loader.

## Output Literal del Test

```text
--- B5 FASE C TEST ---

T1: tool skill_list
  success: true
  verified skills: 5
  T1: PASSED

T2: tool request_new_skill
  output: Skill generated successfully. ID: skill_6fbe4a8c9ddfddbb. Name: reverse_string. Status: unverified.
    Lint: true, Compile: false, Sandbox: false.
    The user must run "/skill approve skill_6fbe4a8c9ddfddbb" to enable it. The skill is NOT yet usable.
  T2: PASSED

T3: aprobar y cargar skill verified
  intentando cargar: skill_ac2ca91a3f5a435c (extract_emails)
  message: skill extract_emails loaded and registered
  T3: PASSED

T4: tool dinámica visible en registry
  total tools: 17
  found extract_emails: true
  T4: PASSED

T5: ejecutar tool dinámica
  exec success: true
  exec output: {"emails":["test@example.com"]}
  T5: PASSED

T6: bloqueo de carga si status != verified
  message: Refusing to load skill with status 'unverified'. Only 'verified' or 'promoted' are loadable.
  T6: PASSED

--- ALL DONE ---
```

## Limitaciones Conocidas
- El transformador TS→JS es naive (regex). Skills con anotaciones de tipo complejas (genérics anidados, interfaces inline) pueden requerir mejora futura o uso de `tsx` directamente.
- La deduplicación de skills (misma skill aprobada en múltiples sesiones) no se gestiona — se re-registra sin error, pero no es un problema funcional.

## Pendientes
- Bloque 6+ según roadmap.
- Mejora opcional del transformador TS→JS si se encuentran skills que fallen.
