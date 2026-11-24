// PassPad page: one file for both roles. The server tells us who we are (host or a guest name)
// from our Tailscale address; body[data-role] shows the matching controls.
import { firstPad, setDeadzone, startInput } from './input.js';
import { layoutFor } from './keymap.js';
import { StallWatch, WhepSession } from './video-player.js';

/** @type {(id: string) => any} */
const $ = (id) => document.getElementById(id);

const state = {
  socket: null,
  role: 'guest',
  you: '',
  guests: [],
  online: [],
  control: { controller: null, endsAt: null, turnMinutes: 15, requests: [] },
  chiaki: { status: 'idle', quality: '1080p' },
  videoUp: false,
  console: 'chiaki',
  shareUrl: '',
  version: '?',
  issuesUrl: '',
  names: {},
  clockOffset: 0,
  started: false,
  attempt: 0,
};

/** The name someone typed, else their configured id ("host" reads as "Host"). */
const label = (id) => state.names[id] ?? (id === 'host' ? 'Host' : id);
const sendName = () => {
  const name = store('name');
  if (name) send({ type: 'name', value: name });
};

const serverNow = () => Date.now() + state.clockOffset;
const inControl = () => state.role === 'guest' && state.control.controller === state.you;

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked (private window): settings last this page load only.
  }
  return null;
}

// ---------- connection ----------

function connect() {
  const socket = new WebSocket(`ws://${location.host}/ws`);
  socket.binaryType = 'arraybuffer';
  state.socket = socket;
  socket.addEventListener('open', () => {
    state.attempt = 0;
    send({ type: 'ping', t: performance.now() });
  });
  socket.addEventListener('close', () => {
    if (state.attempt === 4)
      trouble(
        'Lost the connection to the host laptop',
        'Is PassPad still running there, and is Tailscale connected on both laptops?',
      );
    setChip('who-chip', 'Reconnecting…', 'warn');
    setTimeout(connect, Math.min(10_000, 500 * 2 ** state.attempt++));
  });
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') handle(JSON.parse(event.data));
  });
}

function send(message) {
  if (state.socket?.readyState !== WebSocket.OPEN) return;
  state.socket.send(message instanceof ArrayBuffer ? message : JSON.stringify(message));
}

function handle(message) {
  switch (message.type) {
    case 'hello':
      state.role = message.role;
      state.you = message.you;
      state.guests = message.guests;
      state.online = message.online;
      state.chiaki = message.chiaki;
      state.videoUp = message.video;
      state.console = message.console;
      state.shareUrl = message.shareUrl;
      state.version = message.version ?? state.version;
      state.issuesUrl = message.issuesUrl ?? state.issuesUrl;
      state.names = message.names;
      sendName();
      state.clockOffset = message.serverNow - Date.now();
      onControl(message.control);
      document.body.dataset.role = state.role;
      if (state.started) video.start();
      break;
    case 'control':
      onControl(message);
      break;
    case 'names':
      state.names = message.names;
      break;
    case 'online':
      state.online = message.names;
      break;
    case 'chiaki':
      state.chiaki = { status: message.status, quality: message.quality };
      if (state.role === 'host' && (message.status === 'missing' || message.status === 'unpaired'))
        trouble('The PS5 link needs attention', PS5_TEXT[message.status]);
      break;
    case 'video':
      state.videoUp = message.up;
      if (message.up && state.started) {
        $('sim').hidden = true;
        $('live').hidden = false;
        video.start();
      } else if (!message.up) {
        // Free the decoder and the WebRTC session while there is nothing to show.
        video.stop();
      }
      break;
    case 'pong':
      showRtt(performance.now() - message.t);
      return;
    case 'input':
      drawInput(message);
      return;
    case 'frame':
      drawSim(message);
      return;
    default:
      return;
  }
  render();
}

