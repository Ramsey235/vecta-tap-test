// app.js
// Boots the app, moves between screens, and receives card taps that arrive as
// links: always on iPhone, and on Android whenever the terminal isn't open.

import { store } from './store.js';
import { device, esc, money, ms, topbar, toast, unlockAudio } from './ui.js';
import { startNfc, nfcState, onNfcState, setFallback, nfcPermission } from './nfc.js';
import { tapParams, tapStats } from './pay.js';
import { mountTerminal } from './terminal.js';
import { mountAdmin, describeRead } from './admin.js';

const bootAt = performance.now();
const root = document.getElementById('app');
let unmount = null;
let handoff = null; // a tap that arrived as a link, waiting for its screen

function route() {
  if (unmount) unmount();
  unmount = null;
  root.onclick = null;
  root.onchange = null;
  root.oninput = null;
  const [section = '', ...rest] = (location.hash || '#/').replace(/^#\/?/, '').split('/');
  const pending = handoff;
  handoff = null;
  window.scrollTo(0, 0);
  if (section === 'terminal') unmount = mountTerminal(root, { linkRead: pending && pending.kind === 'pay' ? pending.read : null });
  else if (section === 'admin') unmount = mountAdmin(root, rest.filter(Boolean), { enrollRead: pending && pending.kind === 'enrol' ? pending.read : null });
  else if (section === 'check' && pending) unmount = mountCheck(pending.read);
  else unmount = mountHome();
}

function deviceStatus() {
  if (!device.secure) return { level: 'bad', title: 'Needs an https:// address', text: 'Phones only read NFC on secure pages. Host the app (see the setup guide) and open that address.' };
  if (device.webNfc) {
    const n = nfcState();
    if (n.state === 'on') return { level: 'ok', title: 'Card reader on', text: 'This phone reads cards directly in the app.' };
    if (n.state === 'error') return { level: 'warn', title: 'Card reader off', text: n.error };
    return { level: 'ok', title: 'Android card reader', text: 'Open the terminal to turn on the card reader.' };
  }
  if (device.ios && device.standalone) return { level: 'warn', title: 'Use Safari for the iPhone test', text: 'Card taps open in Safari, which keeps its data apart from this home-screen app. Open the same address in a Safari tab and run the terminal there.' };
  if (device.ios) return { level: 'ok', title: 'iPhone reads cards through Safari', text: 'Open the terminal, tap a card on the top of the phone, then tap the notification. Each tap opens in a new tab.' };
  if (device.android) return { level: 'warn', title: 'Open this in Chrome', text: 'This browser can’t read NFC cards. Chrome on Android can.' };
  return { level: 'warn', title: 'No card reader here', text: 'Turn on the tap simulator in Admin, Settings to try the flow on this computer.' };
}

function mountHome() {
  const render = () => {
    const s = store.settings();
    const taps = store.taps();
    const st = tapStats(taps, false);
    const today = new Date().toDateString();
    const todayCount = taps.filter((t) => t.channel !== 'sim' && new Date(t.at).toDateString() === today).length;
    const status = deviceStatus();
    root.innerHTML = `<div class="screen home">
<header class="brand"><img src="icons/icon-192.png" alt="" width="48" height="48"><div><h1>Vecta Tap Test</h1><p>Your phone as the fare terminal</p></div></header>
<section class="status ${status.level}"><strong>${esc(status.title)}</strong><span>${esc(status.text)}</span></section>
<dl class="facts">
<div><dt>Fare</dt><dd>${money(s.fare)}</dd></div>
<div><dt>Test cards</dt><dd>${store.cardList().length}</dd></div>
<div><dt>Taps today</dt><dd>${todayCount}</dd></div>
<div><dt>Card read to result, median</dt><dd>${st.direct ? ms(st.direct.median) : '–'}</dd></div>
<div><dt>Link opened to result, median</dt><dd>${st.link ? ms(st.link.median) : '–'}</dd></div>
</dl>
<div class="actions"><button class="cta" data-act="terminal">Open terminal</button><a class="quiet" href="#/admin">Admin</a></div>
</div>`;
  };
  render();
  root.onclick = (e) => {
    if (!e.target.closest('[data-act="terminal"]')) return;
    unlockAudio();
    if (device.webNfc) startNfc(); // Chrome asks for NFC permission on this tap the first time
    location.hash = '#/terminal';
  };
  return onNfcState(render);
}

// A card link opened while the terminal isn't taking payments: show it, charge nothing.
function mountCheck(read) {
  let alive = true;
  let body = '<p class="muted">Reading card…</p>';
  let canCharge = false;
  let openedMs = null;
  const render = () => {
    if (!alive) return;
    root.innerHTML = `<div class="screen">${topbar('Card check', '#/')}<div class="pane">
<p class="msg warn">Not charged. The terminal isn’t open on this phone.</p>${body}
${openedMs != null ? `<p class="hint">Link opened to this page: ${ms(openedMs)}.</p>` : ''}
<div class="row-actions spaced">${canCharge ? `<button class="cta small" data-act="charge">Charge ${money(store.settings().fare)} now</button>` : ''}<a class="quiet small" href="#/terminal">Open terminal</a></div>
</div></div>`;
  };
  render();
  describeRead(read).then((d) => {
    body = d.html;
    canCharge = !!d.card && d.ok;
    render();
    openedMs = performance.now();
    render();
  });
  root.onclick = (e) => {
    if (!e.target.closest('[data-act="charge"]')) return;
    unlockAudio();
    handoff = { kind: 'pay', read: { ...read, channel: 'check', t0: performance.now() } };
    location.hash = '#/terminal';
  };
  return () => { alive = false; };
}

function boot() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  setFallback(() => toast('Card read. Open the terminal to charge a fare.'));
  if (device.webNfc) nfcPermission().then((p) => { if (p === 'granted') startNfc(); });

  const link = location.href;
  if (location.search && tapParams(link)) {
    const s = store.settings();
    const read = { channel: 'link', url: link, t0: bootAt };
    let target = '#/check';
    let kind = 'check';
    if (s.enrollPending && s.enrollPending.until > Date.now()) { target = '#/admin/new'; kind = 'enrol'; }
    else if (s.linkArmedUntil > Date.now()) { target = '#/terminal'; kind = 'pay'; }
    handoff = { kind, read };
    // Drop the card data from the address so a reload can never charge the same tap again.
    history.replaceState(null, '', location.pathname + target);
  }
  window.addEventListener('hashchange', route);
  route();
}

boot();
