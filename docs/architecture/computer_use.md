# Computer Use Windows nativo — estado verificado

## Estado de las piezas

| Pieza | Compila | Smoke pasa | Demo viva | Notas |
|---|---|---|---|---|
| `src/tools/screen_observe.ts` | ✅ | ✅ | ⚠ pendiente del usuario | Captura PNG vía `@nut-tree-fork/nut-js` + describe vía Vision LLM (OpenRouter gemini-2.0-flash o OpenAI gpt-4o-mini fallback). |
| `src/tools/screen_act.ts` | ✅ | ✅ | ⚠ pendiente del usuario | click/double_click/right_click/move/type/press_key/hotkey/scroll. |
| `src/utils/screen_safety.ts` | ✅ | ✅ | n/a | Forbidden zones (taskbar 40px, System32, UAC, Windows Update, Control Panel). isDestructiveAction (Alt+F4, Ctrl+W, Delete, "rm -rf", "del /s", "format"). |
| `src/utils/kill_switch.ts` | ✅ | ✅ | ⚠ depende de PowerShell + GetAsyncKeyState | ESC ≥ 1s aborta el loop. start()/stop()/shouldAbort()/reset() estáticos. |

## Smoke test (esta sesión)

`src/tools/__tests__/screen_smoke.test.ts` — **PASS**. Verificado:

- Ambos tools importan sin errores (`@nut-tree-fork/nut-js` carga su native binding en este Windows).
- Ambos se registran con `name` correcto y `execute` función.
- Forbidden títulos rechazan System32 + UAC y permiten Notepad.
- Taskbar zone (y >= height-40) bloquea click; centro pantalla permite.
- Destructive detection: "rm -rf /" → bloquea, "hello world" → permite.
- KillSwitch class expone `start/stop/shouldAbort/reset` como static.

El smoke **NO** invoca `screen_observe.execute()` ni `screen_act.execute()` — eso movería el ratón / capturaría el escritorio real del usuario. Esa demo en vivo queda como verificación manual.

## Demo en vivo (acción manual mínima)

```sh
# 1. Abrir Notepad por la mano (el agente no debería abrirlo en este test).
# 2. Desde el repo:
cd C:\Users\angel\Desktop\shinobibot
npx tsx test_b9.ts
# 3. Observa que: hace screen_observe → describe Notepad → screen_act type "MELOCOTON_TEST_2026"
# 4. Verifica el archivo de salida en /tmp/screen_*.png (screenshot tomada).
# 5. Si muere a mitad, mantén ESC pulsado >=1s — la KillSwitch debe cortar.
```

Esto cierra P2.1 y P2.5 de la criba. Tarda ~30s. Requiere que tengas Notepad abierto y la sesión interactiva (no headless).

## Limitaciones conocidas

1. **`@nut-tree-fork/nut-js` requiere binding nativo Windows x64**. Linux/macOS técnicamente compilan pero las coordenadas y capture API divergen — NO testado fuera de Win11.
2. **Vision LLM cuesta dinero**. Cada `screen_observe` es 1 call a gemini-2.0-flash (~$0.0001) o gpt-4o-mini (~$0.0005). 100 observaciones/día ≈ centavos.
3. **KillSwitch depende de PowerShell + Win32 GetAsyncKeyState**. En sandboxed envs (Docker, WSL) no funciona.
4. **Forbidden zones son heurísticas**, no garantía. Apps con ventanas a pantalla completa que ocultan la taskbar pueden burlar el check de bottom 40px.
5. **No hay UI Automation tree** — todo es vision-based. Para apps con UI dinámica (web embedded) la precisión depende del modelo de visión.

## Promoción de estado

Pre-sesión: **AMARILLO** (build presente, sin demo en vivo).
Post-sesión: **VERDE-PARCIAL** (smoke pasa; demo viva queda en `manual_actions.md` como check de 30s del usuario).

## Para promocionar a VERDE completo

Falta una sola cosa: que Iván corra el script de demo viva una vez, grabe (con OBS o no), y deje un screenshot del resultado en `docs/sessions/`. Ese commit sella la fila a VERDE.
