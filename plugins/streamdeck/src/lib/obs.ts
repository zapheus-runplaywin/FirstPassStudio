/**
 * Minimal client for OBS's built-in WebSocket server (obs-websocket protocol v5, OBS 28+).
 * Uses Node's global WebSocket, so it adds no dependencies. No Stream Deck dependencies either.
 *
 * Protocol: OBS sends Hello (op 0) -> we send Identify (op 1, with a password hash if OBS asks)
 * -> OBS sends Identified (op 2). Then Request (op 6) / RequestResponse (op 7) pairs matched by requestId.
 */
import { createHash, randomUUID } from "node:crypto";

export const DEFAULT_OBS_ADDRESS = "localhost:4455";

const CONNECT_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 10000;

type ObsMessage = { op: number; d: Record<string, unknown> };
type Pending = { resolve: (data: Record<string, unknown>) => void; reject: (err: Error) => void; timer: NodeJS.Timeout };

/** Something that can send OBS requests (the real client, or a fake in tests). */
export type ObsRequester = {
	request(requestType: string, requestData?: Record<string, unknown>): Promise<Record<string, unknown>>;
};

/** An OBS request that OBS answered with a failure status. */
export class ObsRequestError extends Error {
	readonly code: number;
	constructor(requestType: string, code: number, comment: string | undefined) {
		super(`OBS couldn't do ${requestType}: ${comment ?? `error ${code}`}`);
		this.name = "ObsRequestError";
		this.code = code;
	}
}

/** "localhost:4455", "192.168.1.20", "ws://pc:4455" -> a ws:// URL (default port 4455). */
export function obsUrl(address: string | undefined): string {
	let a = (address ?? "").trim() || DEFAULT_OBS_ADDRESS;
	if (!/^wss?:\/\//i.test(a)) a = `ws://${a}`;
	const u = new URL(a);
	if (!u.port) u.port = "4455";
	return u.toString().replace(/\/$/, "");
}

/** obs-websocket v5 auth: base64(sha256(base64(sha256(password + salt)) + challenge)). */
export function obsAuthResponse(password: string, salt: string, challenge: string): string {
	const sha = (s: string): string => createHash("sha256").update(s).digest("base64");
	return sha(sha(password + salt) + challenge);
}

export class ObsClient implements ObsRequester {
	readonly url: string;
	readonly password: string;
	private ws: WebSocket | null = null;
	private ready: Promise<void> | null = null;
	private readonly pending = new Map<string, Pending>();

	constructor(url: string, password: string) {
		this.url = url;
		this.password = password;
	}

	get connected(): boolean {
		return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.ready !== null;
	}

	/** Connect and identify, reusing an open connection. */
	connect(): Promise<void> {
		if (this.ready) return this.ready;
		this.ready = new Promise<void>((resolve, reject) => {
			let identified = false;
			const fail = (message: string): void => {
				clearTimeout(timer);
				this.ready = null;
				try {
					this.ws?.close();
				} catch {
					/* ignore */
				}
				this.ws = null;
				reject(new Error(message));
			};
			const timer = setTimeout(() => fail(`Timed out connecting to OBS at ${this.url}`), CONNECT_TIMEOUT_MS);

			let ws: WebSocket;
			try {
				ws = new WebSocket(this.url, "obswebsocket.json");
			} catch (e) {
				return fail(`Bad OBS address ${this.url}: ${(e as Error).message}`);
			}
			this.ws = ws;

			ws.onmessage = (ev: MessageEvent): void => {
				let msg: ObsMessage;
				try {
					msg = JSON.parse(String(ev.data)) as ObsMessage;
				} catch {
					return;
				}
				if (msg.op === 0) {
					// Hello
					const auth = msg.d.authentication as { challenge: string; salt: string } | undefined;
					if (auth && !this.password) return fail("OBS needs a password: add it in the key's OBS settings");
					ws.send(
						JSON.stringify({
							op: 1,
							d: {
								rpcVersion: 1,
								eventSubscriptions: 0,
								...(auth ? { authentication: obsAuthResponse(this.password, auth.salt, auth.challenge) } : {}),
							},
						}),
					);
				} else if (msg.op === 2) {
					// Identified
					identified = true;
					clearTimeout(timer);
					resolve();
				} else if (msg.op === 7) {
					// RequestResponse
					const d = msg.d as {
						requestId: string;
						requestType: string;
						requestStatus: { result: boolean; code: number; comment?: string };
						responseData?: Record<string, unknown>;
					};
					const p = this.pending.get(d.requestId);
					if (!p) return;
					this.pending.delete(d.requestId);
					clearTimeout(p.timer);
					if (d.requestStatus.result) p.resolve(d.responseData ?? {});
					else p.reject(new ObsRequestError(d.requestType, d.requestStatus.code, d.requestStatus.comment));
				}
			};

			let disconnected = false;
			const disconnect = (code: number): void => {
				if (disconnected || this.ws !== ws) return;
				disconnected = true;
				const reason = closeReason(code, this.url);
				for (const [id, p] of this.pending) {
					clearTimeout(p.timer);
					p.reject(new Error(`OBS connection closed: ${reason}`));
					this.pending.delete(id);
				}
				if (!identified) return fail(reason);
				this.ws = null;
				this.ready = null;
				try {
					ws.close();
				} catch {
					/* ignore */
				}
			};
			ws.onclose = (ev: CloseEvent): void => disconnect(ev.code);
			// Node's WebSocket can report a refused or dropped connection with only an error event,
			// and fire close much later (or not at all), so treat an error as the disconnect.
			ws.onerror = (): void => disconnect(1006);
		});
		return this.ready;
	}

	async request(requestType: string, requestData?: Record<string, unknown>): Promise<Record<string, unknown>> {
		await this.connect();
		const ws = this.ws;
		if (!ws) throw new Error(`Not connected to OBS at ${this.url}`);
		const requestId = randomUUID();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(requestId);
				reject(new Error(`OBS didn't answer ${requestType} within ${REQUEST_TIMEOUT_MS / 1000}s`));
			}, REQUEST_TIMEOUT_MS);
			this.pending.set(requestId, { resolve, reject, timer });
			ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, ...(requestData ? { requestData } : {}) } }));
		});
	}

	close(): void {
		const ws = this.ws;
		this.ws = null;
		this.ready = null;
		try {
			ws?.close();
		} catch {
			/* ignore */
		}
	}
}