function onControl(next) {
  const before = state.control;
  state.control = {
    controller: next.controller,
    endsAt: next.endsAt,
    turnMinutes: next.turnMinutes,
    requests: next.requests,
  };
  if (state.role === 'guest') {
    if (next.controller === state.you && before.controller !== state.you) toast("You've got the pad. Go!");
    if (before.controller === state.you && next.controller !== state.you)
      toast('Turn over — the pad went back to the host.');
  } else {
    const fresh = next.requests.filter((name) => !before.requests.includes(name));
    if (fresh.length) {
      toast(`${fresh.map(label).join(', ')} wants the pad`);
      chime();
    }
  }
}

// ---------- rendering ----------

function setChip(id, text, tone = '') {
  const chip = $(id);
  chip.textContent = text;
  chip.dataset.tone = tone;
}

const PS5_TEXT = {
  missing: 'chiaki-ng is missing. Run START-PassPad.cmd again.',
  unpaired: 'The PS5 is not paired yet. Run START-PassPad.cmd again and follow the pairing step.',
  idle: 'Not connected.',
  connecting: 'Connecting to the PS5… (wake it with the controller if it is asleep)',
  streaming: 'Streaming.',
};

function render() {
  const { controller, requests, turnMinutes } = state.control;
  const host = state.role === 'host';

  if (host)
    setChip(
      'who-chip',
      controller ? `${label(controller)} is playing` : 'You have the pad',
      controller ? 'live' : 'ok',
    );
  else if (inControl()) setChip('who-chip', 'Your turn', 'live');
  else setChip('who-chip', controller ? `${label(controller)} is playing` : `${label('host')} has the pad`);

  const quality = $('quality-chip');
  quality.hidden = state.console !== 'chiaki';
  quality.textContent = state.chiaki.quality;

  // Host panels
  const sim = state.console !== 'chiaki';
  $('ps5-status').textContent = sim ? 'Simulator mode: no PS5 needed.' : (PS5_TEXT[state.chiaki.status] ?? '');
  const live = state.chiaki.status === 'connecting' || state.chiaki.status === 'streaming';
  $('connect').disabled = live || state.console !== 'chiaki';
  $('connect').classList.toggle('busy', state.chiaki.status === 'connecting');
  $('disconnect').disabled = !live;
  for (const b of document.querySelectorAll('[data-quality]')) {
    b.ariaPressed = String(b.dataset.quality === state.chiaki.quality);
    b.disabled = sim;
  }
  for (const b of document.querySelectorAll('[data-min]'))
    b.ariaPressed = String(Number(b.dataset.min) === turnMinutes);
  if (document.activeElement !== $('turn-custom')) $('turn-custom').value = String(turnMinutes);
  $('reclaim').disabled = !controller;
  $('extend').disabled = !controller;
  $('copy-link').hidden = !state.shareUrl;
  renderPeople(controller, requests);

  // Guest panel
  if (!host) {
    const asked = requests.includes(state.you);
    $('guest-title').textContent = inControl()
      ? "You're driving"
      : controller
        ? `${label(controller)} is playing`
        : 'Waiting for the host';
    $('guest-text').textContent = inControl()
      ? 'Your controller drives the PS5 until the clock runs out.'
      : asked
        ? 'Asked — the host got a notification.'
        : 'When the host passes you the pad, your controller drives the PS5.';
    $('request').hidden = inControl();
    $('request').disabled = asked;
  }

  // Gate
  const gate = $('gate');
  gate.hidden = state.started && (state.videoUp || state.console === 'simulated');
  if (state.started && !gate.hidden) {
    $('gate-kicker').textContent = 'Stand by';
    $('gate-title').textContent = 'No picture yet.';
    $('gate-text').textContent = host
      ? 'Press "Connect PS5" below. The first connection can take 20 seconds.'
      : 'Waiting for the host to connect the PS5.';
    $('gate-form').hidden = true;
  }
  renderClock();
}

