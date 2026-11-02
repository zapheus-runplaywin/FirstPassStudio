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
import { sceneLinkFor, type SceneSettings, sceneViewOf } from "../lib/scene-key";
import { cleanHost, feedFor, fetchScene, outputMark, outputsOf, press, type Scene } from "../lib/studio";

const logger = streamDeck.logger.createScope("Scene");
const log = (message: string) => logger.info(message);

type PiCommand = { cmd?: string; host?: string };
type PiPayload = Parameters<typeof streamDeck.ui.sendToPropertyInspector>[0];

/** One Scene key on screen: follows its Studio's scene and redraws when the scenes or the current one change. */
class SceneKey {
	private unsubscribe: (() => void) | null = null;
	private host = "";
	private drawn = "";
	private painted: string | null = null;
	scene: Scene | null = null;

	constructor(
		private key: KeyAction<SceneSettings>,
		private settings: SceneSettings,
	) {
		this.follow();
	}

	update(key: KeyAction<SceneSettings>, settings: SceneSettings): void {
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
		const view = sceneViewOf(this.settings, this.scene);
		// Both states' images with the output's disc, with or without the changed dot; only sent again when those change.
		const output = outputMark(this.scene, this.settings.output);
		const paint = `${view.dot}|${output?.slot}|${output?.colour}`;
		if (paint !== this.painted) {
			this.painted = paint;
			void this.key.setImage(keyImageUrl("scene", 0, { output, dot: view.dot }), { state: 0 });
			void this.key.setImage(keyImageUrl("scene", 1, { output, dot: view.dot }), { state: 1 });
		}
		const title = this.settings.keepTitle ? undefined : view.title;
		const sig = `${view.state}|${title}`;
		if (sig === this.drawn) return;
		this.drawn = sig;
		void this.key.setState(view.state);
		void this.key.setTitle(title as string);
	}

	async press(): Promise<void> {
		const link = sceneLinkFor(this.settings);
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

@action({ UUID: "com.runplaywin.firstpass-studio.scene" })
export class SceneAction extends SingletonAction<SceneSettings> {
	private readonly keys = new Map<string, SceneKey>();

	override onWillAppear(ev: WillAppearEvent<SceneSettings>): void {
		if (!ev.action.isKey()) return;
		const existing = this.keys.get(ev.action.id);
		if (existing) existing.update(ev.action, ev.payload.settings);
		else this.keys.set(ev.action.id, new SceneKey(ev.action, ev.payload.settings));
	}

	override onWillDisappear(ev: WillDisappearEvent<SceneSettings>): void {
		this.keys.get(ev.action.id)?.stop();
		this.keys.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<SceneSettings>): Promise<void> {
		const key = this.keys.get(ev.action.id);
		if (key) return key.press();
		// Inside a multi action there's no key on screen to follow; just press the link.
		const link = sceneLinkFor(ev.payload.settings);
		if (!link || !(await press(cleanHost(ev.payload.settings.host), link))) void ev.action.showAlert();
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<SceneSettings>): void {
		if (!ev.action.isKey()) return;
		this.keys.get(ev.action.id)?.update(ev.action, ev.payload.settings);
	}

	/** The settings panel asks for the saved scenes to fill its list. */
	override async onSendToPlugin(ev: SendToPluginEvent<PiCommand, SceneSettings>): Promise<void> {
		if (ev.payload?.cmd !== "scenes") return;
		const host = cleanHost(ev.payload.host);
		const scene = await fetchScene(host);
		if (streamDeck.ui.action?.id !== ev.action.id) return;
		void streamDeck.ui.sendToPropertyInspector({
			type: "scenes",
			host,
			ok: scene !== null,
			scenes: (scene?.scenes ?? []).map((s) => ({ id: s.id, name: s.name })),
			outputs: outputsOf(scene).map((o) => ({ id: o.id, name: o.name })),
		} as unknown as PiPayload);
	}
}