function closeReason(code: number, url: string): string {
	switch (code) {
		case 4009:
			return "OBS rejected the password (check the key's OBS settings)";
		case 4010:
			return "this OBS is too old: the plugin needs OBS 28 or later";
		case 1000:
		case 1001:
			return "OBS closed the connection";
		default:
			return `Can't reach OBS at ${url}. Is OBS running, with Tools → WebSocket Server Settings → Enable WebSocket server ticked?`;
	}
}

// ---------- the step actions ----------

/** Switch the program output to a scene. */
export async function switchScene(obs: ObsRequester, sceneName: string): Promise<void> {
	await obs.request("SetCurrentProgramScene", { sceneName });
}

/**
 * Show, hide or toggle a source in a scene (the current program scene if none is named).
 * Returns the scene and the source's new visibility, for logging.
 */
export async function setSourceVisible(
	obs: ObsRequester,
	sourceName: string,
	visible: boolean | "toggle",
	sceneName?: string,
): Promise<{ sceneName: string; visible: boolean }> {
	let scene = sceneName;
	if (!scene) {
		const cur = await obs.request("GetCurrentProgramScene");
		scene = String(cur.currentProgramSceneName ?? cur.sceneName ?? "");
	}
	let sceneItemId: number;
	try {
		sceneItemId = Number((await obs.request("GetSceneItemId", { sceneName: scene, sourceName })).sceneItemId);
	} catch (e) {
		if (e instanceof ObsRequestError) throw new Error(`OBS has no source "${sourceName}" in scene "${scene}"`);
		throw e;
	}
	let enabled: boolean;
	if (visible === "toggle") {
		const cur = await obs.request("GetSceneItemEnabled", { sceneName: scene, sceneItemId });
		enabled = !cur.sceneItemEnabled;
	} else {
		enabled = visible;
	}
	await obs.request("SetSceneItemEnabled", { sceneName: scene, sceneItemId, sceneItemEnabled: enabled });
	return { sceneName: scene, visible: enabled };
}

/** Connect, read the version and scene names, and disconnect. For the settings panel's Test button. */
export async function testObsConnection(address: string | undefined, password: string | undefined): Promise<string> {
	const client = new ObsClient(obsUrl(address), password ?? "");
	try {
		const version = await client.request("GetVersion");
		const list = await client.request("GetSceneList");
		const scenes = ((list.scenes as { sceneName: string }[] | undefined) ?? []).map((s) => s.sceneName).reverse();
		return `Connected to OBS ${String(version.obsVersion ?? "")}. Scenes: ${scenes.join(", ") || "(none)"}`;
	} finally {
		client.close();
	}
}