function renderPeople(controller, requests) {
  const list = $('people');
  list.replaceChildren(
    ...state.guests.map((name) => {
      const li = document.createElement('li');
      li.dataset.active = String(name === controller);
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.dataset.on = String(state.online.includes(name));
      dot.title = state.online.includes(name) ? 'Online' : 'Offline';
      const tag = document.createElement('span');
      tag.className = 'name';
      tag.textContent = label(name);
      li.append(dot, tag);
      if (requests.includes(name)) {
        const ask = document.createElement('span');
        ask.className = 'ask';
        ask.textContent = 'wants the pad';
        li.append(ask);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = name === controller ? 'ghost' : 'primary';
      button.textContent = name === controller ? 'Playing' : `Pass to ${label(name)}`;
      button.disabled = name === controller;
      button.addEventListener('click', () => send({ type: 'grant', value: name }));
      li.append(button);
      return li;
    }),
  );
}

function renderClock() {
  const { controller, endsAt, turnMinutes } = state.control;
  const clock = $('clock');
  clock.hidden = !controller || endsAt === null;
  if (clock.hidden) return;
  const left = Math.max(0, endsAt - serverNow());
  const seconds = Math.ceil(left / 1000);
  $('clock-name').textContent = controller === state.you ? 'Your turn' : label(controller);
  $('clock-time').textContent =
    `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  $('clock-fill').style.width = `${Math.min(100, (left / (turnMinutes * 60_000)) * 100)}%`;
  clock.dataset.urgent = String(seconds <= 60);
}
setInterval(renderClock, 250);

function showRtt(ms) {
  const rounded = Math.round(ms);
  setChip('rtt-chip', `${rounded} ms`, rounded < 220 ? 'ok' : rounded < 320 ? 'warn' : 'bad');
}
setInterval(() => send({ type: 'ping', t: performance.now() }), 2000);

let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 5000);
}

/** One shared AudioContext: browsers cap how many can exist, and each holds an audio thread. */
let audio = null;

/** A short two-note chime, so the host notices a request while watching the TV. */
function chime() {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    void ctx.resume();
    for (const [i, freq] of [660, 880].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.15);
      osc.stop(ctx.currentTime + i * 0.15 + 0.3);
    }
  } catch {
    // No audio: the toast is enough.
  }
}

// ---------- video ----------

const video = {
  session: null,
  stream: null,
  retry: 0,
  start() {
    if (!state.videoUp || this.session) return;
    const el = $('live');
    this.stream = new MediaStream();
    el.srcObject = this.stream;
    this.session = new WhepSession({
      route: '/api/video',
      kinds: ['video', 'audio'],
      onTrack: (track) => {
        this.stream.addTrack(track);
        el.muted = false;
        el.play().catch(() => {});
      },
      onState: (s) => {
        if (s === 'failed') this.restart(2000);
      },
    });
    this.session
      .start()
      .then((status) => {
        if (status === 201) {
          this.failures = 0;
          return;
        }
        this.failed(`The video server answered ${status}.`);
      })
      .catch((error) => this.failed(String(error?.message ?? error)));
  },
  stop() {
    this.session?.close();
    this.session = null;
  },
  failures: 0,
  failed(reason) {
    logError(`video: ${reason}`);
    if (++this.failures === 3) trouble('The video will not start', reason);
    this.restart(3000);
  },
  restart(delay) {
    this.stop();
    clearTimeout(this.retry);
    this.retry = setTimeout(() => state.videoUp && this.start(), delay);
  },
};

const stall = new StallWatch();
let lastStats = null;
setInterval(async () => {
  const stats = await video.session?.videoStats();
  if (!stats) {
    $('net-chip').hidden = true;
    lastStats = null;
    return;
  }
  if (stall.update(performance.now(), stats)) send({ type: 'keyframe' });
  // fps, loss and jitter over the last half second: the three numbers that explain "it feels laggy".
  if (lastStats) {
    const seconds = (stats.timestamp - lastStats.timestamp) / 1000 || 0.5;
    // Browsers report their own smoothed fps; fall back to counting decoded frames.
    const fps = Math.round(stats.framesPerSecond ?? (stats.framesDecoded - lastStats.framesDecoded) / seconds);
    const received = stats.packetsReceived - lastStats.packetsReceived;
    const lost = Math.max(0, stats.packetsLost - lastStats.packetsLost);
    const loss = received + lost > 0 ? (lost / (received + lost)) * 100 : 0;
    const jitter = Math.round((stats.jitter ?? 0) * 1000);
    const tone = loss > 3 || fps < 40 ? 'bad' : loss > 0.5 || fps < 55 || jitter > 30 ? 'warn' : 'ok';
    setChip('net-chip', `${fps} fps · ${loss.toFixed(1)}% loss · ${jitter} ms jitter`, tone);
    $('net-chip').hidden = false;
  }
  lastStats = stats;
}, 500);

// ---------- simulator and input visualizer ----------

function drawSim(frame) {
  if (!state.started || state.videoUp) return;
  const canvas = $('sim');
  canvas.hidden = false;
  $('live').hidden = true;
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  ctx.fillStyle = '#0b0b0f';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1e1e28';
  for (let x = 0; x < w; x += 64) ctx.strokeRect(x, 0, 64, h);
  ctx.save();
  ctx.translate(frame.x * w, frame.y * h);
  ctx.rotate(frame.heading);
  ctx.fillStyle = '#ff5a3c';
  ctx.beginPath();
  ctx.moveTo(22, 0);
  ctx.lineTo(-14, 12);
  ctx.lineTo(-14, -12);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#9a97a3';
  ctx.font = '20px Jost, sans-serif';
  ctx.fillText(frame.pressed.length ? frame.pressed.join(' ') : 'Simulated console — no PS5 needed', 24, h - 24);
  if (state.role === 'host') drawInput(frame);
}

function drawInput({ buttons, pressed, sticks, triggers }) {
  const viz = $('viz');
  viz.hidden = state.role !== 'host' || !$('viz-toggle').checked || !state.control.controller;
  if (viz.hidden) return;
  const on = pressed ?? Object.keys(buttons).filter((b) => buttons[b]);
  for (const t of viz.querySelectorAll('[data-b]')) t.classList.toggle('on', on.includes(t.dataset.b));
  $('viz-ls').setAttribute('cx', String(62 + sticks.lx * 20));
  $('viz-ls').setAttribute('cy', String(72 + sticks.ly * 20));
  $('viz-rs').setAttribute('cx', String(158 + sticks.rx * 20));
  $('viz-rs').setAttribute('cy', String(72 + sticks.ry * 20));
  $('viz-l2').setAttribute('width', String(triggers.l2 * 40));
  $('viz-r2').setAttribute('width', String(triggers.r2 * 40));
}

// ---------- capture (screenshot and clip) ----------

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
const stamp = () => new Date().toISOString().slice(0, 19).replaceAll(':', '-');

$('shot').addEventListener('click', () => {
  const source = $('live').hidden ? $('sim') : $('live');
  const canvas = document.createElement('canvas');
  canvas.width = source.videoWidth || source.width;
  canvas.height = source.videoHeight || source.height;
  if (!canvas.width) return toast('No picture to capture yet.');
  canvas.getContext('2d').drawImage(source, 0, 0);
  canvas.toBlob((blob) => blob && download(blob, `passpad-${stamp()}.png`));
});

const MAX_CLIP_SECONDS = 300;
let recorder = null;
$('rec').addEventListener('click', () => {
  if (recorder) {
    recorder.stop();
    return;
  }
  const stream = video.stream?.getTracks().length ? video.stream : $('sim').captureStream?.(30);
  if (!stream) return toast('No picture to record yet.');
  const chunks = [];
  // VP8 is the cheapest to encode in software; the bitrate cap keeps a long clip at ~45 MB/min.
  const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
  const startedAt = performance.now();
  const ticker = setInterval(() => {
    const s = Math.floor((performance.now() - startedAt) / 1000);
    $('rec').textContent = `Stop & save ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    // Clips live in memory until saved: stop at the cap instead of growing without limit.
    if (s >= MAX_CLIP_SECONDS && recorder?.state === 'recording') {
      toast(`Clip saved at the ${MAX_CLIP_SECONDS / 60}-minute limit.`);
      recorder.stop();
    }
  }, 1000);
  recorder.addEventListener('dataavailable', (e) => e.data.size && chunks.push(e.data));
  recorder.addEventListener('stop', () => {
    clearInterval(ticker);
    download(new Blob(chunks, { type: 'video/webm' }), `passpad-${stamp()}.webm`);
    chunks.length = 0;
    recorder = null;
    $('rec').dataset.on = 'false';
    $('rec').textContent = 'Record';
  });
  recorder.start(1000);
  $('rec').dataset.on = 'true';
  $('rec').textContent = 'Stop & save 0:00';
});

