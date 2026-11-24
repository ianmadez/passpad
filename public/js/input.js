// Keyboard, mouse and gamepad sampling, encoded into the 15-byte frame the server expects.
import { encodeInput } from './input-codec.js';
import { isLayoutKey, mapKeys, PAD_BUTTONS } from './keymap.js';
import { MouseLook } from './mouse-look.js';
import { PressLatch } from './press-latch.js';

/**
 * Input is sampled every 4 ms and a change goes out on the very next sample (no batching delay).
 * Unchanged state is repeated every 100 ms so a lost or late packet heals quickly; chiaki-ng
 * releases everything after 500 ms of silence.
 */
const POLL_MS = 4;
const HEARTBEAT_MS = 100;
/** The PS5 reads sticks as 8-bit values: anything finer is noise that would only cost packets. */
const STICK_STEPS = 127;
const quantize = (v) => Math.round(v * STICK_STEPS) / STICK_STEPS;
/** Shorter taps (and clicks) are held this long so they survive sampling. */
const MIN_PRESS_MS = 80;
/** Radial dead zone for off-brand sticks; the guest can change it in Settings. */
let deadzoneSize = 0.08;
/** Hold a chord this long to click the touchpad (XInput pads have no touchpad). */
const CHORD_MS = 150;
const CHORDS = [
  [8, 3], // Back + Y
  [10, 11], // L3 + R3
];
const TRIGGERS = { l2: 6, r2: 7 };
/** Mouse buttons the layouts can use, as input codes (keymap.js). */
const MOUSE_CODES = ['Mouse0', 'Mouse2'];

/** Radial dead zone: kills drift without the square "snap" of per-axis dead zones. */
function deadzone(x, y) {
  const magnitude = Math.hypot(x, y);
  if (magnitude < deadzoneSize) return [0, 0];
  const scaled = Math.min(1, (magnitude - deadzoneSize) / (1 - deadzoneSize));
  return [(x / magnitude) * scaled, (y / magnitude) * scaled];
}
const stronger = (a, b) => (Math.hypot(b[0], b[1]) > Math.hypot(a[0], a[1]) ? b : a);

/** Sets the stick dead zone (0-0.3). */
export function setDeadzone(value) {
  deadzoneSize = Math.max(0, Math.min(0.3, Number(value) || 0));
}

/** The first connected gamepad, or null. */
export function firstPad() {
  return [...(navigator.getGamepads?.() ?? [])].find((g) => g?.connected) ?? null;
}

let chordSince = 0;
/**
 * Touchpad click synthesis: a held chord (Back+Y or L3+R3) becomes a touchpad click, and the
 * chord's own buttons are dropped so the game does not also see Y or a stick click.
 */
function applyChords(pad, buttons, now) {
  const held = CHORDS.find((chord) => chord.every((i) => pad.buttons[i]?.pressed));
  if (!held) {
    chordSince = 0;
    return;
  }
  chordSince ||= now;
  for (const i of held) buttons[PAD_BUTTONS[i]] = false;
  if (now - chordSince >= CHORD_MS) buttons.touchpad = true;
}

/**
 * Merges the keyboard and mouse (already mapped by the layout) with the first connected gamepad
 * into { buttons, triggers, sticks }. The gamepad is read the same way whatever the layout.
 */
function sample(keys, mouse, now) {
  const buttons = { ...keys.buttons };
  const triggers = { l2: 0, r2: 0 };
  let left = [keys.sticks.lx, keys.sticks.ly];
  let right = stronger([keys.sticks.rx, keys.sticks.ry], mouse);
  const pad = firstPad();
  if (pad) {
    pad.buttons.forEach((b, i) => {
      if (b.pressed && PAD_BUTTONS[i]) buttons[PAD_BUTTONS[i]] = true;
    });
    applyChords(pad, buttons, now);
    for (const [name, index] of Object.entries(TRIGGERS)) triggers[name] = pad.buttons[index]?.value ?? 0;
    left = stronger(left, deadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0));
    right = stronger(right, deadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0));
  }
  for (const name of Object.keys(triggers)) if (buttons[name]) triggers[name] ||= 1;
  return {
    buttons,
    triggers: { l2: quantize(triggers.l2), r2: quantize(triggers.r2) },
    sticks: { lx: quantize(left[0]), ly: quantize(left[1]), rx: quantize(right[0]), ry: quantize(right[1]) },
  };
}

