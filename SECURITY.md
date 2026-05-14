# Security Policy

Shinobi es un agente autónomo con capacidad de ejecutar comandos, leer/escribir
ficheros y automatizar la interfaz de Windows. Cualquier vulnerabilidad puede
traducirse en ejecución arbitraria sobre la máquina del usuario. Tomamos esto en
serio.

## Versiones soportadas

| Versión   | Soporte       |
| --------- | ------------- |
| `main`    | ✅ activa     |
| Releases `>=1.0.0` | ✅ últimos 6 meses |
| Anteriores | ❌ sin parches |

Si reportas un fallo en una versión vieja, la fix se publica en la rama `main`.
No backporteamos parches a releases anteriores salvo críticos (CVSS ≥ 9).

## Cómo reportar

**No abras un issue público para vulnerabilidades.** Eso publica el detalle
antes de tener un parche.

Manda un correo a **calycharlie@gmail.com** con el asunto `[SECURITY] <titulo>`,
o usa la [GitHub Security Advisory privada](https://github.com/AngelReml/Shinobibot/security/advisories/new)
del repositorio.

Incluye:
- Versión afectada (commit hash si es `main`).
- Reproducción mínima: comandos, mensajes, configuración relevante.
- Impacto esperado (RCE local, exfil, escalation, DoS, etc.).
- Tu propuesta de mitigación si la tienes.

## Tiempos de respuesta

- **Acuse de recibo:** dentro de 48h hábiles.
- **Triage inicial:** dentro de 7 días naturales.
- **Parche o workaround público:** según severidad:
  - CVSS ≥ 9 (crítico): 7 días.
  - CVSS 7–8 (alto): 30 días.
  - CVSS 4–6 (medio): 60 días.
  - CVSS < 4 (bajo): 90 días.

Si la respuesta se retrasa, asumimos que el reporte sigue siendo válido — no lo
cerramos sin confirmación contigo.

## Alcance

### Dentro del alcance

- Ejecución arbitraria de comandos vía `run_command`, `task_scheduler_create` u
  otras tools que aceptan strings del LLM.
- Bypass de la blacklist destructiva (`Stop-Process`, `kill`, `taskkill`,
  `wmic process`, `pkill`, `killall`, `rm -rf`, `rmdir /s`, `format`, `del /f`).
- Bypass del sandbox de cwd (path traversal fuera de `WORKSPACE_ROOT`).
- Exfiltración de secretos vía `env_list` (la redacción de
  `key|token|secret|password|credential|auth|api_*` debe ser efectiva).
- Bypass de la allowlist de `registry_read` (hives no contempladas
  `HKLM:|HKCU:|HKCR:|HKU:|HKCC:`).
- Manipulación de skills firmadas sin que `verifySkill` lo detecte (`hash_mismatch`
  o `missing_signature` debe disparar siempre que se altere el contenido).
- Inyección de prompt que evada el loop detector v2 (capa de args + capa
  semántica) durante más de 5 iteraciones.
- Cualquier vulnerabilidad clásica (RCE, SSRF, path traversal, XSS en el
  WebChat, prototype pollution, etc.) en el código del repo.

### Fuera del alcance

- Vulnerabilidades en dependencias upstream sin reproducción concreta en
  Shinobi (reportar al proyecto upstream primero).
- Configuraciones explícitamente inseguras documentadas como tales
  (`SHINOBI_AUDIT_DISABLED=1`, `WORKSPACE_ROOT=/`).
- Ataques que requieren acceso físico previo a la máquina.
- Social engineering del operador.
- DoS por consumo de tokens del LLM (los providers tienen sus propios límites).
- Comportamiento del modelo LLM que no involucre tools (alucinación,
  respuestas inadecuadas — esos van como issue normal).

## Hardening defensivo en producción

Mientras se procesa tu reporte, el operador puede:

- Pasar a `SHINOBI_PROVIDER=opengravity` y dejar `SHINOBI_FAILOVER_CHAIN`
  vacío para minimizar superficie de attacker-controlled keys.
- Mantener el repo en una cuenta de usuario sin admin (evita escalada).
- Vigilar `audit.jsonl` (`SHINOBI_AUDIT_LOG_PATH`) para detectar `loop_abort`
  y `failover` inesperados.
- Mantener `WORKSPACE_ROOT` apuntando a un directorio sin secretos.

## Reconocimiento

Mantenemos una **Hall of Fame** en el README para reportes válidos que llevan
a un parche. Si quieres aparecer público (nick + link opcional), dilo en el
reporte. Si prefieres anonimato lo respetamos.

Por ahora no hay bug bounty monetario, pero estamos abiertos a discutirlo si
encuentras algo de impacto serio.
