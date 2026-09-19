// terminal.js
// The fare screen the driver keeps open, drawn after the Vecta terminal mockups:
// Tap Card, Processing, Payment Successful, and the two Payment Failed screens.

import { store } from './store.js';
import { makeSunLink, bytesToHex } from './sun.js';
import { charge, logTap } from './pay.js';
import { startNfc, nfcState, onNfcState, setConsumer } from './nfc.js';
import { esc, money, ms, nfcBadge, seal, topbar, feedback, keepAwake, afterPaint, device, appBase, shortUid, toast, unlockAudio } from './ui.js';

// While the terminal is open, taps that arrive as links (iPhone) are charged.
// This is how long that stays on after the last use.
const ARM_MS = 30 * 60 * 1000;

export function mountTerminal(root, { linkRead = null } = {}) {
  let view = 'waiting'; // waiting | processing | result
  let result = null;
  let busy = false;
  let queued = null;
  let autoTimer = 0;
  let simChoice = '';
  let lastSimLink = '';
  let alive = true;

  const arm = (on) => store.saveSettings({ linkArmedUntil: on ? Date.now() + ARM_MS : 0 });
  arm(true);
  keepAwake(true);
  const offConsumer = setConsumer(handle);
  const offState = onNfcState(() => { if (view === 'waiting') render(); });
  if (device.webNfc && nfcState().state === 'off') startNfc();

  root.onclick = onClick;
  root.onchange = (e) => { if (e.target.matches('[data-sim]')) simChoice = e.target.value; };

  if (linkRead) handle(linkRead);
  else render();

  return () => {
    alive = false;
    clearTimeout(autoTimer);
    offConsumer();
    offState();
    keepAwake(false);
    arm(false);
  };

  function kindOf(r) {
    if (r.outcome === 'approved' || r.outcome === 'already') return 'success';
    return r.outcome === 'declined' ? 'declined' : 'error';
  }

  function timingText(r) {
    if (!r || store.settings().showTiming === false) return '';
    if (r.channel === 'link') return r.openMs != null ? `Link opened to result: ${ms(r.openMs)}` : '';
    return r.paintMs != null ? `Card read to result: ${ms(r.paintMs)}` : '';
  }

  function render() {
    if (!alive) return;
    const s = store.settings();
    let title = 'Tap Card';
    let main;
    let foot;
    if (view !== 'result') {
      const nfc = nfcState();
      const processing = view === 'processing';
      const live = !processing && (!device.webNfc || nfc.state === 'on');
      let hint = '';
      if (!processing) {
        if (device.webNfc && nfc.state === 'error') hint = `<p class="hint-line warn">${esc(nfc.error)}</p>`;
        else if (device.webNfc && nfc.state !== 'on') hint = '<p class="hint-line">Turning on the card reader…</p>';
        else if (device.ios) hint = '<p class="hint-line">Hold the card at the top of the iPhone, then tap the notification that appears.</p>';
        else if (!device.webNfc && device.android) hint = '<p class="hint-line warn">This browser can’t read NFC. Open the app in Chrome.</p>';
        else if (!device.webNfc) hint = `<p class="hint-line">No card reader on this device. ${s.showSimulator ? 'Use the simulator below.' : 'Turn on the tap simulator in Admin, Settings.'}</p>`;
      }
      main = `<div class="stage ${processing ? 'processing' : live ? 'scanning' : ''}">${nfcBadge()}
<p class="caption">${processing ? 'Processing Payment…' : 'Ask passenger to tap their Vecta NFC Card'}</p>
<p class="amount blue">${money(s.fare)}</p>${hint}</div>`;
      const retry = device.webNfc && nfc.state === 'error' && !processing;
      foot = `${simPanel(s)}${retry ? '<button class="cta" data-act="start-nfc">Turn on card reader</button>' : ''}
<button class="${retry ? 'quiet' : 'cta'}" data-act="cancel">Cancel</button>`;
    } else {
      const r = result;
      const kind = kindOf(r);
      title = kind === 'success' ? 'Payment Confirmed' : 'Payment Failed';
      const heading = r.outcome === 'approved' ? 'Payment Successful' : r.outcome === 'already' ? 'Already Paid' : 'Payment Unsuccessful';
      const color = { success: 'green', declined: 'red', error: 'amber' }[kind];
      let reason = '';
      if (r.outcome === 'already') reason = `<p class="reason">${esc(r.detail)}</p>`;
      else if (kind !== 'success') reason = `<p class="reason">${esc(r.text)}</p>`;
      const who = r.holder || (r.uid ? shortUid(r.uid) : '');
      const note = [who && `NFC Card · ${esc(who)}`, r.cardId && r.balance != null && `Balance ${money(r.balance)}`].filter(Boolean).join(' · ');
      main = `<div class="stage result">${seal(kind)}<h2 class="result-title">${heading}</h2>
<p class="amount ${color}">${money(r.fare)}</p>${reason}</div>`;
      foot = `${note ? `<p class="note">${note}</p>` : ''}<p class="timing">${esc(timingText(r))}</p>${simPanel(s)}
<button class="cta" data-act="again">${kind === 'success' ? 'Done' : 'Try Again'}</button>`;
    }
    const spoken = view === 'result' ? `${result.text}. ${money(result.fare)}.` : view === 'processing' ? 'Processing payment' : '';
    root.innerHTML = `<div class="screen terminal">${topbar(title, '#/', 'Close terminal')}<main class="term-main">${main}</main>
<footer class="footer">${foot}</footer><p class="sr" aria-live="assertive">${esc(spoken)}</p></div>`;
  }

  function simPanel(s) {
    if (!s.showSimulator) return '';
    const options = [
      ...store.cardList().map((c) => [`card:${c.id}`, `${c.name}, ${money(c.balance)}`]),
      ['unknown', 'Unregistered card'],
      ['unreadable', 'Unreadable tap'],
      ['forged', 'Forged secure tap'],
      ['replay', 'Replay last secure tap'],
    ];
    if (!options.some(([v]) => v === simChoice)) simChoice = options[0][0];
    return `<div class="sim"><select data-sim aria-label="Card to simulate">${options.map(([v, label]) =>
      `<option value="${esc(v)}"${v === simChoice ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>
<button data-act="sim">Simulate tap</button></div>`;
  }

  async function simulate() {
    const s = store.settings();
    const base = appBase();
    const keys = { metaKeyHex: s.metaKeyHex, fileKeyHex: s.fileKeyHex, piccParam: s.piccParam || 'picc_data', cmacParam: s.cmacParam || 'cmac' };
    const sunLink = (uidHex, lastCounter) => makeSunLink(base, { uidHex, counter: (lastCounter ?? 0) + 1, ...keys });
    const read = { channel: 'sim' };
    if (simChoice.startsWith('card:')) {
      const card = store.getCard(simChoice.slice(5));
      if (!card) return;
      if (card.mode === 'sun') {
        read.url = await sunLink(card.uid, card.lastCounter);
        read.serial = card.uid;
        lastSimLink = read.url;
      } else if (card.mode === 'token') {
        read.url = `${base}?t=${card.token}`;
        read.serial = card.uid || '';
      } else {
        read.serial = card.uid;
      }
    } else if (simChoice === 'unknown') {
      read.serial = `04${bytesToHex(crypto.getRandomValues(new Uint8Array(6)))}`;
    } else if (simChoice === 'unreadable') {
      read.error = 'unreadable';
    } else if (simChoice === 'forged') {
      const card = store.cardList().find((c) => c.mode === 'sun');
      const link = await sunLink(card ? card.uid : '04A1B2C3D4E5F6', card ? card.lastCounter : 0);
      read.url = link.slice(0, -1) + (link.endsWith('0') ? '1' : '0'); // one wrong character in the signature
    } else if (simChoice === 'replay') {
      if (!lastSimLink) { toast('Simulate a secure card tap first, then replay it.', 'warn'); return; }
      read.url = lastSimLink;
    }
    read.t0 = performance.now();
    handle(read);
  }

  async function handle(read) {
    if (!alive) return;
    if (busy) { queued = read; return; }
    busy = true;
    clearTimeout(autoTimer);
    view = 'processing';
    render();
    let res;
    try {
      res = await charge(read);
    } catch (err) {
      console.error(err);
      res = { at: Date.now(), fare: store.settings().fare, channel: read.channel, outcome: 'error', code: 'crash', text: 'Unable to process payment. Please try again', detail: String((err && err.message) || err) };
    }
    const tDecision = performance.now();
    if (!alive) {
      logTap(res, { readMs: tDecision - read.t0 });
      busy = false;
      return;
    }
    view = 'result';
    result = res;
    render();
    feedback(kindOf(res), store.settings());
    await afterPaint();
    const tPaint = performance.now();
    // For links, performance.now() counts from the moment the page started opening.
    const timing = read.channel === 'link'
      ? { readMs: tDecision - read.t0, openMs: tPaint }
      : { readMs: tDecision - read.t0, paintMs: tPaint - read.t0 };
    result = logTap(res, timing);
    const line = root.querySelector('.timing');
    if (line) line.textContent = timingText(result);
    arm(true);
    busy = false;
    const s = store.settings();
    if (s.autoReturnMs > 0) autoTimer = setTimeout(() => { if (view === 'result' && !busy) { view = 'waiting'; render(); } }, s.autoReturnMs);
    if (queued) {
      const next = queued;
      queued = null;
      handle(next);
    }
  }

  function onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    unlockAudio();
    const act = btn.dataset.act;
    if (act === 'cancel') location.hash = '#/';
    else if (act === 'again') { clearTimeout(autoTimer); view = 'waiting'; render(); }
    else if (act === 'start-nfc') startNfc().then(render);
    else if (act === 'sim') simulate();
  }
}
