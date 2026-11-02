/**
 * What a Run order key shows and does, worked out from its settings and the scene (no SDK here). The run order is
 * tonight's queue of sequences and scenes on the Output page; the key shows what is at its head.
 */
import { wrapTitle } from "./source-key";
import { deckBase, forOutput, outputGone, type RunOrderItem, type Scene } from "./studio";

/** next = play the head (Play next), skip = drop it unplayed, load = a saved order in place of the queue, clear = empty it. */
export type RunOrderPress = "next" | "skip" | "load" | "clear";

export type RunOrderSettings = {
	/** Studio's address; empty means http://localhost:8080. */
	host?: string;
	/** What a press does; next when not set. */
	press?: RunOrderPress;
	/** The saved order's id (kept when it's renamed), for load. */
	order?: string;
	/** Its name when picked, shown while Studio is off air. */
	orderName?: string;
	/** The output whose run order it acts on (an output's id); Output 1 when not set. */
	output?: string;
	/** Leave the title alone so the one typed in Stream Deck shows. */
	keepTitle?: boolean;
};

export type RunOrderView = {
	/** 0 = dark, 1 = lit: something is queued to play next. */
	state: 0 | 1;
	title: string;
};

const PRESS: RunOrderPress[] = ["next", "skip", "load", "clear"];

export function pressOf(settings: RunOrderSettings): RunOrderPress {
	return PRESS.includes(settings.press as RunOrderPress) ? (settings.press as RunOrderPress) : "next";
}

/** The run order as this output sees it, without items that have gone (Studio drops those as it reaches them). */
export function queueOf(scene: Scene | null): RunOrderItem[] {
	return (scene?.runOrder ?? []).filter((it) => !it.gone);
}

const LABEL: Record<RunOrderPress, string> = { next: "Play next ▶", skip: "Skip ⏭", load: "Load", clear: "Clear" };

/**
 * Play next, Skip and Clear light while something is queued and name the head item (two lines), with how many more
 * wait behind it; Load names its saved order and how many items it holds. Every key says so when Studio is off air.
 */
export function runOrderViewOf(settings: RunOrderSettings, all: Scene | null): RunOrderView {
	const press = pressOf(settings);
	const scene = forOutput(all, settings.output);
	const view = (title: string, state: 0 | 1 = 0): RunOrderView => ({ state, title });
	const label = LABEL[press];
	if (press === "load") {
		if (!settings.order) return view("Pick a saved\norder");
		const name = settings.orderName || "Saved order";
		if (!scene) return view(`${wrapTitle(name)}\n(off air)`);
		if (outputGone(all, settings.output)) return view(`${wrapTitle(name)}\n(no output)`);
		const order = (scene.runOrders ?? []).find((o) => o.id === settings.order);
		if (!order) return view(`${wrapTitle(name)}\n(gone)`);
		return view(`${wrapTitle(order.name, 9).split("\n").slice(0, 2).join("\n")}\nload ${order.count}`);
	}
	if (!scene) return view(`${label}\n(off air)`);
	if (outputGone(all, settings.output)) return view(`${label}\n(no output)`);
	const queue = queueOf(scene);
	const head = queue[0];
	if (!head) return view(`${label}\n(empty)`);
	const more = queue.length - 1;
	const name = wrapTitle(head.name, 9).split("\n").slice(0, 2).join("\n");
	return view(`${label}\n${name}${more ? `\n+${more} more` : ""}`, 1);
}

/** The Studio link a press opens. */
export function runOrderLinkFor(settings: RunOrderSettings): string | null {
	const press = pressOf(settings);
	if (press === "load") return settings.order ? `${deckBase(settings.output)}/runorder/load/${encodeURIComponent(settings.order)}` : null;
	return `${deckBase(settings.output)}/runorder/${press}`;
}
