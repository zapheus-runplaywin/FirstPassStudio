/**
 * Talks to FirstPass Studio. One live connection per Studio address follows the scene through its
 * server-sent events (/api/scene/events), so every key on that address updates the moment a source
 * is shown or hidden, whether from a key, the Output page or a link. Key presses are plain GETs of
 * the same /deck/layer links the Output page lists. No Stream Deck SDK here, so it can be tested alone.
 */

export const DEFAULT_HOST = "http://localhost:8080";

/** One source in the scene, as /api/scene sends it (only the fields the keys use). */
export type SceneSource = { id: string; name: string; type: string; visible: boolean; sound?: boolean };
/** A saved look: on or off for each source it sets, by source id (only the fields the keys use). */
export type SavedScene = { id: string; name: string; colour?: string; states: Record<string, "on" | "off"> };
/** A sequence: sources played one after another (only the fields the keys use). */
export type Sequence = { id: string; name: string; colour?: string };
/** The sequence playing now: its step (from 0) of steps, and the step's time left when Studio sent it (null: waits for Next). */
export type Playing = {
	id: string;
	step: number;
	steps: number;
	paused: boolean;
	leftMs: number | null;
	length?: string | null;
	/** The whole sequence's time left (from a Studio with it); totalOpen: part of it waits, so at least that; repeats: it goes round again. */
	totalLeftMs?: number | null;
	totalOpen?: boolean;
	repeats?: boolean;
};
/** A sequence about to start by itself. */
export type Pending = { id: string; leftMs: number | null };
/**
 * The whole scene as Studio sends it. scenes, current (the last scene gone to) and changed (sources that differ
 * from it) are missing from a Studio older than scenes; sequences and playing from one older than sequences.
 */
export type Scene = {
	rev: number;
	sources: SceneSource[];
	scenes?: SavedScene[];
	current?: string | null;
	changed?: string[];
	sequences?: Sequence[];
	playing?: Playing | null;
	/** A sequence about to start by itself (a few seconds after the siren): its time left (null while it waits for the one playing). */
	pending?: Pending | null;
};

/** The scene, or null while Studio can't be reached. */
export type Listener = (scene: Scene | null) => void;

const RETRY_MS = 2000;
// Studio sends a comment every 25 s; a connection silent for longer than this has gone and is reopened.
const SILENT_MS = 60000;

/** Tidies an address typed in a key's settings: adds http://, drops a trailing slash. */
export function cleanHost(host?: string): string {
	let h = (host ?? "").trim() || DEFAULT_HOST;
	if (!/^https?:\/\//i.test(h)) h = `http://${h}`;
	return h.replace(/\/+$/, "");
}

/** Pulls the complete events out of a server-sent events buffer; returns their data and what's left over. */
export function parseEvents(buffer: string): { events: string[]; rest: string } {
	const events: string[] = [];
	const blocks = buffer.replace(/\r\n?/g, "\n").split("\n\n");
	const rest = blocks.pop() ?? "";
	for (const block of blocks) {
		const data = block
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).replace(/^ /, ""));
		if (data.length) events.push(data.join("\n"));
	}
	return { events, rest };
}

/** A live connection to one Studio, shared by every key pointing at it. */
export class StudioFeed {
	readonly host: string;
	scene: Scene | null = null;
	private readonly listeners = new Set<Listener>();
	private abort: AbortController | null = null;
	private retry: ReturnType<typeof setTimeout> | null = null;
	private closed = false;

	constructor(host: string, private readonly log: (message: string) => void = () => {}) {
		this.host = host;
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		listener(this.scene);
		if (this.listeners.size === 1) this.open();
		return () => {
			this.listeners.delete(listener);
			if (!this.listeners.size) this.close();
		};
	}

	get listening(): number {
		return this.listeners.size;
	}

	private emit(scene: Scene | null): void {
		this.scene = scene;
		for (const listener of this.listeners) listener(scene);
	}

	private open(): void {
		this.closed = false;
		void this.run();
	}

	private close(): void {
		this.closed = true;
		this.abort?.abort();
		if (this.retry) clearTimeout(this.retry);
		this.retry = null;
	}

	private async run(): Promise<void> {
		const abort = new AbortController();
		this.abort = abort;
		let silent: ReturnType<typeof setTimeout> | null = null;
		const wake = () => {
			if (silent) clearTimeout(silent);
			silent = setTimeout(() => abort.abort(), SILENT_MS);
		};
		try {
			wake();
			const res = await fetch(`${this.host}/api/scene/events`, { signal: abort.signal, headers: { accept: "text/event-stream" } });
			if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
			this.log(`Following the scene at ${this.host}`);
			const decoder = new TextDecoder();
			let buffer = "";
			for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
				wake();
				buffer += decoder.decode(chunk, { stream: true });
				const { events, rest } = parseEvents(buffer);
				buffer = rest;
				for (const data of events) {
					try {
						this.emit(JSON.parse(data) as Scene);
					} catch {
						this.log(`Ignored a scene update that wasn't JSON`);
					}
				}
			}
			throw new Error("connection closed");
		} catch (err) {
			if (this.closed) return;
			if (this.scene !== null) this.log(`Lost Studio at ${this.host}: ${(err as Error).message}`);
			this.emit(null);
			this.retry = setTimeout(() => {
				this.retry = null;
				if (!this.closed) void this.run();
			}, RETRY_MS);
		} finally {
			if (silent) clearTimeout(silent);
		}
	}
}

const feeds = new Map<string, StudioFeed>();

/** The shared feed for a Studio address. */
export function feedFor(host: string, log?: (message: string) => void): StudioFeed {
	let feed = feeds.get(host);
	if (!feed) {
		feed = new StudioFeed(host, log);
		feeds.set(host, feed);
	}
	return feed;
}

/** Presses a Studio link; resolves to whether Studio accepted it. */
export async function press(host: string, path: string): Promise<boolean> {
	try {
		const res = await fetch(`${host}${path}`, { signal: AbortSignal.timeout(5000) });
		return res.ok;
	} catch {
		return false;
	}
}

/** The scene's sources, for the key settings' list; null if Studio can't be reached. */
export async function listSources(host: string): Promise<SceneSource[] | null> {
	try {
		const res = await fetch(`${host}/api/scene`, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return null;
		return ((await res.json()) as Scene).sources;
	} catch {
		return null;
	}
}

/** The saved scenes, for the Scene key settings' list; null if Studio can't be reached. */
export async function listScenes(host: string): Promise<SavedScene[] | null> {
	try {
		const res = await fetch(`${host}/api/scene`, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return null;
		return ((await res.json()) as Scene).scenes ?? [];
	} catch {
		return null;
	}
}

/** The competition's sequences, for the Sequence key settings' list; null if Studio can't be reached. */
export async function listSequences(host: string): Promise<Sequence[] | null> {
	try {
		const res = await fetch(`${host}/api/scene`, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return null;
		return ((await res.json()) as Scene).sequences ?? [];
	} catch {
		return null;
	}
}
