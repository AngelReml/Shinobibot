# bench_results/ — el rastro de la medición

> Aplicación del voto **rastro** a la propia medición (PLAN_SOMBRA §4.4):
> *si no está aquí con firma, no existe.*

Cada corrida de suite o medición N0/N1/N2 deposita aquí un fichero **fechado e
inmutable**. Nada de números en mensajes sueltos ni en la cabeza del operador.

## Disciplina

1. **Nombre**: `<tipo>_<fecha>.md` — p.ej. `kpis_N0_2026-06-10.md`,
   `harnessdelta_S-CODE_2026-07-xx.md`.
2. **Firma**: junto a cada artefacto, su `.sha256`. Para los benchmarks
   comparativos reales (N1/N2), la firma fuerte es Ed25519 vía el motor **E7**
   (`provenance_v2.ts`) sobre el `audit.jsonl` de la corrida — el único benchmark
   del campo infalsificable por construcción.
3. **Congelación**: una suite versionada (S-CODE/S-GAIA/S-POLICY) NO se edita
   entre corridas comparadas. Cambiar una tarea = nueva versión = los números
   viejos no se mezclan con los nuevos.
4. **Nivel de evidencia** declarado en cada fichero: N0 (interno, jamás se
   publica como benchmark), N1 (reproducible barato, mismo modelo para los tres
   agentes), N2 (recibo frontera de pago). Confundirlos está prohibido.

## Contenido actual

| Fichero | Nivel | Qué es |
|---|---|---|
| `kpis_N0_2026-06-10.md` | N0 | Primera medición de la sombra desde el rastro real (1.055 entradas de audit, 12 misiones de ledger). Generado por `scripts/kpis_sombra.mjs`. |

## Verificar un artefacto

```sh
sha256sum -c kpis_N0_2026-06-10.md.sha256
```
