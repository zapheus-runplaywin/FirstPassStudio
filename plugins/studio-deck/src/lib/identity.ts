/**
 * The plugin's own key pair, and the Studios that have allowed it (device pairing). Made once, the first time it is
 * needed, and kept in the Stream Deck's global settings for this plugin (plugin.ts gives the store), so it survives
 * restarts and plugin updates. The private key never leaves this computer.
 *
 * Pairing: the first press on a Studio that hasn't allowed this plugin asks it (POST /api/pair with a name and the
 * public key). Someone at the Mac presses Allow; the plugin asks for the answer every couple of seconds for up to five
 * minutes, and from then on signs every press. A press is signed over "GET\n<path and query>\n<time in ms>" with
 * Ed25519, and sent with x-studio-device (the id Studio gave it), x-studio-time and x-studio-sign. Studio takes a
 * signature only within a minute of its time, and only once. No Stream Deck SDK here, so it can be tested alone.
 */
import crypto from "node:crypto";
import os from "node:os";

export type Identity = {
	/** PKCS#8 DER, base64url. */
	privateKey: string;
	/** SPKI DER, base64url: what Studio is given. */
	publicKey: string;
	/** The device id each Studio gave this plugin, by Studio address. */
	studios: Record<string, string>;
};

export type IdentityStore = { load: () => Promise<Partial<Identity> | null>; save: (identity: Identity) => Promise<void> };

let store: IdentityStore = { load: async () => null, save: async () => {} };
let identity: Promise<Identity> | null = null;
/** Studios being asked now, and when a Studio last refused to be asked (another request open, or denied). */
const asking = new Map<string, Promise<void>>();
const refusedAt = new Map<string, number>();
const RETRY_MS = 60 * 1000;
const ASK_FOR_MS = 5.5 * 60 * 1000;
let pollMs = 2000;

/** Where the identity is kept (plugin.ts: the Stream Deck's global settings). Tests use their own. */
export function useIdentityStore(s: IdentityStore, options: { pollMs?: number } = {}): void {
	store = s;
	identity = null;
	asking.clear();
	refusedAt.clear();
	if (options.pollMs) pollMs = options.pollMs;
}

function make(): Identity {
	const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
	return {
		privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
		publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
		studios: {},
	};
}

/** The identity, made and saved the first time. */
export function getIdentity(): Promise<Identity> {
	identity ??= (async () => {
		const saved = await store.load().catch(() => null);
		if (saved?.privateKey && saved.publicKey) return { privateKey: saved.privateKey, publicKey: saved.publicKey, studios: { ...(saved.studios ?? {}) } };
		const made = make();
		await store.save(made).catch(() => {});
		return made;
	})();
	return identity;
}

/** The headers that sign a GET of path (with its query) as this plugin's device on that Studio. */
export function signedHeaders(id: Identity, device: string, path: string, now = Date.now()): Record<string, string> {
	const key = crypto.createPrivateKey({ key: Buffer.from(id.privateKey, "base64url"), format: "der", type: "pkcs8" });
	const sign = crypto.sign(null, Buffer.from(`GET\n${path}\n${now}`), key).toString("base64url");
	return { "x-studio-device": device, "x-studio-time": String(now), "x-studio-sign": sign };
}

/** Forgets a Studio's device id (Studio removed this plugin from its Devices list), so the next press asks again. */
export async function forget(host: string): Promise<void> {
	const id = await getIdentity();
	if (!(host in id.studios)) return;
	delete id.studios[host];
	await store.save(id).catch(() => {});
}

/**
 * Asks a Studio to allow this plugin, unless it is being asked already or refused less than a minute ago. Resolves
 * once it answers, runs out or can't be reached; the device id is saved when allowed.
 */
export function pair(host: string): Promise<void> {
	const open = asking.get(host);
	if (open) return open;
	if (Date.now() - (refusedAt.get(host) ?? 0) < RETRY_MS) return Promise.resolve();
	const run = (async () => {
		const id = await getIdentity();
		const name = `Stream Deck on ${os.hostname().replace(/\.local$/, "")}`.slice(0, 40);
		const res = await fetch(`${host}/api/pair`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name, publicKey: id.publicKey }),
			signal: AbortSignal.timeout(5000),
		});
		if (res.status !== 202) {
			refusedAt.set(host, Date.now());
			return;
		}
		const { id: request, token } = (await res.json()) as { id: string; token: string };
		const end = Date.now() + ASK_FOR_MS;
		while (Date.now() < end) {
			await new Promise((r) => setTimeout(r, pollMs));
			const got = await fetch(`${host}/api/pair/${encodeURIComponent(request)}`, { headers: { "x-studio-pair": token }, signal: AbortSignal.timeout(5000) }).catch(() => null);
			if (!got) continue;
			if (got.status === 404) break;
			const answer = (await got.json()) as { status: string; device?: string };
			if (answer.status === "allowed" && answer.device) {
				id.studios[host] = answer.device;
				await store.save(id).catch(() => {});
				return;
			}
			if (answer.status === "denied") break;
		}
		refusedAt.set(host, Date.now());
	})()
		.catch(() => {
			refusedAt.set(host, Date.now());
		})
		.finally(() => asking.delete(host));
	asking.set(host, run);
	return run;
}
