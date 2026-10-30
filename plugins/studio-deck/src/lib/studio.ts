/**
 * Talks to FirstPass Studio. One live connection per Studio address follows the scene through its
 * server-sent events (/api/scene/events), so every key on that address updates the moment a source
 * is shown or hidden, whether from a key, the Output page or a link; Switcher keys follow the switcher the same
 * way (/api/switcher/events). Key presses are plain GETs of the same /deck links the Output page lists. No Stream
 * Deck SDK here, so it can be tested alone.
 */

import { forget, getIdentity, pair, signedHeaders } from "./identity";
import type { Playback } from "./playback-key";

export const DEFAULT_HOST = "http://localhost:8080";

/** One source in the scene, as /api/scene sends it (only the fields the keys use). */
export type SceneSource = {
	id: string;
	name: string;
	type: string;
	/** On for Output 1. */
	visible: boolean;
	sound?: boolean;
	/** On for each of the other outputs, by output id (from a Studio with more than one output). */
	out?: Record<string, boolean>;
};
/** One of Studio's outputs (up to four): its id, name, number and colour, and its name as it goes in a link. */
export type Output = { id: string; name: string; slot?: number; colour?: string; link?: string };
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
	/**
	 * Studio's outputs (missing from a Studio older than them). The fields above are Output 1's; the other outputs'
	 * current scene, changes, playing and pending sequence are kept by output id.
	 */
	outputs?: Output[];
	currentOut?: Record<string, string>;
	changedOut?: Record<string, string[]>;
	playingOut?: Record<string, Playing>;
	pendingOut?: Record<string, Pending>;
};

/** Output 1's id. A key with no output set acts on it, as keys did before Studio had more than one. */
export const PRIMARY = "main";

const isPrimary = (output?: string) => !output || output === PRIMARY;

/** The scene as one output sees it: its sources on and off, current scene, changes and sequences, in Output 1's fields. */
export function forOutput(scene: Scene | null, output?: string): Scene | null {
	if (!scene || isPrimary(output)) return scene;
	const id = output!;
	return {
		...scene,
		sources: scene.sources.map((s) => ({ ...s, visible: !!s.out?.[id] })),
		current: scene.currentOut?.[id] ?? null,
		changed: scene.changedOut?.[id] ?? [],
		playing: scene.playingOut?.[id] ?? null,
		pending: scene.pendingOut?.[id] ?? null,
	};
}

/** A key's output has been removed in Studio (Output 1 never is). */
export function outputGone(scene: Scene | null, output?: string): boolean {
	return !!scene && !isPrimary(output) && !(scene.outputs ?? []).some((o) => o.id === output);
}

/** The colour a key for an output lights in: the output's colour from Studio, or undefined to use the default. */
export function outputColour(scene: Scene | null, output?: string): string | undefined {
	return scene?.outputs?.find((o) => o.id === (output || PRIMARY))?.colour;
}

/** Where an output's Stream Deck links start: /deck for Output 1, /deck/output/<id> for the others. */
export function deckBase(output?: string): string {
	return isPrimary(output) ? "/deck" : `/deck/output/${encodeURIComponent(output!)}`;
}

/** The scene (or the switcher, for a switcher feed), or null while Studio can't be reached. */
export type Listener<T = Scene> = (value: T | null) => void;

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

/**
 * A live connection to one Studio, shared by every key pointing at it: the scene (/api/scene/events) by default, or
 * another of Studio's event streams, such as the switcher's (/api/switcher/events).
 */
export class StudioFeed<T = Scene> {
	readonly host: string;
	scene: T | null = null;
	private readonly listeners = new Set<Listener<T>>();
	private abort: AbortController | null = null;
	private retry: ReturnType<typeof setTimeout> | null = null;
	private closed = false;

	constructor(
		host: string,
		private readonly log: (message: string) => void = () => {},
		private readonly path = "/api/scene/events",
		private readonly what = "the scene",
	) {
		this.host = host;
	}

