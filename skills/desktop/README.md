# Shinobi desktop skills (Windows-native)

Bundles `agentskills.io`-compatible para automatización de aplicaciones de escritorio Windows. Cada skill es un directorio con `SKILL.md` + `scripts/skill.mjs` (entry Node, registerTool) + `scripts/<helper>.ps1` o COM/UI Automation.

| Skill | Requiere | Notas |
|---|---|---|
| `desktop-excel-open-and-extract` | MS Excel instalado (COM Automation) | abre `.xlsx`, lee rango, devuelve JSON |
| `desktop-outlook-send-email` | MS Outlook configurado | compone + envía sin UI |
| `desktop-premiere-basic-cut` | Premiere Pro + ExtendScript Toolkit | corte básico via `.jsx` |
| `desktop-obs-setup-scene` | OBS + obs-websocket plugin | crea/configura escena |
| `desktop-photoshop-resize-export` | Photoshop + ExtendScript | resize y export `.jpg` |
| `desktop-chrome-login-and-action` | Chrome instalado | DevTools Protocol vía CDP, reusa perfil del usuario |

## Install

```sh
# copia los bundles a %APPDATA%/Shinobi/agentskills/
node scripts/install_desktop_skills.mjs
```

(en `--dry-run` por defecto; pasa `--apply` para escribir).

## Test de carga

```sh
npx tsx scripts/desktop_skills_lint.ts
```

No invoca las apps (no requiere software instalado): valida que cada bundle tenga `SKILL.md` válido + `scripts/skill.mjs` con `registerTool`.

## Ejecución real

Las skills sólo funcionan con el software correspondiente instalado y configurado. Ver cada `SKILL.md` para prerequisitos. Hay TODOs en `docs/manual_actions.md` para verificarlas en máquina con todo instalado.
