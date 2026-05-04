---
name: desktop-excel-open-and-extract
description: Opens an Excel workbook on Windows and returns the values of a given sheet/range as JSON. Use when the user asks to read cells, extract a table, or pipe data from .xlsx into structured form.
license: MIT
compatibility: Requires Microsoft Excel installed (Excel.Application COM). Windows only.
metadata:
  shinobi.engine: node-mjs
  shinobi.runtime_helper: scripts/extract.ps1
  shinobi.requires_app: Excel
---

# desktop-excel-open-and-extract

Reads an Excel workbook through COM automation and returns the requested range as a JSON 2D array.

## Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `path` | string | yes | — | Absolute path to a `.xlsx` / `.xlsm` / `.xls` file |
| `sheet` | string | no | first | Sheet name |
| `range` | string | no | UsedRange | A1 notation, e.g. `A1:D20` |
| `headerRow` | boolean | no | true | If true, first row becomes object keys; otherwise a 2D array is returned |
| `visible` | boolean | no | false | Show the Excel window during read |
| `closeOnExit` | boolean | no | true | Close Excel after extraction |

## Output

```json
{
  "sheet": "Sheet1",
  "range": "A1:C4",
  "rows": [{"name":"alice","age":30,"city":"BCN"}, ...],
  "row_count": 3,
  "column_count": 3
}
```

## Implementation

Node entry at [`scripts/skill.mjs`](scripts/skill.mjs) spawns `powershell -NoProfile -File scripts/extract.ps1` with the args; the PS1 uses `New-Object -ComObject Excel.Application`, opens read-only, walks the range, emits JSON to stdout.

## Edge cases

- Missing file: returns `{ success: false, error: "file not found" }`.
- Excel not installed: PS1 reports `Could not load Excel.Application`; tool returns the error verbatim.
- Empty range: returns `rows: []` with `row_count: 0`.
- COM leaves orphan `excel.exe` on PS errors: helper releases via `Marshal.FinalReleaseComObject` in a `finally`.
