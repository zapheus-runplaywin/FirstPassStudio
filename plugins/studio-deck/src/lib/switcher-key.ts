/**
 * What a Switcher key shows and does, worked out from its settings and the switcher's state (no SDK here).
 * The switcher is the ATEM picked on Studio's Output page; the key presses Studio's /deck/switcher links.
 */
import { TALLY } from "./colours";
import { wrapTitle } from "./source-key";
import type { Switcher } from "./studio";

export type SwitcherPress = "preview" | "program" | "stinger" | "cut" | "auto" | "usk" | "dsk" | "ftb" | "macro";
/** What a key press does to an upstream or downstream key (auto: a downstream key at its own rate). */
export type KeyVerb = "toggle" | "on" | "off" | "auto";

export type SwitcherSettings = {
	/** Studio's address; empty means http://localhost:8080. */
	host?: string;
	/** What a press does; preview when not set. */
	press?: SwitcherPress;
	/** The input's number on the switcher, for preview, program and stinger (a stinger with none goes to what's on preview). */
	input?: string;
	/** Its name when picked, shown while the switcher isn't there. */
	inputName?: string;
	/** The upstream or downstream key's number, from 1. */
	key?: string;
	/** What a press does to that key; toggle when not set. */
	verb?: KeyVerb;
	/** The macro's number, from 1. */
	macro?: string;
	/** Leave the title alone so the one typed in Stream Deck shows. */
	keepTitle?: boolean;
};

export type SwitcherView = {
	/** 0 = dark, 1 = lit in lit's colour. */
	state: 0 | 1;
	/** The lit body: red on program or on air, green on preview. */
	lit: string;
	title: string;
	/** The switcher isn't answering (or Studio can't reach it): the warning dot. */
	dot: boolean;
};

const PRESS: SwitcherPress[] = ["preview", "program", "stinger", "cut", "auto", "usk", "dsk", "ftb", "macro"];
const VERBS: KeyVerb[] = ["toggle", "on", "off", "auto"];
const withInput = (p: SwitcherPress) => p === "preview" || p === "program" || p === "stinger";

export function pressOf(settings: SwitcherSettings): SwitcherPress {
	return PRESS.includes(settings.press as SwitcherPress) ? (settings.press as SwitcherPress) : "preview";
}

/** toggle unless set; auto is for downstream keys only, so an upstream key's auto is a toggle. */
export function verbOf(settings: SwitcherSettings): KeyVerb {
	const v = VERBS.includes(settings.verb as KeyVerb) ? (settings.verb as KeyVerb) : "toggle";
	return v === "auto" && pressOf(settings) !== "dsk" ? "toggle" : v;
}

const num = (v?: string) => {
	const n = Number(String(v ?? "").trim());
	return Number.isInteger(n) && n > 0 ? n : null;
};

/** The key's own label, before it knows anything about the switcher. */
function label(settings: SwitcherSettings): string {
	const press = pressOf(settings);
	const input = settings.inputName || (settings.input ? `Input ${settings.input}` : "");
	switch (press) {
		case "preview":
		case "program":
			return input ? wrapTitle(input) : "Pick an\ninput";
		case "stinger":
			return input ? `Stinger\n${wrapTitle(input, 9).split("\n")[0]}` : "Stinger";
		case "cut":
			return "Cut";
		case "auto":
			return "Auto";
		case "usk":
			return `Up key\n${settings.key || "?"}`;
		case "dsk":
			return `Down key\n${settings.key || "?"}`;
		case "ftb":
			return "Fade to\nblack";
		case "macro":
			return `Macro\n${settings.macro || "?"}`;
	}
}

/**
 * An input key lights red while its input is on program and green while it's on preview, whatever it presses
 * (so a page of Stinger to or Cut to keys shows the tally too). Up and down keys and Fade to black light red while on
 * air, Auto while the switcher is in a transition. Every key keeps its label and says why when the switcher isn't
 * there: Studio off air, no switcher set up, or not answering (with the warning dot).
 */
export function switcherViewOf(settings: SwitcherSettings, sw: Switcher | null): SwitcherView {
	const press = pressOf(settings);
	const base = label(settings);
	const dark = (title: string, dot = false): SwitcherView => ({ state: 0, lit: TALLY.program, title, dot });
	if (!sw) return dark(`${base}\n(off air)`);
	if (!sw.setUp) return dark(`${base}\n(not set up)`);
	if (sw.state !== "connected") return dark(`${base}\n(offline)`, true);
	const on = (yes: boolean, title = base): SwitcherView => ({ state: yes ? 1 : 0, lit: TALLY.program, title, dot: false });
	if (withInput(press)) {
		const id = num(settings.input);
		if (id === null) return dark(base);
		const input = sw.inputs.find((i) => i.id === id);
		if (!input) return dark(`${base}\n(not on it)`);
		const title = press === "stinger" ? `Stinger\n${wrapTitle(input.name).split("\n")[0]}` : wrapTitle(input.name);
		if (sw.program === id) return { state: 1, lit: TALLY.program, title, dot: false };
		if (sw.preview === id) return { state: 1, lit: TALLY.preview, title, dot: false };
		return on(false, title);
	}
	if (press === "usk" || press === "dsk") {
		const n = num(settings.key);
		const keys = press === "usk" ? sw.usk : sw.dsk;
		if (n === null) return dark(base);
		if (n > keys.length) return dark(`${base}\n(not on it)`);
		return on(keys[n - 1]);
	}
	if (press === "ftb") return on(sw.ftb);
	if (press === "auto") return on(sw.inTransition);
	return on(false);
}

/** The Studio link a press opens, or null when the key isn't set up enough to press anything. */
export function switcherLinkFor(settings: SwitcherSettings): string | null {
	const press = pressOf(settings);
	const input = num(settings.input);
	switch (press) {
		case "preview":
		case "program":
			return input ? `/deck/switcher/${press}/${input}` : null;
		case "stinger":
			return input ? `/deck/switcher/stinger/${input}` : "/deck/switcher/stinger";
		case "cut":
		case "auto":
		case "ftb":
			return `/deck/switcher/${press}`;
		case "usk":
		case "dsk": {
			const n = num(settings.key);
			return n ? `/deck/switcher/${press}/${n}/${verbOf(settings)}` : null;
		}
		case "macro": {
			const n = num(settings.macro);
			return n ? `/deck/switcher/macro/${n}` : null;
		}
	}
}
