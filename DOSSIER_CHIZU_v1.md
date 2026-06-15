# DOSSIER TÉCNICO — SUBSISTEMA CHIZU
## Shinobi · Nivel 3: el cartógrafo — reconocimiento y mapa de la máquina
### v1 · documento de arquitectura para ejecución por Claude Code

---

## 0. Cómo leer este dossier

Mismas convenciones que Kagemusha (N1) y Kagami (N2):

- **⚠ ENGANCHE** — conexión a algo que ya existe; Claude Code verifica la firma real antes de cablear. Reutilizar, no duplicar.
- **✚ NUEVO** — código nuevo bajo `src/chizu/`. Aditivo, gated (`CHIZU_ENABLED`, default off).
- **□ GATE** — criterio de "hecho" verificable por CLI cruda.

Sin tiempos. Pasos pequeños.

Principio rector del Nivel 3: **el ninja reconoce el terreno antes de pisarlo.** Chizu no actúa sobre los programas (eso es el Nivel 4); los **cartografía**. Y lo hace con una regla de oro: el mapa solo contiene lo que verificó existir. No infiere programas "que probablemente están", no clasifica por corazonada. Un mapa que se inventa una calle te lleva al precipicio; este mapa solo dibuja lo que pisó.

---

## 1. Resumen conceptual

**Chizu** (地図, el mapa) es el subsistema por el que Shinobi, al desembarcar en una máquina, produce su **retrato fiel**: qué programas hay, cuáles se usan de verdad, cuáles se pueden automatizar y por qué vía, cuáles se pueden sondear sin riesgo y cuáles no se tocan. Es el cimiento sobre el que cuelgan el Nivel 4 (el Explorador, que aprende a usar los programas) y el Nivel 5 (el Mayordomo, que ejecuta tareas cross-app). Sin un buen mapa, el Explorador exploraría a ciegas y el Mayordomo daría órdenes sobre territorio desconocido.

Es, como dice el Dojo, la victoria visual temprana: lanzas Shinobi y te devuelve el retrato de tu propia máquina como no la habías visto. Pero "fácil" no es "trivial": un mapa fiel exige fusionar fuentes que se contradicen, cribar uso real de ruido, y —lo más delicado— distinguir lo que se puede tocar sin miedo de lo que es una bomba.

### 1.1 Las dos profundidades (distinción central del Nivel 3)

Chizu trabaja en dos profundidades, y la frontera entre ellas es la frontera de seguridad de todo el subsistema:

- **Mapeo estático (read-only, 100% seguro).** Descubrir, rankear por uso, y caracterizar **sin ejecutar** ningún programa: leer el registro, los ficheros, los metadatos, el conocimiento previo. Esto es el núcleo del Nivel 3 y no toca nada del sistema. Es lo "fácil-divertido".
- **Sondeo dinámico (requiere ejecutar → gated y en sandbox).** Para afinar la caracterización (sobre todo "¿tiene árbol de accesibilidad usable?"), lanzar el programa en sandbox, capturar su árbol de UI inicial, cerrarlo. Esto **ya roza el Nivel 4** y por eso va gated, sandboxeado y con efectos declarados. Chizu hace solo un sondeo **ligero** (mirar, no aprender a usar).

El mapa estático es el entregable del Nivel 3. El sondeo dinámico es una capa opcional que prepara el terreno para el Explorador.

---

## 2. Principios de diseño

1. **Solo-lectura primero.** El núcleo de Chizu no ejecuta nada: lee registro, ficheros y metadatos. Es inherentemente seguro. El sondeo dinámico (que sí ejecuta) es una capa aparte, gated y en sandbox.

2. **No inventar lo no verificado.** Una entrada en el mapa existe solo si una **fuente real** la descubrió. Nada de "este tipo de máquina suele tener X". La honestidad del dojo aplicada al territorio: el mapa refleja lo que hay, no lo que cabría esperar.

3. **Multi-fuente con fusión honesta.** Ninguna fuente de descubrimiento es completa (el registro pierde portables; los accesos directos pierden lo sin lanzador). Se combinan varias y se deduplica por identidad canónica. Cuando dos fuentes discrepan, se registra la discrepancia, no se elige en silencio.

4. **El riesgo alimenta el approval gate.** La clasificación de peligrosidad no es decorativa: ⚠ ENGANCHE, un programa que Chizu marca como alto riesgo (banca, contabilidad, comunicación, sistema) se convierte en **recurso protegido** del approval gate existente. El mapa no solo informa; arma la defensa del Nivel 4/5.

5. **Por-OS sin acoplar.** Shinobi corre en Windows local (el PC de Iván) y en VPS Linux. Chizu se diseña con adaptadores por OS (Windows primario, macOS/Linux detrás de la misma interfaz). El núcleo es agnóstico; las fuentes son específicas.

