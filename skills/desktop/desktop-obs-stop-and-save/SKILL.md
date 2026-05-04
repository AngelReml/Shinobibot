---
name: desktop-obs-stop-and-save
description: Stops the active OBS recording and waits until the output MP4 is closed and writable. Returns the absolute path. Use after `desktop-obs-record-self` to finalize a session.
license: MIT
compatibility: Requires OBS Studio 28+ with obs-websocket plugin enabled. Cross-OS once OBS is running.
metadata:
  shinobi.engine: node-mjs
  shinobi.requires_app: OBS Studio
  shinobi.protocol: obs-websocket v5
---

# desktop-obs-stop-and-save

## Parameters

| Name | Type | Required | Default | Notes |
|------|------|----------|---------|-------|
| `host` | string | no | `127.0.0.1` | |
| `port` | number | no | `4455` | |
| `password` | string | no | `''` | |
| `wait_close_ms` | number | no | `8000` | Max time to wait for the file handle to release |

## Output

```json
{ "success": true, "stopped": true, "output_path": "C:\\Users\\you\\Videos\\2026-05-04 ...mp4", "size_bytes": 12345678 }
```

If no recording was active: `stopped: false, output_path: null` (success still true).

## Implementation

[`scripts/skill.mjs`](scripts/skill.mjs):
1. Connect to obs-websocket.
2. `GetRecordStatus`. If inactive → return early with `stopped:false`.
3. `StopRecord`. Capture `outputPath` from the response.
4. Poll the file every 250ms (up to `wait_close_ms`) until `fs.statSync(...).size > 0` and a sentinel write check succeeds (open with append + close with no error).
5. Return absolute path + size.

## Edge cases

- Recording already stopped between `GetRecordStatus` and `StopRecord`: handled — falls through to file-existence poll.
- File still locked after `wait_close_ms`: returns the path with a warning `still_locked: true`.
- obs-websocket reports a path that doesn't exist (rare profile bug): error returned.
