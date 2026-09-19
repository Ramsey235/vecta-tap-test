// store.js
// Everything lives on this phone (localStorage), so the terminal works offline.
// Cards are the test ledger: the NTAG 424 DNA proves who is tapping, the
// balance lives here. Taps are the measurement log.

import { ZERO_KEY_HEX } from './sun.js';

const KEYS = {
  settings: 'vecta.settings.v1',
  cards: 'vecta.cards.v1',
  taps: 'vecta.taps.v1',
};
const MAX_TAPS = 3000;

export const DEFAULT_SETTINGS = {
  fare: 200,
  deviceLabel: '',
  autoReturnMs: 0, // 0 = wait for "Done"
  sound: true,
  vibrate: true,
  repeatGuardSec: 5,
  metaKeyHex: ZERO_KEY_HEX,
  fileKeyHex: ZERO_KEY_HEX,
  piccParam: 'picc_data',
  cmacParam: 'cmac',
  showSimulator: false,
  linkArmedUntil: 0,
  showTiming: true,
  macVariant: '',
  enrollPending: null,
  lastSpeedTest: null,
};

const cache = { cards: null, taps: null };
const listeners = new Set();

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('Could not save', key, err);
    return false;
  }
}

function emit(what) {
  for (const fn of listeners) {
    try { fn(what); } catch (err) { console.error(err); }
  }
}

export function onStoreChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Another tab (for example an iPhone tap-link tab) changed the data.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith('vecta.')) return;
    if (e.key === KEYS.cards) cache.cards = null;
    if (e.key === KEYS.taps) cache.taps = null;
    emit(e.key.split('.')[1]);
  });
}

export function normUid(value) {
  return String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
}

export const store = {
  settings() {
    return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
  },

  saveSettings(patch) {
    const next = { ...this.settings(), ...patch };
    write(KEYS.settings, next);
    emit('settings');
    return next;
  },

  cards() {
    if (!cache.cards) cache.cards = read(KEYS.cards, {});
    return cache.cards;
  },

  cardList() {
    return Object.values(this.cards()).sort((a, b) => a.createdAt - b.createdAt);
  },

  getCard(id) {
    return this.cards()[id] || null;
  },

  findByUid(uid) {
    const want = normUid(uid);
    if (!want) return null;
    return Object.values(this.cards()).find((c) => normUid(c.uid) === want) || null;
  },

  findByToken(token) {
    if (!token) return null;
    const want = String(token).toUpperCase();
    return Object.values(this.cards()).find((c) => c.token === want) || null;
  },

  putCard(card) {
    const all = { ...this.cards(), [card.id]: card };
    cache.cards = all;
    write(KEYS.cards, all);
    emit('cards');
    return card;
  },

  removeCard(id) {
    const all = { ...this.cards() };
    delete all[id];
    cache.cards = all;
    write(KEYS.cards, all);
    emit('cards');
  },

  taps() {
    if (!cache.taps) cache.taps = read(KEYS.taps, []);
    return cache.taps;
  },

  addTap(entry) {
    const list = this.taps();
    list.push(entry);
    if (list.length > MAX_TAPS) list.splice(0, list.length - MAX_TAPS);
    write(KEYS.taps, list);
    emit('taps');
  },

  clearTaps() {
    cache.taps = [];
    write(KEYS.taps, []);
    emit('taps');
  },

  exportAll() {
    return {
      app: 'vecta-tap-test',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: this.settings(),
      cards: this.cards(),
      taps: this.taps(),
    };
  },

  importAll(data) {
    if (!data || data.app !== 'vecta-tap-test') throw new Error('This file is not a Vecta tap test backup.');
    write(KEYS.settings, { ...DEFAULT_SETTINGS, ...(data.settings || {}) });
    write(KEYS.cards, data.cards || {});
    write(KEYS.taps, Array.isArray(data.taps) ? data.taps : []);
    cache.cards = null;
    cache.taps = null;
    emit('all');
  },

  eraseAll() {
    for (const key of Object.values(KEYS)) localStorage.removeItem(key);
    cache.cards = null;
    cache.taps = null;
    emit('all');
  },
};
