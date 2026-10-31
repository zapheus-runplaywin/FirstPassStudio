/**
 * Colour groups for keys, so a page of keys can be sorted by the part of the stream they belong to.
 * Every key keeps the same two looks: a dark body while it's off, and its output's colour while it's on (Output 1
 * orange, 2 pink, 3 blue, 4 green, as on Studio's Output page; the manifest makes the title black on it). The band
 * along the bottom carries the group's colour in both, so a lit key still shows which group it's in.
 * Source, Scene, Sequence and Switcher keys each add their own faint picture and band shape on top (see keyImage).
 * Switcher keys light in the switcher's tally colours instead: red on program (or on air), green on preview.
 */

export type ColourGroup = "blue" | "green" | "grey" | "yellow" | "purple";

export type Colours = {
	/** Shown in the settings panel. */
	label: string;
	/** The key's body while its source is off: dark, so the white title reads and the lit colour stands out. */
	off: string;
	/** The band along the bottom, off and on. */
	band: string;
};

/** Body of a lit key for Output 1 (orange), and for any key when Studio doesn't say its output's colour. */
export const ON = "#ea9a38";

/** Each output's colour by its number (Studio's outputs.js COLOURS): the body of a lit key for that output. */
export const OUTPUT_COLOURS = ["#ea9a38", "#f24f91", "#4ec1e6", "#95ba45"];

/** In the order the settings panel lists them; blue first as the default. */
export const GROUPS: Record<ColourGroup, Colours> = {
	blue: { label: "Blue: live stream", off: "#0f172a", band: "#3b82f6" },
	green: { label: "Green: pre-game", off: "#0b3a1e", band: "#22c55e" },
	grey: { label: "Grey: post-game", off: "#3f3f46", band: "#a1a1aa" },
	yellow: { label: "Yellow: ads", off: "#4a3b00", band: "#facc15" },
	purple: { label: "Purple: quarter time", off: "#3b0764", band: "#a855f7" },
};

export function groupOf(colour?: string): ColourGroup {
	return colour && Object.hasOwn(GROUPS, colour) ? (colour as ColourGroup) : "blue";
}

/** A Switcher key's lit body: red for program and anything on air, green for preview, as on the switcher's own panel. */
export const TALLY = { program: "#ff4d4d", preview: "#22c55e" } as const;

/** The dot a Scene key shows in its top corner while sources differ from the scene as saved (a Switcher key: while the switcher isn't answering). */
export const DOT = "#facc15";

/** The six kinds of key. Each draws its own picture and band, so they can be told apart across a page. */
export type KeyKind = "source" | "scene" | "sequence" | "switcher" | "playback" | "runorder";

/**
 * The big faint picture behind a key's title: an eye for a Source (shows or hides one thing), stacked layers for
 * a Scene (a set of sources), a play button for a Sequence (plays in order), a camera for a Switcher key, play and
 * pause together for a Replay key (a recorded game played back), and a list with a play button at its head for a Run
 * order key (what plays next tonight). White at low opacity so the title still reads over it, on every dark body and
 * every lit colour.
 */
const PICTURE: Record<KeyKind, string> = {
	source:
		`<path d="M18 60Q72 6 126 60Q72 114 18 60Z" fill="none" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>` +
		`<circle cx="72" cy="60" r="19" fill="#fff"/>`,
	scene:
		`<path d="M72 14L124 40L72 66L20 40Z" fill="#fff"/>` +
		`<path d="M20 62L72 88L124 62M20 82L72 108L124 82" fill="none" stroke="#fff" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>`,
	sequence: `<path d="M44 16L112 60L44 104Z" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>`,
	switcher: `<rect x="14" y="34" width="84" height="56" rx="10" fill="#fff"/>` + `<path d="M104 52L130 36V88L104 72Z" fill="#fff"/>`,
	playback:
		`<path d="M20 22L76 60L20 98Z" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>` +
		`<rect x="90" y="22" width="14" height="76" rx="3" fill="#fff"/><rect x="114" y="22" width="14" height="76" rx="3" fill="#fff"/>`,
	runorder:
		`<path d="M18 16L46 32L18 48Z" fill="#fff"/><rect x="58" y="24" width="68" height="14" rx="5" fill="#fff"/>` +
		`<circle cx="30" cy="66" r="8" fill="#fff"/><rect x="58" y="59" width="68" height="14" rx="5" fill="#fff"/>` +
		`<circle cx="30" cy="100" r="8" fill="#fff"/><rect x="58" y="93" width="68" height="14" rx="5" fill="#fff"/>`,
};

