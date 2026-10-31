import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { keyImageUrl } from "../lib/colours";
import { runOrderLinkFor, type RunOrderSettings, runOrderViewOf } from "../lib/runorder-key";
import { cleanHost, feedFor, fetchScene, outputColour, outputsOf, press, type Scene } from "../lib/studio";

const logger = streamDeck.logger.createScope("RunOrder");
const log = (message: string) => logger.info(message);

type PiCommand = { cmd?: string; host?: string };
type PiPayload = Parameters<typeof streamDeck.ui.sendToPropertyInspector>[0];

/**
 * One Run order key on screen: follows its Studio's scene and redraws when the run order changes (something added,
 * played, skipped, loaded) so it always names what Play next will play.
 */
class RunOrderKey {
	private unsubscribe: (() => void) | null = null;
	private host = "";
	private drawn = "";
	private painted: string | null = null;
	scene: Scene | null = null;

	constructor(
		private key: KeyAction<RunOrderSettings>,
		private settings: RunOrderSettings,
	) {
		this.follow();
	}

	update(key: KeyAction<RunOrderSettings>, settings: RunOrderSettings): void {
		this.key = key;
		this.settings = settings;
		this.follow();
		this.draw();
	}

	private follow(): void {
		const host = cleanHost(this.settings.host);
		if (host === this.host && this.unsubscribe) return;
		this.unsubscribe?.();
		this.host = host;
		this.drawn = "";
		this.unsubscribe = feedFor(host, log).subscribe((scene) => {
			this.scene = scene;
			this.draw();
		});
	}

	private draw(): void {
		const view = runOrderViewOf(this.settings, this.scene);
		// Both states' images in the colour group; only sent again when it changes.
		const lit = outputColour(this.scene, this.settings.output);
		if (`${view.colour}|${lit}` !== this.painted) {
			this.painted = `${view.colour}|${lit}`;
			void this.key.setImage(keyImageUrl("runorder", view.colour, 0), { state: 0 });
			void this.key.setImage(keyImageUrl("runorder", view.colour, 1, false, lit), { state: 1 });
		}
		const title = this.settings.keepTitle ? undefined : view.title;
		const sig = `${view.state}|${title}`;
		if (sig === this.drawn) return;
		this.drawn = sig;
		void this.key.setState(view.state);
		void this.key.setTitle(title as string);
	}

	async press(): Promise<void> {
		const link = runOrderLinkFor(this.settings);
		if (!link) return void this.key.showAlert();
		const ok = await press(this.host, link);
		if (!ok) {
			log(`Studio at ${this.host} didn't accept ${link}`);
			void this.key.showAlert();
		}
	}

	stop(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}
}

@action({ UUID: "com.runplaywin.firstpass-studio.runorder" })
export class RunOrderAction extends SingletonAction<RunOrderSettings> {
	private readonly keys = new Map<string, RunOrderKey>();

	override onWillAppear(ev: WillAppearEvent<RunOrderSettings>): void {
		if (!ev.action.isKey()) return;
		const existing = this.keys.get(ev.action.id);
		if (existing) existing.update(ev.action, ev.payload.settings);
		else this.keys.set(ev.action.id, new RunOrderKey(ev.action, ev.payload.settings));
	}

	override onWillDisappear(ev: WillDisappearEvent<RunOrderSettings>): void {
		this.keys.get(ev.action.id)?.stop();
		this.keys.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<RunOrderSettings>): Promise<void> {
		const key = this.keys.get(ev.action.id);
		if (key) return key.press();
		// Inside a multi action there's no key on screen to follow; just press the link.
		const link = runOrderLinkFor(ev.payload.settings);
		if (!link || !(await press(cleanHost(ev.payload.settings.host), link))) void ev.action.showAlert();
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<RunOrderSettings>): void {
		if (!ev.action.isKey()) return;
		this.keys.get(ev.action.id)?.update(ev.action, ev.payload.settings);
	}

	/** The settings panel asks for the competition's saved run orders (and the outputs) to fill its lists. */
	override async onSendToPlugin(ev: SendToPluginEvent<PiCommand, RunOrderSettings>): Promise<void> {
		if (ev.payload?.cmd !== "orders") return;
		const host = cleanHost(ev.payload.host);
		const scene = await fetchScene(host);
		if (streamDeck.ui.action?.id !== ev.action.id) return;
		void streamDeck.ui.sendToPropertyInspector({
			type: "orders",
			host,
			ok: scene !== null,
			orders: (scene?.runOrders ?? []).map((o) => ({ id: o.id, name: o.name, count: o.count })),
			outputs: outputsOf(scene).map((o) => ({ id: o.id, name: o.name })),
		} as unknown as PiPayload);
	}
}
