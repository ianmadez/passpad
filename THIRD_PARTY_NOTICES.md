# Third-party notices

This project is MIT licensed (see `LICENSE`), except for the parts listed below, which keep their own licenses.

| Component             | Where                                  | License                                  | Notes                                                                                                                                                                                                      |
| --------------------- | -------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| chiaki-ng patches     | `chiaki/`                              | AGPL-3.0-only with the OpenSSL exception | Derivative of [chiaki-ng](https://github.com/streetpea/chiaki-ng). See `chiaki/NOTICE` and `chiaki/LICENSE`. chiaki-ng itself is downloaded and built by `scripts/build-chiaki.sh`; it is not stored here. |
| MediaMTX              | not bundled                            | MIT                                      | [bluenviron/mediamtx](https://github.com/bluenviron/mediamtx). Installed with Homebrew or built by `scripts/build-mediamtx.sh`, which changes one constant.                                                |
| Jost                  | `assets/fonts/Jost.ttf`                | SIL OFL 1.1                              | Copyright 2020 The Jost Project Authors. License: `assets/fonts/OFL-Jost.txt`.                                                                                                                             |
| Big Shoulders Display | `assets/fonts/BigShouldersDisplay.ttf` | SIL OFL 1.1                              | Copyright 2019 The Big Shoulders Project Authors. License: `assets/fonts/OFL-BigShouldersDisplay.txt`.                                                                                                     |

## npm packages

Runtime dependencies:

| Package                                                   | License                          |
| --------------------------------------------------------- | -------------------------------- |
| [ws](https://github.com/websockets/ws)                    | MIT                              |
| [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) | MIT (bundles Skia, BSD-3-Clause) |

Development dependencies (not shipped to users):

| Package                 | License    |
| ----------------------- | ---------- |
| typescript              | Apache-2.0 |
| oxlint, oxlint-tsgolint | MIT        |
| oxfmt                   | MIT        |
| @types/bun, @types/ws   | MIT        |

## External services and tools (not bundled)

START-PassPad.cmd downloads Bun (MIT), MediaMTX (MIT) and the patched chiaki-ng build (AGPL-3.0, source: chiaki-ng plus `chiaki/*.patch`) from their GitHub releases, and installs Tailscale through winget; each keeps its own license and terms.

"PlayStation", "PS5" and "DualSense" are trademarks of Sony Interactive Entertainment Inc. This project is not affiliated with or endorsed by Sony or any game publisher.
