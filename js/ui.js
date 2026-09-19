// ui.js
// Shared helpers: formatting, the terminal graphics from the Vecta mockups,
// sound and vibration feedback, the screen wake lock, and facts about this device.

export const APP_VERSION = '1.0.0';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const whole = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 });
export function money(n) {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? '−' : ''}₦${whole.format(Math.abs(v))}`;
}

export function ms(v) {
  if (v == null || !Number.isFinite(v)) return '–';
  if (v < 10) return `${v.toFixed(1)} ms`;
  if (v < 10000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(1)} s`;
}

export function ago(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

export function clock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function shortUid(uid) {
  const u = String(uid || '');
  return u.length > 8 ? `${u.slice(0, 4)}…${u.slice(-4)}` : u;
}

export const MODE_LABEL = { sun: 'Secure link', token: 'Quick token', uid: 'Card ID only' };

export const device = (() => {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  return {
    ios,
    android,
    webNfc: 'NDEFReader' in window,
    standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
    secure: window.isSecureContext,
    name: ios ? 'iPhone' : android ? 'Android' : 'Computer',
  };
})();

// Folder the app is served from, e.g. https://vecta-tap.netlify.app/
export function appBase() {
  return location.origin + location.pathname.replace(/[^/]*$/, '');
}

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function newToken(length = 12) {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => ALPHABET[b & 31]).join('');
}
export function newId() {
  return `c${Date.now().toString(36)}${newToken(4).toLowerCase()}`;
}

export const icons = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
};

export function topbar(title, backHref = '#/', backLabel = 'Back') {
  return `<header class="topbar"><a class="back" href="${backHref}" aria-label="${esc(backLabel)}">${icons.back}</a><h1>${esc(title)}</h1><span></span></header>`;
}

// The contactless badge on the Tap Card screen (same glyph as the app icon).
const GLYPH = '<path d="M165 316V196l78 120V196"/><path d="M281 214a58 58 0 0 1 0 84"/><path d="M315 180a104 104 0 0 1 0 152"/>';
export function nfcBadge() {
  return `<svg class="badge" viewBox="0 0 240 240" aria-hidden="true">
<defs><linearGradient id="nfc-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1A6FEF"/><stop offset="1" stop-color="#38D0E6"/></linearGradient>
<radialGradient id="nfc-face" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E6F4FD"/></radialGradient></defs>
<circle class="halo" cx="120" cy="120" r="117" fill="#EDF5FF"/>
<circle cx="120" cy="120" r="88" fill="url(#nfc-face)" stroke="url(#nfc-ring)" stroke-width="12"/>
<circle class="spin" cx="120" cy="120" r="88" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="12" stroke-linecap="round" stroke-dasharray="64 490"/>
<g transform="translate(120 120) scale(.3) translate(-256 -256)" fill="none" stroke="#1A73F0" stroke-width="22" stroke-linecap="round" stroke-linejoin="round">${GLYPH}</g></svg>`;
}

// Scalloped result seals with a flat long shadow, as in the mockups.
function sealPath(r = 86, amp = 5, points = 16, steps = 192) {
  let d = '';
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = r + amp * Math.cos(points * a);
    d += `${i ? 'L' : 'M'}${(100 + rr * Math.cos(a)).toFixed(2)} ${(100 + rr * Math.sin(a)).toFixed(2)}`;
  }
  return `${d}Z`;
}
const SEAL = sealPath();
const CROSS = { strokes: [[76, 76, 124, 124], [124, 76, 76, 124]], glyph: 'M76 76l48 48M124 76l-48 48' };
const SEALS = {
  success: { fill: '#5DB749', deep: '#4DA33B', strokes: [[70, 101, 91, 122], [91, 122, 132, 80]], glyph: 'M70 101l21 21 41-42' },
  declined: { fill: '#EE4141', deep: '#D72E2E', ...CROSS },
  error: { fill: '#F5A617', deep: '#E48E02', ...CROSS },
};
let sealCount = 0;
export function seal(kind) {
  const s = SEALS[kind] || SEALS.error;
  const id = `seal-clip-${++sealCount}`;
  const L = 170;
  const shadow = s.strokes.map(([x1, y1, x2, y2]) => `<path d="M${x1} ${y1}L${x2} ${y2}L${x2 + L} ${y2 + L}L${x1 + L} ${y1 + L}Z"/>`).join('');
  return `<svg class="seal" viewBox="0 0 200 200" aria-hidden="true"><defs><clipPath id="${id}"><path d="${SEAL}"/></clipPath></defs>
<path d="${SEAL}" fill="${s.fill}"/>
<g clip-path="url(#${id})" fill="${s.deep}" stroke="${s.deep}" stroke-width="16" stroke-linejoin="round">${shadow}</g>
<path d="${s.glyph}" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

let toastTimer = 0;
export function toast(message, kind = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.className = `toast ${kind}`;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    window.prompt('Copy this:', text);
  }
}

export function download(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Sound needs one tap on the page first (browser rule), so buttons call unlockAudio().
let audio = null;
export function unlockAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audio = audio || new Ctx();
    if (audio.state === 'suspended') audio.resume();
  } catch {
    audio = null;
  }
}
function tone(freq, at, dur, type = 'sine', vol = 0.16) {
  const t = audio.currentTime + at;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}
export function feedback(kind, settings) {
  try {
    if (settings.sound && audio) {
      if (audio.state === 'suspended') audio.resume();
      if (kind === 'success') { tone(988, 0, 0.09); tone(1319, 0.1, 0.16); }
      else if (kind === 'declined') tone(196, 0, 0.3, 'square', 0.06);
      else { tone(523, 0, 0.12, 'triangle'); tone(392, 0.14, 0.18, 'triangle'); }
    }
    const touched = !navigator.userActivation || navigator.userActivation.hasBeenActive;
    if (settings.vibrate && navigator.vibrate && touched) navigator.vibrate(kind === 'success' ? 60 : [90, 60, 90]);
  } catch {
    // feedback is optional
  }
}

let lock = null;
let wantLock = false;
export async function keepAwake(on) {
  wantLock = on;
  try {
    if (on && !lock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } else if (!on && lock) {
      await lock.release();
      lock = null;
    }
  } catch {
    lock = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (wantLock && document.visibilityState === 'visible') keepAwake(true);
});

// Resolves just after the browser has painted the current screen.
export function afterPaint() {
  return new Promise((resolve) => {
    const fallback = setTimeout(resolve, 600); // hidden tabs never paint
    requestAnimationFrame(() => setTimeout(() => { clearTimeout(fallback); resolve(); }, 0));
  });
}
