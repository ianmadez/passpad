# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## Project

PassPad shares one PS5 with 1-4 friends over Tailscale. On the Windows host laptop, a Bun server:

- decides who may drive the console (`ControlArbiter`: locked by default, timed turns),
- starts the patched chiaki-ng,
- relays WHEP video signaling to MediaMTX.

Read `README.md`, then `docs/security.md` and `docs/protocol.md`.

## Commands

| Task                    | Command                                                   |
| ----------------------- | --------------------------------------------------------- |
| Install                 | `bun install`                                             |
| Run (simulated console) | `bun start` (http://localhost:3000)                       |
| All checks              | `bun run check` (typecheck, lint, format, tests)          |
| Host starter (Windows)  | `START-PassPad.cmd` → `scripts/start-host.ps1`            |
| Friend starter          | `JOIN-PassPad.cmd` → `scripts/join.ps1`                   |
| Windows release         | push a `v*` tag (`.github/workflows/release-windows.yml`) |

Bun runs the TypeScript directly; there is no build step. Code uses `node:*` modules, not `Bun.*`.

## Layout

```
src/domain/        pure rules (controller state)
src/application/   control arbiter, rate limiter, keyframes, ports
src/adapters/      config, HTTP + roles, WebSocket gateway, chiaki-ng, MediaMTX
src/main.ts        composition root only
public/            the page: plain HTML, one CSS file, ES modules (no build)
scripts/           Windows starters (must run on Windows PowerShell 5.1)
mediamtx/          MediaMTX configuration
chiaki/            chiaki-ng patches and tests (AGPL-3.0, see chiaki/NOTICE)
test/              bun:test suites
```

## Conventions

- **TypeScript:**
  - Strict and erasable-only: no enums, no namespaces, no parameter properties.
  - Import local files with `.ts` and types with `import type`.
  - Private state uses `#fields`. TSDoc says why, not what.
- **Dependencies point inward:** `domain` ← `application` ← `adapters`. Inject time (`Clock`) and
  I/O so tests stay deterministic.
- **Untrusted input:** treat every browser value as untrusted; parse, bound and clamp it at the edge.
- **Configuration** comes only from `src/adapters/config/env-config.ts`. A new variable needs
  validation, a test and a row in `docs/configuration.md`.
- **PowerShell scripts:** no `??`, `?.` or `&&`, so they run on PowerShell 5.1.
- **Commits** use conventional prefixes (`feat:`, `fix:`, `docs:`, ...). The project name lives in
  `src/app-info.ts` and `package.json`.

## Rules for agents

- Run `bun run check` before you say a change is done; add tests for behavior changes.
- Tests use loopback and ephemeral ports. Never call real third-party services from tests.
- Do not commit `.env`, `config/`, `passpad.env`, `join.txt` or anything under `vendor/`.
- Do not run `START-PassPad.cmd` on someone's machine unless asked: it adds firewall rules (UAC).
- The human does the PS5 side and PSN pairing. Never ask them to paste secrets into the chat.
- Keep `chiaki/*.patch` applying cleanly to the pinned commit (`git apply --check`).
- A change to a WebSocket message or the input frame must update `docs/protocol.md`.
- Security-sensitive spots: `src/adapters/http/roles.ts` (identity, Origin), the SDP sanitizer,
  the firewall rules in `scripts/start-host.ps1`, and MediaMTX credentials. Update
  `docs/security.md` with them.
- Secrets never go on a command line; pass them in the environment or a file.
