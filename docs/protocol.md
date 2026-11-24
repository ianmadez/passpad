# WebSocket protocol (`/ws`)

Each page opens one socket. Messages are JSON text, plus binary controller frames (15 bytes, see
`public/js/input-codec.js`).

## Server → page

| type      | fields                                                                                                       | when                        |
| --------- | ------------------------------------------------------------------------------------------------------------ | --------------------------- |
| `hello`   | `you`, `role`, `guests`, `online`, `names`, `control`, `chiaki`, `video`, `console`, `serverNow`, `shareUrl` | on connect                  |
| `control` | `controller` (guest id or null), `endsAt`, `turnMinutes`, `requests`                                         | lock or timer changes       |
| `online`  | `names`: ids with a page open (`host` for the host)                                                          | someone connects or leaves  |
| `names`   | `names`: id → display name                                                                                   | someone sets their name     |
| `chiaki`  | `status` (`missing`, `unpaired`, `idle`, `connecting`, `streaming`), `quality`                               | PS5 link changes            |
| `video`   | `up`                                                                                                         | stream starts or stops      |
| `input`   | `buttons`, `sticks`, `triggers` (host only, about 30 per second)                                             | guest input reaches the PS5 |
| `frame`   | simulator state                                                                                              | simulated console only      |
| `pong`    | `t`                                                                                                          | reply to `ping`             |

## Page → server

**Anyone:**

- a binary controller frame (applied only for the guest who has the pad)
- `ping {t}`
- `keyframe`
- `name {value}`
- `request` (guests)

**Host only:**

- `grant {value: guestId}`
- `reclaim`
- `extend {value: minutes}`
- `turn-minutes {value}`
- `connect`
- `disconnect`
- `quality {value: "1080p" | "720p"}`

**Video:** `POST /api/video` with an SDP offer (WHEP, relayed to MediaMTX); `DELETE /api/video` ends
it.