/**
 * The band along the bottom in the group's colour: one solid strip for a Source, the same with a frame up the
 * sides and over the top for a Scene (a whole screen), four steps with gaps for a Sequence, two halves for a
 * Switcher key (program and preview), a timeline with its playhead for a Replay key, and a queue for a Run order key:
 * the head block full height, the ones behind it lower.
 */
function band(kind: KeyKind, colour: string): string {
	if (kind === "runorder")
		return (
			`<rect y="124" width="144" height="20" fill="#000" fill-opacity="0.35"/>` +
			`<rect y="124" width="33" height="20" fill="${colour}"/>` +
			[1, 2, 3].map((i) => `<rect x="${i * 37}" y="131" width="33" height="13" fill="${colour}"/>`).join("")
		);
	if (kind === "playback")
		return (
			`<rect y="124" width="144" height="20" fill="#000" fill-opacity="0.35"/>` +
			`<rect y="130" width="144" height="8" fill="${colour}"/><rect x="58" y="124" width="10" height="20" fill="${colour}"/>`
		);
	if (kind === "switcher")
		return (
			`<rect y="124" width="144" height="20" fill="#000" fill-opacity="0.35"/>` +
			`<rect y="124" width="69" height="20" fill="${colour}"/><rect x="75" y="124" width="69" height="20" fill="${colour}"/>`
		);
	if (kind === "sequence")
		return (
			`<rect y="124" width="144" height="20" fill="#000" fill-opacity="0.35"/>` +
			[0, 1, 2, 3].map((i) => `<rect x="${i * 37}" y="124" width="33" height="20" fill="${colour}"/>`).join("")
		);
	const strip = `<rect y="124" width="144" height="20" fill="${colour}"/>`;
	if (kind === "source") return strip;
	return `<path d="M0 0H144V124H138V6H6V124H0Z" fill="${colour}"/>` + strip;
}

/**
 * The key image for a kind, group and state, as an SVG Stream Deck draws at the key's own size. A thin dark line
 * sits between the body and the band so the band keeps its edge against the lit colour. dot adds the
 * changed dot, ringed in navy so it shows on every lit colour and every dark body. lit: the body while on, the
 * key's output's colour.
 */
export function keyImage(kind: KeyKind, colour: string | undefined, state: 0 | 1, dot = false, lit = ON): string {
	const g = GROUPS[groupOf(colour)];
	const body = state ? (/^#[0-9a-f]{6}$/i.test(lit) ? lit : ON) : g.off;
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
		`<rect width="144" height="144" fill="${body}"/>` +
		`<g opacity="${state ? 0.26 : 0.2}">${PICTURE[kind]}</g>` +
		`<rect y="120" width="144" height="4" fill="#000" fill-opacity="0.35"/>` +
		band(kind, g.band) +
		(dot ? `<circle cx="124" cy="20" r="11" fill="${DOT}" stroke="#0f172a" stroke-width="4"/>` : "") +
		`</svg>`
	);
}

/**
 * The key image as Stream Deck's setImage takes an SVG: a data URL. Sent as a bare SVG string, the app ignores it
 * and the key keeps the manifest's blue image.
 */
export function keyImageUrl(kind: KeyKind, colour: string | undefined, state: 0 | 1, dot = false, lit = ON): string {
	return `data:image/svg+xml,${encodeURIComponent(keyImage(kind, colour, state, dot, lit))}`;
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
