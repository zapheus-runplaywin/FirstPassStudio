// FirstPass Studio - secrets kept in the Mac's Keychain.
//
// A secret Studio needs to keep (a club's FirstPass HQ sign-in, hqauth.ts) goes in the login Keychain as a generic
// password, under a service name of its own and an account per secret, through macOS's `security` command: the helper
// runs as a utility process, which can't use Electron's safeStorage, and the secure link (securelink.ts) already keeps
// its Route 53 key this way. Keychain items are never in iCloud Drive, a settings backup or config.json.
//
// Outside the Mac app (npm start, the tests, another platform) there's no Keychain to use, so the secrets go in a
// JSON file in the local data folder instead (fallback), readable by this user only. STUDIO_KEYCHAIN=1 or 0 says
// which to use whatever the platform.
//
// create(service, fallback) gives { get(account), set(account, secret), remove(account) }, each a promise; get gives
// '' for nothing kept, set gives false when the Keychain refused.

import fs from 'node:fs';
import { execFile } from 'node:child_process';
import * as savefile from './savefile';
import { obj } from './check';

const useKeychain = () => (process.env.STUDIO_KEYCHAIN ? process.env.STUDIO_KEYCHAIN === '1' : (process.platform === 'darwin' && !!process.parentPort));

const security = (args: string[]) => new Promise<string | null>(resolve =>
  execFile('/usr/bin/security', args, { timeout: 10000 }, (err, out) => resolve(err ? null : String(out).trim())));

function create(service: string, fallback: string) {
  const cache = new Map<string, string>();
  const keychain = useKeychain();
  const readFile = (): Record<string, string> => {
    const got = obj(savefile.readJson<unknown>(fallback, {}));
    return Object.fromEntries(Object.entries(got).filter((e): e is [string, string] => typeof e[1] === 'string'));
  };
  const writeFile = (all: Record<string, string>) => {
    savefile.writeJsonSync(fallback, all);
    try { fs.chmodSync(fallback, 0o600); } catch { /* not there to protect */ }
  };

  async function get(account: string): Promise<string> {
    const cached = cache.get(account);
    if (cached !== undefined) return cached;
    const got = keychain ? (await security(['find-generic-password', '-s', service, '-a', account, '-w'])) || '' : readFile()[account] || '';
    cache.set(account, got);
    return got;
  }

  async function set(account: string, secret: string): Promise<boolean> {
    if (!secret) return remove(account);
    if (keychain) {
      if ((await security(['add-generic-password', '-U', '-s', service, '-a', account, '-w', secret])) === null) return false;
    } else {
      writeFile({ ...readFile(), [account]: secret });
    }
    cache.set(account, secret);
    return true;
  }

  async function remove(account: string): Promise<boolean> {
    cache.set(account, '');
    if (keychain) {
      await security(['delete-generic-password', '-s', service, '-a', account]);
      return true;
    }
    const all = readFile();
    if (account in all) { delete all[account]; writeFile(all); }
    return true;
  }

  return { get, set, remove, keychain };
}

type Keychain = ReturnType<typeof create>;
export type { Keychain };
export { create };
