# Shinobi 忍

![versión](https://img.shields.io/badge/versión-1.0.0-8B2C20)
![plataforma](https://img.shields.io/badge/Windows-10%2F11-2C2C2C)
![licencia](https://img.shields.io/badge/licencia-ISC-9E9589)

> *an agent that works in silence.*

Shinobi es un agente personal **Windows-nativo**. Recibe una misión, desaparece, y
vuelve con el trabajo hecho. No es un chatbot ni un wrapper: ejecuta acciones
reales en tu máquina —archivos, shell, un navegador de verdad— y deja **rastro**
de todo lo que hace.

Su promesa cabe en una línea: **extensión de ti mismo, todo local, todo tuyo.**

---

## Qué hace, comprobado

Lo de esta sección está verificado funcionando en vivo, no prometido.

**Navega la web de verdad.** Conduce Chrome/Comet por CDP con tus sesiones
abiertas. Entra en una página, extrae sus datos y mapea sus elementos
interactivos con refs estables para pulsarlos o rellenarlos.
*Comprobado:* extrajo la portada de Hacker News con puntos y comentarios reales y
calculó los ratios; mapeó los 17 elementos interactivos de una página.

**Ejecuta código y se corrige.** Escribe y corre Python, Node y PowerShell;
instala dependencias que falten; ante un fallo, diagnostica la causa y reintenta.
*Comprobado:* generó un dataset, detectó anomalías por z-score y reportó
precisión y recall reales.

**Lee y razona sobre código.** Recorre un repositorio y cita el código real, con
sus líneas, para fundamentar lo que afirma.
*Comprobado:* auditó su propio código y pegó fragmentos verbatim verificables.

**Orquesta un enjambre.** Descompone una misión en sub-agentes que corren en
paralelo, cada uno aislado, y consolida el resultado.
*Comprobado:* tres sub-agentes concurrentes analizando ficheros distintos.

**El candado.** Pausa solo donde debe: secretos, dinero, destrucción irreversible
y la primera vez que el navegador pisa un host nuevo. El resto lo ejecuta sin
preguntar. La pausa nunca grita.
*Comprobado:* disparó en los casos sensibles y respetó la decisión del operador.

**No se atasca.** Un detector de bucles de tres capas corta la repetición sin
progreso, pero distingue "reintento que no avanza" de "el mundo cambió entre
llamadas" (editaste un fichero, navegaste) y deja progresar lo legítimo.

**Contexto por conversación.** Cada misión tiene su propio hilo de memoria; no
arrastra el contexto de la anterior. Multi-proveedor con failover transparente
(OpenAI · Anthropic · Groq · OpenRouter) y un contador de tokens visible.

**El dojo (WebChat).** Una interfaz fiel al manual de marca: antesala de entrada,
modos día/noche (Hiru/Yoru), panel de Rastro en vivo, paleta de comandos,
ajustes y búsqueda dentro de todas las misiones.

## Qué incluye

Además de lo anterior, el agente trae **50 herramientas nativas** y **19
comandos** de operador:

- **Sistema** Windows-nativo: portapapeles, procesos, info de sistema, disco,
  variables de entorno (con redacción automática de secretos), red, registro
  (con allowlist), tareas programadas, notificaciones toast.
- **Skills firmadas** (SHA256 + procedencia): cuando una misión se repite, Shinobi
  la forja como skill y la verifica al cargar.
- **Memoria persistente** con citas (id + score) y un reflector que la cura.
- **Rastro auditable**: cada tool-call queda en `audit.jsonl` (cadena verificable).
- **Comité** multi-modelo para decisiones críticas, **self-debug** heurístico,
  **replay** de misiones, **A2A** (agente-a-agente), **modo VPS** aislado,
  **STT local** y **misiones residentes** con scheduler (interval/daily/weekly/cron).

## Cómo se opera

Requisitos: Windows 10/11 · Node.js 20+ · Chrome o Comet con
`--remote-debugging-port=9222` · al menos una API key de LLM.

```bash
git clone https://github.com/AngelReml/Shinobibot shinobibot
cd shinobibot
npm install
cp .env.example .env      # añade tu API key
npm run dev               # abre el dojo en http://localhost:3333
```

O usa el binario: `build/shinobi.exe` (o el instalador `build/ShinobiSetup-<version>.exe`).

Comandos del operador (los 19, vía `/` en el dojo o la CLI):

| Comando | Hace |
|---|---|
| `/mode local·kernel·auto` | Modo de ejecución |
| `/model [auto·list·<nombre>]` | Modelo activo |
| `/approval on·smart·critical·off` | El candado |
| `/memory recall·store·stats…` | Memoria persistente |
| `/skill list·approve·install…` | Skills |
| `/read <ruta>` | Analiza un codebase |
| `/committee` · `/improvements` · `/apply <id>` | Comité y mejoras |
| `/learn <url·ruta>` | Aprende una tool o librería |
| `/resident start·stop·add` | Misiones en segundo plano |
| `/ledger verify·export` | Verifica la cadena de misiones |
| `/sentinel` · `/notify` · `/doc` · `/replay` · `/record` · `/self` | Vigilancia, n8n, documentos, replay, OBS, auto-informe |

## Estado actual

**v1.0.0.** El núcleo de arriba está sólido y comprobado. Con honestidad, lo que
queda por delante —sin adornos:

- **Cablear los motores E5/E8** (best-of-N, governor de runtime) al orchestrator
  — existen como módulos, falta enchufarlos. Ver `DECISIONES.md`.
- **Verificación en Windows**: `npm run typecheck` y `npm test` corren en tu
  máquina (el toolchain usa binarios nativos).
- **Benchmark público comparado**: el plan vive en `ROADMAP_FRONTERA_2026.md` y
  `PLAN_SOMBRA_2026.md`.

### Cerebros: arranca sin configurar nada

Shinobi viene con una **key de Groq compartida** ya puesta: lo descargas, lo
arrancas y funciona, sin pelearte con API keys. Es deliberado — el coste de
entrada debe ser cero.

Cuando quieras más músculo, conéctalo a **otro cerebro** sin fricción: un modelo
**local** (Ollama, LM Studio, llama.cpp por su URL OpenAI-compatible) o
**cualquier proveedor** (OpenAI, Anthropic, OpenRouter, Groq propio). Lo dices y
Shinobi se conecta; si una llamada falla, hace **failover** transparente a la
siguiente. La key compartida es solo el primer escalón, no una atadura.

## Documentación

`ARCHITECTURE.md` (diseño y flujo) · `CLAUDE.md`/`AGENTS.md` (entrada para una IA,
autogenerados) · `ROADMAP_FRONTERA_2026.md` · `DECISIONES.md` (log append-only) ·
`SHINOBI_Manual_de_Marca.docx` (la identidad y su porqué) · `SECURITY.md`.

## Aviso

Shinobi ejecuta acciones reales en tu sistema. El candado (`/approval`) frena lo
irreversible, pero la responsabilidad de operarlo es tuya.

## Licencia

ISC · parte del ecosistema ZapWeave.

<sub>忍 — la selva no duerme. Solo guarda silencio.</sub>
