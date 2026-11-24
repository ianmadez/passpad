# Security policy

## Reporting a vulnerability

Please report security issues privately, using GitHub's "Report a vulnerability" (private security
advisory) on this repository. Include what you found, how to reproduce it and the impact you expect.

## Scope

In scope: the server (`src/`), the web page (`public/`), the Windows scripts (`scripts/*.ps1`,
`*.cmd`), the release workflow and the chiaki-ng patches (`chiaki/`).

Out of scope: vulnerabilities in chiaki-ng, MediaMTX, Tailscale or Bun themselves (report them
upstream), and issues that need physical or admin access to the host laptop.

See [docs/security.md](docs/security.md) for the threat model.
