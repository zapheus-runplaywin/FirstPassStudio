/**
 * How keys look. Colour says what kind of key it is, so a page of keys sorts itself by job: Sources teal, Scenes blue,
 * Sequences purple, Run order yellow, Switcher (ATEM) red, Replay grey, and a Source key that turns a video's sound on
 * and off pink. Each kind is dark in its colour while it's off and lit in its full colour while it's on (the manifest
 * makes the title black on it); a Switcher key lights in the switcher's tally colours instead: red on program (or on
 * air), green on preview.
 *
 * Which output a key acts on is the numbered disc in its top right corner, in that output's colour (Output 1 orange,
 * 2 pink, 3 blue, 4 green, as on Studio's Output page). Switcher and Replay keys have none: they act on the switcher
 * and the replay, not an output. The kind's picture sits in the top left, and the title along the bottom.
 */

/** The seven kinds of key. A Source key that turns a video's sound on and off is a "sound" key. */
export type KeyKind = "source" | "sound" | "scene" | "sequence" | "runorder" | "switcher" | "playback";

export type KindColours = {
	/** What the kind is called in the docs. */
	label: string;
	/** The body while off: dark, so the white title reads and the lit colour stands out. */
	off: string;
	/** The body while on (black title), and the picture's colour while off. */
	on: string;
};

export const KINDS: Record<KeyKind, KindColours> = {
	source: { label: "Source", off: "#0b3533", on: "#14b8a6" },
	sound: { label: "Sound", off: "#3a1440", on: "#e879f9" },
	scene: { label: "Scene", off: "#0f2147", on: "#3b82f6" },
	sequence: { label: "Sequence", off: "#2e1350", on: "#b07cf7" },
	runorder: { label: "Run order", off: "#3d3305", on: "#facc15" },
	switcher: { label: "Switcher", off: "#3b1010", on: "#ff4d4d" },
	playback: { label: "Replay", off: "#2a2a2e", on: "#a1a1aa" },
};

/** Each output's colour by its number (Studio's outputs.js COLOURS): the disc on a key for that output. */
export const OUTPUT_COLOURS = ["#ea9a38", "#f24f91", "#4ec1e6", "#95ba45"];

/** The output a key acts on, as its disc shows it: the output's number and colour. */
export type OutputMark = { slot: number; colour: string };

/** A Switcher key's lit body: red for program and anything on air, green for preview, as on the switcher's own panel. */
export const TALLY = { program: "#ff4d4d", preview: "#22c55e" } as const;

/** The dot a Scene key shows at its top while sources differ from the scene as saved (a Switcher key: while the switcher isn't answering). */
export const DOT = "#facc15";

/**
 * The kind's picture, drawn in a 36 by 36 box: an eye for a Source (shows or hides one thing), a speaker for a sound
 * key, stacked layers for a Scene (a set of sources), a film strip for a Sequence (steps in order), a numbered list for
 * a Run order key (what plays next tonight), a camera for a Switcher key and a replay arrow for a Replay key.
 */
