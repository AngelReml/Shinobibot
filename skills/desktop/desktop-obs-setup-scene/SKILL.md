---
name: desktop-obs-setup-scene
description: Creates or updates an OBS Studio scene with display, audio output and microphone sources via the obs-websocket plugin. Use when the user wants to prepare a recording or streaming scene programmatically.
license: MIT
compatibility: Requires OBS Studio 28+ with the built-in obs-websocket plugin enabled (Tools > WebSocket Server Settings). Defaults to ws://127.0.0.1:4455.
metadata:
  shinobi.engine: node-mjs
  shinobi.requires_app: OBS Studio
  shinobi.protocol: obs-websocket v5
---

# desktop-obs-setup-scene

Connects to OBS via WebSocket (no extra dependency — uses the global `WebSocket` from Node 22+) and idempotently sets up a scene with the requested sources.

## Parameters

| Name | Type | Required | Default | Notes |
|------|------|----------|---------|-------|
| `scene` | string | yes | — | Scene name |
| `host` | string | no | `127.0.0.1` | obs-websocket bind address |
| `port` | number | no | `4455` | |
| `password` | string | no | `''` | Configured in OBS Settings > WebSocket |
| `display` | boolean | no | `true` | Add a `display_capture` source |
| `audio_output` | boolean | no | `true` | Add a `wasapi_output_capture` source |
| `audio_input` | boolean | no | `false` | Add a `wasapi_input_capture` (microphone) |
| `make_active` | boolean | no | `true` | Switch to this scene after setup |

## Output

```json
{
  "success": true,
  "scene": "Shinobi Self-Recording",
  "created_scene": true,
  "sources_added": ["display","audio_output"],
  "sources_existing": [],
  "active_scene": "Shinobi Self-Recording"
}
```

## Implementation

[`scripts/skill.mjs`](scripts/skill.mjs) opens a WebSocket, performs the
auth handshake (challenge/salt → `Identify`), then issues
`GetSceneList`, optionally `CreateScene`, and `CreateInput` for each requested source.

## Edge cases

- obs-websocket disabled or wrong port: ECONNREFUSED → error returned.
- Wrong password: server closes; we surface `auth failed`.
- Source already exists: counted in `sources_existing`, not duplicated.
- OBS not running: the same as port closed.
