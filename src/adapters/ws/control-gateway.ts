import type { IncomingMessage, Server } from 'node:http';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import { decodeInput } from '../../../public/js/input-codec.js';
import type { ControlArbiter, Peer } from '../../application/control-arbiter.ts';
import { type ControllerState, parseControllerState } from '../../domain/controller-state.ts';
import { type Identity, peerOf, sameOrigin } from '../http/roles.ts';

/** Gamepads send up to ~125 frames/s plus pings. */
const MAX_MESSAGES_PER_SECOND = 400;
/** The host's input visualizer redraws at most this often. */
const VISUALIZER_MS = 33;
const MAX_BUFFERED_BYTES = 512 * 1024;

/** What the host's buttons can ask for besides the control lock. */
export type HostCommands = {
  connect(): void;
  disconnect(): void;
  setQuality(quality: string): void;
  requestKeyframe(): void;
};

type ControlGatewayOptions = {
  server: Server;
  identity: Identity;
  arbiter: ControlArbiter;
  commands: HostCommands;
  /** Everything a page needs on connect. */
  snapshot: () => object;
  /** A page reported an error (already truncated). */
  onClientError?: (who: string, text: string) => void;
};

type Message = { type?: unknown; value?: unknown; t?: unknown };

/** Letters, digits, spaces and a little punctuation; control and markup characters are dropped. */
export function cleanName(raw: string): string {
  return raw
    .replaceAll(/[^\p{L}\p{N} _.'-]/gu, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

const nameOf = (peer: Peer) => (peer.role === 'host' ? 'host' : peer.name);

/**
 * The one WebSocket every page uses. Identity is the Tailscale peer address (roles.ts): guests may
 * send controller frames, pings and "request control"; the host drives everything else.
 */
export class ControlGateway {
  readonly #sockets = new Map<WebSocket, Peer>();
  readonly #o: ControlGatewayOptions;
  /** Names people typed on their page, by peer id ("host" or the configured guest id). */
  readonly #displayNames = new Map<string, string>();
  #pendingInput: ControllerState | null = null;
  #visualizerPending = false;

  constructor(options: ControlGatewayOptions) {
    this.#o = options;
    const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
    options.server.on('upgrade', (req: IncomingMessage, socket, head) => {
      const peer = peerOf(req, options.identity);
      const path = URL.parse(req.url ?? '/', 'http://localhost')?.pathname;
      if (!peer || path !== '/ws' || !sameOrigin(req.headers)) {
        socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.#accept(ws, peer));
    });
  }

  /** Sends to every page, or only to the host's pages. */
  broadcast(message: object, hostOnly = false): void {
    const data = JSON.stringify(message);
    for (const [ws, peer] of this.#sockets) {
      if (hostOnly && peer.role !== 'host') continue;
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) ws.terminate();
      else ws.send(data);
    }
  }

  /** Feeds the host's live input visualizer, throttled. */
  showInput(state: ControllerState): void {
    this.#pendingInput = state;
    if (this.#visualizerPending) return;
    this.#visualizerPending = true;
    setTimeout(() => {
      this.#visualizerPending = false;
      if (this.#pendingInput) this.broadcast({ type: 'input', ...this.#pendingInput }, true);
      this.#pendingInput = null;
    }, VISUALIZER_MS);
  }

  /** Display names typed by people, by peer id. */
  displayNames(): Record<string, string> {
    return Object.fromEntries(this.#displayNames);
  }

  get socketCount(): number {
    return this.#sockets.size;
  }

  /** Names of everyone with a page open ("host" for the host). */
  online(): string[] {
    return [...new Set([...this.#sockets.values()].map(nameOf))];
  }

  #accept(ws: WebSocket, peer: Peer): void {
    this.#sockets.set(ws, peer);
    ws.send(JSON.stringify({ type: 'hello', you: nameOf(peer), role: peer.role, ...this.#o.snapshot() }));
    this.broadcast({ type: 'online', names: this.online() });
    let budget = MAX_MESSAGES_PER_SECOND;
    const refill = setInterval(() => (budget = MAX_MESSAGES_PER_SECOND), 1000);

    ws.on('message', (data: RawData, isBinary) => {
      if (--budget < 0 || !Buffer.isBuffer(data)) return;
      if (isBinary) {
        const frame = decodeInput(data);
        const state = frame && parseControllerState(frame);
        if (state && this.#o.arbiter.input(peer, state)) this.showInput(state);
        return;
      }
      let message: Message;
      try {
        message = JSON.parse(data.toString('utf8'));
      } catch {
        return;
      }
      this.#command(ws, peer, message);
    });
    ws.on('close', () => {
      clearInterval(refill);
      this.#sockets.delete(ws);
      const name = nameOf(peer);
      if (peer.role === 'guest' && !this.online().includes(name)) this.#o.arbiter.guestLeft(name);
      this.broadcast({ type: 'online', names: this.online() });
    });
  }

  #command(ws: WebSocket, peer: Peer, message: Message): void {
    const { arbiter, commands } = this.#o;
    const number = typeof message.value === 'number' ? message.value : Number.NaN;
    switch (message.type) {
      case 'ping':
        if (typeof message.t === 'number') ws.send(JSON.stringify({ type: 'pong', t: message.t }));
        return;
      case 'keyframe':
        return commands.requestKeyframe();
      case 'request':
        arbiter.request(peer);
        return;
      case 'client-error':
        if (typeof message.value === 'string') this.#o.onClientError?.(nameOf(peer), message.value.slice(0, 600));
        return;
      case 'name': {
        const name = typeof message.value === 'string' ? cleanName(message.value) : '';
        if (!name || this.#displayNames.get(nameOf(peer)) === name) return;
        this.#displayNames.set(nameOf(peer), name);
        this.broadcast({ type: 'names', names: this.displayNames() });
        return;
      }
      default:
    }
    if (peer.role !== 'host') return;
    switch (message.type) {
      case 'grant':
        if (typeof message.value === 'string' && this.#o.identity.guests.some((g) => g.name === message.value))
          arbiter.grant(peer, message.value);
        return;
      case 'reclaim':
        arbiter.reclaim(peer);
        return;
      case 'extend':
        arbiter.extend(peer, number);
        return;
      case 'turn-minutes':
        arbiter.setTurnMinutes(peer, number);
        return;
      case 'connect':
        return commands.connect();
      case 'disconnect':
        return commands.disconnect();
      case 'quality':
        if (typeof message.value === 'string') commands.setQuality(message.value);
        return;
      default:
    }
  }
}