const sameFrame = (a, b) => a && b && new Uint8Array(a).every((byte, i) => byte === new Uint8Array(b)[i]);

/** Locks the pointer to `element`, without the OS's mouse acceleration where the browser allows. */
function lockPointer(element) {
  // A refusal (some browsers refuse for a second after Esc) is not an error: the next click retries.
  const plain = () => element.requestPointerLock()?.catch?.(() => {});
  try {
    const pending = element.requestPointerLock({ unadjustedMovement: true });
    pending?.catch?.(plain);
  } catch {
    plain();
  }
}

/**
 * Starts sampling. `active()` says whether this page is in control (only then are frames sent);
 * `send(frame)` delivers an ArrayBuffer. `layout` comes from keymap.js. With a mouse-look layout,
 * clicking `screen` locks the pointer to it. `onDrivingChange(on)` reports the driving toggle.
 */
export function startInput({ active, send, layout, screen, onDrivingChange = () => {} }) {
  const latch = new PressLatch(MIN_PRESS_MS);
  const look = new MouseLook();
  const typing = () => document.activeElement?.matches?.('input, textarea, select') === true;
  const locked = () => Boolean(screen) && document.pointerLockElement === screen;
  let driving = false;
  let lastFrame = null;
  let lastSentAt = 0;

  const setDriving = (on) => {
    if (on === driving) return;
    driving = on;
    onDrivingChange(on);
  };

  let tabHeld = false;
  window.addEventListener('keydown', (event) => {
    // With a gamepad, Tab is the touchpad (interaction menu); without one it stays a layout key.
    if (event.code === 'Tab' && firstPad() && active()) {
      event.preventDefault();
      tabHeld = true;
      return;
    }
    if (!isLayoutKey(layout, event.code) || typing()) return;
    if (active()) event.preventDefault();
    if (event.code === layout.driving?.toggle) {
      if (active() && !event.repeat) setDriving(!driving);
      return;
    }
    latch.press(event.code, performance.now(), event.repeat);
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'Tab') tabHeld = false;
    latch.release(event.code, performance.now());
  });
  const releaseAll = () => {
    latch.reset();
    look.reset();
    tabHeld = false;
    if (active()) send(encodeInput({}));
    lastFrame = null;
  };
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => document.hidden && releaseAll());

  if (layout.mouseLook && screen) {
    // The click that locks the pointer is not a game click: mouse buttons count only once locked.
    screen.addEventListener('click', () => {
      if (active() && !locked()) lockPointer(screen);
    });
    screen.addEventListener('contextmenu', (event) => event.preventDefault());
    document.addEventListener('mousemove', (event) => {
      if (locked()) look.move(event.movementX, event.movementY);
    });
    document.addEventListener('mousedown', (event) => {
      if (!locked() || !active()) return;
      event.preventDefault();
      latch.press(`Mouse${event.button}`, performance.now());
    });
    document.addEventListener('mouseup', (event) => latch.release(`Mouse${event.button}`, performance.now()));
    document.addEventListener('pointerlockchange', () => {
      if (locked()) return;
      const now = performance.now();
      for (const code of MOUSE_CODES) latch.release(code, now);
      look.reset();
    });
  }

  setInterval(() => {
    if (!active()) {
      lastFrame = null;
      // A new turn starts on foot with a free pointer.
      setDriving(false);
      if (locked()) document.exitPointerLock();
      return;
    }
    const now = performance.now();
    const keys = mapKeys(layout, latch.held(now), { driving });
    const mouse = locked() ? look.sample(now) : [0, 0];
    const state = sample(keys, mouse, now);
    if (tabHeld) state.buttons.touchpad = true;
    const frame = encodeInput(state);
    const changed = !sameFrame(frame, lastFrame);
    if (changed || now - lastSentAt >= HEARTBEAT_MS) {
      send(frame);
      lastFrame = frame;
      lastSentAt = now;
    }
  }, POLL_MS);
}
