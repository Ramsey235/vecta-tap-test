// pay.js
// Turns a card read into a payment decision against the test ledger on this phone,
// and keeps the timing log that answers "how fast is a tap?".

import { verifySun, findSunParams } from './sun.js';
import { store, normUid } from './store.js';
import { device, money } from './ui.js';

export function keysOf(s) {
  return {
    metaKeyHex: s.metaKeyHex,
    fileKeyHex: s.fileKeyHex,
    piccParam: s.piccParam,
    cmacParam: s.cmacParam,
    preferVariant: s.macVariant || undefined,
  };
}

export function tokenFrom(link) {
  const m = /[?&#]t=([0-9A-Za-z]{6,40})(?=[&#]|$)/.exec(link || '');
  return m ? m[1].toUpperCase() : null;
}

// Does this link carry a card tap? 'sun', 'token' or null.
export function tapParams(link) {
  if (!link) return null;
  if (findSunParams(link, store.settings())) return 'sun';
  return tokenFrom(link) ? 'token' : null;
}

const problem = (severity, code, text, detail = '') => ({ severity, code, text, detail });

// Works out which test card is tapping. Changes nothing.
export async function identify(read) {
  const s = store.settings();
  const out = { card: null, uid: read.serial || null, counter: null, method: null, sun: null, problem: null };
  if (read.error) {
    out.problem = problem('error', 'unreadable', 'Unable to read the card. Please try again', 'The phone saw a card but could not read it.');
    return out;
  }
  const link = read.url || '';
  if (link && findSunParams(link, s)) {
    out.method = 'sun';
    const sun = await verifySun(link, keysOf(s));
    out.sun = sun;
    if (!sun.ok) {
      out.problem = problem('declined', 'bad-signature', 'Card could not be verified', sun.reason);
      return out;
    }
    if (sun.variant !== s.macVariant) store.saveSettings({ macVariant: sun.variant });
    out.uid = sun.uid;
    out.counter = sun.counter;
    out.card = store.findByUid(sun.uid);
    if (!out.card) out.problem = problem('declined', 'unknown', 'Card not registered', `Card ${sun.uid} is genuine but has no test account on this phone.`);
    return out;
  }
  const token = tokenFrom(link) || (read.text ? tokenFrom(`?t=${read.text.trim()}`) : null);
  if (token) {
    out.method = 'token';
    out.card = store.findByToken(token);
    if (!out.card) {
      out.problem = problem('declined', 'unknown', 'Card not registered', `Token ${token} is not on this phone.`);
    } else if (read.serial && out.card.uid && normUid(out.card.uid) !== read.serial) {
      out.problem = problem('declined', 'copied', 'Card copy detected', `This token belongs to chip ${out.card.uid} but was read from chip ${read.serial}.`);
    }
    return out;
  }
  if (read.serial) {
    out.method = 'uid';
    out.card = store.findByUid(read.serial);
    if (!out.card) out.problem = problem('declined', 'unknown', 'Card not registered', `Chip ${read.serial} has no test account on this phone.`);
    else if (out.card.mode === 'sun') out.problem = problem('error', 'no-sun', 'Card is missing its secure link', 'This card is registered as secure but sent no signed link.');
    else if (out.card.mode === 'token') out.problem = problem('error', 'no-token', 'Card is missing its token', 'Write the link onto the card again from Admin, Cards.');
    return out;
  }
  out.problem = problem('error', 'empty', 'No card data found. Please try again');
  return out;
}

// Charges the fare to the tapping card. The only place balances go down.
export async function charge(read) {
  const s = store.settings();
  const fare = Math.max(0, Math.round(Number(s.fare) || 0));
  const id = await identify(read);
  const now = Date.now();
  const card = id.card ? { ...id.card } : null;
  const res = {
    at: now, fare, channel: read.channel, method: id.method, uid: id.uid, counter: id.counter,
    cardId: card ? card.id : null, holder: card ? card.name : null,
    outcome: '', code: '', text: '', detail: '', balance: card ? card.balance : null,
  };
  const finish = (outcome, code, text, detail = '') => {
    Object.assign(res, { outcome, code, text, detail });
    if (card) {
      card.lastTapAt = now;
      card.tapCount = (card.tapCount || 0) + 1;
      store.putCard(card);
      res.balance = card.balance;
    }
    return res;
  };

  // A verified secure tap moves the card's counter forward even if the fare is then
  // declined, so the same link can never be used twice.
  if (card && id.method === 'sun' && !id.problem) {
    if (card.lastCounter != null && id.counter <= card.lastCounter) {
      return finish('declined', 'replay', 'This tap was already used', `Tap counter ${id.counter} is not newer than ${card.lastCounter}. The link was copied or replayed.`);
    }
    card.lastCounter = id.counter;
  }
  if (id.problem) return finish(id.problem.severity, id.problem.code, id.problem.text, id.problem.detail);
  if (card.blocked) return finish('declined', 'blocked', 'Card blocked');
  const guardMs = Math.max(0, Number(s.repeatGuardSec) || 0) * 1000;
  if (guardMs && card.lastPaidAt && now - card.lastPaidAt < guardMs) {
    return finish('already', 'repeat', 'Already paid', `Paid ${Math.max(1, Math.round((now - card.lastPaidAt) / 1000))} s ago. Not charged twice.`);
  }
  if (card.balance < fare) return finish('declined', 'balance', 'Insufficient Balance', `Balance is ${money(card.balance)}.`);
  card.balance -= fare;
  card.lastPaidAt = now;
  card.paidCount = (card.paidCount || 0) + 1;
  return finish('approved', 'ok', 'Payment Successful');
}

export function logTap(res, timing = {}) {
  const s = store.settings();
  const taps = store.taps();
  const prev = taps[taps.length - 1];
  const entry = {
    id: `t${res.at.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    ...res,
    platform: device.name,
    device: s.deviceLabel || device.name,
    gapMs: prev ? res.at - prev.at : null,
  };
  for (const key of ['readMs', 'paintMs', 'openMs']) {
    if (Number.isFinite(timing[key])) entry[key] = Math.round(timing[key] * 10) / 10;
  }
  store.addTap(entry);
  return entry;
}

function summarize(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = (p) => {
    const i = (v.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return v[lo] + (v[hi] - v[lo]) * (i - lo);
  };
  return { n: v.length, min: v[0], median: q(0.5), p90: q(0.9), max: v[v.length - 1] };
}

export function tapStats(taps, includeSim = false) {
  const list = taps.filter((t) => includeSim || t.channel !== 'sim');
  return {
    count: list.length,
    approved: list.filter((t) => t.outcome === 'approved' || t.outcome === 'already').length,
    direct: summarize(list.filter((t) => t.channel === 'webnfc' || t.channel === 'sim').map((t) => t.paintMs)),
    link: summarize(list.filter((t) => t.channel === 'link').map((t) => t.openMs)),
    gap: summarize(list.map((t) => t.gapMs).filter((g) => g > 0 && g < 60000)),
  };
}

const CSV_COLUMNS = [
  ['time', (t) => new Date(t.at).toISOString()], ['terminal', (t) => t.device], ['platform', (t) => t.platform],
  ['how_read', (t) => t.channel], ['card_check', (t) => t.method], ['holder', (t) => t.holder], ['chip_id', (t) => t.uid],
  ['tap_counter', (t) => t.counter], ['outcome', (t) => t.outcome], ['reason', (t) => t.text], ['fare_ngn', (t) => t.fare],
  ['balance_after_ngn', (t) => t.balance], ['read_to_result_ms', (t) => t.paintMs], ['link_open_to_result_ms', (t) => t.openMs],
  ['processing_ms', (t) => t.readMs], ['gap_since_previous_tap_ms', (t) => t.gapMs],
];
function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`; // keep spreadsheets from running formulas
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function tapsCsv(taps) {
  return [CSV_COLUMNS.map(([name]) => name).join(','), ...taps.map((t) => CSV_COLUMNS.map(([, get]) => csvCell(get(t))).join(','))].join('\r\n');
}
