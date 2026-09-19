// admin.js
// The test dashboard inside the app: add test cards and load test balances,
// read the timing results, and set the fare, card keys and options.

import { store } from './store.js';
import { verifySun, findSunParams, selfTest, isKeyHex, makeSunLink, ZERO_KEY_HEX } from './sun.js';
import { identify, keysOf, tapStats, tapsCsv } from './pay.js';
import { startNfc, nfcState, onNfcState, setConsumer, writeUrl, nfcErrorText } from './nfc.js';
import {
  APP_VERSION, esc, money, ms, ago, clock, shortUid, MODE_LABEL, device, appBase, newToken, newId,
  topbar, nfcBadge, seal, toast, download, copyText, feedback, unlockAudio,
} from './ui.js';

const TABS = [['cards', 'Cards'], ['results', 'Results'], ['settings', 'Settings']];
const VARIANT_LABEL = {
  empty: 'The signature alone (standard setup)',
  'from-file-data': 'Link text from the file data up to the signature',
  'from-picc-data': 'Link text from the card data up to the signature',
  'from-uid': 'Link text from the chip ID up to the signature',
};

function writeErrorText(err) {
  switch (err && err.name) {
    case 'NetworkError': return 'The card moved before writing finished. Tap it again and hold it still.';
    case 'AbortError': return 'Writing took too long. Tap the card again and hold it still.';
    case 'NotAllowedError': return 'The card refused the write. It may be write-protected. Use a fresh card, or choose Secure link.';
    case 'NotSupportedError': return 'This card can’t store a link.';
    case 'NotReadableError':
    case 'SecurityError':
    case 'InvalidStateError': return nfcErrorText(err);
    default: return (err && err.message) || String(err);
  }
}

