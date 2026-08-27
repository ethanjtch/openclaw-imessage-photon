# openclaw-imessage-photon

**English** · [中文](README.zh-CN.md)

iMessage channel plugin for [OpenClaw](https://github.com/contaxy/openclaw) via
**Photon Spectrum Cloud** — no Mac, no iMessage server, no bridge process.

Run iMessage on your VPS/cloud server: your agent talks to iMessage contacts
directly through Photon's cloud relay, as a native OpenClaw channel plugin
(runs inside the gateway process — no per-message CLI spawn, no temporary
agent processes).

## Highlights

- **Native channel plugin** — runs in the OpenClaw gateway process; messages
  dispatch straight into the embedded agent runtime.
- **No Mac required** — Photon Spectrum Cloud relays iMessage.
- **Text, images, voice, polls, effects, contacts** — both directions.
- **Voice transcription** — plug any `tools.media.audio` STT provider
  (Deepgram, ElevenLabs, Groq, ...) via ordinary OpenClaw config.
- **Green-friendly defaults** — DM allowlist, seen-ack reaction, tapbacks,
  auto-reconnect, read receipts, typing indicators.
- **Onboarding wizard** — `openclaw onboard` guides through Photon project
  setup (credentials via `SPECTRUM_PROJECT_ID` / `SPECTRUM_PROJECT_SECRET`,
  or paste from the dashboard).

## Installation

Requirements: OpenClaw ≥ 2026.7.1, Node 22+.

**Via npm (recommended)** — either ask an AI agent to run it, or:

```bash
npx -y openclaw-imessage-photon-cli@latest install
```

Or install the plugin package directly:

```bash
openclaw plugins install npm:openclaw-imessage-photon
```

**From source:**
git clone https://github.com/ethanjtch/openclaw-imessage-photon
cd openclaw-imessage-photon
npm install
npm run build
openclaw plugins install ./imessage-photon
openclaw gateway restart
```

Then configure the channel (run `openclaw onboard`, pick **iMessage (Photon)**)
or edit `openclaw.json` directly:

```json5
{
  channels: {
    "imessage-photon": {
      enabled: true,
      projectId: "...",       // or env SPECTRUM_PROJECT_ID
      projectSecret: "...",   // or env SPECTRUM_PROJECT_SECRET
      allowFrom: ["+8613800138000"], // DM allowlist (E.164). [] = open
    },
  },
}
```

Register at [photon.codes](https://photon.codes), create a project with the
iMessage provider, and copy the Project ID / Secret.

## Configuration

| Key | Default | Description |
|---|---|---|
| `projectId` / `projectSecret` | env `SPECTRUM_PROJECT_ID` / `SPECTRUM_PROJECT_SECRET` | Photon project credentials |
| `allowFrom` | `[]` (open) | DM allowlist, E.164 numbers |
| `ackReaction` | `👀` | Seen/processing reaction on inbound text; removed after reply. `""` disables |
| `tapbackNotifications` | `all` | `all` forward tapbacks to agent; `off` ignores them |
| `enableMedia` | `false` | Agent can send/receive media attachments |
| `enablePoll` | `false` | Agent can create polls |
| `enableEffects` | `false` | Full-screen effects (confetti, lasers, ...) |
| `enableContact` | `false` | Agent can share contacts |
| `enableVoice` | `false` | Agent can send voice (via media + audio content type) |
| `enableGroups` | `false` | Handle group chats |
| `enableTyping` | `false` | Typing indicator while processing |
| `enableReadReceipts` | `false` | Mark inbound as read |

### Voice transcription

Configure any OpenClaw media-audio STT provider, e.g. Deepgram:

```json5
{
  tools: { media: { audio: { models: [{ provider: "deepgram", model: "nova-3", language: "zh" }] } } },
}
```

Requires the provider's env key (e.g. `DEEPGRAM_API_KEY`) in the gateway
environment. Inbound voice is saved to the media store and transcribed by the
core media pipeline; the agent then sees the transcript.

## Capability matrix

| iMessage capability | This plugin | [Mouxy/openclaw-photon](https://github.com/Mouxy/openclaw-photon) |
|---|---|---|
| Text / reply / active send | ✅ | ✅ |
| Media (images/files, both ways) | ✅ (`enableMedia`) | ✅ |
| Voice send + inbound transcription | ✅ (`enableVoice` + `tools.media.audio`) | ✅ |
| Polls (create) | ✅ (`enablePoll`) | ✅ |
| Poll vote events | ⚠️ blocked by upstream spectrum-ts bug | ✅ |
| Full-screen effects | ✅ (`enableEffects`) | ✅ |
| Contacts | ✅ (`enableContact`) | ✅ |
| Group chats | ✅ (`enableGroups`, no mention gating) | ✅ |
| Tapbacks (inbound) | ✅ | ✅ |
| Seen-ack reaction | ✅ (👀) | — |
| Typing indicators | ✅ (`enableTyping`) | ✅ |
| Read receipts | ✅ (`enableReadReceipts`) | ✅ |
| Stickers / text animations | ❌ | ✅ (needs `@photon-ai/advanced-imessage`) |
| Mini-app / status cards | ❌ (business-account only) | ✅ |
| photonDoctor diagnostic tool | ❌ (use `openclaw channels status`) | ✅ |
| Onboarding | manual credentials / env | device-code auto-provisioning |
| License | **MIT** | UNLICENSED |

### Attribution

This project is an **independent implementation** inspired by
[Mouxy/openclaw-photon](https://github.com/Mouxy/openclaw-photon)'s design and
its pointer that OpenClaw's shared message tool + channel runtime are the right
integration surface. No code from that repository is used — its license is
UNLICENSED, and this project is written from scratch against the OpenClaw
plugin SDK and `spectrum-ts`. Thank you, Mouxy, for the inspiration.

## Development

```bash
npm run build              # tsc -> dist/
npm test                   # (planned) config/inbound/dedupe unit tests
openclaw plugins install ./imessage-photon --force
systemctl --user restart openclaw-gateway
```

Local install lives under `~/.openclaw/extensions/imessage-photon/`; rebuild
and `cp -r dist/*` there, or re-run `plugins install --force`.

## Known issues

- **Poll vote events**: spectrum-ts's `toCachedPoll` rejects events whose poll
  title is an empty string, crashing and dropping the event in the library
  before the plugin can see it (issue draft:
  `spectrum-ts-poll-bug-issue-draft.md`). Poll *creation* works.

## Roadmap / TODO

- [ ] **Message dedupe**: 48h window + restart protection (avoid duplicate
      replies after a gateway restart)
- [ ] **Unit tests**: config parsing / inbound classification / dedupe
- [ ] **Device-code onboarding**: auto-login + auto-provision the Photon
      project via Photon's public API (no manual credential copying)
- [ ] **Group mention gating**: `requireMention` config (only reply in groups
      when mentioned)
- [ ] **Edit/unsend notifications**: `enableEditUnsend` switch (agent reacts
      to inbound edit/unsend events)
- [ ] Multi-account / remote iMessage line refinement

## License

[MIT](LICENSE)