6. **Procedencia en cada dato.** Cada campo del mapa lleva de qué fuente salió y cómo se midió. Un "uso alto" dice si vino de UserAssist o de observación en vivo; una "automatizable por CLI" dice si se confirmó con `--help` en sandbox o se infirió de conocimiento previo.

7. **Aditivo, gated, no-duplicar.** Todo bajo `src/chizu/`, flag off por defecto. Reutiliza sandbox/Sello, approval gate, swarm, store, CDP. No reescribe nada.

---

## 3. Inventario de lo existente reutilizado

| Subsistema existente | Chizu lo usa para | Regla |
|---|---|---|
| Sello / sandbox | Lanzar programas en aislamiento para el sondeo dinámico ligero. | ⚠ Reutiliza el sandbox; no monta otro aislamiento. |
| `src/integrity` (Capa 2, procedencia) | Procedencia por dato del mapa; gating del sondeo dinámico. | ⚠ Hereda el modelo de procedencia. |
| Approval gate selectivo | Recibe los programas de alto riesgo como recursos protegidos. | ⚠ Chizu **extiende** la política del gate; no crea otra. |
| `agent_loop` / Team (swarm) | Paralelizar el sondeo de muchos programas. | ⚠ Chizu define tareas; el swarm las corre. |
| CDP / browser | Para navegadores, marca que Shinobi ya los maneja por CDP (no necesitan UIA). | ⚠ Reutiliza el conocimiento del browser layer. |
| `src/memory` (store SQLite) | Persistir el Atlas y su histórico. | ⚠ Tablas nuevas en el store existente. |
| **Kagami (N2)** | El Atlas alimenta el auto-conocimiento: "qué herramientas tengo disponibles" es parte de la frontera. | ⚠ Chizu publica el inventario; Kagami lo consume. |
| Subproceso runner | Ejecutar `reg query`, `Get-AppxPackage`, `winget list`, parseo de .pf, etc. | ⚠ Usa el runner de subprocesos existente. |

**Antes de cada ⚠ ENGANCHE, abrir el módulo real y confirmar la firma.** El repo manda en la forma.

---

## 4. Arquitectura general

### 4.1 Las cuatro fases

```
   ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐   ┌──────────┐
   │ DISCOVERY    │ → │ USAGE        │ → │ CHARACTERIZATION │ → │ ATLAS    │
   │ ¿qué hay?    │   │ ¿cuánto se   │   │ ¿cómo es cada    │   │ el mapa  │
   │ (read-only)  │   │ usa?         │   │ uno? (estático + │   │ + render │
   │              │   │ (read-only)  │   │ sondeo gated)    │   │ visual   │
   └──────┬───────┘   └──────┬───────┘   └────────┬─────────┘   └────┬─────┘
          │                  │                    │                  │
          └──────────────────┴────────────────────┴──────────────────┘
                                     │
                   ┌─────────────────▼──────────────────┐
                   │ ALMACÉN (src/chizu/store)           │
                   │ AppCard[] · fuentes · señales ·     │
                   │ caracterización · procedencia       │
                   └─────────────────┬──────────────────┘
                                     │
                   ┌─────────────────▼──────────────────┐
                   │ INTEGRIDAD + APPROVAL GATE          │
                   │ procedencia · sondeo gated ·        │
                   │ riesgo → recurso protegido          │
                   └─────────────────────────────────────┘
```

### 4.2 Flujo

1. **DISCOVERY** — múltiples fuentes (read-only) enumeran programas; se fusionan y deduplican en `AppCard` provisionales.
2. **USAGE** — señales de uso (read-only) puntúan cada AppCard; se criba el ranking.
3. **CHARACTERIZATION** — por cada AppCard: caracterización estática (read-only) siempre; sondeo dinámico (gated/sandbox) para los candidatos jugosos donde el árbol de UI importa.
4. **ATLAS** — se consolida el mapa, se prioriza (candidatos para el Nivel 4), se renderiza visual, y los de alto riesgo se publican al approval gate.

La línea de seguridad: fases 1, 2 y la parte estática de la 3 no ejecutan nada. Solo el sondeo dinámico de la 3 ejecuta, y va aislado.

---

## 5. Modelo de datos

Tablas nuevas en el store SQLite existente (⚠ confirmar migrador real). Idempotentes.

### 5.1 La ficha de aplicación