// ---------- errors: log, copy, report ----------

const errors = [];
let troubleCount = 0;

/** Keeps a short history and tells the server (it lands in logs/passpad.log on the host). */
function logError(text) {
  const line = `${new Date().toISOString()} ${text}`;
  errors.push(line);
  if (errors.length > 30) errors.shift();
  send({ type: 'client-error', value: text.slice(0, 600) });
}

/** Shows the trouble panel. */
function trouble(title, text) {
  logError(`${title}: ${text}`);
  troubleCount++;
  $('trouble-title').textContent = title;
  $('trouble-text').textContent = text;
  $('trouble-count').textContent = troubleCount > 1 ? `(${troubleCount})` : '';
  $('trouble').hidden = false;
}

const redact = (text) => text.replaceAll(/([a-z]+:\/\/)[^@\s/]+@/gi, '$1***@');

async function details() {
  let serverLog = [];
  if (state.role === 'host') {
    try {
      serverLog = (await (await fetch('/api/logs')).json()).lines;
    } catch {
      serverLog = ['(could not read the server log)'];
    }
  }
  return redact(
    [
      `PassPad ${state.version} · ${state.role} · ${new Date().toISOString()}`,
      `Browser: ${navigator.userAgent}`,
      `PS5 link: ${state.chiaki.status} (${state.chiaki.quality}) · video ${state.videoUp ? 'up' : 'down'} · console ${state.console}`,
      `Page connection: ${state.socket?.readyState === WebSocket.OPEN ? 'open' : 'closed'} · controller: ${firstPad()?.id ?? 'none'}`,
      `Problem: ${$('trouble-title').textContent} — ${$('trouble-text').textContent}`,
      '',
      'Page errors:',
      ...(errors.length ? errors : ['(none)']),
      ...(serverLog.length ? ['', 'Host log (most recent last):', ...serverLog.slice(-80)] : []),
    ].join(String.fromCharCode(10)),
  );
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

$('trouble-copy').addEventListener('click', async () => {
  toast(
    (await copyText(await details()))
      ? 'Details copied. Paste them to whoever helps you.'
      : 'Could not copy: your browser blocked it.',
  );
});
$('trouble-report').addEventListener('click', async () => {
  const text = await details();
  const copied = await copyText(text);
  // URLs over ~8 KB are refused by GitHub: the body is trimmed and the full text is on the clipboard.
  const fence = '```';
  const body = [
    '**What happened?** (one line is fine)',
    '',
    '',
    `**Details** ${copied ? '(full version copied to your clipboard; paste it here if this one is cut off)' : ''}`,
    '',
    fence,
    text.slice(0, 5000),
    fence,
  ].join(String.fromCharCode(10));
  const url = `${state.issuesUrl}?${new URLSearchParams({ title: `[${state.role}] ${$('trouble-title').textContent}`, body, labels: 'bug' })}`;
  window.open(url, '_blank', 'noopener');
});
$('trouble-close').addEventListener('click', () => ($('trouble').hidden = true));

window.addEventListener('error', (event) =>
  trouble('The page hit an error', `${event.message} (${event.filename?.split('/').pop()}:${event.lineno})`),
);
window.addEventListener('unhandledrejection', (event) =>
  trouble('The page hit an error', String(event.reason?.message ?? event.reason)),
);

// ---------- feedback ----------

// Click ripple from the pointer position (CSS draws it; this only places it).
document.addEventListener('pointerdown', (event) => {
  const button = event.target instanceof Element ? event.target.closest('button') : null;
  if (!button || button.disabled) return;
  const box = button.getBoundingClientRect();
  button.style.setProperty('--x', `${event.clientX - box.left}px`);
  button.style.setProperty('--y', `${event.clientY - box.top}px`);
  button.classList.remove('pop');
  void button.offsetWidth; // restart the animation on quick repeat clicks
  button.classList.add('pop');
});
document.addEventListener('animationend', (event) => {
  if (event.animationName === 'ripple' && event.target instanceof Element) event.target.classList.remove('pop');
});
// Fade the picture in once frames actually arrive, instead of flashing black.
$('live').addEventListener('playing', () => ($('live').dataset.playing = ''));
$('live').addEventListener('emptied', () => delete $('live').dataset.playing);

// ---------- controls ----------

$('gate-form').addEventListener('submit', (event) => {
  event.preventDefault();
  state.started = true;
  const typed = $('your-name').value.trim();
  if (typed) store('name', typed);
  sendName();
  video.start();
  $('live').muted = false;
  $('live')
    .play()
    .catch(() => {});
  render();
});
$('connect').addEventListener('click', () => send({ type: 'connect' }));
$('disconnect').addEventListener('click', () => send({ type: 'disconnect' }));
$('reclaim').addEventListener('click', () => send({ type: 'reclaim' }));
$('extend').addEventListener('click', () => send({ type: 'extend', value: 5 }));
$('request').addEventListener('click', () => send({ type: 'request' }));
for (const b of document.querySelectorAll('[data-quality]'))
  b.addEventListener('click', () => send({ type: 'quality', value: b.dataset.quality }));
for (const b of document.querySelectorAll('[data-min]'))
  b.addEventListener('click', () => send({ type: 'turn-minutes', value: Number(b.dataset.min) }));
$('turn-custom').addEventListener('change', (e) => send({ type: 'turn-minutes', value: Number(e.target.value) }));
$('copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.shareUrl);
    toast(`Copied ${state.shareUrl} — send it to your friends.`);
  } catch {
    toast(state.shareUrl);
  }
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.role === 'host' && state.control.controller) send({ type: 'reclaim' });
});

