/**
 * What a Replay key shows and does, worked out from its settings and what Studio is playing back (no SDK here): the
 * 4K replay or a practice (or demo) game started on Studio's Recordings tab, whichever is running.
 */
/** toggle = Play or Pause (one key); next and prev jump to the next or previous moment; the nudges are the replay's. */
export type PlaybackPress = "toggle" | "stop" | "next" | "prev" | "frameBack" | "frameOn" | "secondBack" | "secondOn";

export type PlaybackSettings = {
	/** Studio's address; empty means http://localhost:8080. */
	host?: string;
	/** What a press does; toggle when not set. */
	press?: PlaybackPress;
	/** Leave the title alone so the one typed in Stream Deck shows. */
	keepTitle?: boolean;
};

/** What Studio is playing back (/api/replay and /api/practice, only the fields the keys use); null while it can't be reached. */
export type Playback = {
	replay: { active: boolean; paused?: boolean; follow?: { kind?: string } };
	practice: { active: boolean; paused?: boolean; demo?: unknown };
} | null;

export type PlaybackView = {
	/** 0 = dark, 1 = lit: a replay or practice game is running for it to act on. */
	state: 0 | 1;
	title: string;
};

const PRESS: PlaybackPress[] = ["toggle", "stop", "next", "prev", "frameBack", "frameOn", "secondBack", "secondOn"];
const NUDGE: Partial<Record<PlaybackPress, number>> = { frameBack: -40, frameOn: 40, secondBack: -1000, secondOn: 1000 };
const LABEL: Record<PlaybackPress, string> = {
	toggle: "Play ▶",
	stop: "Stop ■",
	next: "Next ⏭",
	prev: "Back ⏮",
	frameBack: "−1 frame",
	frameOn: "+1 frame",
	secondBack: "−1 s",
	secondOn: "+1 s",
};

export function pressOf(settings: PlaybackSettings): PlaybackPress {
	return PRESS.includes(settings.press as PlaybackPress) ? (settings.press as PlaybackPress) : "toggle";
}

/** Which is running: the replay, a practice game, or neither. */
function running(pb: Playback): "replay" | "practice" | null {
	if (pb?.replay.active) return "replay";
	if (pb?.practice.active) return "practice";
	return null;
}

/**
 * Every key names what it acts on ("4K replay", "Practice", "Demo") and lights while it's running; the Play key says
 * Pause while it plays. A nudge is the replay's only. While the replay follows a player's timecode, the player plays
 * and pauses it, so the Play key says so.
 */
export function playbackViewOf(settings: PlaybackSettings, pb: Playback): PlaybackView {
	const press = pressOf(settings);
	let label = LABEL[press];
	if (!pb) return { state: 0, title: `${label}\n(off air)` };
	const what = running(pb);
	if (!what) return { state: 0, title: `${label}\n(none on)` };
	const now = what === "replay" ? pb.replay : pb.practice;
	const name = what === "replay" ? "4K replay" : pb.practice.demo ? "Demo" : "Practice";
	if (NUDGE[press] !== undefined && what !== "replay") return { state: 0, title: `${label}\n(replay only)` };
	if (press === "toggle") {
		if (what === "replay" && pb.replay.follow?.kind && pb.replay.follow.kind !== "none") return { state: 1, title: `${name}\nfollows\nvideo` };
		label = now.paused ? "Play ▶" : "Pause ⏸";
	}
	return { state: 1, title: `${label}\n${name}` };
}

/** The Studio link a press opens, for whichever is running; null when there's nothing for it to act on. */
export function playbackLinkFor(settings: PlaybackSettings, pb: Playback): string | null {
	const press = pressOf(settings);
	const what = running(pb);
	if (!what) return null;
	const nudge = NUDGE[press];
	if (nudge !== undefined) return what === "replay" ? `/deck/replay/nudge/${nudge}` : null;
	return `/deck/${what}/${press}`;
}
