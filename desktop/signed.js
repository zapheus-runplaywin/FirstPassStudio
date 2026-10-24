// FirstPass Studio Mac app - is a library on this Mac signed by who it should be?
//
// desktop/ndi.js looks for the NDI® runtime inside the NDI apps on the Mac when the runtime
// installer hasn't put it in /usr/local/lib. Loading a library means running its code inside
// Studio, so a file that merely has the right name (any app could carry a libndi.dylib) isn't
// enough: the copy must carry a valid Developer ID signature from NDI's makers (Vizrt, earlier
// NewTek). macOS's codesign tool checks the signature; this reads what it says.
// Plain Node, no Electron, so the tests can run it.

'use strict';

const { execFileSync } = require('child_process');

const CODESIGN = '/usr/bin/codesign';
// Who may sign the NDI runtime: the names on Vizrt's and NewTek's Developer ID certificates.
const PUBLISHERS = /\b(Vizrt|NewTek)\b/i;

// Reads codesign's --verbose=2 details: { authorities: [...], teamId, identifier }.
function parseDetails(text) {
  const out = { authorities: [], teamId: '', identifier: '' };
  for (const line of String(text || '').split('\n')) {
    const m = /^(Authority|TeamIdentifier|Identifier)=(.*)$/.exec(line.trim());
    if (!m) continue;
    if (m[1] === 'Authority') out.authorities.push(m[2].trim());
    else if (m[1] === 'TeamIdentifier') out.teamId = m[2].trim();
    else out.identifier = m[2].trim();
  }
  return out;
}

// Whether details describe a Developer ID signature from one of PUBLISHERS: the leaf authority
// names the publisher, and the chain goes through Apple's Developer ID authority.
function fromPublisher(details) {
  const leaf = details.authorities[0] || '';
  return PUBLISHERS.test(leaf) && details.authorities.some(a => /^Developer ID Certification Authority$/i.test(a))
    && details.authorities.some(a => /^Apple Root CA$/i.test(a));
}

// Whether the library at file may be loaded: its signature verifies and it's from a publisher
// above. On anything but a Mac, or without codesign, nothing is trusted. Gives { ok, why }.
// exec is for the tests (replaces execFileSync).
function trusted(file, exec = execFileSync) {
  if (process.platform !== 'darwin') return { ok: false, why: 'only checked on a Mac' };
  try { exec(CODESIGN, ['--verify', '--strict', file], { stdio: 'ignore', timeout: 10000 }); }
  catch (err) { return { ok: false, why: `its signature doesn't verify${err && err.status ? ` (codesign exit ${err.status})` : ''}` }; }
  let text = '';
  try { text = String(exec(CODESIGN, ['-dv', '--verbose=2', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 })); }
  catch (err) { text = String((err && (err.stderr || err.stdout)) || ''); } // codesign writes the details to stderr, exit 0
  const details = parseDetails(text);
  if (!fromPublisher(details)) return { ok: false, why: `it isn't signed by Vizrt or NewTek (signed by ${details.authorities[0] || 'nobody'}${details.teamId ? `, team ${details.teamId}` : ''})` };
  return { ok: true, why: `signed by ${details.authorities[0]}${details.teamId ? ` (${details.teamId})` : ''}` };
}

module.exports = { trusted, parseDetails, fromPublisher, PUBLISHERS };
