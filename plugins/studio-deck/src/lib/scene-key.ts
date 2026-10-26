/**
 * What a Scene key shows and does, worked out from its settings and the scene (no SDK here).
 */
import { wrapTitle } from "./source-key";
import { deckBase, forOutput, outputGone, type SavedScene, type Scene } from "./studio";

export type ScenePress = "go" | "next" | "prev" | "again";

export type SceneSettings = {
	/** Studio's address; empty means http://localhost:8080. */
	host?: string;
	/** The scene's id (kept when it's renamed), for "go". */
	scene?: string;
	/** Its name when picked, shown while Studio is off air. */
	sceneName?: string;
	/** What a press does; go when not set. */
	press?: ScenePress;
	/** The output it plays the scene on (an output's id); Output 1 when not set. */
	output?: string;
	/** Colour group; empty means the scene's own colour from the Output page. */
	colour?: string;
	/** Leave the title alone so the one typed in Stream Deck shows. */
	keepTitle?: boolean;
};

export type SceneView = {
	/** 0 = dark, 1 = lit (in its output's colour): the key's scene is the current one. */
	state: 0 | 1;
	title: string;
	/** Draw the changed dot: sources differ from the current scene as saved. */
	dot: boolean;
	/** The colour group to draw it in. */
	colour: string;
};

const PRESS: ScenePress[] = ["go", "next", "prev", "again"];

export function pressOf(settings: SceneSettings): ScenePress {
	return PRESS.includes(settings.press as ScenePress) ? (settings.press as ScenePress) : "go";
}

const scenesOf = (scene: Scene | null): SavedScene[] => scene?.scenes ?? [];
const currentOf = (scene: Scene | null): SavedScene | undefined => scenesOf(scene).find((s) => s.id === scene?.current);
const isChanged = (scene: Scene | null): boolean => !!currentOf(scene) && (scene?.changed?.length ?? 0) > 0;

/** Where Next or Previous goes: in the Output page's order, stopping at the ends; from no scene, the first or the last. */
export function stepTarget(scene: Scene | null, press: "next" | "prev"): SavedScene | undefined {
	const list = scenesOf(scene);
	const cur = currentOf(scene);
	if (!cur) return press === "next" ? list[0] : list[list.length - 1];
	return list[list.indexOf(cur) + (press === "next" ? 1 : -1)];
}

/**
 * A "go" key lights while its scene is the current one, with the dot when something's changed since.
 * Next and Previous show where they'll go; Back to saved shows the scene it puts back, with the dot when there's
 * something to put back. Every key says so when Studio is off air.
 */
export function sceneViewOf(settings: SceneSettings, all: Scene | null): SceneView {
	const press = pressOf(settings);
	const scene = forOutput(all, settings.output);
	const own = settings.colour || "";
	const view = (title: string, target?: SavedScene, state: 0 | 1 = 0, dot = false): SceneView => ({
		state,
		title,
		dot,
		colour: own || target?.colour || "blue",
	});
	if (press === "go") {
		if (!settings.scene) return view("Pick a\nscene");
		const name = settings.sceneName || "Scene";
		if (!scene) return view(`${wrapTitle(name)}\n(off air)`);
		if (outputGone(all, settings.output)) return view(`${wrapTitle(name)}\n(no output)`);
		const sc = scenesOf(scene).find((s) => s.id === settings.scene);
		if (!sc) return view(`${wrapTitle(name)}\n(gone)`);
		const current = scene.current === sc.id;
		return view(wrapTitle(sc.name), sc, current ? 1 : 0, current && isChanged(scene));
	}
	const label = { next: "Next", prev: "Previous", again: "Back to saved" }[press];
	if (!scene) return view(`${label}\n(off air)`);
	if (outputGone(all, settings.output)) return view(`${label}\n(no output)`);
	if (press === "again") {
		const cur = currentOf(scene);
		return cur ? view(`Back to\n${wrapTitle(cur.name)}`, cur, 0, isChanged(scene)) : view("Back to\nsaved\n(no scene)");
	}
	const target = stepTarget(scene, press);
	const arrow = press === "next" ? "▶" : "◀";
	if (!target) return view(scenesOf(scene).length ? `${arrow}\n(${press === "next" ? "last" : "first"})` : `${label}\n(no scenes)`);
	return view(`${arrow}\n${wrapTitle(target.name)}`, target);
}

/** The Studio link a press opens. */
export function sceneLinkFor(settings: SceneSettings): string | null {
	const press = pressOf(settings);
	const base = deckBase(settings.output);
	if (press !== "go") return `${base}/scene/${press}`;
	return settings.scene ? `${base}/scene/${encodeURIComponent(settings.scene)}` : null;
}
