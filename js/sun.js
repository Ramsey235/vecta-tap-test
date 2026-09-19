// sun.js
// Verifies NTAG 424 DNA "Secure Unique NFC" (SUN / Secure Dynamic Messaging) taps.
// Follows NXP AN12196 in AES mode: decrypt PICCData (UID + tap counter), then
// check the truncated AES-CMAC the card appends to its link on every tap.
//
// WebCrypto has no raw AES block mode or CMAC, so both are built here on top of
// AES-CBC. Works in any secure browser context and in Node 20+ (for tests).

const subtle = globalThis.crypto.subtle;
const ZERO_IV = new Uint8Array(16);
const PAD_BLOCK = new Uint8Array(16).fill(16);
const SV1_PREFIX = [0xC3, 0x3C, 0x00, 0x01, 0x00, 0x80]; // session ENC key label
const SV2_PREFIX = [0x3C, 0xC3, 0x00, 0x01, 0x00, 0x80]; // session MAC key label
const HEX_RE = /^[0-9A-Fa-f]+$/;

export const ZERO_KEY_HEX = '00000000000000000000000000000000';

// ---------- byte helpers ----------

export function hexToBytes(hex) {
  const clean = String(hex).replace(/[\s:]/g, '');
  if (!HEX_RE.test(clean) || clean.length % 2) throw new Error('Not a valid hex string');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function isKeyHex(value) {
  return typeof value === 'string' && /^[0-9A-Fa-f]{32}$/.test(value.trim());
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function xor16(a, b) {
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = a[i] ^ b[i];
  return out;
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------- AES building blocks ----------

const staticKeys = new Map();

async function importAes(raw, cache = false) {
  if (cache) {
    const id = bytesToHex(raw);
    if (staticKeys.has(id)) return staticKeys.get(id);
    const key = await subtle.importKey('raw', raw, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
    staticKeys.set(id, key);
    return key;
  }
  return subtle.importKey('raw', raw, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
}

// One raw AES block encryption = first block of CBC with a zero IV.
async function aesEncryptBlock(key, block) {
  const out = await subtle.encrypt({ name: 'AES-CBC', iv: ZERO_IV }, key, block);
  return new Uint8Array(out).slice(0, 16);
}

// One raw AES block decryption. WebCrypto insists on PKCS#7 padding, so append a
// second block that decrypts to a full padding block; the browser strips it and
// returns exactly D(block).
async function aesDecryptBlock(key, block) {
  const tail = await aesEncryptBlock(key, xor16(PAD_BLOCK, block));
  const out = await subtle.decrypt({ name: 'AES-CBC', iv: ZERO_IV }, key, concat(block, tail));
  return new Uint8Array(out);
}

function doubleBlock(b) {
  const out = new Uint8Array(16);
  let carry = 0;
  for (let i = 15; i >= 0; i--) {
    out[i] = ((b[i] << 1) | carry) & 0xff;
    carry = b[i] >>> 7;
  }
  if (b[0] & 0x80) out[15] ^= 0x87;
  return out;
}

// AES-CMAC per RFC 4493.
export async function aesCmac(key, message) {
  const L = await aesEncryptBlock(key, new Uint8Array(16));
  const k1 = doubleBlock(L);
  const k2 = doubleBlock(k1);
  const blocks = Math.max(1, Math.ceil(message.length / 16));
  const complete = message.length > 0 && message.length % 16 === 0;
  const buf = new Uint8Array(blocks * 16);
  buf.set(message);
  if (!complete) buf[message.length] = 0x80;
  const sub = complete ? k1 : k2;
  const last = (blocks - 1) * 16;
  for (let i = 0; i < 16; i++) buf[last + i] ^= sub[i];
  const enc = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv: ZERO_IV }, key, buf));
  return enc.slice(last, last + 16);
}

export async function aesCmacHex(keyHex, messageBytes) {
  return bytesToHex(await aesCmac(await importAes(hexToBytes(keyHex)), messageBytes));
}

// ---------- NTAG 424 DNA secure dynamic messaging ----------

export async function decryptPiccData(metaKeyBytes, piccBytes) {
  const key = await importAes(metaKeyBytes, true);
  const plain = await aesDecryptBlock(key, piccBytes);
  const tag = plain[0];
  const hasUid = (tag & 0x80) !== 0;
  const hasCounter = (tag & 0x40) !== 0;
  const uidLength = tag & 0x0f;
  if ((tag & 0x30) !== 0 || !hasUid || !hasCounter || uidLength !== 7) {
    return {
      ok: false,
      tag,
      reason: 'The card data did not decrypt to a card ID and tap counter, so the SDM meta read key in Settings is probably not the one on the card.',
    };
  }
  const uid = plain.slice(1, 8);
  const ctrBytes = plain.slice(8, 11); // least significant byte first
  const counter = ctrBytes[0] | (ctrBytes[1] << 8) | (ctrBytes[2] << 16);
  return { ok: true, tag, uid, ctrBytes, counter };
}

export async function sdmMac(fileKeyBytes, uid, ctrBytes, inputBytes) {
  const key = await importAes(fileKeyBytes, true);
  const sessionRaw = await aesCmac(key, new Uint8Array([...SV2_PREFIX, ...uid, ...ctrBytes]));
  const sessionKey = await importAes(sessionRaw);
  const full = await aesCmac(sessionKey, inputBytes);
  const truncated = new Uint8Array(8);
  for (let i = 0; i < 8; i++) truncated[i] = full[i * 2 + 1];
  return truncated;
}

export async function decryptFileData(fileKeyBytes, uid, ctrBytes, encBytes) {
  const key = await importAes(fileKeyBytes, true);
  const sessionRaw = await aesCmac(key, new Uint8Array([...SV1_PREFIX, ...uid, ...ctrBytes]));
  const sessionKey = await importAes(sessionRaw);
  const ivInput = new Uint8Array(16);
  ivInput.set(ctrBytes, 0);
  let prev = await aesEncryptBlock(sessionKey, ivInput);
  const out = new Uint8Array(encBytes.length);
  for (let off = 0; off < encBytes.length; off += 16) {
    const block = encBytes.slice(off, off + 16);
    out.set(xor16(await aesDecryptBlock(sessionKey, block), prev), off);
    prev = block;
  }
  return out;
}

// Pull key=value pairs out of the query string and fragment, remembering where
// each value sits in the original text (the MAC covers raw link characters).
function linkParams(link) {
  const pairs = [];
  const re = /[?&#]([A-Za-z0-9_.~-]+)=([^&#]*)/g;
  let m;
  while ((m = re.exec(link))) {
    pairs.push({ name: m[1].toLowerCase(), value: m[2], start: m.index + m[0].length - m[2].length });
  }
  return pairs;
}

const PICC_NAMES = ['picc_data', 'picc', 'p', 'e', 'enc_picc'];
const CMAC_NAMES = ['cmac', 'c', 'm', 'mac', 'sdmmac'];

export function findSunParams(link, prefs = {}) {
  if (typeof link !== 'string' || !link) return null;
  const pairs = linkParams(link);
  const isHexOf = (v, len) => v.length === len && HEX_RE.test(v);
  const named = (name) => name && pairs.find((p) => p.name === String(name).toLowerCase());

  let picc = named(prefs.piccParam);
  if (!picc || !isHexOf(picc.value, 32)) picc = pairs.find((p) => PICC_NAMES.includes(p.name) && isHexOf(p.value, 32));
  if (!picc) picc = pairs.find((p) => isHexOf(p.value, 32));

  let cmac = named(prefs.cmacParam);
  if (!cmac || !isHexOf(cmac.value, 16)) cmac = pairs.find((p) => CMAC_NAMES.includes(p.name) && isHexOf(p.value, 16));
  if (!cmac) cmac = pairs.find((p) => isHexOf(p.value, 16));

  if (picc && cmac) {
    const enc = pairs.find((p) => p !== picc && p !== cmac && HEX_RE.test(p.value) && p.value.length >= 32 && p.value.length % 32 === 0);
    return {
      mode: 'encrypted',
      picc: picc.value, piccPos: picc.start,
      cmac: cmac.value, cmacPos: cmac.start,
      enc: enc ? enc.value : null, encPos: enc ? enc.start : null,
      names: { picc: picc.name, cmac: cmac.name, enc: enc ? enc.name : null },
    };
  }

  // "Bulk" layout: one parameter holding PICC data + optional file data + MAC.
  const bulk = pairs.find((p) => HEX_RE.test(p.value) && p.value.length >= 48 && (p.value.length - 48) % 32 === 0);
  if (bulk) {
    const v = bulk.value;
    const encLen = v.length - 48;
    return {
      mode: 'bulk',
      picc: v.slice(0, 32), piccPos: bulk.start,
      enc: encLen ? v.slice(32, 32 + encLen) : null, encPos: encLen ? bulk.start + 32 : null,
      cmac: v.slice(-16), cmacPos: bulk.start + v.length - 16,
      names: { bulk: bulk.name },
    };
  }

  // Plain mirroring: readable UID + counter + MAC.
  const uid = pairs.find((p) => isHexOf(p.value, 14));
  const ctr = pairs.find((p) => isHexOf(p.value, 6));
  if (uid && ctr && cmac) {
    return {
      mode: 'plain',
      uid: uid.value, uidPos: uid.start,
      ctr: ctr.value, ctrPos: ctr.start,
      cmac: cmac.value, cmacPos: cmac.start,
      names: { uid: uid.name, ctr: ctr.name, cmac: cmac.name },
    };
  }
  return null;
}

// The card MACs the link characters between SDMMACInputOffset and the MAC itself.
// Most setups use an empty range; some tools start it at the file data or PICC data.
function macInputCandidates(link, p) {
  const text = new TextEncoder();
  const list = [{ variant: 'empty', bytes: new Uint8Array(0) }];
  if (p.encPos != null && p.encPos < p.cmacPos) list.push({ variant: 'from-file-data', bytes: text.encode(link.slice(p.encPos, p.cmacPos)) });
  if (p.piccPos != null && p.piccPos < p.cmacPos) list.push({ variant: 'from-picc-data', bytes: text.encode(link.slice(p.piccPos, p.cmacPos)) });
  if (p.uidPos != null) {
    const from = Math.min(p.uidPos, p.ctrPos);
    if (from < p.cmacPos) list.push({ variant: 'from-uid', bytes: text.encode(link.slice(from, p.cmacPos)) });
  }
  return list;
}

export async function verifySun(link, opts = {}) {
  const p = findSunParams(link, opts);
  if (!p) return { ok: false, found: false, reason: 'No secure tap data in this link.' };

  let metaKey, fileKey;
  try {
    metaKey = hexToBytes(isKeyHex(opts.metaKeyHex) ? opts.metaKeyHex : ZERO_KEY_HEX);
    fileKey = hexToBytes(isKeyHex(opts.fileKeyHex) ? opts.fileKeyHex : ZERO_KEY_HEX);
  } catch {
    return { ok: false, found: true, params: p, reason: 'A key in Settings is not 32 hex characters.' };
  }

  let uid, ctrBytes, counter;
  if (p.mode === 'plain') {
    uid = hexToBytes(p.uid);
    const be = hexToBytes(p.ctr); // mirrored most significant byte first
    ctrBytes = new Uint8Array([be[2], be[1], be[0]]);
    counter = (be[0] << 16) | (be[1] << 8) | be[2];
  } else {
    const d = await decryptPiccData(metaKey, hexToBytes(p.picc));
    if (!d.ok) return { ok: false, found: true, params: p, reason: d.reason };
    ({ uid, ctrBytes, counter } = d);
  }

  const expected = hexToBytes(p.cmac);
  const candidates = macInputCandidates(link, p);
  if (opts.preferVariant) {
    candidates.sort((a, b) => Number(b.variant === opts.preferVariant) - Number(a.variant === opts.preferVariant));
  }
  for (const c of candidates) {
    const mac = await sdmMac(fileKey, uid, ctrBytes, c.bytes);
    if (sameBytes(mac, expected)) {
      let fileData = null;
      if (opts.decryptFileData && p.enc) {
        try { fileData = await decryptFileData(fileKey, uid, ctrBytes, hexToBytes(p.enc)); } catch { fileData = null; }
      }
      return { ok: true, found: true, mode: p.mode, variant: c.variant, uid: bytesToHex(uid), counter, fileData, params: p };
    }
  }
  return {
    ok: false, found: true, params: p, uid: bytesToHex(uid), counter,
    reason: 'The signature on this tap did not match. Check the SDM file read key in Settings, and that the card is in AES mode (not LRP).',
  };
}

// Builds a genuine-looking SUN link. Used by the simulator and the self-test.
export async function makeSunLink(base, { uidHex, counter, metaKeyHex, fileKeyHex, piccParam = 'picc_data', cmacParam = 'cmac' }) {
  const uid = hexToBytes(uidHex);
  if (uid.length !== 7) throw new Error('UID must be 7 bytes');
  const ctrBytes = new Uint8Array([counter & 0xff, (counter >> 8) & 0xff, (counter >> 16) & 0xff]);
  const plain = new Uint8Array(16);
  plain[0] = 0xC7;
  plain.set(uid, 1);
  plain.set(ctrBytes, 8);
  globalThis.crypto.getRandomValues(plain.subarray(11));
  const metaKey = await importAes(hexToBytes(isKeyHex(metaKeyHex) ? metaKeyHex : ZERO_KEY_HEX), true);
  const picc = await aesEncryptBlock(metaKey, plain);
  const mac = await sdmMac(hexToBytes(isKeyHex(fileKeyHex) ? fileKeyHex : ZERO_KEY_HEX), uid, ctrBytes, new Uint8Array(0));
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${piccParam}=${bytesToHex(picc)}&${cmacParam}=${bytesToHex(mac)}`;
}

// Known-answer tests: RFC 4493 for AES-CMAC and NXP's own AN12196 example tap.
export async function selfTest() {
  const results = [];
  const rfcKey = '2B7E151628AED2A6ABF7158809CF4F3C';
  results.push({
    name: 'AES-CMAC, empty message (RFC 4493)',
    ok: (await aesCmacHex(rfcKey, new Uint8Array(0))) === 'BB1D6929E95937287FA37D129B756746',
  });
  results.push({
    name: 'AES-CMAC, one block (RFC 4493)',
    ok: (await aesCmacHex(rfcKey, hexToBytes('6BC1BEE22E409F96E93D7E117393172A'))) === '070A16B46B4D4144F79BDD9DD04A287C',
  });
  const nxp = await verifySun('https://ntag.nxp.com/424?e=EF963FF7828658A599F3041510671E88&c=94EED9EE65337086');
  results.push({
    name: 'NXP AN12196 example tap decrypts and verifies',
    ok: nxp.ok && nxp.uid === '04DE5F1EACC040' && nxp.counter === 61,
  });
  const forged = await verifySun('https://ntag.nxp.com/424?e=EF963FF7828658A599F3041510671E88&c=94EED9EE65337087');
  results.push({ name: 'A tampered signature is rejected', ok: forged.found && !forged.ok });
  const link = await makeSunLink('https://example.com/', { uidHex: '04AABBCCDDEEFF', counter: 42 });
  const round = await verifySun(link);
  results.push({ name: 'Generated tap round-trips', ok: round.ok && round.uid === '04AABBCCDDEEFF' && round.counter === 42 });
  return { ok: results.every((r) => r.ok), results };
}
