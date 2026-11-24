import { isIP } from 'node:net';

/** Thrown with a message meant for the person running the server. */
export class ConfigError extends Error {}

export type Quality = '1080p' | '720p';

export type Config = {
  http: { host: string; port: number };
  identity: { hostIp: string; guests: Array<{ name: string; ip: string }> };
  turnMinutes: number;
  console:
    | { kind: 'simulated' }
    | {
        kind: 'chiaki';
        /** PS5 LAN address: never offered to browsers as an ICE candidate. */
        ps5Ip: string;
        chiakiExe: string;
        inputPort: number;
        quality: Quality;
        /** Kbit/s for each quality; 0 lets chiaki-ng choose. */
        bitrate: Record<Quality, number>;
      };
  video: null | {
    mediamtxUrl: string;
    mediamtxApiUrl: string;
    apiUser: string;
    apiPass: string;
  };
};

type Env = Record<string, string | undefined>;

function read(env: Env, key: string, fallback = ''): string {
  return env[key]?.trim() || fallback;
}

function int(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = read(env, key);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new ConfigError(`${key} must be a whole number from ${min} to ${max} (got "${raw}").`);
  return value;
}

function ip(env: Env, key: string, required: boolean): string {
  const raw = read(env, key);
  if (!raw) {
    if (required) throw new ConfigError(`${key} is required. Run START-PassPad.cmd again to set it.`);
    return '';
  }
  if (!isIP(raw)) throw new ConfigError(`${key} must be an IP address (got "${raw}").`);
  return raw;
}

function loopbackHttp(env: Env, key: string, fallback: string): string {
  const raw = read(env, key, fallback);
  const url = URL.parse(raw);
  if (!url || url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new ConfigError(`${key} must be an http:// URL on this machine (got "${raw}").`);
  return raw.replace(/\/+$/, '');
}

const MAX_GUESTS = 4;
const NAME = /^[\p{L}\p{N} _.-]{1,24}$/u;

/**
 * GUESTS="100.64.0.2, 100.64.0.3" or "Ian=100.64.0.2, ..." (up to four). GUEST_NAME + GUEST_TAILSCALE_IP still
 * work for a single guest.
 */
function guests(env: Env, required: boolean): Array<{ name: string; ip: string }> {
  const raw = read(env, 'GUESTS');
  const single = read(env, 'GUEST_TAILSCALE_IP');
  const entries = raw
    ? raw.split(',').map((part, i) => {
        // "100.64.0.2" alone is fine: people type their own display name on the page.
        const pieces = part.split('=').map((s) => s.trim());
        return pieces.length === 1 ? [`Guest ${i + 1}`, pieces[0] ?? ''] : pieces;
      })
    : single
      ? [[read(env, 'GUEST_NAME', 'Guest'), single]]
      : [];
  if (entries.length === 0 && required)
    throw new ConfigError('GUESTS is required. Run START-PassPad.cmd again to set it.');
  if (entries.length > MAX_GUESTS) throw new ConfigError(`GUESTS takes at most ${MAX_GUESTS} people.`);
  const list = entries.map(([name = '', address = '']) => {
    if (!NAME.test(name)) throw new ConfigError(`Guest name "${name}" must be 1-24 letters, digits or spaces.`);
    if (!isIP(address)) throw new ConfigError(`Guest ${name} needs a Tailscale IP address (got "${address}").`);
    return { name, ip: address };
  });
  if (new Set(list.map((g) => g.name)).size !== list.length || new Set(list.map((g) => g.ip)).size !== list.length)
    throw new ConfigError('Each guest needs a different name and IP address.');
  return list;
}

/** Reads and validates every setting. Docs: docs/configuration.md. */
export function loadConfig(env: Env): Config {
  const kind = read(env, 'CONSOLE', 'simulated');
  if (kind !== 'simulated' && kind !== 'chiaki') throw new ConfigError('CONSOLE must be simulated or chiaki.');
  const quality = read(env, 'STREAM_RESOLUTION', '1080p');
  if (quality !== '1080p' && quality !== '720p') throw new ConfigError('STREAM_RESOLUTION must be 1080p or 720p.');
  const videoMode = read(env, 'VIDEO', kind === 'chiaki' ? 'webrtc' : 'off');
  if (videoMode !== 'webrtc' && videoMode !== 'off') throw new ConfigError('VIDEO must be webrtc or off.');
  const apiUser = read(env, 'MEDIAMTX_API_USER');
  const apiPass = read(env, 'MEDIAMTX_API_PASS');
  if (videoMode === 'webrtc' && (!apiUser || !apiPass))
    throw new ConfigError('MEDIAMTX_API_USER and MEDIAMTX_API_PASS are required with VIDEO=webrtc.');

  return {
    http: { host: read(env, 'HOST', '0.0.0.0'), port: int(env, 'PORT', 3000, 1, 65_535) },
    identity: { hostIp: ip(env, 'HOST_TAILSCALE_IP', false), guests: guests(env, kind === 'chiaki') },
    turnMinutes: int(env, 'TURN_MINUTES', 15, 1, 60),
    console:
      kind === 'simulated'
        ? { kind }
        : {
            kind,
            ps5Ip: ip(env, 'PS5_HOST_IP', true),
            chiakiExe: read(env, 'CHIAKI_EXE', 'vendor/chiaki/chiaki.exe'),
            inputPort: int(env, 'CHIAKI_INPUT_PORT', 9370, 1024, 65_535),
            quality,
            bitrate: {
              '1080p': int(env, 'STREAM_BITRATE_1080P', 15_000, 0, 50_000),
              '720p': int(env, 'STREAM_BITRATE', 7000, 0, 50_000),
            },
          },
    video:
      videoMode === 'off'
        ? null
        : {
            mediamtxUrl: loopbackHttp(env, 'MEDIAMTX_URL', 'http://127.0.0.1:8889'),
            mediamtxApiUrl: loopbackHttp(env, 'MEDIAMTX_API_URL', 'http://127.0.0.1:9997'),
            apiUser,
            apiPass,
          },
  };
}
