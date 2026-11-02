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
import { switcherLinkFor, type SwitcherSettings, switcherViewOf } from "../lib/switcher-key";
import { cleanHost, fetchSwitcher, press, type Switcher, switcherFeedFor } from "../lib/studio";

const logger = streamDeck.logger.createScope("Switcher");
const log = (message: string) => logger.info(message);

type PiCommand = { cmd?: string; host?: string };
type PiPayload = Parameters<typeof streamDeck.ui.sendToPropertyInspector>[0];

/** One Switcher key on screen: follows its Studio's switcher and redraws when the tally or keys change. */
class SwitcherKey {
	private unsubscribe: (() => void) | null = null;
	private host = "";
	private drawn = "";
	private painted: string | null = null;
	switcher: Switcher | null = null;

	constructor(
		private key: KeyAction<SwitcherSettings>,
		private settings: SwitcherSettings,
	) {
		this.follow();
	}

	update(key: KeyAction<SwitcherSettings>, settings: SwitcherSettings): void {
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
		this.unsubscribe = switcherFeedFor(host, log).subscribe((sw) => {
			this.switcher = sw;
			this.draw();
		});
	}

	private draw(): void {
		const view = switcherViewOf(this.settings, this.switcher);
		// The lit image is in the tally colour (red or green), so it's sent again when that changes, not on every cut.
		const paint = `${view.dot}|${view.lit}`;
		if (paint !== this.painted) {
			this.painted = paint;
			void this.key.setImage(keyImageUrl("switcher", 0, { dot: view.dot }), { state: 0 });
			void this.key.setImage(keyImageUrl("switcher", 1, { dot: view.dot, lit: view.lit }), { state: 1 });
		}
		const title = this.settings.keepTitle ? undefined : view.title;
		const sig = `${view.state}|${title}`;
		if (sig === this.drawn) return;
		this.drawn = sig;
		void this.key.setState(view.state);
		void this.key.setTitle(title as string);
	}

	async press(): Promise<void> {
		const link = switcherLinkFor(this.settings);
		if (!link) return void this.key.showAlert();
		// Studio refuses a press while the switcher isn't answering (nothing is saved up for later): the key says so.
		const ok = await press(this.host, link);
		if (!ok) {
			log(`Studio at ${this.host} didn't do ${link}`);
			void this.key.showAlert();
		}
	}

	stop(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}
}

@action({ UUID: "com.runplaywin.firstpass-studio.switcher" })
export class SwitcherAction extends SingletonAction<SwitcherSettings> {
	private readonly keys = new Map<string, SwitcherKey>();

	override onWillAppear(ev: WillAppearEvent<SwitcherSettings>): void {
		if (!ev.action.isKey()) return;
		const existing = this.keys.get(ev.action.id);
		if (existing) existing.update(ev.action, ev.payload.settings);
		else this.keys.set(ev.action.id, new SwitcherKey(ev.action, ev.payload.settings));
	}

	override onWillDisappear(ev: WillDisappearEvent<SwitcherSettings>): void {
		this.keys.get(ev.action.id)?.stop();
		this.keys.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<SwitcherSettings>): Promise<void> {
		const key = this.keys.get(ev.action.id);
		if (key) return key.press();
		// Inside a multi action there's no key on screen to follow; just press the link.
		const link = switcherLinkFor(ev.payload.settings);
		if (!link || !(await press(cleanHost(ev.payload.settings.host), link))) void ev.action.showAlert();
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<SwitcherSettings>): void {
		if (!ev.action.isKey()) return;
		this.keys.get(ev.action.id)?.update(ev.action, ev.payload.settings);
	}

	/** The settings panel asks for the switcher's inputs and keys to fill its lists. */
	override async onSendToPlugin(ev: SendToPluginEvent<PiCommand, SwitcherSettings>): Promise<void> {
		if (ev.payload?.cmd !== "switcher") return;
		const host = cleanHost(ev.payload.host);
		const sw = await fetchSwitcher(host);
		if (streamDeck.ui.action?.id !== ev.action.id) return;
		void streamDeck.ui.sendToPropertyInspector({
			type: "switcher",
			host,
			ok: sw !== null,
			setUp: !!sw?.setUp,
			connected: sw?.state === "connected",
			model: sw?.model ?? "",
			inputs: (sw?.inputs ?? []).map((i) => ({ id: i.id, name: i.name })),
			usk: sw?.usk.length ?? 0,
			dsk: sw?.dsk.length ?? 0,
		} as unknown as PiPayload);
	}
}
