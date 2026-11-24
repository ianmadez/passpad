import { describe, expect, it } from 'bun:test';
import { loadConfig } from '../src/adapters/config/env-config.ts';
import { chiakiSettings, parseHostList } from '../src/adapters/console/chiaki-process.ts';
import { peerOf, sameOrigin } from '../src/adapters/http/roles.ts';
import { redact } from '../src/adapters/logging/log-book.ts';
import { ControlArbiter } from '../src/application/control-arbiter.ts';
import { NEUTRAL_STATE, parseControllerState } from '../src/domain/controller-state.ts';
import { FakeClock, RecordingConsole } from './helpers.ts';

const req = (ip: string) => ({ socket: { remoteAddress: ip } });
const gas = parseControllerState({ triggers: { r2: 1 }, sticks: { lx: -1 } })!;

const HOST = { role: 'host' } as const;
const IAN = { role: 'guest', name: 'Ian' } as const;
const SAM = { role: 'guest', name: 'Sam' } as const;
const identity = {
  hostIp: '100.64.0.1',
  guests: [
    { name: 'Ian', ip: '100.64.0.2' },
    { name: 'Sam', ip: '100.64.0.3' },
  ],
};

function setup(turnMinutes = 10) {
  const device = new RecordingConsole();
  const clock = new FakeClock();
  const changes: Array<string | null> = [];
  const arbiter = new ControlArbiter({
    device,
    turnMinutes,
    now: clock.read,
    onChange: (c) => changes.push(c.controller),
  });
  return { device, clock, changes, arbiter };
}

