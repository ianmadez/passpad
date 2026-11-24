import { realpathSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join, normalize, sep } from 'node:path';
import type { Peer } from '../../application/control-arbiter.ts';
import type { Logger } from '../../application/ports.ts';
import type { RateLimiter } from '../../application/rate-limiter.ts';
import type { WhepProxy } from '../mediamtx/whep-proxy.ts';
import { type Identity, peerOf, sameOrigin } from './roles.ts';
import { StaticFiles } from './static-files.ts';

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; '),
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), geolocation=(), microphone=()',
};

type HttpServerOptions = {
  publicDir: string;
  identity: Identity;
  video: WhepProxy | null;
  /** Non-secret settings the page needs, per role (`/config.json`). */
  clientConfig: (peer: Peer) => object;
  limiter: RateLimiter;
  /** Recent log lines for the host's "copy details" button. */
  logs: () => string[];
  log?: Logger;
};

/** Builds the HTTP server: the Tailscale identity gate first, then a handful of routes. */
export function createHttpServer(options: HttpServerOptions): Server {
  const log = options.log ?? console.warn;
  const files = new StaticFiles();
  const publicDir = realpathSync(options.publicDir);

  const server = createServer(async (req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    const peer = peerOf(req, options.identity);
    if (!peer) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
      return;
    }
    if (!options.limiter.take(peer.role === 'host' ? 'host' : peer.name)) {
      res.writeHead(429, { 'retry-after': '1' }).end('Too many requests');
      return;
    }
    try {
      await route(req, res, peer);
    } catch (error) {
      log(`Request failed: ${(error as Error).message}`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.maxConnections = 200;
  return server;

  async function route(req: IncomingMessage, res: ServerResponse, peer: Peer): Promise<void> {
    const url = URL.parse(req.url ?? '/', 'http://localhost');
    if (!url) return void res.writeHead(400).end('Bad request');
    if (url.pathname === '/config.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return void res.end(JSON.stringify(options.clientConfig(peer)));
    }
    if (url.pathname === '/api/logs') {
      if (peer.role !== 'host') return void res.writeHead(403).end('Forbidden');
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return void res.end(JSON.stringify({ lines: options.logs() }));
    }
    if (url.pathname === '/api/video') {
      if (!options.video) return void res.writeHead(404).end('Video is off');
      if (!sameOrigin(req.headers)) return void res.writeHead(403).end('Forbidden');
      return options.video.handle(req, res, peer);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405, { allow: 'GET, HEAD' }).end();
    await serveFile(req, res, url.pathname);
  }

  async function serveFile(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    let relative: string;
    try {
      relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    } catch {
      return void res.writeHead(400).end('Bad request');
    }
    const file = normalize(join(publicDir, relative));
    if (!file.startsWith(publicDir + sep)) return notFound(res);
    try {
      // A link inside public/ must not reach files outside it.
      const real = await realpath(file);
      if (!real.startsWith(publicDir + sep)) return notFound(res);
      const reply = await files.serve(real, {
        acceptEncoding: header(req, 'accept-encoding'),
        ifNoneMatch: header(req, 'if-none-match'),
      });
      res.writeHead(reply.status, reply.headers);
      res.end(req.method === 'HEAD' ? undefined : (reply.body ?? undefined));
    } catch {
      notFound(res);
    }
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
}
