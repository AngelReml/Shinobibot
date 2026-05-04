---
name: desktop-premiere-basic-cut
description: Adobe Premiere Pro automation that imports a video clip, trims it to a given start/end timecode, and exports an MP4. Use when the user wants a quick cut without opening the full timeline UI.
license: MIT
compatibility: Requires Adobe Premiere Pro (with ExtendScript host enabled) installed. Windows only.
metadata:
  shinobi.engine: node-mjs
  shinobi.runtime_helper: scripts/cut.jsx
  shinobi.requires_app: Premiere Pro
---

# desktop-premiere-basic-cut

Drives Premiere via ExtendScript: a generated `.jsx` opens the project, imports the source clip, places it on a sequence trimmed to `[start, end]`, then renders to MP4.

## Parameters

| Name | Type | Required | Notes |
|------|------|----------|-------|
| `input` | string | yes | Absolute path to source video (`.mp4`/`.mov`/`.avi`) |
| `output` | string | yes | Absolute path for the rendered MP4 |
| `start` | string | yes | Timecode `HH:MM:SS.mmm` |
| `end` | string | yes | Timecode `HH:MM:SS.mmm` |
| `preset` | string | no | Exporter preset name; falls back to "Match Source - High bitrate" |

## Output

```json
{ "success": true, "output": "C:\\\\path\\\\out.mp4", "duration_ms": 12345 }
```

## Implementation

[`scripts/skill.mjs`](scripts/skill.mjs) emits a temp `.jsx` based on `scripts/cut.jsx` template, then invokes `premiere.exe -script "<temp.jsx>"`. ExtendScript writes a result JSON to `%TEMP%/shinobi-premiere-result.json` which the skill picks up.

## Edge cases

- Premiere not installed: skill returns `error: "Premiere Pro executable not found"`.
- Invalid timecode: validated by `parseTimecodeMs()` in `skill.mjs` before launching Premiere.
- Render fails: ExtendScript reports the error in the result JSON.

## Manual verification

This skill cannot be E2E-tested in CI because Premiere licensing requires the workstation. See `docs/manual_actions.md`.
