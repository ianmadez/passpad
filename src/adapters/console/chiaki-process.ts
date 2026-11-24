import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Quality } from '../config/env-config.ts';

export type ChiakiStatus = 'missing' | 'unpaired' | 'idle' | 'connecting' | 'streaming';

type ChiakiProcessOptions = {
  exe: string;
  ps5Ip: string;
  inputPort: number;
  /** rtsp:// URL with the publisher's credentials; given to chiaki-ng in its environment only. */
  streamOutUrl: string;
  quality: Quality;
  bitrate: Record<Quality, number>;
  onStatus: (status: ChiakiStatus, quality: Quality) => void;
  /** chiaki-ng's own output, line by line (for the error log). */
  onLog?: (line: string) => void;
  /** True once MediaMTX sees the console video. */
  isVideoUp: () => boolean;
  /** 1080p that shows no picture by then drops to 720p once. */
  fallbackAfterMs?: number;
};

const SETTINGS_KEY = String.raw`HKCU\Software\Chiaki\Chiaki\settings`;

/** "Host: Living Room PS5 \n" lines from `chiaki.exe list`. */
export function parseHostList(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => /^Host:\s*(.*?)\s*$/.exec(line)?.[1] ?? '')
    .filter(Boolean);
}

/**
 * Registry values chiaki-ng reads for a PS5 on the same network. H.264 is forced: browsers cannot
 * play the PS5's default HEVC over WebRTC, and the stream-out patch only forwards H.264.
 */
export function chiakiSettings(quality: Quality, bitrate: number): Array<[name: string, type: string, data: string]> {
  return [
    ['resolution_local_ps5', 'REG_SZ', quality],
    ['fps_local_ps5', 'REG_DWORD', '60'],
    ['codec_local_ps5', 'REG_SZ', 'h264'],
    ['bitrate_local_ps5', 'REG_DWORD', String(bitrate)],
  ];
}

const run = (file: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(file, args, { timeout: 15_000, windowsHide: true }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });

/**
 * Starts and stops the patched chiaki-ng on the host's "Connect PS5" / "Disconnect" buttons,
 * restarts it if it crashes while wanted, and falls back from 1080p to 720p when the higher
 * quality never produces a picture.
 */
export class ChiakiProcess {
  readonly #o: Required<ChiakiProcessOptions>;
  #child: ChildProcess | null = null;
  #wanted = false;
  #quality: Quality;
  #status: ChiakiStatus = 'idle';
  #watch: ReturnType<typeof setInterval> | null = null;

  constructor(options: ChiakiProcessOptions) {
    this.#o = { fallbackAfterMs: 25_000, onLog: () => {}, ...options };
    this.#quality = options.quality;
    if (!existsSync(options.exe)) this.#status = 'missing';
  }

  get status(): ChiakiStatus {
    return this.#status;
  }

  get quality(): Quality {
    return this.#quality;
  }

  async connect(): Promise<void> {
    if (this.#wanted) return;
    this.#wanted = true;
    await this.#start();
  }

  disconnect(): void {
    this.#wanted = false;
    this.#stopWatch();
    this.#child?.kill();
    this.#child = null;
    this.#set('idle');
  }

  /** Switches quality; reconnects when streaming so it takes effect. */
  async setQuality(quality: Quality): Promise<void> {
    if (quality === this.#quality) return;
    this.#quality = quality;
    this.#set(this.#status);
    if (this.#wanted) {
      this.#child?.kill();
      // The exit handler restarts it with the new settings.
    }
  }

  async #start(): Promise<void> {
    if (!this.#wanted) return;
    if (!existsSync(this.#o.exe)) return this.#set('missing');
    let hosts: string[];
    try {
      hosts = parseHostList(await run(this.#o.exe, ['list']));
    } catch {
      hosts = [];
    }
    const nickname = hosts[0];
    if (!nickname) {
      this.#wanted = false;
      return this.#set('unpaired');
    }
    await this.#writeSettings();
    this.#set('connecting');
    const child = spawn(this.#o.exe, ['--exit-app-on-stream-exit', 'stream', nickname, this.#o.ps5Ip], {
      env: {
        ...process.env,
        CHIAKI_NET_INPUT_PORT: String(this.#o.inputPort),
        CHIAKI_STREAM_OUT_URL: this.#o.streamOutUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    });
    this.#child = child;
    for (const stream of [child.stdout, child.stderr]) {
      let rest = '';
      stream?.on('data', (chunk: Buffer) => {
        const lines = (rest + chunk.toString('utf8')).split(/\r?\n/);
        rest = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) this.#o.onLog(line);
      });
    }
    child.on('error', (error) => this.#o.onLog(`could not start: ${error.message}`));
    child.on('exit', (code) => {
      if (this.#child !== child) return;
      if (this.#wanted) this.#o.onLog(`exited with code ${code ?? 'none'}`);
      this.#child = null;
      this.#stopWatch();
      if (!this.#wanted) return this.#set('idle');
      // Crashed, the console slept, or a quality change: try again shortly.
      this.#set('connecting');
      setTimeout(() => void this.#start(), 3000).unref();
    });
    this.#watchVideo();
  }

  #watchVideo(): void {
    this.#stopWatch();
    const startedAt = Date.now();
    this.#watch = setInterval(() => {
      if (this.#o.isVideoUp()) return this.#set('streaming');
      if (this.#status === 'streaming') this.#set('connecting');
      if (this.#quality === '1080p' && Date.now() - startedAt > this.#o.fallbackAfterMs) {
        console.warn('No picture at 1080p: falling back to 720p.');
        void this.setQuality('720p');
      }
    }, 1000);
    this.#watch.unref();
  }

  #stopWatch(): void {
    if (this.#watch) clearInterval(this.#watch);
    this.#watch = null;
  }

  async #writeSettings(): Promise<void> {
    if (process.platform !== 'win32') return;
    for (const [name, type, data] of chiakiSettings(this.#quality, this.#o.bitrate[this.#quality])) {
      try {
        await run('reg.exe', ['add', SETTINGS_KEY, '/v', name, '/t', type, '/d', data, '/f']);
      } catch (error) {
        console.warn(`Could not set chiaki-ng ${name}: ${(error as Error).message}`);
      }
    }
  }

  #set(status: ChiakiStatus): void {
    this.#status = status;
    this.#o.onStatus(status, this.#quality);
  }
}