function printable(bytes) {
  const text = new TextDecoder().decode(bytes);
  return /^[\x20-\x7E]*$/.test(text) ? text : Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function tapRow(t) {
  const cls = t.outcome === 'approved' || t.outcome === 'already' ? 'ok' : t.outcome === 'declined' ? 'no' : 'err';
  const time = t.channel === 'link' ? t.openMs : t.paintMs;
  const how = t.channel === 'sim' ? ', simulated' : t.channel === 'link' ? ', via link' : '';
  return `<div class="row"><span class="dot ${cls}"></span><span class="main"><span class="t">${esc(t.holder || (t.uid ? shortUid(t.uid) : 'Unknown card'))}</span>
<span class="s">${clock(t.at)}, ${esc(t.text || '')}${how}</span></span>
<span class="v">${t.outcome === 'approved' ? money(t.fare) : '–'}<span class="s">${ms(time)}</span></span></div>`;
}

function chart(taps) {
  const pts = taps.map((t) => ({
    v: t.channel === 'link' ? t.openMs : t.paintMs,
    link: t.channel === 'link',
    ok: t.outcome === 'approved' || t.outcome === 'already',
  })).filter((p) => Number.isFinite(p.v));
  if (pts.length < 2) return '';
  const W = 340;
  const H = 120;
  const pad = 46;
  const sorted = pts.map((p) => p.v).sort((a, b) => a - b);
  const top = Math.max(sorted[Math.floor((sorted.length - 1) * 0.95)] * 1.15, 1);
  const bw = (W - pad) / pts.length;
  const bars = pts.map((p, i) => {
    const h = Math.max(2, Math.min(1, p.v / top) * (H - 18));
    return `<rect x="${(pad + i * bw + 1).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${p.link ? '#38D0E6' : '#1A73F0'}"${p.ok ? '' : ' opacity=".4"'}/>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H + 4}" role="img" aria-label="Time to result for the last ${pts.length} taps">
<line x1="${pad}" x2="${W}" y1="${H}" y2="${H}" stroke="#E8EBF0"/><line x1="${pad}" x2="${W}" y1="18" y2="18" stroke="#E8EBF0" stroke-dasharray="3 3"/>
<text x="0" y="22" font-size="10" fill="#8A90A0">${ms(top)}</text><text x="0" y="${H}" font-size="10" fill="#8A90A0">0 ms</text>${bars}</svg>
<p class="legend"><span><i style="background:#1A73F0"></i>Read in the app</span><span><i style="background:#38D0E6"></i>Via link (iPhone)</span><span>Faded: not approved</span></p>`;
}

// What a card sends, in plain words. Used by Inspect and by the Card check page.
export async function describeRead(read) {
  const s = store.settings();
  const rows = [];
  const add = (label, html) => rows.push(`<div><dt>${esc(label)}</dt><dd>${html}</dd></div>`);
  if (read.error) {
    return { html: '<p class="msg warn">The phone saw a card but couldn’t read it. Hold it flat and still for a second.</p>', card: null, ok: false };
  }
  if (read.serial) add('Chip ID', esc(read.serial));
  (read.records || []).forEach((r, i) => add(`Record ${i + 1}, ${r.type}`, esc(r.content)));
  if (!read.records && read.url) add('Link', esc(read.url));
  let extra = '';
  if (read.url && findSunParams(read.url, s)) {
    const t0 = performance.now();
    const sun = await verifySun(read.url, { ...keysOf(s), decryptFileData: true });
    const took = performance.now() - t0;
    if (sun.ok) {
      add('Secure link', `<span class="ok-text">Verified</span> in ${ms(took)}`);
      add('Chip ID inside the signed data', esc(sun.uid));
      add('Tap counter', String(sun.counter));
      add('Signature covers', esc(VARIANT_LABEL[sun.variant] || sun.variant));
      if (sun.fileData) add('Encrypted file data', esc(printable(sun.fileData)));
    } else {
      add('Secure link', '<span class="bad-text">Not verified</span>');
      extra = `<p class="msg bad">${esc(sun.reason)}</p>`;
    }
  } else {
    add('Secure link', read.url ? 'None, plain link' : 'None');
  }
  const id = await identify(read);
  add('Registered to', id.card ? `${esc(id.card.name)}, ${money(id.card.balance)}` : 'Nobody on this phone');
  return { html: `<dl class="kv">${rows.join('')}</dl>${extra}`, card: id.card, ok: !id.problem };
}

// Byte offsets of the SUN mirrors inside the NDEF file, for tools that ask for them.
function sdmOffsets(base, s) {
  const rest = base.replace(/^https:\/\//, ''); // the NDEF URI prefix code 0x04 stands for https://
  const enc = new TextEncoder();
  const head = 7; // NLEN (2) + record header (1) + type length (1) + payload length (1) + type "U" (1) + prefix code (1)
  const picc = head + enc.encode(`${rest}?${s.piccParam}=`).length;
  const mac = picc + 32 + enc.encode(`&${s.cmacParam}=`).length;
  return { picc, mac };
}
const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');

export function mountAdmin(root, path, { enrollRead = null } = {}) {
  const [page = 'cards', arg = ''] = path;
  const tab = ['results', 'settings'].includes(page) ? page : 'cards';
  const cleanup = [];
  let alive = true;

  const shell = (title, back, body) => `<div class="screen admin">${topbar(title, back)}
<nav class="tabs" aria-label="Admin sections">${TABS.map(([id, label]) => `<a href="#/admin/${id}"${id === tab ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
<div class="pane">${body}</div></div>`;
  const paint = (title, back, body) => { if (alive) root.innerHTML = shell(title, back, body); };
  const common = { copy: (el) => copyText(el.dataset.v) };
  const actions = (map) => {
    root.onclick = (e) => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      const fn = map[el.dataset.act] || common[el.dataset.act];
      if (!fn) return;
      if (el.tagName === 'BUTTON') e.preventDefault();
      unlockAudio();
      fn(el, e);
    };
  };

  if (page === 'new') newCardPage();
  else if (page === 'card') cardPage(arg);
  else if (page === 'inspect') inspectPage();
  else if (page === 'results') resultsPage();
  else if (page === 'settings') settingsPage();
  else cardsPage();

  return () => {
    alive = false;
    cleanup.forEach((fn) => fn());
  };

  // ---------- Cards ----------

  function cardsPage() {
    const cards = store.cardList();
    const row = (c) => `<a class="row" href="#/admin/card/${esc(c.id)}"><span class="dot ${c.blocked ? 'no' : 'ok'}"></span>
<span class="main"><span class="t">${esc(c.name)}</span><span class="s">${MODE_LABEL[c.mode]}, ${c.uid ? esc(shortUid(c.uid)) : 'not linked yet'}</span></span>
<span class="v">${money(c.balance)}<span class="s">${c.lastTapAt ? ago(c.lastTapAt) : 'no taps yet'}</span></span></a>`;
    paint('Admin', '#/', `<div class="row-actions"><a class="cta small" href="#/admin/new">Add test card</a><a class="quiet small" href="#/admin/inspect">Inspect a card</a></div>
${cards.length ? `<div class="list">${cards.map(row).join('')}</div>`
    : '<div class="empty"><p><b>No test cards yet</b></p><p class="muted">Add a card, load a test balance, then tap it on the terminal.</p></div>'}
<p class="hint">Balances live on this phone. The card only proves who is tapping.</p>`);
    actions({});
  }

  function newCardPage() {
    let step = 'form';
    let draft = { name: '', balance: 1000, mode: 'token' };
    let status = null;
    let done = null;
    let manual = false;
    let working = false;
    let pendingSet = false;

    const clearPending = () => {
      if (pendingSet) { store.saveSettings({ enrollPending: null }); pendingSet = false; }
    };
    const render = () => paint('Add test card', '#/admin/cards', step === 'form' ? formHtml() : done ? doneHtml() : linkHtml());

    root.oninput = (e) => {
      const el = e.target;
      if (el.name === 'mode') draft.mode = el.value;
      else if (el.dataset.draft) draft[el.dataset.draft] = el.value;
    };
    root.onchange = root.oninput;
    actions({
      bal: (el) => {
        draft.balance = el.dataset.v;
        const input = root.querySelector('#f-bal');
        if (input) input.value = el.dataset.v;
      },
      continue: () => {
        const name = String(draft.name || '').trim();
        const raw = String(draft.balance).trim();
        const balance = Math.round(Number(raw.replace(/[^\d.]/g, '')));
        if (!name) { status = { kind: 'bad', text: 'Enter the card holder’s name.' }; render(); return; }
        if (!raw || !Number.isFinite(balance)) { status = { kind: 'bad', text: 'Enter a test balance in naira, for example 1000.' }; render(); return; }
        draft = { name, balance, mode: draft.mode };
        status = null;
        step = 'link';
        if (device.webNfc) {
          startNfc();
        } else if (draft.mode === 'token') {
          done = saveCard({ token: newToken() });
          manual = true;
        } else if (draft.mode === 'sun') {
          store.saveSettings({ enrollPending: { ...draft, until: Date.now() + 3 * 60 * 1000 } });
          pendingSet = true;
        }
        render();
      },
      'back-form': () => { step = 'form'; status = null; clearPending(); render(); },
      another: () => { step = 'form'; done = null; manual = false; status = null; draft = { name: '', balance: 1000, mode: draft.mode }; render(); },
      'start-nfc': () => startNfc().then(render),
    });
    if (device.webNfc) {
      cleanup.push(setConsumer(onRead));
      cleanup.push(onNfcState(() => { if (step === 'link' && !done) render(); }));
    }
    cleanup.push(clearPending);
    if (enrollRead) finishLinkEnrol();
    else render();

    function formHtml() {
      const choice = (mode, title, text, disabled = false) => `<label class="choice${disabled ? ' off' : ''}"><input type="radio" name="mode" value="${mode}"${draft.mode === mode ? ' checked' : ''}${disabled ? ' disabled' : ''}><span><b>${title}</b><span>${text}</span></span></label>`;
      return `<div class="field"><label for="f-name">Card holder</label><input id="f-name" class="input" data-draft="name" value="${esc(draft.name)}" placeholder="For example, Adekeye O" autocomplete="off"></div>
<div class="field"><label for="f-bal">Starting test balance (₦)</label><input id="f-bal" class="input" data-draft="balance" inputmode="numeric" value="${esc(draft.balance)}">
<div class="chips">${[1000, 5000, 100].map((v) => `<button class="chip" data-act="bal" data-v="${v}">${money(v)}${v === 100 ? ', to test a decline' : ''}</button>`).join('')}</div></div>
<div class="field"><span class="field-lbl">How the card proves who it is</span>
${choice('token', 'Quick token', 'This phone writes a link with a random token onto the card. Ready in a second, but the link can be copied to another card.')}
${choice('sun', 'Secure link (SUN)', 'The NTAG 424 DNA signs every tap, so it can’t be copied or replayed. Turn on SUN with NXP TagWriter first; Settings shows the link to use.')}
${choice('uid', 'Card ID only', device.webNfc ? 'Uses the chip’s serial number. Works with any NFC card, but is the easiest to fake.' : 'Needs Chrome on Android.', !device.webNfc)}
</div>
${status ? `<p class="msg ${status.kind}">${esc(status.text)}</p>` : ''}
<button class="cta" data-act="continue">Continue</button>`;
    }

    function linkHtml() {
      const who = `<p><b>${esc(draft.name)}</b>, ${money(draft.balance)}, ${MODE_LABEL[draft.mode]}</p>`;
      const msg = status ? `<p class="msg ${status.kind}">${esc(status.text)}</p>` : '';
      const back = '<button class="quiet" data-act="back-form">Change details</button>';
      if (device.webNfc) {
        const n = nfcState();
        return `<div class="enrol ${working ? 'processing' : 'scanning'}">${nfcBadge()}${who}
<p class="muted">${working ? 'Keep holding the card…' : 'Hold the card flat on the back of the phone and keep it there until you see Card ready.'}</p></div>
${n.state === 'error' ? `<p class="msg warn">${esc(n.error)}</p><button class="cta" data-act="start-nfc">Turn on card reader</button>` : ''}${msg}${back}`;
      }
      if (draft.mode === 'sun') {
        return `<div class="enrol ${working ? 'processing' : 'scanning'}">${nfcBadge()}${who}
<p class="muted">${working ? 'Checking the card…' : 'Tap the card on the top of the iPhone now, then tap the notification. The card is added in the tab that opens. This waits for 3 minutes.'}</p></div>${msg}${back}`;
      }
      return `<p class="msg warn">Card ID only needs Chrome on Android.</p>${back}`;
    }

    function doneHtml() {
      const c = done;
      const link = c.mode === 'token' ? `${appBase()}?t=${c.token}` : '';
      return `<div class="enrol">${seal('success')}<h2 class="result-title">Card ready</h2><p><b>${esc(c.name)}</b> has ${money(c.balance)} to spend.</p></div>
${manual ? `<p>This phone can’t write cards. Write this link onto the card as a URL record with NXP TagWriter, then tap the card on the terminal.</p>
<code class="code">${esc(link)}</code><div class="row-actions"><button class="quiet small" data-act="copy" data-v="${esc(link)}">Copy link</button></div>` : ''}
<dl class="kv"><div><dt>Type</dt><dd>${MODE_LABEL[c.mode]}</dd></div>${c.uid ? `<div><dt>Chip ID</dt><dd>${esc(c.uid)}</dd></div>` : ''}${c.lastCounter != null ? `<div><dt>Tap counter</dt><dd>${c.lastCounter}</dd></div>` : ''}</dl>
<div class="row-actions spaced"><button class="cta small" data-act="another">Add another card</button><a class="quiet small" href="#/terminal">Open terminal</a></div>`;
    }

    function saveCard(extra) {
      const card = {
        id: newId(), name: draft.name, balance: draft.balance, mode: draft.mode, createdAt: Date.now(),
        uid: null, token: null, lastCounter: null, blocked: false, tapCount: 0, paidCount: 0, ...extra,
      };
      store.putCard(card);
      return card;
    }

    async function enrolSun(link) {
      const sun = await verifySun(link, keysOf(store.settings()));
      if (!sun.ok) throw new Error(sun.reason);
      const owner = store.findByUid(sun.uid);
      if (owner) throw new Error(`This card is already registered to ${owner.name}.`);
      if (sun.variant) store.saveSettings({ macVariant: sun.variant });
      done = saveCard({ uid: sun.uid, lastCounter: sun.counter });
    }

    async function onRead(read) {
      if (step !== 'link' || done || working) return;
      working = true;
      status = null;
      render();
      try {
        if (read.error) throw new Error('The card could not be read. Hold it flat on the phone and try again.');
        const sunLink = read.url && findSunParams(read.url, store.settings()) ? read.url : null;
        if (draft.mode === 'sun') {
          if (!sunLink) throw new Error('This card isn’t sending a secure link yet. Turn on SUN with NXP TagWriter first (Settings, Secure cards), or choose Quick token.');
          await enrolSun(sunLink);
        } else {
          const owner = read.serial && store.findByUid(read.serial);
          if (owner) throw new Error(`This card is already registered to ${owner.name}.`);
          if (draft.mode === 'uid') {
            if (!read.serial) throw new Error('The phone didn’t report a chip ID for this card.');
            done = saveCard({ uid: read.serial });
          } else {
            if (sunLink) throw new Error('This card already sends a secure SUN link. Writing a token would break it, so choose Secure link instead.');
            const token = newToken();
            await writeUrl(`${appBase()}?t=${token}`, read.serial);
            done = saveCard({ token, uid: read.serial || null });
          }
        }
        feedback('success', store.settings());
      } catch (err) {
        status = { kind: 'bad', text: writeErrorText(err) };
        feedback('error', store.settings());
      }
      working = false;
      render();
    }

    // iPhone: the card tap opened this tab as a link while an enrolment was waiting.
    async function finishLinkEnrol() {
      const pend = store.settings().enrollPending || {};
      store.saveSettings({ enrollPending: null });
      draft = { name: pend.name || 'New card', balance: Number(pend.balance) || 0, mode: 'sun' };
      step = 'link';
      working = true;
      render();
      try {
        if (!findSunParams(enrollRead.url, store.settings())) throw new Error('This card sent a plain link, not a secure SUN link. Set it up with NXP TagWriter first, or add it as a Quick token.');
        await enrolSun(enrollRead.url);
      } catch (err) {
        status = { kind: 'bad', text: err.message };
        store.saveSettings({ enrollPending: { ...draft, until: Date.now() + 3 * 60 * 1000 } });
      }
      working = false;
      render();
    }
  }

  function cardPage(id) {
    let note = null;
    const render = () => {
      const c = store.getCard(id);
      if (!c) {
        paint('Card', '#/admin/cards', '<div class="empty"><p>This card isn’t on this phone any more.</p><p><a href="#/admin/cards">Back to cards</a></p></div>');
        return;
      }
      const taps = store.taps().filter((t) => t.cardId === id).slice(-8).reverse();
      const link = c.mode === 'token' && c.token ? `${appBase()}?t=${c.token}` : '';
      paint(c.name, '#/admin/cards', `<p class="muted">Test balance</p><p class="big-balance">${money(c.balance)}</p>
<div class="chips">${[200, 500, 1000, 5000].map((v) => `<button class="chip" data-act="add" data-v="${v}">Add ${money(v)}</button>`).join('')}</div>
<div class="field"><label for="c-set">Set balance to (₦)</label><div class="inline"><input id="c-set" class="input" inputmode="numeric" placeholder="${c.balance}"><button class="quiet small" data-act="set">Save</button></div></div>
<div class="field"><label for="c-name">Card holder</label><div class="inline"><input id="c-name" class="input" value="${esc(c.name)}"><button class="quiet small" data-act="rename">Save</button></div></div>
<h2>Card</h2>
<dl class="kv"><div><dt>Type</dt><dd>${MODE_LABEL[c.mode]}</dd></div>
<div><dt>Chip ID</dt><dd>${c.uid ? esc(c.uid) : 'Not linked yet'}</dd></div>
${c.mode === 'sun' ? `<div><dt>Last tap counter</dt><dd>${c.lastCounter ?? '–'}</dd></div>` : ''}
<div><dt>Taps</dt><dd>${c.tapCount || 0}, ${c.paidCount || 0} paid</dd></div>
<div><dt>Status</dt><dd>${c.blocked ? '<span class="bad-text">Blocked</span>' : 'Active'}</dd></div></dl>
${link ? `<p class="field-lbl">Link on the card</p><code class="code">${esc(link)}</code>
<div class="row-actions"><button class="quiet small" data-act="copy" data-v="${esc(link)}">Copy link</button>${device.webNfc ? '<button class="quiet small" data-act="rewrite">Write it onto a card</button>' : ''}</div>` : ''}
${note ? `<p class="msg ${note.kind}">${esc(note.text)}</p>` : ''}
<div class="row-actions"><button class="quiet small${c.blocked ? '' : ' danger'}" data-act="block">${c.blocked ? 'Unblock card' : 'Block card'}</button><button class="quiet small danger" data-act="remove">Remove card</button></div>
<h2>Recent taps</h2>
${taps.length ? `<div class="list">${taps.map(tapRow).join('')}</div>` : '<p class="muted">No taps yet.</p>'}`);
    };
    const update = (patch, message) => {
      const c = store.getCard(id);
      if (!c) return;
      store.putCard({ ...c, ...patch });
      if (message) toast(message);
      render();
    };
    actions({
      add: (el) => update({ balance: store.getCard(id).balance + Number(el.dataset.v) }, `Added ${money(el.dataset.v)}`),
      set: () => {
        const raw = root.querySelector('#c-set').value.trim();
        const v = Math.round(Number(raw.replace(/[^\d.]/g, '')));
        if (!raw || !Number.isFinite(v)) { toast('Enter a balance in naira.', 'warn'); return; }
        update({ balance: v }, 'Balance saved');
      },
      rename: () => {
        const v = root.querySelector('#c-name').value.trim();
        if (!v) { toast('Enter a name.', 'warn'); return; }
        update({ name: v }, 'Name saved');
      },
      block: () => {
        const c = store.getCard(id);
        update({ blocked: !c.blocked }, c.blocked ? 'Card unblocked' : 'Card blocked');
      },
      remove: () => {
        const c = store.getCard(id);
        if (!window.confirm(`Remove ${c.name}? Its test balance of ${money(c.balance)} is deleted.`)) return;
        store.removeCard(id);
        toast('Card removed');
        location.hash = '#/admin/cards';
      },
      rewrite: () => {
        note = { kind: 'warn', text: 'Hold a card on the back of the phone until it says Written.' };
        startNfc();
        const off = setConsumer(async (read) => {
          off();
          const c = store.getCard(id);
          try {
            if (read.error) throw new Error('The card could not be read. Try again.');
            if (read.url && findSunParams(read.url, store.settings())) throw new Error('That card sends a secure SUN link. Writing a token would break it.');
            const owner = read.serial && store.findByUid(read.serial);
            if (owner && owner.id !== id) throw new Error(`That card belongs to ${owner.name}.`);
            await writeUrl(`${appBase()}?t=${c.token}`, read.serial);
            store.putCard({ ...c, uid: read.serial || c.uid });
            note = { kind: 'ok', text: 'Written. This card now pays from this account.' };
          } catch (err) {
            note = { kind: 'bad', text: writeErrorText(err) };
          }
          render();
        });
        cleanup.push(off);
        render();
      },
    });
    render();
  }

  function inspectPage() {
    let out = '';
    const render = () => paint('Inspect a card', '#/admin/cards', device.webNfc
      ? `<div class="enrol scanning">${nfcBadge()}<p class="muted">Tap any card to see what it sends. Nothing is charged.</p></div>${out}`
      : '<p>This needs Chrome on Android. On iPhone, close the terminal, tap a card on the top of the phone and open the notification. The page that opens shows the same details without charging.</p>');
    actions({});
    if (device.webNfc) {
      startNfc();
      cleanup.push(setConsumer(async (read) => { out = (await describeRead(read)).html; render(); }));
    }
    render();
  }

  // ---------- Results ----------

  function resultsPage() {
    let includeSim = false;
    let speed = null;
    const render = () => {
      const taps = store.taps();
      const st = tapStats(taps, includeSim);
      const recent = taps.filter((t) => includeSim || t.channel !== 'sim').slice(-80).reverse();
      const fig = (value, label) => `<div><b>${value}</b><span>${label}</span></div>`;
      const pct = (label, x) => (x ? `<tr><th scope="row">${label}<span>${x.n} taps</span></th><td>${ms(x.min)}</td><td>${ms(x.median)}</td><td>${ms(x.p90)}</td><td>${ms(x.max)}</td></tr>` : '');
      paint('Admin', '#/', `<h2>Tap timing</h2>
<div class="figures">
${fig(st.count, 'taps logged')}
${fig(st.count ? `${Math.round((st.approved / st.count) * 100)}%` : '–', 'approved')}
${fig(st.direct ? ms(st.direct.median) : '–', 'card read to result, median (Android)')}
${fig(st.link ? ms(st.link.median) : '–', 'link opened to result, median (iPhone)')}
${fig(st.gap ? ms(st.gap.median) : '–', 'between one tap and the next, median')}
${fig(st.gap ? Math.round(60000 / st.gap.median) : '–', 'passengers a minute at that pace')}
</div>
${chart(recent.slice(0, 40).reverse())}
${st.direct || st.link ? `<table class="pct"><thead><tr><th></th><th>Fastest</th><th>Median</th><th>90%</th><th>Slowest</th></tr></thead>
<tbody>${pct('Card read to result', st.direct)}${pct('Link opened to result', st.link)}${pct('Between taps', st.gap)}</tbody></table>` : ''}
<label class="toggle"><span>Include simulated taps</span><input type="checkbox" data-act="sim-toggle"${includeSim ? ' checked' : ''}></label>
<h2>Rapid tap test</h2>${speedHtml()}
<h2>Tap log</h2>
<div class="row-actions"><button class="quiet small" data-act="csv">Export CSV</button><button class="quiet small danger" data-act="clear">Clear log</button></div>
${recent.length ? `<div class="list">${recent.map(tapRow).join('')}</div>` : '<p class="muted">No taps yet. Open the terminal and tap a card.</p>'}`);
    };
    const speedHtml = () => {
      if (!device.webNfc) return '<p class="muted">Needs Chrome on Android, because iPhone can’t read taps inside the app.</p>';
      if (speed) return `<p>Tap one card on and off the phone as fast as you can. <b>${speed.stamps.length}</b> reads so far, ${Math.max(0, Math.ceil(speed.left))} s left.</p><button class="quiet" data-act="speed-stop">Stop</button>`;
      const last = store.settings().lastSpeedTest;
      return `<p class="muted">Tap one card on and off the phone as fast as you can for 20 seconds. It shows the fastest the phone can take back-to-back taps. Nothing is charged.</p>
${last ? `<dl class="kv"><div><dt>Last run</dt><dd>${new Date(last.at).toLocaleString()}</dd></div><div><dt>Reads</dt><dd>${last.count} in ${Math.round(last.seconds)} s</dd></div>
<div><dt>Fastest gap between reads</dt><dd>${ms(last.minGap)}</dd></div><div><dt>Median gap</dt><dd>${ms(last.medianGap)}</dd></div></dl>` : ''}
<button class="quiet" data-act="speed">Start rapid tap test</button>`;
    };
    const stopSpeed = () => {
      if (!speed) return;
      clearInterval(speed.timer);
      speed.off();
      const gaps = speed.stamps.slice(1).map((t, i) => t - speed.stamps[i]).sort((a, b) => a - b);
      store.saveSettings({ lastSpeedTest: {
        at: Date.now(), count: speed.stamps.length, seconds: (performance.now() - speed.t0) / 1000,
        minGap: gaps.length ? gaps[0] : null, medianGap: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
      } });
      speed = null;
      render();
    };
    actions({
      'sim-toggle': (el) => { includeSim = el.checked; render(); },
      csv: () => download(`vecta-taps-${new Date().toISOString().slice(0, 10)}.csv`, tapsCsv(store.taps()), 'text/csv'),
      clear: () => {
        if (!window.confirm('Clear the whole tap log? Card balances stay as they are.')) return;
        store.clearTaps();
        toast('Tap log cleared');
        render();
      },
      speed: () => {
        startNfc();
        speed = { t0: performance.now(), stamps: [], left: 20 };
        speed.off = setConsumer((read) => { if (speed && !read.error) { speed.stamps.push(read.t0); render(); } });
        speed.timer = setInterval(() => {
          speed.left = 20 - (performance.now() - speed.t0) / 1000;
          if (speed.left <= 0) stopSpeed(); else render();
        }, 1000);
        render();
      },
      'speed-stop': stopSpeed,
    });
    cleanup.push(() => { if (speed) { clearInterval(speed.timer); speed.off(); } });
    render();
  }

  // ---------- Settings ----------

  function settingsPage() {
    let testOut = '';
    const toggle = (key, label, on) => `<label class="toggle"><span>${label}</span><input type="checkbox" data-set="${key}" data-type="bool"${on ? ' checked' : ''}></label>`;
    const render = () => {
      const s = store.settings();
      const base = appBase();
      const tpl = `${base}?${s.piccParam}=${'0'.repeat(32)}&${s.cmacParam}=${'0'.repeat(16)}`;
      const off = sdmOffsets(base, s);
      const zeroKeys = s.metaKeyHex === ZERO_KEY_HEX || s.fileKeyHex === ZERO_KEY_HEX;
      paint('Admin', '#/', `<h2>Fare</h2>
<div class="field"><label for="s-fare">Fare per tap (₦)</label><input id="s-fare" class="input" inputmode="numeric" data-set="fare" data-type="int" value="${s.fare}"></div>
<div class="field"><label for="s-label">Name of this terminal</label><input id="s-label" class="input" data-set="deviceLabel" data-type="text" value="${esc(s.deviceLabel)}" placeholder="${device.name}"><p class="hint">Shows in exported results, so you can compare phones.</p></div>
<h2>After each tap</h2>
<div class="field"><label for="s-auto">Return to Tap Card after this many seconds (0 waits for Done)</label><input id="s-auto" class="input" inputmode="decimal" data-set="autoReturnMs" data-type="seconds" value="${s.autoReturnMs / 1000}"></div>
<div class="field"><label for="s-guard">Ignore the same card again within (seconds)</label><input id="s-guard" class="input" inputmode="numeric" data-set="repeatGuardSec" data-type="int" value="${s.repeatGuardSec}"><p class="hint">Stops a double tap from charging twice. 0 charges every tap.</p></div>
${toggle('sound', 'Sound', s.sound)}${toggle('vibrate', 'Vibration (Android)', s.vibrate)}${toggle('showTiming', 'Show timing on result screens', s.showTiming !== false)}
<h2>Secure cards (SUN)</h2>
<p class="muted">The keys this terminal uses to check NTAG 424 DNA taps. New cards come with all-zero keys: fine for a test, but anyone can fake a tap until you change the keys on the cards and here.</p>
${zeroKeys ? '<p class="msg warn">Using the factory all-zero keys.</p>' : ''}
<div class="field"><label for="s-meta">SDM meta read key (unlocks chip ID and counter)</label><input id="s-meta" class="input mono" data-set="metaKeyHex" data-type="key" value="${esc(s.metaKeyHex)}" autocomplete="off" spellcheck="false"></div>
<div class="field"><label for="s-file">SDM file read key (checks the signature)</label><input id="s-file" class="input mono" data-set="fileKeyHex" data-type="key" value="${esc(s.fileKeyHex)}" autocomplete="off" spellcheck="false"></div>
<div class="field"><span class="field-lbl">Link parameter names: card data, then signature</span><div class="inline"><input class="input mono" data-set="piccParam" data-type="param" value="${esc(s.piccParam)}" aria-label="Card data parameter"><input class="input mono" data-set="cmacParam" data-type="param" value="${esc(s.cmacParam)}" aria-label="Signature parameter"></div></div>
<p class="field-lbl">Link to put on the cards</p><code class="code">${esc(tpl)}</code>
<div class="row-actions"><button class="quiet small" data-act="copy" data-v="${esc(tpl)}">Copy link</button></div>
<dl class="kv"><div><dt>PICC data offset</dt><dd>${off.picc} (0x${hex(off.picc)})</dd></div><div><dt>SDM MAC offset</dt><dd>${off.mac} (0x${hex(off.mac)})</dd></div><div><dt>SDM MAC input offset</dt><dd>${off.mac} (0x${hex(off.mac)})</dd></div></dl>
<p class="hint">${location.protocol === 'https:' ? 'Offsets count from the start of the NDEF file. Only tools that ask for offsets need them.' : 'Host the app on https:// first; the link and offsets above follow its address.'} Signature layout seen so far: ${s.macVariant ? esc(VARIANT_LABEL[s.macVariant]) : 'no secure tap yet'}.</p>
<div class="row-actions"><button class="quiet small" data-act="selftest">Run crypto self-test</button></div>${testOut}
<h2>Try without cards</h2>
${toggle('showSimulator', 'Show tap simulator on the terminal', s.showSimulator)}
<h2>Data on this phone</h2>
<p class="muted">${store.cardList().length} cards and ${store.taps().length} taps are saved in this browser. Safari can clear a site’s data after about a week without visits, so export a backup.</p>
<div class="row-actions"><button class="quiet small" data-act="export">Export backup</button><button class="quiet small" data-act="import">Import backup</button><input type="file" accept="application/json,.json" data-file hidden><button class="quiet small danger" data-act="erase">Erase everything</button></div>
<h2>This device</h2>
<dl class="kv"><div><dt>Platform</dt><dd>${device.name}, ${device.standalone ? 'installed app' : 'browser tab'}</dd></div><div><dt>Web NFC</dt><dd>${device.webNfc ? 'Available' : 'Not available'}</dd></div>
<div><dt>Secure page (HTTPS)</dt><dd>${device.secure ? 'Yes' : 'No'}</dd></div><div><dt>App version</dt><dd>${APP_VERSION}</dd></div></dl>`);
    };
    const bad = (message) => { toast(message, 'warn'); render(); };
    root.onchange = async (e) => {
      const el = e.target;
      if (el.matches('[data-file]')) {
        const file = el.files && el.files[0];
        if (!file) return;
        try {
          store.importAll(JSON.parse(await file.text()));
          toast('Backup restored');
        } catch (err) {
          toast(err.message.includes('Vecta') ? err.message : 'That file isn’t a Vecta tap test backup.', 'bad');
        }
        render();
        return;
      }
      const key = el.dataset.set;
      if (!key) return;
      let v = el.value.trim();
      const type = el.dataset.type;
      if (type === 'bool') v = el.checked;
      else if (type === 'int') {
        v = Math.round(Number(v.replace(/[^\d.]/g, '')));
        if (!el.value.trim() || !Number.isFinite(v)) return bad('Enter a whole number.');
      } else if (type === 'seconds') {
        v = Math.round(Number(v) * 1000);
        if (!Number.isFinite(v) || v < 0) return bad('Enter a number of seconds.');
      } else if (type === 'key') {
        v = v.replace(/[\s:]/g, '').toUpperCase();
        if (!isKeyHex(v)) return bad('A key is 32 hex characters (16 bytes).');
      } else if (type === 'param') {
        if (!/^[A-Za-z0-9_.~-]{1,24}$/.test(v)) return bad('Use letters, numbers and _ only.');
      }
      const patch = { [key]: v };
      if (type === 'key' || type === 'param') patch.macVariant = '';
      store.saveSettings(patch);
      toast('Saved');
      if (type === 'key' || type === 'param' || key === 'showSimulator') render();
    };
    actions({
      selftest: async () => {
        testOut = '<p class="muted">Running…</p>';
        render();
        const r = await selfTest();
        const s = store.settings();
        const link = await makeSunLink(appBase(), { uidHex: '04AABBCCDDEEFF', counter: 5, metaKeyHex: s.metaKeyHex, fileKeyHex: s.fileKeyHex, piccParam: s.piccParam, cmacParam: s.cmacParam });
        const t0 = performance.now();
        for (let i = 0; i < 50; i++) await verifySun(link, keysOf(s));
        const each = (performance.now() - t0) / 50;
        testOut = `<dl class="kv">${r.results.map((x) => `<div><dt>${esc(x.name)}</dt><dd class="${x.ok ? 'ok-text' : 'bad-text'}">${x.ok ? 'Pass' : 'Fail'}</dd></div>`).join('')}
<div><dt>Checking one secure tap on this phone</dt><dd>${ms(each)}</dd></div></dl>`;
        render();
      },
      export: () => download(`vecta-tap-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.exportAll(), null, 2), 'application/json'),
      import: () => root.querySelector('[data-file]').click(),
      erase: () => {
        if (!window.confirm('Erase all cards, balances, taps and settings on this phone?')) return;
        store.eraseAll();
        toast('Everything erased');
        render();
      },
    });
    render();
  }
}
