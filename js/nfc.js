// nfc.js
// Web NFC (Chrome on Android). One reader stays on while the app is open, and
// whichever screen is showing decides what a tap means. iPhone has no Web NFC;
// there, taps reach the app as links instead (see app.js).

import { normUid } from './store.js';

export const nfcSupported = typeof window !== 'undefined' && 'NDEFReader' in window;

let reader = null;
let status = nfcSupported ? 'off' : 'unsupported'; // off | starting | on | error | unsupported
let lastError = '';
let consumer = null;
let fallback = null;
let writing = false;
let echo = null; // { serial, until }: the card just written, which may be read again right away
const watchers = new Set();

function setStatus(next, error = '') {
  status = next;
  lastError = error;
  for (const fn of watchers) {
    try { fn(status); } catch (err) { console.error(err); }
  }
}

export const nfcState = () => ({ supported: nfcSupported, state: status, error: lastError });
export function onNfcState(fn) { watchers.add(fn); return () => watchers.delete(fn); }
export function setConsumer(fn) { consumer = fn; return () => { if (consumer === fn) consumer = null; }; }
export function setFallback(fn) { fallback = fn; }

export async function nfcPermission() {
  try { return (await navigator.permissions.query({ name: 'nfc' })).state; } catch { return 'unknown'; }
}

export function nfcErrorText(err) {
  switch (err && err.name) {
    case 'NotAllowedError': return 'Chrome is blocking NFC for this site. Tap the icon left of the address, allow NFC, then try again.';
    case 'NotSupportedError': return 'This phone has no NFC reader that Chrome can use.';
    case 'NotReadableError': return 'NFC is off or busy. Turn on NFC in Android settings, then try again.';
    case 'SecurityError': return 'NFC only works on an https:// page opened directly in Chrome.';
    default: return (err && err.message) || String(err);
  }
}

const utf8 = new TextDecoder();

export function parseMessage(message) {
  const out = { url: null, text: null, records: [] };
  const walk = (records) => {
    for (const r of records || []) {
      let content;
      try {
        if (r.recordType === 'url' || r.recordType === 'absolute-url') {
          content = utf8.decode(r.data);
          if (!out.url) out.url = content;
        } else if (r.recordType === 'text') {
          content = new TextDecoder(r.encoding || 'utf-8').decode(r.data);
          if (!out.text) out.text = content;
        } else if (r.recordType === 'smart-poster' && typeof r.toRecords === 'function') {
          content = 'smart poster';
          walk(r.toRecords());
        } else {
          content = r.data ? `${r.data.byteLength} bytes` : 'empty';
        }
      } catch {
        content = 'could not decode';
      }
      out.records.push({ type: r.recordType, content });
    }
  };
  walk(message && message.records);
  return out;
}

function deliver(read) {
  const target = consumer || fallback;
  if (target) target(read);
}

export async function startNfc() {
  if (!nfcSupported) return false;
  if (status === 'on' || status === 'starting') return true;
  setStatus('starting');
  try {
    const r = new NDEFReader();
    r.onreading = (event) => {
      const now = performance.now();
      // Use the event's own timestamp when it looks sane: it is closer to the moment the card was read.
      const t0 = event.timeStamp > 0 && event.timeStamp <= now && now - event.timeStamp < 5000 ? event.timeStamp : now;
      const serial = normUid(event.serialNumber);
      if (writing || (echo && echo.serial === serial && now < echo.until)) return;
      deliver({ channel: 'webnfc', serial, ...parseMessage(event.message), t0 });
    };
    r.onreadingerror = () => {
      if (!writing) deliver({ channel: 'webnfc', error: 'unreadable', t0: performance.now() });
    };
    await r.scan();
    reader = r;
    setStatus('on');
    return true;
  } catch (err) {
    const permission = await nfcPermission();
    setStatus('error', err && err.name === 'NotAllowedError' && permission !== 'denied'
      ? 'Tap “Turn on card reader”, then allow NFC when Chrome asks.'
      : nfcErrorText(err));
    return false;
  }
}

// Writes a link onto the card that is on the phone right now. Call it from a
// reading handler, so one touch reads the card and then writes it.
export async function writeUrl(url, serial = '', timeoutMs = 4000) {
  if (!reader) throw Object.assign(new Error('The card reader is off. Tap “Turn on card reader” first.'), { name: 'InvalidStateError' });
  writing = true;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    await reader.write({ records: [{ recordType: 'url', data: url }] }, { overwrite: true, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
    writing = false;
    echo = serial ? { serial: normUid(serial), until: performance.now() + 1000 } : null;
  }
}