```ts
interface AppCard {
  app_id: string;                 // identidad canónica (hash de exe_path normalizado)
  display_name: string;
  publisher?: string;
  version?: string;
  install_location?: string;
  primary_executable?: string;    // exe principal resuelto
  install_type: "registry" | "store_msix" | "package_manager"
              | "portable" | "shortcut_only" | "unknown";
  discovered_by: DiscoverySource[]; // todas las fuentes que lo vieron (multi)
  usage: UsageSignal;
  characterization: Characterization;
  category: AppCategory;
  risk: RiskClass;
  automation_candidate_score: number; // 0..1, para priorizar el Nivel 4
  provenance: Provenance;
  mapped_at: string;
}

type AppCategory =
  | "browser" | "office" | "design" | "dev" | "emulator" | "media"
  | "communication" | "finance" | "system" | "game" | "utility" | "other";
```

### 5.2 Descubrimiento

```ts
interface DiscoverySource {
  source: "registry_uninstall" | "registry_apppaths" | "start_menu"
        | "appx" | "winget" | "choco" | "scoop" | "path_scan" | "programfiles_scan";
  raw_name: string;               // como lo vio esa fuente
  raw_path?: string;
  confidence: number;             // qué tan fiable es la identidad desde esa fuente
}
```

### 5.3 Uso

```ts
interface UsageSignal {
  run_count?: number;             // de UserAssist / Prefetch
  last_used?: string;
  recency_days?: number;
  usage_score: number;            // 0..1, frecuencia × recencia, normalizado
  signal_sources: ("userassist" | "prefetch" | "jumplist" | "live_sample")[];
}
```

### 5.4 Caracterización

```ts
interface Characterization {
  // ¿automatizable por API/CLI? (robusto)
  cli: { available: boolean | "unknown"; evidence: "help_probe" | "known_db"
        | "com_registered" | "none"; notes?: string };
  com_automation: boolean | "unknown";  // expone COM/ProgID
  scripting_sdk: boolean | "unknown";   // SDK/extensiones/scripting

  // ¿automatizable por UI? (frágil) — del sondeo dinámico
  uia: { class: "rich" | "poor" | "opaque" | "unprobed";
         control_count?: number; named_ratio?: number };

  // ¿sandboxeable?
  sandbox: { portable: boolean | "unknown"; needs_install: boolean | "unknown";
             needs_network: boolean | "unknown"; needs_login: boolean | "unknown";
             verdict: "easy" | "hard" | "unsafe" | "unknown" };
}
```

`cli.available` y `uia.class` son los dos campos que el Nivel 4 mirará primero: dicen si un programa se automatiza por la vía robusta (CLI/COM) o por la frágil (UI), o si directamente es opaco.

### 5.5 Riesgo

```ts
interface RiskClass {
  level: "safe" | "caution" | "dangerous" | "forbidden";
  reasons: string[];              // "financial", "irreversible_data",
                                  // "sends_on_your_behalf", "system_admin"
  becomes_protected_resource: boolean; // si true → se publica al approval gate
}
```

- **safe**: sondear y automatizar sin fricción (editor de texto, visor).
- **caution**: automatizable con verificación extra (escribe ficheros del usuario).
- **dangerous**: requiere aprobación explícita por acción (finanzas, comunicación, borrado).
- **forbidden**: no se toca ni se sondea (banca, herramientas de sistema críticas). → recurso protegido.

El Atlas no decide solo el nivel; las reglas son explícitas y auditables (§8.4), y los `dangerous`/`forbidden` se publican al approval gate.

### 5.6 Procedencia (reutilizada)

Cada `AppCard` y cada campo sensible (uso, riesgo, automatizabilidad) lleva la `Provenance` del dojo: de qué fuente salió y cómo se midió. Un campo `cli.available = true` con `evidence: "known_db"` (conocimiento previo) es menos fuerte que con `evidence: "help_probe"` (confirmado ejecutando `--help` en sandbox), y el mapa lo dice.

---

## 6. Subsistema Discovery — ¿qué hay? (read-only)

Ninguna fuente es completa; el arte está en combinarlas y deduplicar honestamente. Adaptadores por OS bajo una interfaz común.

### 6.1 ✚ NUEVO `src/chizu/discovery/`

```ts
interface DiscoveryAdapter {
  source: DiscoverySource["source"];
  enumerate(): Promise<RawApp[]>;   // read-only, no ejecuta programas
}
interface RawApp { raw_name: string; raw_path?: string; meta: Record<string,string>; }
```

### 6.2 Fuentes Windows (en detalle)

Cada una es un adaptador. Todas read-only.

- **registry_uninstall** — las tres ramas Uninstall:
  `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*`,
  `HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*` (apps 32-bit en SO 64-bit),
  `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*` (instaladas por usuario).
  Campos: `DisplayName`, `DisplayVersion`, `Publisher`, `InstallLocation`, `DisplayIcon` (a menudo apunta al exe), `EstimatedSize`. □ GATE: enumera con nombre+versión+publisher las apps instaladas vía MSI/instalador.
