/**
 * What a Sequence key shows and does, worked out from its settings and the scene (no SDK here).
 */
import { wrapTitle } from "./source-key";
import type { Scene, Sequence } from "./studio";

/** play = play it, or stop it while it plays (one key); start = always play it from the first step. */
export type SequencePress = "play" | "start" | "next" | "delay" | "pause" | "stop";

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
};

export type SequenceView = {
	/** 0 = dark, 1 = lit (orange): its sequence is playing (or, for the playing keys, any is). */
	state: 0 | 1;
	title: string;
	colour: string;
	/** The title changes each second (it shows the time left), so the key redraws while this is true. */
	ticking: boolean;
};

const PRESS: SequencePress[] = ["play", "start", "next", "delay", "pause", "stop"];

export function pressOf(settings: SequenceSettings): SequencePress {
	return PRESS.includes(settings.press as SequencePress) ? (settings.press as SequencePress) : "play";
}

const sequencesOf = (scene: Scene | null): Sequence[] => scene?.sequences ?? [];
const playingOf = (scene: Scene | null): Sequence | undefined => sequencesOf(scene).find((s) => s.id === scene?.playing?.id);

/** 0:04, from milliseconds, rounded up so it reaches 0:00 as the step ends. */
export function clock(ms: number): string {
	const t = Math.ceil(Math.max(0, ms) / 1000);
	return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * Where the playing sequence is: "3/5 0:04", "3/5 paused", "3/5 Next" or "3/5 ends". sinceMs is how long
 * ago the scene arrived, since Studio sends the time left only when something changes.
 */
export function progress(scene: Scene, sinceMs: number): { text: string; ticking: boolean } {
	const p = scene.playing!;
	const at = `${p.step + 1}/${p.steps}`;
	if (p.paused) return { text: `${at} paused`, ticking: false };
	if (p.leftMs === null || p.leftMs === undefined) return { text: `${at} Next`, ticking: false };
	return { text: `${at} ${clock(p.leftMs - sinceMs)}`, ticking: true };
}

/**
 * A play (or start) key lights while its sequence plays and shows its step and time left. The keys for whatever
 * is playing (next, delay, pause, stop) light while any sequence plays and name it. Every key says so when
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
		const { text, ticking } = progress(scene, sinceMs);
		return view(`${wrapTitle(sq.name, 9).split("\n").slice(0, 2).join("\n")}\n${text}`, sq, 1, ticking);
	}
	const label = { next: "Next ⏭", delay: "Delay\n+10 s", pause: "Pause", stop: "Stop" }[press];
	if (!scene) return view(`${label}\n(off air)`);
	// A sequence about to start by itself: Delay pushes it back, so that key counts down to it.
	const pend = scene.pending;
	const coming = pend && sequencesOf(scene).find((s) => s.id === pend.id);
	if (press === "delay" && pend && coming && pend.leftMs !== null) {
		const held = pend.delayMs ? ` (+${Math.round(pend.delayMs / 1000)})` : "";
		return view(`Delay +10\nin ${clock(pend.leftMs - sinceMs)}${held}`, coming, 1, true);
	}
	const sq = playingOf(scene);
	if (!sq) return view(`${label}\n(none on)`);
	const { text, ticking } = progress(scene, sinceMs);
	if (press === "pause") return view(`${scene.playing!.paused ? "Carry on" : "Pause"}\n${text}`, sq, 1, ticking);
	if (press === "delay") {
		const held = scene.playing!.delayMs ? ` (+${Math.round(scene.playing!.delayMs / 1000)})` : "";
		return view(`Delay +10\n${text}${held}`, sq, 1, ticking);
	}
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
