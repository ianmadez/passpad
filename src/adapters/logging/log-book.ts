import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_LINES = 400;

/** Removes anything secret-looking before a line is stored or shown (URL passwords, tokens). */
export function redact(line: string): string {
  return line
    .replaceAll(/([a-z]+:\/\/)[^@\s/]+@/gi, '$1***@')
    .replaceAll(/(pass(word)?|token|secret|key)(["'\s:=]+)[^\s"',]+/gi, '$1$3***');
}

/**
 * Keeps the last few hundred log lines in memory (for the "copy details" button) and appends them
 * to a file that rotates at 1 MB, so a problem can be reported after the fact.
 */
export class LogBook {
  readonly #lines: string[] = [];
  readonly #file: string | null;

  constructor(file: string | null) {
    this.#file = file;
    if (file) mkdirSync(dirname(file), { recursive: true });
  }

  add(level: 'info' | 'warn' | 'error', source: string, text: string): void {
    const line = redact(`${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${source}] ${text}`);
    this.#lines.push(line);
    if (this.#lines.length > MAX_LINES) this.#lines.shift();
    if (!this.#file) return;
    try {
      if ((statSync(this.#file, { throwIfNoEntry: false })?.size ?? 0) > MAX_FILE_BYTES)
        renameSync(this.#file, `${this.#file}.1`);
      appendFileSync(this.#file, `${line}\n`);
    } catch {
      // Logging must never take the server down.
    }
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