- **registry_apppaths** — `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\*`: ejecutables registrados con su ruta. Bueno para resolver el exe principal. □ GATE: resuelve el exe de apps conocidas (p.ej. el navegador).
- **start_menu** — `.lnk` en `%ProgramData%\Microsoft\Windows\Start Menu\Programs` y `%APPDATA%\Microsoft\Windows\Start Menu\Programs`. Resolver cada acceso directo a su target (exe). Pilla cosas que el registro no. □ GATE: lista apps con shortcut, con target resuelto.
- **appx** — apps de la Store/MSIX: `Get-AppxPackage` (PowerShell) → nombre, publisher, InstallLocation, PackageFamilyName. Estas **no** tienen exe clásico; se lanzan por protocolo/AppID. □ GATE: lista apps de la Store con su PackageFamilyName.
- **winget / choco / scoop** — gestores de paquetes si están: `winget list`, `choco list --local-only`, `scoop list`. Dan nombre+versión canónicos. □ GATE: si winget está, su salida se parsea a RawApp.
- **path_scan** — ejecutables en directorios del `PATH` (herramientas de línea de comandos que no aparecen en otras fuentes: git, python, node…). □ GATE: detecta herramientas CLI del PATH.
- **programfiles_scan** — barrido de `C:\Program Files`, `C:\Program Files (x86)`, `%LOCALAPPDATA%\Programs`: pilla **portables** y apps no registradas (carpetas con un .exe principal). □ GATE: detecta un portable suelto que ninguna otra fuente ve.

### 6.3 Fusión y deduplicación

```ts
function fuse(raws: { source: DiscoverySource["source"]; apps: RawApp[] }[]): AppCard[];
```

- Identidad canónica: ruta normalizada del **ejecutable principal** (resuelto desde DisplayIcon / App Paths / shortcut target / barrido), más nombre normalizado como respaldo cuando no hay exe (apps Store).
- Una misma app vista por N fuentes → **una** `AppCard` con `discovered_by` = todas. Multi-fuente sube la confianza de identidad.
- Discrepancias (dos versiones, dos rutas) → se registran en la card, no se ocultan.
- □ GATE Discovery: el conjunto fusionado no duplica (una app instalada por MSI con shortcut y en winget aparece **una** vez con tres fuentes); un portable sin registro aparece (vía programfiles_scan); cero entradas inventadas.

### 6.4 macOS/Linux (detrás de la misma interfaz, posterior)

- macOS: `/Applications`, `mdfind`, `system_profiler SPApplicationsDataType`, Homebrew.
- Linux: `.desktop` en `/usr/share/applications` y `~/.local/share/applications`, gestores de paquetes (dpkg/rpm/flatpak/snap), ejecutables del PATH.
No bloquean el Nivel 3 en Windows; son adaptadores adicionales.

---

## 7. Subsistema Usage — ¿cuánto se usa? (read-only)

Cribar lo que importa del ruido. Windows guarda varias huellas de uso; se combinan.

### 7.1 ✚ NUEVO `src/chizu/usage/`

- **userassist** — `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\UserAssist\{GUID}\Count`. Entradas con **nombre ROT13** que contienen, en su estructura binaria, **run count** y **last execution time**. Es la fuente clásica de "programas más ejecutados por este usuario". Hay que decodificar ROT13 el nombre y parsear el blob binario. □ GATE: produce run_count + last_used para apps lanzadas por el usuario.
- **prefetch** — `C:\Windows\Prefetch\*.pf` (si accesible; a veces requiere privilegios): nombre del ejecutable, run count, y hasta 8 timestamps de ejecución. Complementa UserAssist para procesos no lanzados desde el shell. □ GATE: si accesible, aporta señal de uso de ejecutables.
- **jumplist / recentapps** — `HKCU\...\Explorer\...\RecentApps` y AutomaticDestinations (jump lists) para recencia. □ GATE: aporta recencia.
- **live_sample** (opcional) — muestrear procesos en ejecución durante una ventana (read-only sobre la tabla de procesos). Útil para validar/actualizar. □ GATE: una muestra detecta los procesos activos.

### 7.2 Scoring de uso

```ts
function scoreUsage(signals: Partial<UsageSignal>): number; // 0..1
```

`usage_score` = combinación normalizada de frecuencia (run_count) y recencia (decae con recency_days). Multi-señal: si UserAssist y Prefetch coinciden, sube la confianza. Un programa **muy usado pero sin shortcut en el escritorio** debe rankear alto (UserAssist lo pilla aunque "esté escondido"). □ GATE Usage: el top-N por usage_score coincide con lo que el usuario realmente vive; un programa instalado pero nunca usado queda al fondo.

