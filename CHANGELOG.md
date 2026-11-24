# Patch notes

## v0.2.2: ping and fps on screen

- **Ping and fps on screen:** a thin white readout in the top-left corner of the video, always
  visible while you play.

## v0.2.1 — less lag

- **Faster controls:** every button press and stick move is sent the instant it happens, with
  no more waiting up to 8 ms to batch it.
- **No more network batching:** turned off the TCP setting (Nagle's algorithm) that could hold
  small input messages back by up to ~40 ms.
- **Less wasted traffic:** stick movements are rounded to the precision the PS5 actually reads, so
  tiny wobbles from cheap controllers no longer flood the connection.
- **Quicker recovery:** if a packet goes missing, the controller state is resent within 100 ms
  (was 200 ms).
- **Frozen picture fixed faster:** a stuck video asks for a fresh frame after 0.45 s (was 0.7 s).
- **Less stale video:** the video server keeps a shorter backlog, so after a hiccup you see what's
  happening now instead of catching up on old frames.
- **Snappier host laptop:** the PassPad server now runs at higher priority, like the video service.
- **New connection meter:** a chip at the top shows fps, packet loss and jitter, green, amber or
  red, so you can tell whether lag comes from the internet or the PS5.

## v0.2.0 — PassPad is born

The first version of PassPad, a private fork of PlayGTA by
[@germanfndez](https://github.com/germanfndez).

- **Share your PS5 with 1–4 friends** over Tailscale, right in the browser. Nothing is opened to
  the internet.
- **You stay in charge:** friends' controllers are locked until you pass them the pad. A
  countdown (10/12/15 minutes or your own length) hands it back automatically, and `Esc` takes it
  back instantly.
- **Ask for the pad:** friends can request a turn, and the host hears a chime.
- **1080p at 60 fps**, dropping to 720p by itself if 1080p won't start.
- **Everyone types their own name** when they open the page.
- **One-click setup for the host:** START-PassPad installs Tailscale, finds the PS5, sets up the
  firewall, walks through pairing and adds a desktop shortcut. Extras: `doctor`, `setup`,
  `update`, `autostart`.
- **One-click join for friends:** JOIN-PassPad.
- **Screenshots and clips** from the page.
- **Works with off-brand controllers:** Back+Y, L3+R3 or Tab act as the touchpad, and the stick
  dead zone is adjustable.
- **When something breaks:** a panel with "Copy details" and "Report on GitHub" (passwords are
  removed automatically), plus logs saved on the host.
- **Polished UI:** hover and click animations, a live input view for the host, works on small
  screens.
- **Lighter on memory:** fixed an audio leak, clips are capped at 5 minutes, and the video
  decoder is freed when the picture stops.