	subscribe(listener: Listener<T>): () => void {
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

	private emit(scene: T | null): void {
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
			const res = await fetch(`${this.host}${this.path}`, { signal: abort.signal, headers: { accept: "text/event-stream" } });
			if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
			this.log(`Following ${this.what} at ${this.host}`);
			const decoder = new TextDecoder();
			let buffer = "";
			for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
				wake();
				buffer += decoder.decode(chunk, { stream: true });
				const { events, rest } = parseEvents(buffer);
				buffer = rest;
				for (const data of events) {
					try {
						this.emit(JSON.parse(data) as T);
					} catch {
						this.log(`Ignored an update from ${this.what} that wasn't JSON`);
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

const switcherFeeds = new Map<string, StudioFeed<Switcher>>();

/** The shared switcher feed for a Studio address: the switcher's state on every change (its tally, keys, losing it). */
export function switcherFeedFor(host: string, log?: (message: string) => void): StudioFeed<Switcher> {
	let feed = switcherFeeds.get(host);
	if (!feed) {
		feed = new StudioFeed<Switcher>(host, log, "/api/switcher/events", "the switcher");
		switcherFeeds.set(host, feed);
	}
	return feed;
}

/** The switcher as Studio sends it (/api/switcher, only the fields the keys use). */
export type Switcher = {
	/** A switcher has been picked on the Output page. */
	setUp: boolean;
	/** off | connecting | connected | lost | error */
	state: string;
	model: string;
	/** The inputs plugged in (cameras and the like), numbered as on the switcher. */
	inputs: { id: number; name: string; short: string }[];
	program: number | null;
	preview: number | null;
	inTransition: boolean;
	/** Each upstream and downstream key: on air or not. */
	usk: boolean[];
	dsk: boolean[];
	ftb: boolean;
};

/** The switcher now, for the key settings' lists; null if Studio can't be reached. */
export async function fetchSwitcher(host: string): Promise<Switcher | null> {
	try {
		const res = await fetch(`${host}/api/switcher`, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return null;
		return (await res.json()) as Switcher;
	} catch {
		return null;
	}
}

/**
 * Presses a Studio link; resolves to whether Studio accepted it. Once that Studio has allowed this plugin the press is
 * signed with the plugin's own key (identity.ts), so it needs no key in the link. Until then it carries the
 * x-studio-deck header, which a Studio without any paired plugin still takes, and asks Studio to allow it (a dialog on
 * the Mac). A Studio that no longer knows the plugin (removed in Devices…) is asked again.
 */
export async function press(host: string, path: string): Promise<boolean> {
	try {
		const id = await getIdentity();
		const device = id.studios[host];
		// Signed over the path as it goes on the wire, which is what Studio sees.
		const sent = new URL(`${host}${path}`);
		const headers = device ? signedHeaders(id, device, sent.pathname + sent.search) : { "x-studio-deck": "1" };
		const res = await fetch(`${host}${path}`, { signal: AbortSignal.timeout(5000), headers });
		if (res.status === 403) {
			const body = (await res.json().catch(() => ({}))) as { pair?: boolean };
			if (body.pair) {
				if (device) await forget(host);
				void pair(host);
			}
		} else if (!device) void pair(host);
		return res.ok;
	} catch {
		return false;
	}
}

/**
 * What Studio is playing back from the Recordings tab (Replay keys): the 4K replay and the practice game; null if
 * Studio can't be reached. A Studio older than replays answers 404 there, taken as none running.
 */
export async function fetchPlayback(host: string): Promise<Playback> {
	const get = async (path: string) => {
		const res = await fetch(`${host}${path}`, { signal: AbortSignal.timeout(5000) });
		return res.ok ? ((await res.json()) as { active: boolean }) : { active: false };
	};
	try {
		const [replay, practice] = await Promise.all([get("/api/replay"), get("/api/practice")]);
		return { replay, practice };
	} catch {
		return null;
	}
}

/** The whole scene, for the key settings' lists; null if Studio can't be reached. */
export async function fetchScene(host: string): Promise<Scene | null> {
	try {
		const res = await fetch(`${host}/api/scene`, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return null;
		return (await res.json()) as Scene;
	} catch {
		return null;
	}
}

/** The scene's sources, for the key settings' list; null if Studio can't be reached. */
export async function listSources(host: string): Promise<SceneSource[] | null> {
	return (await fetchScene(host))?.sources ?? null;
}

/** The saved scenes, for the Scene key settings' list; null if Studio can't be reached. */
export async function listScenes(host: string): Promise<SavedScene[] | null> {
	const scene = await fetchScene(host);
	return scene ? (scene.scenes ?? []) : null;
}

/** The competition's sequences, for the Sequence key settings' list; null if Studio can't be reached. */
export async function listSequences(host: string): Promise<Sequence[] | null> {
	const scene = await fetchScene(host);
	return scene ? (scene.sequences ?? []) : null;
}

/** The outputs for the key settings' Output list: Output 1 alone from a Studio older than outputs. */
export function outputsOf(scene: Scene | null): Output[] {
	return scene?.outputs?.length ? scene.outputs : [{ id: PRIMARY, name: "Output 1", slot: 1 }];
}