---

## 8. Subsistema Characterization — ¿cómo es cada uno?

El subsistema más detallado, porque es el que da valor al Nivel 4. Caracterización **estática** (read-only) siempre; **sondeo dinámico** (gated/sandbox) solo para candidatos.

### 8.1 ✚ NUEVO `src/chizu/characterize/`

### 8.2 Automatizabilidad por API/CLI (la vía robusta)

Por cada app, determinar si se puede pilotar sin tocar la UI:

- **com_automation** — ¿registra COM/ProgID? Buscar en `HKCR\<ProgID>` / CLSID asociados al exe. Muchas apps de ofimática/diseño exponen COM. read-only. □ GATE: detecta COM en una app que lo expone (p.ej. una suite ofimática).
- **cli** — ¿acepta argumentos? Dos evidencias:
  - `known_db`: base curada/aprendida de apps conocidas y su CLI (read-only, sin ejecutar). Rápida, menos fuerte.
  - `help_probe`: lanzar `exe --help` / `/?` **en sandbox** (sondeo dinámico) y ver si responde con uso. Fuerte. Gated.
- **scripting_sdk** — ¿tiene scripting/extensiones? Detectable por carpetas de plugins, presencia de un intérprete embebido, o known_db. read-only. □ GATE: marca scripting en una app que lo tiene.

La prioridad del Nivel 4 será: CLI/COM (robusto) > UIA-rich (frágil pero viable) > UIA-opaque (último recurso).

### 8.3 Automatizabilidad por UI — el sondeo dinámico (gated/sandbox)

Solo para candidatos jugosos donde la UI importa y no hay CLI. **Ejecuta**, así que va aislado:

- Lanzar el programa en sandbox (⚠ ENGANCHE Sello/sandbox), con efectos declarados (solo abrir, no actuar), timeout corto.
- Conectar al árbol de **UI Automation** de Windows (UIA): contar controles, medir `named_ratio` (proporción con Name/AutomationId frente a elementos anónimos), detectar si la ventana es un **canvas opaco** (un solo control grande sin hijos — típico de juegos, apps de dibujo, Electron mal expuesto).
- Clasificar `uia.class`: **rich** (árbol con muchos controles nombrados → automatizable por UI), **poor** (pocos, frágil), **opaque** (canvas → automatización por UI inviable, haría falta visión).
- Cerrar el programa, descartar el sandbox.

□ GATE: sobre una app Win32/WPF estándar → `rich`; sobre un emulador/juego o un canvas → `opaque`; el sondeo no deja residuos (sandbox limpio) y no actúa sobre el programa, solo lo observa.

### 8.4 Clasificación de riesgo (reglas explícitas, no corazonada)

```ts
function classifyRisk(card: AppCard): RiskClass;
```

Reglas auditables, combinando categoría + publisher + nombre + señales:

- **finance** (banca, contabilidad, trading, carteras) → **dangerous/forbidden**. becomes_protected_resource.
- **communication** (email, mensajería, redes) → **dangerous** (puede enviar en tu nombre).
- **irreversible_data** (gestores de BD, herramientas de borrado, particionado) → **dangerous/forbidden**.
- **system_admin** (regedit, editores de políticas, gestores de discos) → **forbidden**.
- ofimática/diseño que escribe ficheros del usuario → **caution**.
- visores/editores de texto/multimedia sin efectos externos → **safe**.

La clasificación es transparente (cada `RiskClass.reasons` lista por qué) y, lo importante: los `dangerous`/`forbidden` se **publican al approval gate** (§10). El mapa arma la defensa. □ GATE: una app de banca → forbidden + protected_resource; un visor de imágenes → safe; cada veredicto con sus reasons.

### 8.5 Categoría y score de candidato

- **category** — por publisher/nombre/known_db + heurística. □ GATE: clasifica correctamente apps obvias.
- **automation_candidate_score** = f(usage_score alto, automatizable [CLI/COM o UIA-rich], sandboxeable [easy], riesgo bajo [safe/caution]). Ordena qué apps son las jugosas para que el Nivel 4 empiece por ellas. □ GATE: una app muy usada + CLI + safe puntúa alto; una opaca + dangerous puntúa bajo.

---

## 9. El Atlas — el mapa y su retrato visual

### 9.1 Consolidación

Las `AppCard` completas (descubrimiento + uso + caracterización + riesgo) forman el **Atlas**, persistido y versionado (un Atlas por barrido, para ver cómo cambia la máquina con el tiempo).

### 9.2 Render visual (el subidón del Nivel 3)