const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : $('stage').requestFullscreen());
$('fullscreen').addEventListener('click', fullscreen);
$('stage').addEventListener('dblclick', fullscreen);
$('collapse').addEventListener('click', () => {
  const collapsed = $('dock').classList.toggle('collapsed');
  $('collapse').ariaExpanded = String(!collapsed);
  $('collapse').textContent = collapsed ? 'Show' : 'Hide';
});

const savedDz = store('deadzone');
if (savedDz !== null) $('deadzone').value = savedDz;
const applyDz = () => {
  setDeadzone($('deadzone').value);
  $('dz-out').textContent = Number($('deadzone').value).toFixed(2);
  store('deadzone', $('deadzone').value);
};
$('deadzone').addEventListener('input', applyDz);
applyDz();

setInterval(() => {
  const pad = firstPad();
  if (!pad) return setChip('pad-chip', 'No controller — press a button', 'warn');
  const kind = /xinput|xbox/i.test(pad.id) ? 'XInput' : pad.mapping === 'standard' ? 'Standard' : 'Gamepad';
  setChip('pad-chip', `${kind} controller connected`, 'ok');
}, 1000);

startInput({ active: inControl, send, layout: layoutFor('gta'), screen: $('stage') });
connect();
$('your-name').value = store('name') ?? '';
// #watch skips the start gate (the host's desktop shortcut uses it; the video starts muted then).
if (location.hash === '#watch') $('gate-form').requestSubmit();
render();