export function picture(kind: KeyKind, c: string): string {
	switch (kind) {
		case "source":
			return `<path d="M2 18Q18 3 34 18Q18 33 2 18Z" fill="none" stroke="${c}" stroke-width="3.5" stroke-linejoin="round"/><circle cx="18" cy="18" r="6" fill="${c}"/>`;
		case "sound":
			return `<path d="M3 13H10L19 5V31L10 23H3Z" fill="${c}"/><path d="M24 11Q29 18 24 25M28 7Q36 18 28 29" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
		case "scene":
			return `<path d="M18 3L33 11L18 19L3 11Z" fill="${c}"/><path d="M3 18L18 26L33 18M3 25L18 33L33 25" fill="none" stroke="${c}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
		case "sequence":
			// A strip with three frames cut out of it, so the body shows through.
			return `<path fill-rule="evenodd" fill="${c}" d="M4 7H32A3 3 0 0 1 35 10V26A3 3 0 0 1 32 29H4A3 3 0 0 1 1 26V10A3 3 0 0 1 4 7Z${[4, 15, 26].map((x) => `M${x} 12H${x + 8}V24H${x}Z`).join("")}"/>`;
		case "runorder":
			return (
				`<path d="M2 4L10 8.5L2 13Z" fill="${c}"/>` +
				`<circle cx="6" cy="20" r="3" fill="${c}"/><circle cx="6" cy="31" r="3" fill="${c}"/>` +
				[5, 17, 28].map((y) => `<rect x="14" y="${y}" width="21" height="6" rx="2" fill="${c}"/>`).join("")
			);
		case "switcher":
			return `<rect x="1" y="9" width="23" height="18" rx="3" fill="${c}"/><path d="M26 14L35 9V27L26 22Z" fill="${c}"/>`;
		case "playback":
			return (
				`<path d="M9 9A12 12 0 1 1 6 23" fill="none" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>` +
				`<path d="M3 3L12 4L6 12Z" fill="${c}"/><path d="M15 12L24 18L15 24Z" fill="${c}"/>`
			);
	}
}

/** The digits 1 to 4 as strokes, centred on (0, 0), so the disc needs no font. */
const DIGITS: Record<number, string> = {
	1: "M-5 -8L1 -13V13",
	2: "M-7 -6Q-7 -13 0 -13Q7 -13 7 -6Q7 -1 0 4L-7 13H8",
	3: "M-7 -10Q-4 -13 0 -13Q7 -13 7 -6.5Q7 0 -1 0Q7 0 7 6.5Q7 13 0 13Q-4 13 -7 10",
	4: "M4 13V-13L-8 6H9",
};

/** The output's disc in the top right corner: its colour, ringed in black so it shows on every body, with its number. */
function disc(o: OutputMark): string {
	const colour = /^#[0-9a-f]{6}$/i.test(o.colour) ? o.colour : OUTPUT_COLOURS[0];
	const digit = DIGITS[o.slot];
	return (
		`<circle cx="112" cy="32" r="22" fill="${colour}" stroke="#000" stroke-width="4"/>` +
		(digit
			? `<path transform="translate(112 32)" d="${digit}" fill="none" stroke="#000" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`
			: "")
	);
}

export type KeyLook = {
	/** The output it acts on, for the disc; none for a Switcher or Replay key. */
	output?: OutputMark | null;
	/** The yellow dot at the top: a scene changed since saved, or the switcher not answering. */
	dot?: boolean;
	/** A Switcher key's lit body (its tally colour); every other kind lights in its own colour. */
	lit?: string;
};

/**
 * The key image for a kind and state, as an SVG Stream Deck draws at the key's own size. Stream Deck draws the
 * title over it, along the bottom.
 */
export function keyImage(kind: KeyKind, state: 0 | 1, look: KeyLook = {}): string {
	const k = KINDS[kind];
	const lit = kind === "switcher" && look.lit && /^#[0-9a-f]{6}$/i.test(look.lit) ? look.lit : k.on;
	const body = state ? lit : k.off;
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
		`<rect width="144" height="144" fill="${body}"/>` +
		`<g transform="translate(12 12) scale(1.1)">${picture(kind, state ? "#000" : k.on)}</g>` +
		(look.output ? disc(look.output) : "") +
		(look.dot ? `<circle cx="72" cy="26" r="10" fill="${DOT}" stroke="#000" stroke-width="4"/>` : "") +
		`</svg>`
	);
}

/**
 * The key image as Stream Deck's setImage takes an SVG: a data URL. Sent as a bare SVG string, the app ignores it
 * and the key keeps the manifest's image.
 */
export function keyImageUrl(kind: KeyKind, state: 0 | 1, look: KeyLook = {}): string {
	return `data:image/svg+xml,${encodeURIComponent(keyImage(kind, state, look))}`;
}

/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrast(a: string, b: string): number {
	const lum = (hex: string) => {
		const [r, g, b] = [1, 3, 5].map((i) => {
			const c = parseInt(hex.slice(i, i + 2), 16) / 255;
			return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}