"Lanzas Shinobi y te devuelve el retrato de tu propia máquina." El Atlas se renderiza a un artefacto visual (HTML/markdown):

- Vista por **uso**: ranking de lo que vives, con run_count y recencia.
- Vista por **categoría**: treemap o agrupación (navegadores, diseño, dev, finanzas…).
- Vista por **automatizabilidad**: verde (CLI/COM), ámbar (UIA-rich), rojo (opaco) — qué podrá pilotar el Nivel 4 y por qué vía.
- Vista por **riesgo**: qué se puede tocar sin miedo (safe), qué con cuidado, qué ni acercarse (forbidden).
- **Candidatos para el Nivel 4**: la lista priorizada por `automation_candidate_score`.

□ GATE: tras un barrido, existe `atlas/<scan_id>.html` legible, fiel al store, con las cuatro vistas.

### 9.3 Consulta programática

El Atlas es consultable por los niveles superiores:

```ts
interface Atlas {
  query(filter: { category?: AppCategory; minUsage?: number;
                  automatable?: boolean; maxRisk?: RiskClass["level"] }): AppCard[];
  get(app_id: string): AppCard | null;
  candidatesForExplorer(): AppCard[]; // ordenados por automation_candidate_score
}
```

---

## 10. Integridad y enganche con el approval gate

- **Descubrimiento y uso**: read-only → sin gate, seguros por construcción.
- **Sondeo dinámico**: ejecuta → en sandbox, efectos declarados (solo abrir/observar), gated. ⚠ ENGANCHE Capa 2.
- **Procedencia**: cada dato del mapa con su fuente y método; los campos por sondeo (help_probe, uia) marcados como medidos-ejecutando, los por known_db como inferidos.
- **El riesgo arma la defensa**: ⚠ ENGANCHE approval gate — los `dangerous`/`forbidden` se publican como recursos protegidos. A partir de aquí, cualquier intento del Nivel 4/5 de actuar sobre una app de banca pausa pidiendo aprobación, **porque el Cartógrafo la marcó**. El mapa no es pasivo: es la primera línea de seguridad de toda la visión cross-app.
- **Anti-alucinación**: el Atlas solo lista lo descubierto por una fuente real; "no detectado" nunca se rellena con "probablemente está".

□ GATE integridad: el sondeo no deja residuos ni actúa sobre programas; las apps peligrosas plantadas aparecen como protegidas en el gate; el Atlas no contiene entradas sin fuente.

---

## 11. Integración con el resto del dojo

- **→ Kagami (N2)**: el inventario de herramientas disponibles es parte del auto-conocimiento. "Qué puedo pilotar en esta máquina" entra en la frontera. ⚠ Chizu publica; Kagami consume.
- **→ Nivel 4 (Explorador)**: el Atlas es su punto de partida. `candidatesForExplorer()` le dice por dónde empezar (alto uso + automatizable + safe), y `uia.class`/`cli` le dicen por qué vía. Sin el mapa, el Explorador exploraría a ciegas.
- **→ Nivel 5 (Mayordomo)**: cuando el usuario diga "edita la foto en mi programa de diseño", el Mayordomo resuelve "mi programa de diseño" consultando el Atlas.
- **→ approval gate**: como en §10, el riesgo se vuelve protección activa.

---

## 12. LA PRUEBA DURA — verificación end-to-end del cartógrafo

Una batería con casos difíciles plantados por Iván, verificable de forma **binaria** contra su hoja sellada. "Fácil" no significa que la prueba sea floja: ataca justo donde un mapeo ingenuo falla.

### 12.1 Montaje (lo hace Iván)

Sobre su máquina real (o una de prueba), Iván anota la verdad y planta casos:

1. **El portable escondido.** Un programa portable (un .exe en una carpeta suelta, sin instalador ni registro ni shortcut). → debe descubrirse solo vía `programfiles_scan`/`path_scan`.
2. **El duplicado.** Una app instalada por MSI **y** presente en winget **y** con shortcut. → debe aparecer **una** vez con tres fuentes, no tres veces.
3. **El usado-pero-oculto.** Un programa que Iván usa mucho pero que no tiene icono en el escritorio ni en la barra. → debe rankear alto por uso (UserAssist), no quedar enterrado.
4. **El peligroso.** Una app de banca/contabilidad/comunicación. → debe clasificarse dangerous/forbidden y publicarse como recurso protegido.
5. **El opaco.** Un emulador, un juego, o una app canvas (Electron mal expuesto). → su `uia.class` debe ser `opaque` tras el sondeo, no `rich`.
6. **El CLI no obvio.** Una herramienta con CLI potente pero sin GUI vistosa (p.ej. una utilidad del PATH). → debe marcarse `cli.available = true`.
7. **El señuelo de alucinación.** Iván verifica que el mapa **no** lista ningún programa que no esté instalado de verdad (un agente que "rellena" inventaría suites comunes).

