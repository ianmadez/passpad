# Test log and next steps

A living doc: what real tests showed, and what to try next. It gets updated after each test session.

## First real test (v0.2.2): what to check

Write down what you see for each step. Numbers come from the readout in the top-left and the
fps/loss/jitter chip.

1. **Setup:** did START-PassPad finish on Patrick's laptop? Where did it get stuck, if anywhere?
   (Any error panel → Report on GitHub.)
2. **Tailscale path:** `START-PassPad.cmd doctor`. Is it "reachable directly" or "through a relay"?
3. **Video:** 1080p or did it fall back to 720p? fps, loss % and jitter on your side.
4. **Ping:** the `ms` number on your side, idle and while playing.
5. **Feel:** how laggy does driving feel (fine / playable / bad)? Do inputs ever stick or stutter?
6. **Controller:** do all buttons work, including the triggers (analog) and the touchpad combo?
7. **Control lock:** does Pass to / Take back / the timer work the way you expect?
8. **Anything weird:** UI glitches, sound, disconnects.

## Results

_Nothing yet. Filled in after the first test._

## Next to try: input over a WebRTC data channel (candidate for v0.3)

**Problem.** Controller input now travels over a WebSocket, which runs on TCP. TCP delivers
everything in order, so on a long, slightly lossy link (Netherlands ↔ Malaysia) one lost packet
holds back every input after it until it's resent, about one round trip (~180 ms). That shows up
as occasional "the car kept turning" hiccups, not as constant lag.

**Fix.** Send input over a WebRTC data channel set to `ordered: false, maxRetransmits: 0`. That
works like plain UDP: a lost packet is simply skipped, because the next one (sent at least every
100 ms, usually every 4 ms while you're moving) carries the full controller state anyway. The
video already uses WebRTC, so the browser side is easy.

**What it takes:**

- A WebRTC stack in the server, for example `werift` (pure TypeScript, no native build).
  MediaMTX can't carry data channels for us.
- One more UDP port, allowed in the firewall from Tailscale only, like 8189.
- Keep the WebSocket as the fallback and for everything else (grant, timer, names); only
  controller frames move.
- The same rules as today: the server ignores the data channel unless that peer holds the pad.

**Do it if** the first test shows input hiccups or stutter while the ping is otherwise fine, or
loss above roughly 0.5%. **Skip it if** input feels consistent; then the lag is mostly distance
plus the PS5's encoding, which this doesn't change.

**Other ideas, lower priority:**

- Show the PS5 bitrate and add a "bitrate" picker (needs a reconnect of chiaki-ng).
- Auto-suggest 720p when loss stays high for a minute.
- Measure input-to-screen delay with a test pattern, so changes can be compared with numbers.
