/**
 * What a Sequence key shows and does, worked out from its settings and the scene (no SDK here).
 */
import { wrapTitle } from "./source-key";
import type { Playing, Scene, Sequence } from "./studio";

/** play = play it, or stop it while it plays (one key); start = always play it from the first step. */
export type SequencePress = "play" | "start" | "next" | "advance" | "pause" | "stop";

export type SequenceSettings = {
	/** Studio's address; empty means http://localhost:8080. */
	host?: string;
	/** The sequence's id (kept when it's renamed), for play and start. */
	sequence?: string;
	/** Its name when picked, shown while Studio is off air. */
	sequenceName?: string;
	/** What a press does; play when not set. */
	press?: SequencePress;
	/** Colour group; empty means the sequence's own colour from the Output page. */
	colour?: string;
	/** Leave the title alone so the one typed in Stream Deck shows. */
	keepTitle?: boolean;
	/** Which time left the key shows while its sequence plays; step when not set. */
	time?: SequenceTime;
};

/** step = the step's time left, total = the whole sequence's, both, or none (just the step number). */
export type SequenceTime = "step" | "total" | "both" | "none";

export type SequenceView = {
	/** 0 = dark, 1 = lit (orange): its sequence is playing (or, for the playing keys, any is). */
	state: 0 | 1;
	title: string;
	colour: string;
	/** The title changes each second (it shows the time left), so the key redraws while this is true. */
	ticking: boolean;
};

const PRESS: SequencePress[] = ["play", "start", "next", "advance", "pause", "stop"];

export function pressOf(settings: SequenceSettings): SequencePress {
	return PRESS.includes(settings.press as SequencePress) ? (settings.press as SequencePress) : "play";
}

const TIMES: SequenceTime[] = ["step", "total", "both", "none"];

export function timeOf(settings: SequenceSettings): SequenceTime {
	return TIMES.includes(settings.time as SequenceTime) ? (settings.time as SequenceTime) : "step";
}

const sequencesOf = (scene: Scene | null): Sequence[] => scene?.sequences ?? [];
const playingOf = (scene: Scene | null): Sequence | undefined => sequencesOf(scene).find((s) => s.id === scene?.playing?.id);

/** 0:04, from milliseconds, rounded up so it reaches 0:00 as the step ends. */
export function clock(ms: number): string {
	const t = Math.ceil(Math.max(0, ms) / 1000);
	return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * The whole sequence's time left: "all 1:40", with + when part of it waits (Next, the game, a page) so it's at
 * least that, ↻ when it goes round again after this time through, and "all –" when all that's left waits.
 */
export function totalOf(p: Playing, sinceMs: number): string {
	if (p.totalLeftMs === null || p.totalLeftMs === undefined) return "";
	const ms = p.totalLeftMs - sinceMs;
	if (p.totalOpen && ms < 1000) return p.repeats ? "all ↻" : "all –";
	return `all ${clock(ms)}${p.totalOpen ? "+" : ""}${p.repeats ? "↻" : ""}`;
}

/**
 * Where the playing sequence is: "3/5 0:04", "3/5 paused" or "3/5 Next", and with time set to total or both
 * the whole sequence's time left ("all 1:40") instead or on the next line; none shows just "3/5". sinceMs is how long
 * ago the scene arrived, since Studio sends the time left only when something changes.
 */
export function progress(scene: Scene, sinceMs: number, time: SequenceTime = "step"): { text: string; ticking: boolean } {
	const p = scene.playing!;
	const at = `${p.step + 1}/${p.steps}`;
	const counting = !p.paused && p.leftMs !== null && p.leftMs !== undefined;
	const since = counting ? sinceMs : 0;
	const step = p.paused ? `${at} paused` : counting ? `${at} ${clock(p.leftMs! - since)}` : `${at} Next`;
	// A Studio from before the whole sequence's time left sends none: the step's time shows instead.
	const total = totalOf(p, since);
	if (time === "none") return { text: p.paused ? `${at} paused` : at, ticking: false };
	// Just the whole sequence's (the step number would make it too long for the key).
	if (time === "total" && total) return { text: p.paused ? `${at} paused` : total, ticking: counting };
	if (time === "both" && total) return { text: `${step}\n${total}`, ticking: counting };
	return { text: step, ticking: counting };
}

/**
 * A play (or start) key lights while its sequence plays and shows its step and time left. The keys for whatever
 * is playing (next, pause, stop) light while any sequence plays and name it; advance (Next when waiting) lights
 * only while the step on now waits for Next. Every key says so when
 * Studio is off air.
 */
export function sequenceViewOf(settings: SequenceSettings, scene: Scene | null, sinceMs = 0): SequenceView {
	const press = pressOf(settings);
	const own = settings.colour || "";
	const view = (title: string, target?: Sequence, state: 0 | 1 = 0, ticking = false): SequenceView => ({
		state,
		title,
		colour: own || target?.colour || "blue",
		ticking,
	});
	if (press === "play" || press === "start") {
		if (!settings.sequence) return view("Pick a\nsequence");
		const name = settings.sequenceName || "Sequence";
		if (!scene) return view(`${wrapTitle(name)}\n(off air)`);
		const sq = sequencesOf(scene).find((s) => s.id === settings.sequence);
		if (!sq) return view(`${wrapTitle(name)}\n(gone)`);
	const pend = scene.pending;
	if (pend && pend.id === sq.id && scene.playing?.id !== sq.id) {
		return view(`${wrapTitle(sq.name)}\n${pend.leftMs === null ? "next" : `in ${clock(pend.leftMs - sinceMs)}`}`, sq, 0, pend.leftMs !== null);
	}
		if (scene.playing?.id !== sq.id) return view(`${wrapTitle(sq.name)}\n▶`, sq);
		const { text, ticking } = progress(scene, sinceMs, timeOf(settings));
		// Two lines of time leave room for one of the name.
		const lines = text.includes("\n") ? 1 : 2;
		return view(`${wrapTitle(sq.name, 9).split("\n").slice(0, lines).join("\n")}\n${text}`, sq, 1, ticking);
	}
	const label = { next: "Next ⏭", advance: "Next ⏭", pause: "Pause", stop: "Stop" }[press];
	if (!scene) return view(`${label}\n(off air)`);
	const sq = playingOf(scene);
	if (!sq) return view(`${label}\n(none on)`);
	const { text, ticking } = progress(scene, sinceMs, timeOf(settings));
	if (press === "advance" && scene.playing!.length !== "next") return view(`${label}\nnot waiting`, sq, 0, false);
	if (press === "pause") return view(`${scene.playing!.paused ? "Carry on" : "Pause"}\n${text}`, sq, 1, ticking);
	return view(`${label}\n${text}`, sq, 1, ticking);
}

/** The Studio link a press opens. */
export function sequenceLinkFor(settings: SequenceSettings): string | null {
	const press = pressOf(settings);
	if (press === "play" || press === "start") {
		if (!settings.sequence) return null;
		return `/deck/sequence/${encodeURIComponent(settings.sequence)}/${press === "play" ? "toggle" : "play"}`;
	}
	return `/deck/sequence/${press}`;
}
