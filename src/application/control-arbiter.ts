import { type ControllerState, NEUTRAL_STATE } from '../domain/controller-state.ts';
import type { Clock, ConsoleAdapter } from './ports.ts';

/** Who is asking: the host (owns the PS5) or one of the configured guests, by name. */
export type Peer = { role: 'host' } | { role: 'guest'; name: string };

/** Public view of the lock, sent to every page. */
export type ControlSnapshot = {
  /** Guest name in control, or null while the host has it ("locked"). */
  controller: string | null;
  /** Epoch ms the current turn ends, or null without a timer. */
  endsAt: number | null;
  turnMinutes: number;
  /** Guests who pressed "Request control", oldest first. */
  requests: string[];
};

export const MIN_TURN_MINUTES = 1;
export const MAX_TURN_MINUTES = 60;

type ArbiterOptions = {
  device: ConsoleAdapter;
  turnMinutes: number;
  /** The guest's input going silent this long hands control back (their connection died). */
  silenceMs?: number;
  now?: Clock;
  onChange?: (snapshot: ControlSnapshot) => void;
  /** Every guest frame that reached the console (the host's input visualizer). */
  onInput?: (state: ControllerState) => void;
};

/**
 * The single gate between guests' browsers and the console. Default is locked (the host plays on
 * the TV). The host grants one guest at a time for a timed turn; reclaiming flushes neutral input
 * before anything else so no throttle or steering stays held.
 */
export class ControlArbiter {
  readonly #o: Required<ArbiterOptions>;
  #controller: string | null = null;
  #endsAt: number | null = null;
  #turnMinutes: number;
  #lastInputAt = 0;
  #requests: string[] = [];

  constructor(options: ArbiterOptions) {
    this.#o = { silenceMs: 20_000, now: Date.now, onChange: () => {}, onInput: () => {}, ...options };
    this.#turnMinutes = clampMinutes(options.turnMinutes);
  }

  snapshot(): ControlSnapshot {
    return {
      controller: this.#controller,
      endsAt: this.#endsAt,
      turnMinutes: this.#turnMinutes,
      requests: [...this.#requests],
    };
  }

  /** Host only. Hands the pad to `guest` for one turn (replacing whoever had it). */
  grant(by: Peer, guest: string): boolean {
    if (by.role !== 'host' || !guest) return false;
    if (this.#controller && this.#controller !== guest) this.#neutral();
    const now = this.#o.now();
    this.#controller = guest;
    this.#endsAt = now + this.#turnMinutes * 60_000;
    this.#lastInputAt = now;
    this.#requests = this.#requests.filter((name) => name !== guest);
    this.#changed();
    return true;
  }

  /** Host only. Takes control back immediately. */
  reclaim(by: Peer): boolean {
    if (by.role !== 'host') return false;
    this.#lock();
    return true;
  }

  /** Host only. Adds time to the running turn. */
  extend(by: Peer, minutes: number): boolean {
    if (by.role !== 'host' || this.#endsAt === null || !Number.isFinite(minutes)) return false;
    this.#endsAt += Math.max(-MAX_TURN_MINUTES, Math.min(MAX_TURN_MINUTES, Math.round(minutes))) * 60_000;
    this.#changed();
    return true;
  }

  /** Host only. Turn length for the next grant. */
  setTurnMinutes(by: Peer, minutes: number): boolean {
    if (by.role !== 'host' || !Number.isFinite(minutes)) return false;
    this.#turnMinutes = clampMinutes(minutes);
    this.#changed();
    return true;
  }

  /** A guest asks for the pad; the host sees it as a notification. */
  request(by: Peer): boolean {
    if (by.role !== 'guest' || this.#controller === by.name || this.#requests.includes(by.name)) return false;
    this.#requests.push(by.name);
    this.#changed();
    return true;
  }

  /** A controller frame. Only the guest in control reaches the console. */
  input(from: Peer, state: ControllerState): boolean {
    if (from.role !== 'guest' || from.name !== this.#controller) return false;
    this.#lastInputAt = this.#o.now();
    this.#o.device.apply(state);
    this.#o.onInput(state);
    return true;
  }

  /** A guest's last page closed: let go of everything (they may come back within their turn). */
  guestLeft(name: string): void {
    if (name === this.#controller) this.#o.device.release();
    const before = this.#requests.length;
    this.#requests = this.#requests.filter((n) => n !== name);
    if (before !== this.#requests.length) this.#changed();
  }

  /** Call every second: ends expired turns and turns whose guest went silent. */
  tick(): void {
    if (this.#controller === null) return;
    const now = this.#o.now();
    if ((this.#endsAt !== null && now >= this.#endsAt) || now - this.#lastInputAt >= this.#o.silenceMs) this.#lock();
  }

  #neutral(): void {
    this.#o.device.apply(NEUTRAL_STATE);
    this.#o.device.release();
  }

  #lock(): void {
    this.#neutral();
    const changed = this.#controller !== null;
    this.#controller = null;
    this.#endsAt = null;
    if (changed) this.#changed();
  }

  #changed(): void {
    this.#o.onChange(this.snapshot());
  }
}

function clampMinutes(minutes: number): number {
  return Math.max(MIN_TURN_MINUTES, Math.min(MAX_TURN_MINUTES, Math.round(minutes) || 15));
}
