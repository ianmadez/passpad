# Security model

**Who can connect.** Identity is the TCP peer address (`src/adapters/http/roles.ts`):

- Loopback and `HOST_TAILSCALE_IP` are the host.
- Each `GUESTS` IP is that guest.
- Anyone else gets 403 on every HTTP route and on the WebSocket upgrade.

Over Tailscale, WireGuard authenticates the source address, so it can't be spoofed. Forwarding
headers (`X-Forwarded-For`) are never read: nothing proxies the server, and any client could send
them.

**Cross-site requests.** WebSocket upgrades and video offers need an `Origin` that matches `Host`.
A website open in the host's browser can't drive `ws://127.0.0.1:3000`, for example to press
"grant".

**What a guest can do:**

- Send controller frames, which reach the console only while that guest holds the pad.
- Ask for control, ping, set a display name, and ask for a keyframe (rate-limited).

Grant, reclaim, the timer, PS5 connect/disconnect and quality are host-only. Messages are size- and
rate-limited, and every value is parsed and clamped (`parseControllerState`, `cleanName`).

**Control lock** (`src/application/control-arbiter.ts`). Locked by default. These all send a
neutral controller state first, so nothing stays held:

- reclaim
- turn expiry
- 20 s of silence from the guest
- switching to another guest

**Network surface (Windows host):**

- Inbound TCP 3000 and UDP 8189 are allowed only from `100.64.0.0/10`.
- Block rules stop `bun.exe` and `mediamtx.exe` from accepting anything outside the tailnet, even
  if someone clicks "allow" on a Windows prompt.
- The MediaMTX API, RTSP and WHEP listeners are loopback-only.
- Publishing the video needs a generated password. It goes to chiaki-ng and MediaMTX in the
  environment, never on a command line.
- ICE offers only the Tailscale and loopback addresses, with no STUN.
- The PS5's LAN address is stripped from browser offers (`src/adapters/mediamtx/sdp.ts`).

**Downloads.** The starter checks Bun, MediaMTX, chiaki-ng and updates against their published
SHA-256 sums before use. `config/host.env` is readable only by the Windows user.

**PSN.** Pairing happens once, in chiaki-ng, on the host laptop. PassPad never handles PSN
credentials. A free secondary PSN account keeps the host's saves and wallet out of reach.
