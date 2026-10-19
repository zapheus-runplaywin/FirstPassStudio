/**
 * What a Source key shows and does, worked out from its settings and the scene (no SDK here).
 */
import type { Scene, SceneSource } from "./studio";

export type PressAction = "toggle" | "on" | "off" | "restart" | "sound";

export type SourceSettings = {
	/** Studio's address; empty means http://localhost:8080. */
	host?: string;
	/** The source's id in the scene (kept when it's renamed). */
	source?: string;
	/** Its name when picked, shown while Studio is off air. */
	sourceName?: string;
	/** What a press does; toggle when not set. */
	press?: PressAction;
	/** Leave the title alone so the one typed in Stream Deck shows. */
	keepTitle?: boolean;
};

export type KeyView = {
	/** 0 = off, 1 = on (lit). */
	state: 0 | 1;
	title: string;
};

const PRESS: PressAction[] = ["toggle", "on", "off", "restart", "sound"];

export function pressOf(settings: SourceSettings): PressAction {
	return PRESS.includes(settings.press as PressAction) ? (settings.press as PressAction) : "toggle";
}

export function findSource(scene: Scene | null, id?: string): SceneSource | undefined {
	return id ? scene?.sources.find((s) => s.id === id) : undefined;
}

/** Breaks a name over up to three short lines so it fits on a key. */
export function wrapTitle(name: string, width = 9): string {
	const lines: string[] = [];
	let line = "";
	for (const word of name.trim().split(/\s+/)) {
		if (line && (line + " " + word).length > width) {
			lines.push(line);
			line = word;
		} else line = line ? `${line} ${word}` : word;
	}
	if (line) lines.push(line);
	return lines.slice(0, 3).join("\n");
}

/**
 * The key lights while its source is on (for a sound key, while the video's sound is on).
 * The title is the source's name; it says so when Studio is off air or the source has gone.
 */
export function viewOf(settings: SourceSettings, scene: Scene | null): KeyView {
	if (!settings.source) return { state: 0, title: "Pick a\nsource" };
	const name = settings.sourceName || "Source";
	if (!scene) return { state: 0, title: `${wrapTitle(name)}\n(off air)` };
	const src = findSource(scene, settings.source);
	if (!src) return { state: 0, title: `${wrapTitle(name)}\n(gone)` };
	if (pressOf(settings) === "sound") {
		return { state: src.sound ? 1 : 0, title: `${wrapTitle(src.name)}\n${src.sound ? "🔊" : "🔇"}` };
	}
	return { state: src.visible ? 1 : 0, title: wrapTitle(src.name) };
}

/** The Studio link a press opens. */
export function linkFor(settings: SourceSettings): string | null {
	if (!settings.source) return null;
	const ref = encodeURIComponent(settings.source);
	const action = pressOf(settings);
	return action === "sound" ? `/deck/layer/${ref}/sound/toggle` : `/deck/layer/${ref}/${action}`;
}
