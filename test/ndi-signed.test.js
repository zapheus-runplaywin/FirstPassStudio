// Only a signed NDI runtime is loaded (desktop/signed.js): codesign's details are read, and a copy is trusted
// only when its signature verifies and its Developer ID is Vizrt's or NewTek's.
const test = require('node:test');
const assert = require('node:assert/strict');
const signed = require('../desktop/signed');

const VIZRT = `Executable=/Applications/NDI Tools/NDI Video Monitor.app/Contents/Frameworks/libndi.dylib
Identifier=libndi
Format=Mach-O thin (arm64)
CodeDirectory v=20500 size=... flags=0x10000(runtime) hashes=... location=embedded
Signature size=9000
Authority=Developer ID Application: Vizrt NDI AB (ABCDE12345)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
Timestamp=1 Jan 2026 at 10:00:00
TeamIdentifier=ABCDE12345
`;
const OTHER = VIZRT.replace('Developer ID Application: Vizrt NDI AB (ABCDE12345)', 'Developer ID Application: Some Other Company (ZZZZZ99999)').replace('TeamIdentifier=ABCDE12345', 'TeamIdentifier=ZZZZZ99999');
const ADHOC = `Executable=/Applications/Fake.app/Contents/Frameworks/libndi.dylib
Identifier=libndi
Signature=adhoc
TeamIdentifier=not set
`;

test('parseDetails reads the authorities, team and identifier', () => {
  const d = signed.parseDetails(VIZRT);
  assert.deepEqual(d.authorities, ['Developer ID Application: Vizrt NDI AB (ABCDE12345)', 'Developer ID Certification Authority', 'Apple Root CA']);
  assert.equal(d.teamId, 'ABCDE12345');
  assert.equal(d.identifier, 'libndi');
});

test('fromPublisher: a Developer ID chain whose leaf is Vizrt or NewTek', () => {
  assert.equal(signed.fromPublisher(signed.parseDetails(VIZRT)), true);
  assert.equal(signed.fromPublisher(signed.parseDetails(VIZRT.replace('Vizrt NDI AB', 'NewTek, Inc.'))), true);
  assert.equal(signed.fromPublisher(signed.parseDetails(OTHER)), false);
  assert.equal(signed.fromPublisher(signed.parseDetails(ADHOC)), false);
  // The name alone isn't enough: a self-signed certificate can say anything.
  assert.equal(signed.fromPublisher(signed.parseDetails('Authority=Developer ID Application: Vizrt NDI AB (X)\n')), false);
});

test('trusted: verify must pass and the publisher must match (codesign stood in)', { skip: process.platform !== 'darwin' && 'codesign checks only run on a Mac' }, () => {
  const fake = (verifyFails, details) => (cmd, args) => {
    assert.equal(cmd, '/usr/bin/codesign');
    if (args[0] === '--verify') { if (verifyFails) { const e = new Error('bad'); e.status = 1; throw e; } return ''; }
    const e = new Error('details'); e.stderr = details; throw e; // codesign prints details on stderr
  };
  assert.equal(signed.trusted('/x/libndi.dylib', fake(false, VIZRT)).ok, true);
  assert.match(signed.trusted('/x/libndi.dylib', fake(false, VIZRT)).why, /Vizrt/);
  const other = signed.trusted('/x/libndi.dylib', fake(false, OTHER));
  assert.equal(other.ok, false);
  assert.match(other.why, /Some Other Company/);
  const broken = signed.trusted('/x/libndi.dylib', fake(true, VIZRT));
  assert.equal(broken.ok, false);
  assert.match(broken.why, /doesn't verify/);
});

test('trusted: nothing is trusted off a Mac', { skip: process.platform === 'darwin' && 'this Mac runs codesign' }, () => {
  assert.equal(signed.trusted('/x/libndi.dylib', () => '').ok, false);
});
