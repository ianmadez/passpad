# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Before you start

- For anything larger than a small fix, open an issue first so we can agree on the approach.
- Keep the project game-agnostic and free of any game's art, names or controls.
- Read [AGENTS.md](AGENTS.md) for the layout and conventions; they apply to humans too.

## Development

```bash
bun install
bun start        # simulated console at http://localhost:3000
bun run format   # format with oxfmt
bun run check    # typecheck + lint + format check + tests
```

[Bun](https://bun.sh) 1.4 or newer is required. There is no build step.

## Pull requests

- One topic per pull request, with tests for behavior changes.
- `bun run check` must pass, and `scripts/*.ps1` must parse in Windows PowerShell 5.1.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`...).
- Document new settings in `docs/configuration.md` and `.env.example`.
- Never include secrets, personal data or real IP addresses in code, tests or examples. Use the
  documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`) and
  `example.com`.

## Licensing

By contributing you agree that your contribution is licensed under the MIT license, except changes
to files in `chiaki/`, which are licensed under AGPL-3.0 like chiaki-ng (see `chiaki/NOTICE`).