### 12.2 Criterios de PASS (binarios, contra la hoja sellada)

- **P1 — Portable descubierto.** El portable escondido está en el Atlas, con `install_type: "portable"` y la fuente correcta.
- **P2 — Dedup correcto.** El duplicado aparece una sola vez, con `discovered_by` = las tres fuentes.
- **P3 — Uso fiel.** El top-N por `usage_score` coincide con lo que Iván realmente usa; el usado-pero-oculto está arriba; un instalado-nunca-usado está al fondo.
- **P4 — Riesgo correcto + protección armada.** El peligroso es dangerous/forbidden con reasons correctas, y aparece como recurso protegido en el approval gate.
- **P5 — Opaco detectado.** El programa canvas tiene `uia.class: "opaque"`; una app Win32 estándar tiene `rich`. El sondeo no dejó residuos.
- **P6 — CLI detectado.** La utilidad CLI tiene `cli.available: true` con su evidencia.
- **P7 — Cero alucinaciones.** El Atlas no contiene ninguna app que Iván no tenga instalada. Cada entrada es rastreable a una fuente real.

P3 y P7 son los que separan un mapa fiel de uno plausible: P3 prueba que mide el uso real (no asume), P7 que no inventa. Un cartógrafo que rellena el mapa con lo que "suele haber" pasa P1–P6 y falla P7 — y un mapa con una calle inventada es peor que no tener mapa.

□ GATE FINAL Nivel 3: P1–P7 en verde con salida cruda (Atlas + dump del store + estado del approval gate), reproducible.

---

## 13. EL PROMPT WOW

### 13.1 El prompt (en su voz)

> **Shinobi: antes de mover un dedo, reconoce el terreno.**
> Esta máquina es nuestra base. Quiero que la conozcas entera: qué programas hay de verdad —no los que suele haber, los que hay—, cuáles vivo y cuáles ni toco, cuáles puedes pilotar a ciegas por línea de comandos y cuáles tendrías que aprender a manejar a mano, y cuáles son una bomba que no se toca sin permiso.
> Mira sin ejecutar nada que no debas; y si necesitas abrir algo para verle las tripas, hazlo en tu jaula, mira y cierra, sin tocar.
> Y cuando termines, dame el retrato: el mapa de mi propia máquina, como no lo he visto nunca. Qué uso, qué se puede automatizar y por qué vía, y qué hay que proteger de ti mismo.
> No me dibujes una sola calle que no hayas pisado.

### 13.2 Qué dispara

| Frase | Fase / mecanismo |
|---|---|
| "qué programas hay de verdad, no los que suele haber" | Discovery multi-fuente + anti-alucinación (P7) |
| "cuáles vivo y cuáles ni toco" | Usage (UserAssist/Prefetch) + scoring |
| "pilotar por línea de comandos vs aprender a mano" | Characterization: cli/com vs uia.class |
| "una bomba que no se toca sin permiso" | RiskClass → recurso protegido en el approval gate |
| "abrir en tu jaula, mira y cierra, sin tocar" | sondeo dinámico gated/sandbox, solo-observar |
| "el retrato … como no lo he visto nunca" | Atlas + render visual (las cuatro vistas) |
| "no me dibujes una calle que no hayas pisado" | procedencia obligatoria; cero entradas sin fuente |

El wow del Nivel 3 es inmediato y visual: en una pasada, Shinobi te devuelve tu máquina retratada con una honestidad que tú mismo no tenías sobre ella — y de paso, ya sabe qué no debe tocar.

---

## 14. Orden de construcción (pasos pequeños)

