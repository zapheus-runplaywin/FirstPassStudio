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
import { sequenceLinkFor, type SequenceSettings, sequenceViewOf } from "../lib/sequence-key";
import { cleanHost, feedFor, fetchScene, outputColour, outputsOf, press, type Scene } from "../lib/studio";

const logger = streamDeck.logger.createScope("Sequence");
const log = (message: string) => logger.info(message);

type PiCommand = { cmd?: string; host?: string };
type PiPayload = Parameters<typeof streamDeck.ui.sendToPropertyInspector>[0];

/**
 * One Sequence key on screen: follows its Studio's scene and redraws when a sequence starts, moves on or stops.
 * While the title shows a time left, it redraws each second, counting down from when Studio last sent the scene.
 */
class SequenceKey {
	private unsubscribe: (() => void) | null = null;
	private host = "";
	private drawn = "";
	private painted: string | null = null;
	private heardAt = 0;
	private ticker: ReturnType<typeof setInterval> | null = null;
	scene: Scene | null = null;

	constructor(
		private key: KeyAction<SequenceSettings>,
		private settings: SequenceSettings,
	) {
		this.follow();
	}

	update(key: KeyAction<SequenceSettings>, settings: SequenceSettings): void {
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
			this.heardAt = Date.now();
			this.draw();
		});
	}

	private draw(): void {
		const view = sequenceViewOf(this.settings, this.scene, Date.now() - this.heardAt);
		if (view.ticking && !this.ticker) this.ticker = setInterval(() => this.draw(), 250);
		if (!view.ticking && this.ticker) {
			clearInterval(this.ticker);
			this.ticker = null;
		}
		// Both states' images in the colour group; only sent again when it changes.
		const lit = outputColour(this.scene, this.settings.output);
		if (`${view.colour}|${lit}` !== this.painted) {
			this.painted = `${view.colour}|${lit}`;
			void this.key.setImage(keyImageUrl("sequence", view.colour, 0), { state: 0 });
			void this.key.setImage(keyImageUrl("sequence", view.colour, 1, false, lit), { state: 1 });
		}
		const title = this.settings.keepTitle ? undefined : view.title;
		const sig = `${view.state}|${title}`;
		if (sig === this.drawn) return;
		this.drawn = sig;
		void this.key.setState(view.state);
		void this.key.setTitle(title as string);
	}

	async press(): Promise<void> {
		const link = sequenceLinkFor(this.settings);
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
		if (this.ticker) clearInterval(this.ticker);
		this.ticker = null;
	}
}

@action({ UUID: "com.runplaywin.firstpass-studio.sequence" })
export class SequenceAction extends SingletonAction<SequenceSettings> {
	private readonly keys = new Map<string, SequenceKey>();

	override onWillAppear(ev: WillAppearEvent<SequenceSettings>): void {
		if (!ev.action.isKey()) return;
		const existing = this.keys.get(ev.action.id);
		if (existing) existing.update(ev.action, ev.payload.settings);
		else this.keys.set(ev.action.id, new SequenceKey(ev.action, ev.payload.settings));
	}

	override onWillDisappear(ev: WillDisappearEvent<SequenceSettings>): void {
		this.keys.get(ev.action.id)?.stop();
		this.keys.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<SequenceSettings>): Promise<void> {
		const key = this.keys.get(ev.action.id);
		if (key) return key.press();
		// Inside a multi action there's no key on screen to follow; just press the link.
		const link = sequenceLinkFor(ev.payload.settings);
		if (!link || !(await press(cleanHost(ev.payload.settings.host), link))) void ev.action.showAlert();
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<SequenceSettings>): void {
		if (!ev.action.isKey()) return;
		this.keys.get(ev.action.id)?.update(ev.action, ev.payload.settings);
	}

	/** The settings panel asks for the competition's sequences to fill its list. */
	override async onSendToPlugin(ev: SendToPluginEvent<PiCommand, SequenceSettings>): Promise<void> {
		if (ev.payload?.cmd !== "sequences") return;
		const host = cleanHost(ev.payload.host);
		const scene = await fetchScene(host);
		if (streamDeck.ui.action?.id !== ev.action.id) return;
		void streamDeck.ui.sendToPropertyInspector({
			type: "sequences",
			host,
			ok: scene !== null,
			sequences: (scene?.sequences ?? []).map((s) => ({ id: s.id, name: s.name, colour: s.colour ?? "blue" })),
			outputs: outputsOf(scene).map((o) => ({ id: o.id, name: o.name })),
		} as unknown as PiPayload);
	}
}
