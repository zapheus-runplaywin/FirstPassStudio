/**
 * Colour groups for Source keys, so a page of keys can be sorted by the part of the stream they belong to.
 * Every key keeps the same two looks: a dark body while its source is off, and orange while it's on. The band
 * along the bottom carries the group's colour in both, so a lit key still shows which group it's in.
 */

export type ColourGroup = "blue" | "green" | "grey" | "yellow" | "purple";

export type Colours = {
	/** Shown in the settings panel. */
	label: string;
	/** The key's body while its source is off: dark, so the white title reads and the orange "on" stands out. */
	off: string;
	/** The band along the bottom, off and on. */
	band: string;
};

/** Orange body of a lit key, the same for every group. */
export const ON = "#f75c03";

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

/**
 * The key image for a group and state, as an SVG Stream Deck draws at the key's own size. A thin dark line
 * sits between the body and the band so the band keeps its edge against the orange.
 */
export function keyImage(colour: string | undefined, state: 0 | 1): string {
	const g = GROUPS[groupOf(colour)];
	const body = state ? ON : g.off;
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
		`<rect width="144" height="144" fill="${body}"/>` +
		`<rect y="120" width="144" height="4" fill="#000" fill-opacity="0.35"/>` +
		`<rect y="124" width="144" height="20" fill="${g.band}"/>` +
		`</svg>`
	);
}

/**
 * The key image as Stream Deck's setImage takes an SVG: a data URL. Sent as a bare SVG string, the app ignores it
 * and the key keeps the manifest's blue image.
 */
export function keyImageUrl(colour: string | undefined, state: 0 | 1): string {
	return `data:image/svg+xml,${encodeURIComponent(keyImage(colour, state))}`;
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
