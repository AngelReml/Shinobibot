#!/usr/bin/env python
"""
Descarga el metadata de GAIA validation (dataset gated) y lo convierte a
metadata.jsonl para el runner de la cata (scripts/gaia/run_gaia_cata.ts).

- Token: HF_TOKEN del entorno, o leido del .env de shinobi (no se hardcodea).
- Dataset GATED: se guarda FUERA del repo (GAIA_DIR o ~/Desktop/GAIA) para no
  versionarlo nunca.
- NO descarga attachments (mp3/xlsx/pdf): la primera cata es sin adjuntos.

Uso: python scripts/gaia/fetch_gaia.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))


def load_token() -> str:
    tok = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if tok:
        return tok.strip()
    env_path = os.path.join(REPO_ROOT, ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("HF_TOKEN=") or line.startswith("HUGGING_FACE_HUB_TOKEN="):
                    return line.split("=", 1)[1].strip()
    sys.exit("HF_TOKEN no encontrado (ni en entorno ni en .env)")


def main() -> None:
    import pandas as pd
    from huggingface_hub import hf_hub_download

    token = load_token()
    dest_root = os.environ.get("GAIA_DIR") or os.path.join(os.path.expanduser("~"), "Desktop", "GAIA")
    out_dir = os.path.join(dest_root, "2023", "validation")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "metadata.jsonl")

    print(f"Descargando metadata.parquet (gaia-benchmark/GAIA, validation)…")
    pq = hf_hub_download(
        repo_id="gaia-benchmark/GAIA",
        filename="2023/validation/metadata.parquet",
        repo_type="dataset",
        token=token,
    )
    df = pd.read_parquet(pq)
    # El runner espera: task_id, Question, Level, Final answer, file_name.
    df.to_json(out_path, orient="records", lines=True, force_ascii=False)

    levels = df["Level"].astype(str).value_counts().sort_index().to_dict()
    no_att = int((df["file_name"].fillna("").astype(str).str.strip() == "").sum())
    print(f"\nOK. metadata.jsonl escrito en:\n  {out_path}")
    print(f"Filas: {len(df)}")
    print(f"Columnas: {list(df.columns)}")
    print(f"Reparto por nivel: {levels}")
    print(f"Tareas SIN adjunto (file_name vacio): {no_att}")
    print(f"\nLanzar dry-run:\n  npx tsx scripts/gaia/run_gaia_cata.ts --metadata \"{out_path}\" --dry-run")


if __name__ == "__main__":
    main()
