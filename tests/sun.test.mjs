// Run with:  node tests/sun.test.mjs
// Checks the in-browser NTAG 424 DNA verifier against published reference values.
import { selfTest, verifySun, makeSunLink, bytesToHex } from '../js/sun.js';

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
}

const st = await selfTest();
for (const r of st.results) check(r.name, r.ok);

// sdm-backend demo links (factory all-zero keys)
const withFileData = await verifySun(
  'https://sdm.nfcdeveloper.com/tag?picc_data=FD91EC264309878BE6345CBE53BADF40&enc=CEE9A53E3E463EF1F459635736738962&cmac=ECC1E7F6C6C73BF6',
  { decryptFileData: true },
);
check('sdm-backend link with encrypted file data', withFileData.ok,
  withFileData.ok ? `uid=${withFileData.uid} ctr=${withFileData.counter} variant=${withFileData.variant} file="${new TextDecoder().decode(withFileData.fileData || new Uint8Array())}"` : withFileData.reason);

const plain = await verifySun('https://sdm.nfcdeveloper.com/tagpt?uid=041E3C8A2D6B80&ctr=000006&cmac=4B00064004B0B3D3');
check('sdm-backend plain UID + counter link', plain.ok, plain.ok ? `uid=${plain.uid} ctr=${plain.counter}` : plain.reason);

const sdmDemo = await verifySun('https://sdm.nfcdeveloper.com/tag?picc_data=EF963FF7828658A599F3041510671E88&cmac=94EED9EE65337086');
check('sdm-backend demo link without file data', sdmDemo.ok, sdmDemo.ok ? `uid=${sdmDemo.uid} ctr=${sdmDemo.counter}` : sdmDemo.reason);

// Custom keys round trip, with a wrong key rejected
const meta = '11111111111111111111111111111111';
const file = '22222222222222222222222222222222';
const link = await makeSunLink('https://vecta.example/', { uidHex: '04112233445566', counter: 0x0102, metaKeyHex: meta, fileKeyHex: file });
const good = await verifySun(link, { metaKeyHex: meta, fileKeyHex: file });
check('custom keys verify', good.ok && good.counter === 258 && good.uid === '04112233445566');
const wrongFile = await verifySun(link, { metaKeyHex: meta, fileKeyHex: '22222222222222222222222222222223' });
check('wrong file read key rejected', wrongFile.found && !wrongFile.ok);
const wrongMeta = await verifySun(link, { metaKeyHex: '11111111111111111111111111111112', fileKeyHex: file });
check('wrong meta read key rejected', wrongMeta.found && !wrongMeta.ok);

// Timing on this machine
const t0 = performance.now();
for (let i = 0; i < 200; i++) await verifySun(link, { metaKeyHex: meta, fileKeyHex: file });
console.log(`info  average verify time: ${((performance.now() - t0) / 200).toFixed(2)} ms`);

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
