import type { Peer } from '../../application/control-arbiter.ts';

type RequestLike = { socket: { remoteAddress?: string | undefined } };

export type Guest = { name: string; ip: string };
export type Identity = { hostIp: string; guests: readonly Guest[] };

/** "::ffff:100.1.2.3" → "100.1.2.3". */
export function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/**
 * Who is asking, from the TCP peer address only. Over Tailscale that address is authenticated by
 * WireGuard, so it cannot be spoofed; forwarding headers (X-Forwarded-For) are never read because
 * nothing proxies this server and any page could send them.
 *
 * @returns null for anyone else: they get 403.
 */
export function peerOf(req: RequestLike, identity: Identity): Peer | null {
  const ip = normalizeIp(req.socket.remoteAddress ?? '');
  if (!ip) return null;
  if (ip === '127.0.0.1' || ip === '::1' || (identity.hostIp && ip === identity.hostIp)) return { role: 'host' };
  const guest = identity.guests.find((g) => g.ip === ip);
  return guest ? { role: 'guest', name: guest.name } : null;
}

/**
 * Blocks other websites from talking to this server through someone's browser (a page could
 * otherwise open ws://127.0.0.1:3000 and press "grant"). A missing Origin (non-browser) passes,
 * since those clients are already limited by the IP allowlist.
 */
export function sameOrigin(headers: { origin?: string | undefined; host?: string | undefined }): boolean {
  if (!headers.origin) return true;
  const origin = URL.parse(headers.origin);
  return origin !== null && origin.host === headers.host;
}