- M-01. `src/chizu/` + flag `CHIZU_ENABLED` (off) + tipos (§5). □ GATE: tsc 0, suite verde, flag off sin efecto.
- M-02. Migraciones idempotentes en el store. □ GATE: fresca crea, legacy no rompe, re-run no-op.
- M-03. Adaptadores ⚠ ENGANCHE (subproceso runner, sandbox/Sello, approval gate, store, swarm) contra firmas reales. □ GATE: compilan contra los módulos reales.
- **Discovery**
- M-04. Adaptadores registry_uninstall + registry_apppaths + start_menu. □ GATE: las apps instaladas aparecen con nombre/version/exe.
- M-05. Adaptadores appx + winget/choco/scoop + path_scan + programfiles_scan. □ GATE: portables y CLI del PATH aparecen.
- M-06. Fusión + dedup por identidad canónica. □ GATE: el duplicado de prueba aparece una vez con N fuentes; cero inventos.
- **Usage**
- M-07. userassist (ROT13 + parseo binario) + prefetch + jumplist. □ GATE: run_count/last_used reales.
- M-08. scoreUsage + ranking. □ GATE: el top-N coincide con el uso real; el oculto-pero-usado sube.
- **Characterization**
- M-09. Estática: com_automation + cli(known_db) + scripting + category + sandbox-static. □ GATE: COM/CLI/categoría correctos en apps conocidas, sin ejecutar.
- M-10. Riesgo (reglas explícitas) + publicación al approval gate. □ GATE: peligroso→forbidden+protegido; reasons presentes.
- M-11. Sondeo dinámico gated/sandbox: lanzar→UIA→clasificar→cerrar. □ GATE: rich/opaque correctos; sin residuos; no actúa sobre el programa.
- M-12. automation_candidate_score. □ GATE: candidatos priorizados con sentido.
- **Atlas**
- M-13. Consolidación + persistencia versionada. □ GATE: Atlas fiel al store.
- M-14. Render visual (cuatro vistas) + API de consulta. □ GATE: `atlas/<id>.html` legible; `candidatesForExplorer()` ordenado.
- **Verificación**
- M-15. Montar y correr la prueba dura (§12). □ GATE FINAL: P1–P7 verde, reproducible.
- M-16. Lanzar el prompt wow sobre la máquina real. □ GATE: Iván reconoce su máquina en el retrato y dice wow.

Regla de oro: **la línea read-only / ejecuta es la línea de seguridad.** Discovery y Usage nunca ejecutan; el sondeo dinámico siempre en sandbox. Si en algún paso Chizu necesita lanzar algo fuera de la jaula para "ver mejor", está mal diseñado.

---

## 15. Riesgos y mitigaciones

- **R1 — Mapa que alucina.** El riesgo central (P7). Mitigación: cada entrada con fuente; "no detectado" ≠ "probablemente está".
- **R2 — Fuentes que requieren privilegios.** Prefetch y algún registry pueden necesitar admin. Mitigación: degradar con honestidad (marcar la señal como no disponible), no fingir el dato. UserAssist (HKCU) funciona sin admin.
- **R3 — Sondeo dinámico peligroso.** Lanzar un programa, aunque sea para mirar, tiene riesgo. Mitigación: solo en sandbox, efectos declarados (abrir/observar/cerrar), nunca apps `forbidden`, timeout corto, descarte del sandbox.
- **R4 — Clasificación de riesgo errónea.** Marcar safe algo peligroso es grave. Mitigación: ante la duda, subir el nivel (fail-safe hacia caution/dangerous); reglas auditables; Iván puede revisar y corregir.
- **R5 — UIA engañoso.** Algunas apps exponen árbol pero no son automatizables de verdad (controles falsos). Mitigación: `uia.class` es una señal, no una garantía; el Nivel 4 confirmará al intentar de verdad. Chizu no promete, orienta.
- **R6 — Privacidad.** El historial de uso es dato personal sensible. Mitigación: todo local, en el store del usuario; nunca sale de la máquina; procedencia clara.
- **R7 — Deriva del mapa.** La máquina cambia (instalas/desinstalas). Mitigación: Atlas versionado por barrido; rebarridos incrementales; el mapa lleva su fecha.

---

## 16. Glosario

- **Chizu** (地図, mapa) — el subsistema del Nivel 3; el reconocimiento y retrato de la máquina.
- **Atlas** — el mapa consolidado: el conjunto de `AppCard` con sus cuatro vistas, versionado por barrido.
- **AppCard** — la ficha de un programa: identidad, uso, caracterización, riesgo, procedencia.
- **Las dos profundidades** — mapeo estático (read-only, seguro) y sondeo dinámico (ejecuta, gated/sandbox).
- **uia.class** — rich / poor / opaque: cuán automatizable por UI es un programa, del sondeo.
- **RiskClass** — safe / caution / dangerous / forbidden; los dos últimos se publican como recursos protegidos.
- **automation_candidate_score** — prioridad de una app como objetivo del Nivel 4.
- **Recurso protegido** — un programa que, por su riesgo, hace pausar el approval gate; el mapa arma esta defensa.

---

*Fin del dossier v1. Chizu es el reconocimiento del ninja antes de pisar el terreno: dibuja la máquina con honestidad —solo lo que pisó—, dice qué se puede pilotar y por qué vía, y arma de antemano la defensa marcando lo que no se toca. Es el cimiento sobre el que el Explorador aprenderá y el Mayordomo gobernará. Un buen mapa no es el que más calles dibuja; es el que no inventa ninguna.*
