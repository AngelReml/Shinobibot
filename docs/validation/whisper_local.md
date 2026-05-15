# Validación FASE V3 — whisper.cpp local

Fecha: 2026-05-15.

## Resumen

| Item | Estado |
|---|---|
| whisper.cpp compilado (Linux) | ✅ Contabo, `whisper-cli` v1.8.4 + libs `.so` |
| whisper.cpp prebuild (Windows) | ✅ `whisper-bin-x64.zip` v1.8.4 oficial, `whisper-cli.exe` + DLLs |
| Modelo ggml-base | ✅ `ggml-base.bin` 147 MB descargado (Linux + Windows) |
| STT con fallback | ✅ `audio_transcribe` usa whisper.cpp local → fallback Whisper API |
| Prueba real | ✅ transcripción de `jfk.wav` en ambos backends |

## Integración en Shinobi

`src/tools/audio_transcribe.ts` reescrito con estrategia dual:

1. **whisper.cpp local primero** — si `SHINOBI_WHISPERCPP_BIN` +
   `SHINOBI_WHISPERCPP_MODEL` están configurados y el binario responde.
2. **Whisper API como fallback** — si el local no está o falla (y hay
   `OPENAI_API_KEY`).
3. Forzar backend: `SHINOBI_STT_BACKEND=local|api` (default `auto`).

Bug colateral corregido dentro de scope: `whisper_cpp_provider.ts`
pasaba `--output-txt` y leía stdout con timestamps. Cambiado a
`--no-timestamps` para que stdout devuelva texto limpio (afecta
directamente la calidad de salida que V3 valida).

## Binarios y modelo (NO versionados)

El modelo `ggml-base.bin` pesa **147 MB**, supera el límite de 100 MB
por archivo de GitHub — **no se puede commitear**. Los binarios son
platform-specific. Por eso:

- `bin/whisper-linux-x64/`, `bin/whisper-windows-x64/`, `models/whisper/*.bin`
  están en `.gitignore`.
- Se regeneran con `scripts/contabo/setup-whisper.sh` (Linux) o
  descargando el prebuild oficial (Windows).
- El wrapper `bin/whisper-linux` SÍ se versiona (script shell de 12 líneas).

Esto es una desviación del plan ("commit binario en bin/") forzada por
el límite de GitHub. Documentada, no maquillada.

### Setup Linux (Contabo)

```bash
./scripts/contabo/setup-whisper.sh base
# exporta luego:
export SHINOBI_WHISPERCPP_BIN=/opt/shinobibot/bin/whisper-linux
export SHINOBI_WHISPERCPP_MODEL=/opt/shinobibot/models/whisper/ggml-base.bin
```

### Setup Windows

```
Descargar whisper-bin-x64.zip de github.com/ggml-org/whisper.cpp/releases
→ extraer Release/* en bin/whisper-windows-x64/
SHINOBI_WHISPERCPP_BIN=bin\whisper-windows-x64\whisper-cli.exe
SHINOBI_WHISPERCPP_MODEL=models\whisper\ggml-base.bin
```

## Prueba real — local vs API

Audio: `samples/jfk.wav` de whisper.cpp (excerpt real del discurso de
JFK, ~11 s). Modelo `ggml-base`.

### Evidencia cruda (ejecución Windows)

```
--- Backend 1: whisper.cpp local ---
  tiempo: 2008 ms
  texto:  "And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country."

--- Backend 2: Whisper API ---
  tiempo: 4006 ms
  texto:  "And so my fellow Americans, ask not what your country can do for you, ask what you can do for your country."

=== COMPARATIVA ===
  similaridad texto (Jaccard word-level): 100.0%
  local: 2008 ms · API: 4006 ms
  más rápido: local
```

### Comparativa

| Métrica | whisper.cpp local | Whisper API |
|---|---|---|
| Tiempo (jfk.wav, ~11 s audio) | **2008 ms** | 4006 ms |
| Texto | idéntico | idéntico |
| Similaridad (Jaccard word-level) | 100 % | — |
| Coste | 0 (CPU local) | tokens/min facturados |
| Internet | no requiere | requiere |
| Límite tamaño | sin límite práctico | 25 MB |
| Privacidad | audio nunca sale del host | audio sube a OpenAI |

**Veredicto**: en este host, whisper.cpp local con `ggml-base` es **2×
más rápido** que la API, con calidad **idéntica** (100 % de coincidencia
de palabras), cero coste y sin enviar el audio a terceros. La API sigue
como fallback útil cuando no se quiere instalar el binario+modelo
(~148 MB de footprint).

Nota: el tiempo local depende de la CPU del host y del modelo. `ggml-base`
es el equilibrio recomendado; `ggml-tiny` es más rápido y menos preciso,
`ggml-small`/`medium` más precisos y lentos.

## Linux (Contabo) — transcripción verificada

```
$ ./bin/whisper-linux -m models/whisper/ggml-base.bin -f samples/jfk.wav --no-prints --no-timestamps
 And so my fellow Americans ask not what your country can do for you, ask what you can do for your country.
real  3.81s
```
