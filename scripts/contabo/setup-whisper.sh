#!/usr/bin/env bash
#
# setup-whisper.sh — compila whisper.cpp, lo empaqueta self-contained
# en bin/whisper-linux-x64/, y descarga el modelo ggml.
#
# Reproducible: el binario + libs + modelo NO se versionan (binarios
# platform-specific + modelo de 147MB > límite GitHub). Este script los
# regenera desde cero.
#
# Uso:
#   ./scripts/contabo/setup-whisper.sh [modelo]
#   modelo por defecto: base  (otros: tiny, small, medium, large-v3)
#
# Al terminar imprime las env vars a exportar.

set -euo pipefail

MODEL="${1:-base}"
SHINOBI_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WHISPER_SRC="${WHISPER_SRC:-/opt/whisper.cpp}"

echo "[setup-whisper] home: $SHINOBI_HOME · modelo: $MODEL"

# 1. Build whisper.cpp si no está.
if [[ ! -x "$WHISPER_SRC/build/bin/whisper-cli" ]]; then
  echo "[setup-whisper] compilando whisper.cpp en $WHISPER_SRC …"
  command -v cmake >/dev/null || { echo "ERROR: cmake no instalado (apt-get install cmake)"; exit 1; }
  if [[ ! -d "$WHISPER_SRC" ]]; then
    git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$WHISPER_SRC"
  fi
  cmake -B "$WHISPER_SRC/build" -S "$WHISPER_SRC" -DCMAKE_BUILD_TYPE=Release
  cmake --build "$WHISPER_SRC/build" -j --config Release
fi

# 2. Empaqueta binario + libs en bin/whisper-linux-x64/.
DEST="$SHINOBI_HOME/bin/whisper-linux-x64"
mkdir -p "$DEST"
cp "$WHISPER_SRC/build/bin/whisper-cli" "$DEST/"
cp "$WHISPER_SRC"/build/src/libwhisper.so.1* "$DEST/" 2>/dev/null || true
cp "$WHISPER_SRC"/build/ggml/src/libggml*.so.0* "$DEST/" 2>/dev/null || true
# Symlinks soname → archivo real.
( cd "$DEST"
  for f in libwhisper.so.1 libggml.so.0 libggml-base.so.0 libggml-cpu.so.0; do
    real="$(ls "${f}".* 2>/dev/null | head -1 || true)"
    [[ -n "$real" ]] && ln -sf "$real" "$f"
  done
)
echo "[setup-whisper] binario empaquetado en $DEST"

# 3. Descarga el modelo.
mkdir -p "$SHINOBI_HOME/models/whisper"
MODEL_FILE="$SHINOBI_HOME/models/whisper/ggml-${MODEL}.bin"
if [[ ! -f "$MODEL_FILE" ]]; then
  echo "[setup-whisper] descargando modelo ggml-${MODEL} …"
  bash "$WHISPER_SRC/models/download-ggml-model.sh" "$MODEL"
  cp "$WHISPER_SRC/models/ggml-${MODEL}.bin" "$MODEL_FILE"
fi
echo "[setup-whisper] modelo en $MODEL_FILE"

# 4. Verifica.
chmod +x "$SHINOBI_HOME/bin/whisper-linux"
"$SHINOBI_HOME/bin/whisper-linux" --help >/dev/null 2>&1 \
  && echo "[setup-whisper] wrapper OK" \
  || { echo "ERROR: wrapper no funciona"; exit 1; }

echo ""
echo "=== Exporta estas variables para activar STT local ==="
echo "export SHINOBI_WHISPERCPP_BIN=\"$SHINOBI_HOME/bin/whisper-linux\""
echo "export SHINOBI_WHISPERCPP_MODEL=\"$MODEL_FILE\""
