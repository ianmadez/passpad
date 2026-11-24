/**
 * Composition root: reads the configuration, builds every component, wires them together and
 * starts the HTTP/WebSocket server. No business logic lives here.
 */
import { join, resolve } from 'node:path';
import { type Config, ConfigError, loadConfig, type Quality } from './adapters/config/env-config.ts';
import { ChiakiConsole } from './adapters/console/chiaki-console.ts';
import { ChiakiProcess, type ChiakiStatus } from './adapters/console/chiaki-process.ts';
import { SimulatedConsole } from './adapters/console/simulated-console.ts';
import { createHttpServer } from './adapters/http/http-server.ts';
import { LogBook } from './adapters/logging/log-book.ts';
import { StreamHealth } from './adapters/mediamtx/stream-health.ts';
import { WhepProxy } from './adapters/mediamtx/whep-proxy.ts';
import { ControlGateway } from './adapters/ws/control-gateway.ts';
import { APP_NAME, ISSUES_URL, VERSION } from './app-info.ts';
import { ControlArbiter } from './application/control-arbiter.ts';
import { KeyframeRequests } from './application/keyframe-requests.ts';
import type { ConsoleAdapter } from './application/ports.ts';
import { RateLimiter } from './application/rate-limiter.ts';

const ROOT = join(import.meta.dirname, '..');
const PUBLIC_DIR = join(ROOT, 'public');
const SIMULATOR_FRAME_MS = 50;
/** MediaMTX path the console video is published on. */
const VIDEO_PATH = 'console';

function readConfig(): Config {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

function main(): void {
  const logs = new LogBook(process.env.LOG_FILE === 'off' ? null : join(ROOT, 'logs', 'passpad.log'));
  logs.captureConsole();
  console.log(`${APP_NAME} ${VERSION} starting (${process.platform}, Bun ${process.versions.bun ?? '?'})`);
  const config = readConfig();
  const simulator = config.console.kind === 'simulated' ? new SimulatedConsole() : null;
  const device: ConsoleAdapter =
    config.console.kind === 'chiaki' ? new ChiakiConsole({ port: config.console.inputPort }) : simulator!;
  let gateway: ControlGateway | null = null;
  let videoUp = false;

  let lastController: string | null = null;
  const arbiter = new ControlArbiter({
    device,
    turnMinutes: config.turnMinutes,
    onChange: (control) => {
      if (control.controller !== lastController)
        console.log(control.controller ? `${control.controller} has the pad.` : 'Host has the pad.');
      lastController = control.controller;
      gateway?.broadcast({ type: 'control', ...control });
    },
  });
  setInterval(() => arbiter.tick(), 1000).unref();
  const keyframes = new KeyframeRequests({
    send: device.requestKeyframe ? () => device.requestKeyframe?.() : null,
    minIntervalMs: 2000,
  });

  // ---------- chiaki-ng ----------
  let chiaki: ChiakiProcess | null = null;
  let chiakiState: { status: ChiakiStatus; quality: Quality } = { status: 'idle', quality: '1080p' };
  if (config.console.kind === 'chiaki' && config.video) {
    const { console: c, video } = config;
    chiaki = new ChiakiProcess({
      exe: resolve(ROOT, c.chiakiExe),
      ps5Ip: c.ps5Ip,
      inputPort: c.inputPort,
      streamOutUrl: `rtsp://${video.apiUser}:${video.apiPass}@127.0.0.1:8554/${VIDEO_PATH}`,
      quality: c.quality,
      bitrate: c.bitrate,
      isVideoUp: () => videoUp,
      onLog: (() => {
        // chiaki-ng can be chatty when the network hiccups: keep at most 30 lines a second.
        let windowStart = 0;
        let count = 0;
        return (line: string) => {
          const now = Date.now();
          if (now - windowStart > 1000) {
            windowStart = now;
            count = 0;
          }
          if (++count <= 30) logs.add('info', 'chiaki', line);
        };
      })(),
      onStatus: (status, quality) => {
        chiakiState = { status, quality };
        gateway?.broadcast({ type: 'chiaki', ...chiakiState });
      },
    });
    chiakiState = { status: chiaki.status, quality: chiaki.quality };
  }

  // ---------- video ----------
  const whep = config.video
    ? new WhepProxy({
        upstream: config.video.mediamtxUrl,
        path: VIDEO_PATH,
        blockedCandidateAddresses: config.console.kind === 'chiaki' ? [config.console.ps5Ip] : [],
        onSession: () => keyframes.request(),
      })
    : null;
  if (config.video) {
    const { apiUser, apiPass, mediamtxApiUrl } = config.video;
    new StreamHealth({
      apiUrl: mediamtxApiUrl,
      authorization: `Basic ${Buffer.from(`${apiUser}:${apiPass}`).toString('base64')}`,
      path: VIDEO_PATH,
      onChange: (up) => {
        videoUp = up;
        console.log(up ? 'PS5 video is live.' : 'PS5 video stopped.');
        gateway?.broadcast({ type: 'video', up });
      },
    }).start(1000);
  }

  // ---------- HTTP and WebSocket ----------
  const server = createHttpServer({
    publicDir: PUBLIC_DIR,
    identity: config.identity,
    video: whep,
    limiter: new RateLimiter({ capacity: 120, perSecond: 60 }),
    logs: () => logs.recent(),
    clientConfig: (peer) => ({
      name: APP_NAME,
      version: VERSION,
      issuesUrl: ISSUES_URL,
      role: peer.role,
      console: config.console.kind,
      video: config.video ? 'webrtc' : 'off',
    }),
  });
  gateway = new ControlGateway({
    server,
    identity: config.identity,
    arbiter,
    onClientError: (who, text) => logs.add('error', `page:${who}`, text),
    snapshot: () => ({
      guests: config.identity.guests.map((g) => g.name),
      online: gateway?.online() ?? [],
      names: gateway?.displayNames() ?? {},
      control: arbiter.snapshot(),
      serverNow: Date.now(),
      version: VERSION,
      issuesUrl: ISSUES_URL,
      shareUrl: config.identity.hostIp ? `http://${config.identity.hostIp}:${config.http.port}` : '',
      chiaki: chiakiState,
      video: videoUp,
      console: config.console.kind,
    }),
    commands: {
      connect: () => void chiaki?.connect(),
      disconnect: () => {
        arbiter.reclaim({ role: 'host' });
        chiaki?.disconnect();
      },
      setQuality: (value) => {
        if (value === '1080p' || value === '720p') void chiaki?.setQuality(value);
      },
      requestKeyframe: () => keyframes.request(),
    },
  });
  const live = gateway;

  if (simulator) {
    setInterval(() => {
      simulator.step(SIMULATOR_FRAME_MS);
      if (live.socketCount > 0) live.broadcast({ type: 'frame', ...simulator.frame() });
    }, SIMULATOR_FRAME_MS).unref();
  }

  const shutdown = () => {
    logs.flush();
    arbiter.reclaim({ role: 'host' });
    chiaki?.disconnect();
    process.exit(0);
  };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGBREAK'] as const) process.on(signal, shutdown);
  process.on('unhandledRejection', (error) => console.error('Unhandled rejection:', error));
  process.on('uncaughtException', (error) => console.error('Uncaught exception:', error));

  server.listen(config.http.port, config.http.host, () => {
    console.log(`${APP_NAME} ready: open http://127.0.0.1:${config.http.port} on this laptop.`);
    if (config.identity.hostIp) console.log(`Friends open http://${config.identity.hostIp}:${config.http.port}`);
  });
}

main();
