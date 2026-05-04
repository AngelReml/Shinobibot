---
name: desktop-photoshop-resize-export
description: Opens an image in Adobe Photoshop, resizes it to the requested width/height (preserving aspect ratio by default) and exports a JPEG. Use when the user wants a quick resize without manual UI work.
license: MIT
compatibility: Requires Adobe Photoshop with ExtendScript (-r flag) installed. Windows only.
metadata:
  shinobi.engine: node-mjs
  shinobi.runtime_helper: scripts/resize.jsx
  shinobi.requires_app: Photoshop
---

# desktop-photoshop-resize-export

Generates a temp `.jsx`, runs Photoshop with `-r <jsx>` and reads the result JSON written to `%TEMP%`.

## Parameters

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `input` | string | yes | Absolute image path |
| `output` | string | yes | Absolute `.jpg` output path |
| `width` | number | yes | Pixels |
| `height` | number | no | Pixels (calculated by aspect if omitted) |
| `quality` | number | no | 1–12 JPEG quality (default 10) |
| `keep_aspect` | boolean | no | default true |

## Output

```json
{ "success": true, "output": "C:\\\\out.jpg", "width": 1920, "height": 1080, "ms": 4321 }
```

## Edge cases

- Photoshop not installed: `error: Photoshop executable not found`.
- Unsupported format: PS will error; surfaced verbatim.
- Output dir not writable: error from PS, returned.
