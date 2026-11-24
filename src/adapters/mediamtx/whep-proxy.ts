import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Peer } from '../../application/control-arbiter.ts';
import { PayloadTooLarge, readText } from '../http/http-util.ts';
import { sanitizeOffer } from './sdp.ts';

const MAX_OFFER_BYTES = 16 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;

type WhepProxyOptions = {
  /** Media server WebRTC HTTP base, e.g. http://127.0.0.1:8889 */
  upstream: string;
  /** Media server path the stream is published on (from configuration, never from a browser). */
  path: string;
  /** Addresses viewers may never offer as ICE candidates (e.g. the PS5). */
  blockedCandidateAddresses?: readonly string[];
  upstreamTimeoutMs?: number;
  /** Called once a viewer's session is set up (e.g. to ask the console for a keyframe). */
  onSession?: () => void;
};

/**
 * WHEP signaling relay: browsers talk only to this server, which forwards the SDP offer to the
 * loopback-only media server. One session per person: a new offer replaces the old one,
 * so a reloaded tab never leaves a stale stream running.
 */
export class WhepProxy {
  readonly #o: Required<WhepProxyOptions>;
  readonly #sessions = new Map<string, string>();

  constructor(options: WhepProxyOptions) {
    this.#o = {
      blockedCandidateAddresses: [],
      upstreamTimeoutMs: UPSTREAM_TIMEOUT_MS,
      onSession: () => {},
      ...options,
      upstream: options.upstream.replace(/\/$/, ''),
    };
  }

  async handle(req: IncomingMessage, res: ServerResponse, peer: Peer): Promise<void> {
    const role = peer.role === 'host' ? 'host' : `guest:${peer.name}`;
    if (req.method === 'DELETE') {
      await this.disconnect(role);
      res.writeHead(204).end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST, DELETE' }).end();
      return;
    }
    let offer: string;
    try {
      offer = await readText(req, MAX_OFFER_BYTES);
    } catch (error) {
      if (error instanceof PayloadTooLarge) return void res.writeHead(413).end('Offer too large');
      throw error;
    }
    await this.disconnect(role);

    let upstream: Response;
    let answer: string;
    try {
      upstream = await fetch(`${this.#o.upstream}/${this.#o.path}/whep`, {
        method: 'POST',
        headers: { 'content-type': 'application/sdp' },
        body: sanitizeOffer(offer, this.#o.blockedCandidateAddresses.filter(Boolean)),
        signal: AbortSignal.timeout(this.#o.upstreamTimeoutMs),
      });
      answer = await upstream.text();
    } catch {
      return void res.writeHead(503).end('Video server unavailable');
    }
    if (upstream.status === 404) return void res.writeHead(503).end('Stream offline');
    if (!upstream.ok) return void res.writeHead(502).end('Video server error');

    const location = upstream.headers.get('location');
    if (location) this.#sessions.set(role, new URL(location, this.#o.upstream).href);
    res.writeHead(201, { 'content-type': 'application/sdp' }).end(answer);
    this.#o.onSession();
  }

  /** Tears down whatever session a person left open. */
  async disconnect(role: string): Promise<void> {
    const session = this.#sessions.get(role);
    if (!session) return;
    this.#sessions.delete(role);
    try {
      await fetch(session, { method: 'DELETE', signal: AbortSignal.timeout(this.#o.upstreamTimeoutMs) });
    } catch {
      // The media server also drops the session on its own once ICE times out.
    }
  }
}
