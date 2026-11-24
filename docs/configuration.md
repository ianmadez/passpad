# Configuration

Settings come from the environment, validated in `src/adapters/config/env-config.ts`. On the host
laptop, `START-PassPad.cmd` writes them to `config/host.env`, which only that Windows user can read.
A `passpad.env` file next to the starter pre-fills the setup questions (for example
`GUESTS=100.64.0.2`) before you send the folder to a friend.

| Variable                                 | Default                          | Meaning                                                           |
| ---------------------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| `GUESTS`                                 | required with chiaki             | Up to 4 friends: `100.64.0.2,100.64.0.3` or `Ian=100.64.0.2,...`  |
| `GUEST_TAILSCALE_IP`, `GUEST_NAME`       |                                  | Single-guest shorthand for `GUESTS`                               |
| `HOST_TAILSCALE_IP`                      | set by the starter               | The host laptop's Tailscale IP (counts as the host too)           |
| `TURN_MINUTES`                           | `15`                             | Default turn length (1-60); the host changes it on the page       |
| `CONSOLE`                                | `simulated`                      | `chiaki` for a real PS5                                           |
| `PS5_HOST_IP`                            | required with chiaki             | The PS5's LAN address (the starter finds it automatically)        |
| `STREAM_RESOLUTION`                      | `1080p`                          | `1080p` or `720p`. 1080p drops to 720p if no picture within ~25 s |
| `STREAM_BITRATE_1080P`, `STREAM_BITRATE` | `15000`, `7000`                  | kbit/s at 1080p and at 720p (0 = chiaki-ng chooses)               |
| `CHIAKI_EXE`                             | `vendor/chiaki/chiaki.exe`       | Patched chiaki-ng                                                 |
| `CHIAKI_INPUT_PORT`                      | `9370`                           | Loopback UDP port for controller input                            |
| `VIDEO`                                  | `webrtc` with chiaki, else `off` | Video on or off                                                   |
| `MEDIAMTX_API_USER`, `MEDIAMTX_API_PASS` | generated                        | MediaMTX publisher/API credentials                                |
| `MEDIAMTX_URL`, `MEDIAMTX_API_URL`       | `http://127.0.0.1:8889`, `:9997` | Must be on this machine                                           |
| `HOST`, `PORT`                           | `0.0.0.0`, `3000`                | Listen address. The IP allowlist and firewall decide who gets in  |

Before every connection the server writes chiaki-ng's own settings (H.264, 60 fps, resolution,
bitrate) to `HKCU\Software\Chiaki\Chiaki\settings`. H.264 is required: Firefox can't play the
PS5's default HEVC over WebRTC.