describe('roles', () => {
  it('maps loopback and the host IP to host, each guest IP to that guest, anyone else to nobody', () => {
    expect(peerOf(req('127.0.0.1'), identity)).toStrictEqual(HOST);
    expect(peerOf(req('::ffff:127.0.0.1'), identity)).toStrictEqual(HOST);
    expect(peerOf(req('::1'), identity)).toStrictEqual(HOST);
    expect(peerOf(req('100.64.0.1'), identity)).toStrictEqual(HOST);
    expect(peerOf(req('100.64.0.2'), identity)).toStrictEqual(IAN);
    expect(peerOf(req('100.64.0.3'), identity)).toStrictEqual(SAM);
    expect(peerOf(req('100.64.0.9'), identity)).toBeNull();
    expect(peerOf(req('192.168.1.20'), identity)).toBeNull();
    expect(peerOf(req(''), identity)).toBeNull();
  });

  it('rejects cross-site browser requests', () => {
    expect(sameOrigin({ origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000' })).toBe(true);
    expect(sameOrigin({ origin: 'https://evil.example', host: '127.0.0.1:3000' })).toBe(false);
    expect(sameOrigin({ host: '127.0.0.1:3000' })).toBe(true);
  });
});

describe('control arbiter', () => {
  it('starts locked: guest input never reaches the console', () => {
    const { arbiter, device } = setup();
    expect(arbiter.snapshot().controller).toBeNull();
    expect(arbiter.input(IAN, gas)).toBe(false);
    expect(device.applied).toHaveLength(0);
  });

  it('only the host grants, and only the guest in control drives', () => {
    const { arbiter, changes } = setup();
    expect(arbiter.grant(IAN, 'Ian')).toBe(false);
    expect(arbiter.grant(HOST, 'Ian')).toBe(true);
    expect(arbiter.input(HOST, gas)).toBe(false);
    expect(arbiter.input(SAM, gas)).toBe(false);
    expect(arbiter.input(IAN, gas)).toBe(true);
    expect(arbiter.reclaim(IAN)).toBe(false);
    expect(changes).toStrictEqual(['Ian']);
  });

  it('reclaim flushes neutral input before locking, synchronously', () => {
    const { arbiter, device } = setup();
    arbiter.grant(HOST, 'Ian');
    arbiter.input(IAN, gas);
    arbiter.reclaim(HOST);
    expect(device.applied.at(-1)).toStrictEqual(NEUTRAL_STATE);
    expect(device.releases).toBe(1);
    expect(arbiter.snapshot().controller).toBeNull();
    expect(arbiter.input(IAN, gas)).toBe(false);
  });

  it('ends the turn when the timer runs out', () => {
    const { arbiter, clock } = setup(10);
    arbiter.grant(HOST, 'Ian');
    expect(arbiter.snapshot().endsAt).toBe(clock.now + 600_000);
    for (let s = 0; s < 599; s++) {
      clock.advance(1000);
      arbiter.input(IAN, gas);
      arbiter.tick();
    }
    expect(arbiter.snapshot().controller).toBe('Ian');
    clock.advance(1000);
    arbiter.tick();
    expect(arbiter.snapshot().controller).toBeNull();
  });

  it('the host can set the length and extend a turn', () => {
    const { arbiter, clock } = setup(15);
    arbiter.setTurnMinutes(HOST, 12);
    arbiter.setTurnMinutes(IAN, 60);
    arbiter.grant(HOST, 'Ian');
    arbiter.extend(HOST, 5);
    expect(arbiter.snapshot().endsAt).toBe(clock.now + 17 * 60_000);
    arbiter.setTurnMinutes(HOST, 999);
    expect(arbiter.snapshot().turnMinutes).toBe(60);
  });

  it('hands the pad back when the guest goes silent', () => {
    const { arbiter, clock } = setup();
    arbiter.grant(HOST, 'Ian');
    clock.advance(20_000);
    arbiter.tick();
    expect(arbiter.snapshot().controller).toBeNull();
  });

  it('collects control requests and clears them on grant or leave', () => {
    const { arbiter } = setup();
    arbiter.request(IAN);
    arbiter.request(IAN);
    arbiter.request(SAM);
    expect(arbiter.request(HOST)).toBe(false);
    expect(arbiter.snapshot().requests).toStrictEqual(['Ian', 'Sam']);
    arbiter.grant(HOST, 'Ian');
    arbiter.guestLeft('Sam');
    expect(arbiter.snapshot().requests).toStrictEqual([]);
  });

  it('switching guests neutralizes the first one', () => {
    const { arbiter, device } = setup();
    arbiter.grant(HOST, 'Ian');
    arbiter.grant(HOST, 'Sam');
    expect(device.applied.at(-1)).toStrictEqual(NEUTRAL_STATE);
    expect(arbiter.snapshot().controller).toBe('Sam');
  });
});

describe('config', () => {
  it('defaults to a simulated console', () => {
    const config = loadConfig({});
    expect(config.console.kind).toBe('simulated');
    expect(config.video).toBeNull();
  });

  it('needs the PS5 and guest IPs and MediaMTX credentials for chiaki', () => {
    expect(() => loadConfig({ CONSOLE: 'chiaki' })).toThrow();
    const config = loadConfig({
      CONSOLE: 'chiaki',
      PS5_HOST_IP: '192.168.1.50',
      GUESTS: 'Ian=100.64.0.2, Sam=100.64.0.3',
      MEDIAMTX_API_USER: 'u',
      MEDIAMTX_API_PASS: 'p',
    });
    expect(config.console.kind === 'chiaki' && config.console.quality).toBe('1080p');
    expect(config.video?.mediamtxUrl).toBe('http://127.0.0.1:8889');
    expect(config.identity.guests).toStrictEqual(identity.guests);
    expect(config.turnMinutes).toBe(15);
  });

  it('rejects bad values', () => {
    expect(() => loadConfig({ GUEST_TAILSCALE_IP: 'nope' })).toThrow();
    expect(() => loadConfig({ STREAM_RESOLUTION: '4k' })).toThrow();
    expect(() => loadConfig({ GUESTS: 'A=100.64.0.2,A=100.64.0.3' })).toThrow();
    expect(() => loadConfig({ GUESTS: 'A=1.1.1.1,B=1.1.1.2,C=1.1.1.3,D=1.1.1.4,E=1.1.1.5' })).toThrow();
    expect(() => loadConfig({ GUESTS: '<script>=100.64.0.2' })).toThrow();
    expect(() =>
      loadConfig({
        VIDEO: 'webrtc',
        MEDIAMTX_API_USER: 'u',
        MEDIAMTX_API_PASS: 'p',
        MEDIAMTX_URL: 'http://example.com',
      }),
    ).toThrow();
  });
});

describe('chiaki-ng helpers', () => {
  it('reads registered consoles from `chiaki list`', () => {
    expect(parseHostList('Host: Living Room \r\nHost: PS5-123 \n')).toStrictEqual(['Living Room', 'PS5-123']);
    expect(parseHostList('')).toStrictEqual([]);
  });

  it('forces H.264 at 60 fps', () => {
    const values = Object.fromEntries(chiakiSettings('720p', 7000).map(([n, , d]) => [n, d]));
    expect(values).toStrictEqual({
      resolution_local_ps5: '720p',
      fps_local_ps5: '60',
      codec_local_ps5: 'h264',
      bitrate_local_ps5: '7000',
    });
  });
});

describe('log redaction', () => {
  it('removes URL passwords and secret-looking values', () => {
    expect(redact('pub rtsp://passpad-api:s3cr3t@127.0.0.1:8554/console')).toBe(
      'pub rtsp://***@127.0.0.1:8554/console',
    );
    expect(redact('MEDIAMTX_API_PASS=abc123 ok')).not.toContain('abc123');
    expect(redact('token: xyz')).not.toContain('xyz');
    expect(redact('normal line')).toBe('normal line');
  });
});
