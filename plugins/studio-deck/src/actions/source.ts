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
import { linkFor, type SourceSettings, viewOf } from "../lib/source-key";
import { cleanHost, feedFor, fetchScene, outputColour, outputsOf, press, type Scene } from "../lib/studio";

const logger = streamDeck.logger.createScope("Source");
const log = (message: string) => logger.info(message);

type PiCommand = { cmd?: string; host?: string };
type PiPayload = Parameters<typeof streamDeck.ui.sendToPropertyInspector>[0];

/** One Source key on screen: follows its Studio's scene and redraws when the source changes. */
class SourceKey {
	private unsubscribe: (() => void) | null = null;
	private host = "";
	private drawn = "";
	private painted: string | null = null;
	scene: Scene | null = null;

	constructor(
		private key: KeyAction<SourceSettings>,
		private settings: SourceSettings,
	) {
		this.follow();
	}

	update(key: KeyAction<SourceSettings>, settings: SourceSettings): void {
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
		this.paint();
		const view = viewOf(this.settings, this.scene);
		const title = this.settings.keepTitle ? undefined : view.title;
		const sig = `${view.state}|${title}`;
		if (sig === this.drawn) return;
		this.drawn = sig;
		void this.key.setState(view.state);
		// Without a title of ours, Stream Deck shows the one typed in its own Title box.
		void this.key.setTitle(title as string);
	}

	/** Both states' images in the key's colour group, lit in its output's colour; only sent again when those change. */
	private paint(): void {
		const colour = this.settings.colour ?? "";
		const lit = outputColour(this.scene, this.settings.output);
		if (`${colour}|${lit}` === this.painted) return;
		this.painted = `${colour}|${lit}`;
		void this.key.setImage(keyImageUrl("source", colour, 0), { state: 0 });
		void this.key.setImage(keyImageUrl("source", colour, 1, false, lit), { state: 1 });
	}

	async press(): Promise<void> {
		const link = linkFor(this.settings);
		if (!link) return void this.key.showAlert();
		const ok = await press(this.host, link);
		if (!ok) {
			log(`Studio at ${this.host} didn't accept ${link}`);
			void this.key.showAlert();
		}
		// No change drawn here: the scene's next update (straight after a press) lights or dims the key.
	}

	stop(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}
}

@action({ UUID: "com.runplaywin.firstpass-studio.source" })
export class SourceAction extends SingletonAction<SourceSettings> {
	private readonly keys = new Map<string, SourceKey>();

	override onWillAppear(ev: WillAppearEvent<SourceSettings>): void {
		if (!ev.action.isKey()) return;
		const existing = this.keys.get(ev.action.id);
		if (existing) existing.update(ev.action, ev.payload.settings);
		else this.keys.set(ev.action.id, new SourceKey(ev.action, ev.payload.settings));
	}

	override onWillDisappear(ev: WillDisappearEvent<SourceSettings>): void {
		// Off screen keys stop following, so a page of keys nobody can see makes no connection.
		this.keys.get(ev.action.id)?.stop();
		this.keys.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<SourceSettings>): Promise<void> {
		const key = this.keys.get(ev.action.id);
		if (key) return key.press();
		// Inside a multi action there's no key on screen to follow; just press the link.
		const link = linkFor(ev.payload.settings);
		if (!link || !(await press(cleanHost(ev.payload.settings.host), link))) void ev.action.showAlert();
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<SourceSettings>): void {
		if (!ev.action.isKey()) return;
		this.keys.get(ev.action.id)?.update(ev.action, ev.payload.settings);
	}

	/** The settings panel asks for the scene's sources to fill its list. */
	override async onSendToPlugin(ev: SendToPluginEvent<PiCommand, SourceSettings>): Promise<void> {
		if (ev.payload?.cmd !== "sources") return;
		const host = cleanHost(ev.payload.host);
		const scene = await fetchScene(host);
		if (streamDeck.ui.action?.id !== ev.action.id) return;
		void streamDeck.ui.sendToPropertyInspector({
			type: "sources",
			host,
			ok: scene !== null,
			sources: (scene?.sources ?? []).map((s) => ({ id: s.id, name: s.name, type: s.type })),
			outputs: outputsOf(scene).map((o) => ({ id: o.id, name: o.name })),
		} as unknown as PiPayload);
	}
}
