import { appendFile, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_LINES = 400;
/** Lines are written in one batch per second instead of one disk write each. */
const FLUSH_MS = 1000;

/** Removes anything secret-looking before a line is stored or shown (URL passwords, tokens). */
export function redact(line: string): string {
  return line
    .replaceAll(/([a-z]+:\/\/)[^@\s/]+@/gi, '$1***@')
    .replaceAll(/(pass(word)?|token|secret|key)(["'\s:=]+)[^\s"',]+/gi, '$1$3***');
}

/**
 * Keeps the last few hundred log lines in memory (for the "copy details" button) and appends them
 * to a file that rotates at 1 MB, so a problem can be reported after the fact. Memory is bounded:
 * at most MAX_LINES in the ring and MAX_LINES waiting for the next write.
 */
export class LogBook {
  readonly #lines: string[] = [];
  readonly #file: string | null;
  #pending: string[] = [];

  constructor(file: string | null) {
    this.#file = file;
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    setInterval(() => this.flush(), FLUSH_MS).unref();
  }

  add(level: 'info' | 'warn' | 'error', source: string, text: string): void {
    const line = redact(`${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${source}] ${text}`);
    this.#lines.push(line);
    if (this.#lines.length > MAX_LINES) this.#lines.shift();
    if (this.#file && this.#pending.length < MAX_LINES) this.#pending.push(line);
  }

  /** Writes what is pending (without blocking the server); rotates the file past 1 MB. */
  flush(): void {
    if (!this.#file || this.#pending.length === 0) return;
    const text = `${this.#pending.join('\n')}\n`;
    this.#pending = [];
    try {
      if ((statSync(this.#file, { throwIfNoEntry: false })?.size ?? 0) > MAX_FILE_BYTES)
        renameSync(this.#file, `${this.#file}.1`);
    } catch {
      // Rotation is best effort.
    }
    appendFile(this.#file, text, () => {
      // Logging must never take the server down.
    });
  }

  recent(count = 150): string[] {
    return this.#lines.slice(-count);
  }

  /** Routes console.log/warn/error through the book (and still prints them). */
  captureConsole(): void {
    const wrap =
      (level: 'info' | 'warn' | 'error', original: (...args: unknown[]) => void) =>
      (...args: unknown[]) => {
        original(...args);
        this.add(level, 'server', args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a))).join(' '));
      };
    console.log = wrap('info', console.log.bind(console));
    console.warn = wrap('warn', console.warn.bind(console));
    console.error = wrap('error', console.error.bind(console));
  }
}
