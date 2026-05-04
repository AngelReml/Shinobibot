---
name: desktop-obs-record-self
description: Boots OBS if not already running, ensures the "Shinobi Self-Recording" scene exists with display + audio sources, switches to it and starts recording. Use when Shinobi needs to record its own session for a demo or proof of work.
license: MIT
compatibility: Requires OBS Studio 28+ with the bundled obs-websocket plugin enabled (Tools > WebSocket Server Settings, default 127.0.0.1:4455). Windows only for OBS auto-launch; the recording itself works cross-OS once OBS is running.
metadata:
  shinobi.engine: node-mjs
  shinobi.requires_app: OBS Studio
  shinobi.protocol: obs-websocket v5
  shinobi.scene: Shinobi Self-Recording
---

# desktop-obs-record-self

End-to-end "press record" skill. Idempotent: re-invoking on an active recording is a no-op.

## Parameters

| Name | Type | Required | Default | Notes |
|------|------|----------|---------|-------|
| `host` | string | no | `127.0.0.1` | obs-websocket bind |
| `port` | number | no | `4455` | |
| `password` | string | no | `''` | obs-websocket password |
| `auto_launch` | boolean | no | `true` | If OBS not reachable, spawn `obs64.exe` (detached) and retry |
| `with_microphone` | boolean | no | `false` | Add a `wasapi_input_capture` source |
| `scene` | string | no | `Shinobi Self-Recording` | Scene name (override for tests) |

## Output

```json
{
  "success": true,
  "scene": "Shinobi Self-Recording",
  "scene_created": false,
  "sources_added": ["...display", "...system audio"],
  "recording": true,
  "started_at": "2026-05-04T10:23:00.000Z"
}
```

If recording was already active when invoked, returns `recording: true` with `started_at: null` (not measured).

## Implementation

[`scripts/skill.mjs`](scripts/skill.mjs) imports the shared `ObsClient` from `src/skills_runtime/obs_client.ts`:

1. Try to connect. On failure + `auto_launch=true`, spawn OBS detached and poll until reachable (max 12s).
2. `ensureScene("Shinobi Self-Recording", [display, audio_output, optionally mic])`.
3. `SetCurrentProgramScene`.
4. `startRecording()` — already-recording is treated as success.

## Edge cases

- OBS not installed and `auto_launch=true`: `obs64.exe` not found → returned as error with the candidate paths checked.
- Plugin not enabled: connect fails → `auto_launch` retry won't fix it; user gets a clear "enable obs-websocket" error.
- `with_microphone=true` but no input device: `CreateInput` fails for that source only; recording still proceeds with the rest.
