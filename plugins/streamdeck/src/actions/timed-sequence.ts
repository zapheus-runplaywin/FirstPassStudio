import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type PropertyInspectorDidAppearEvent,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { type KeyHost, SequenceController, type StatusPayload, type TimedSequenceSettings } from "../lib/controller";
import { type ObsRequester, testObsConnection } from "../lib/obs";
import { getObs } from "../obs-service";

const logger = streamDeck.logger.createScope("TimedSequence");

/** Messages the property inspector sends with sendToPlugin. */
type PiCommand = { cmd?: string; address?: string; password?: string };
type PiPayload = Parameters<typeof streamDeck.ui.sendToPropertyInspector>[0];

/**
 * Bridges one key on the Stream Deck to its SequenceController.
 * The key's KeyAction handle is swapped in/out as it appears and disappears (page or profile changes);
 * the controller, and any countdown or running sequence, keeps going in the background.
 */
class KeyBridge implements KeyHost {
	key: KeyAction<TimedSequenceSettings> | null = null;
	private readonly id: string;

	constructor(id: string) {
		this.id = id;
	}

	get visible(): boolean {
		return this.key !== null;
	}

	setTitle(title: string): void {
		void this.key?.setTitle(title);
	}

	setState(state: 0 | 1): void {
		void this.key?.setState(state);
	}

	showOk(): void {
		void this.key?.showOk();
	}

	showAlert(): void {
		void this.key?.showAlert();
	}

	saveSettings(settings: TimedSequenceSettings): void {
		// Use the stored handle even if hidden; settings are addressed by context id.
		void (this.key ?? this.lastKey)?.setSettings(settings);
	}

	sendStatus(status: StatusPayload): void {
		// The SDK routes this to whichever key's property inspector is open; only send for ours.
		if (streamDeck.ui.action?.id === this.id) {
			void streamDeck.ui.sendToPropertyInspector(status as unknown as PiPayload);
		}
	}

	openUrl(url: string): Promise<void> {
		return streamDeck.system.openUrl(url);
	}

	obs(): Promise<ObsRequester> {
		return getObs();
	}

	log(message: string): void {
		logger.info(`[${this.id.slice(0, 8)}] ${message}`);
	}

	/** Last handle seen, kept so settings can still be saved while the key is off screen. */
	lastKey: KeyAction<TimedSequenceSettings> | null = null;

	attach(key: KeyAction<TimedSequenceSettings>): void {
		this.key = key;
		this.lastKey = key;
	}

	detach(): void {
		this.key = null;
	}
}

@action({ UUID: "com.runplaywin.timed-sequence.run" })
export class TimedSequenceAction extends SingletonAction<TimedSequenceSettings> {
	private readonly keys = new Map<string, { bridge: KeyBridge; controller: SequenceController }>();

	override onWillAppear(ev: WillAppearEvent<TimedSequenceSettings>): void {
		if (!ev.action.isKey()) return;
		const existing = this.keys.get(ev.action.id);
		if (existing) {
			existing.bridge.attach(ev.action);
			existing.controller.updateSettings(ev.payload.settings);
			existing.controller.render(true);
			return;
		}
		const bridge = new KeyBridge(ev.action.id);
		bridge.attach(ev.action);
		const controller = new SequenceController(ev.payload.settings, bridge);
		this.keys.set(ev.action.id, { bridge, controller });
		controller.restore();
	}

	override onWillDisappear(ev: WillDisappearEvent<TimedSequenceSettings>): void {
		// Keep timers running across page/profile switches; just stop drawing.
		this.keys.get(ev.action.id)?.bridge.detach();
	}

	override onKeyDown(ev: KeyDownEvent<TimedSequenceSettings>): void {
		this.keys.get(ev.action.id)?.controller.press();
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<TimedSequenceSettings>): void {
		this.keys.get(ev.action.id)?.controller.updateSettings(ev.payload.settings);
	}

	override onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<TimedSequenceSettings>): void {
		this.keys.get(ev.action.id)?.controller.sendStatus();
	}

	override async onSendToPlugin(ev: SendToPluginEvent<PiCommand, TimedSequenceSettings>): Promise<void> {
		if (ev.payload?.cmd === "testObs") {
			// Test the address/password typed in the panel (they may not be saved yet).
			let reply: { type: "obsTest"; ok: boolean; message: string };
			try {
				reply = { type: "obsTest", ok: true, message: await testObsConnection(ev.payload.address, ev.payload.password) };
			} catch (e) {
				reply = { type: "obsTest", ok: false, message: (e as Error).message };
			}
			logger.info(`OBS test: ${reply.message}`);
			await streamDeck.ui.sendToPropertyInspector(reply);
			return;
		}
		this.keys.get(ev.action.id)?.controller.command(ev.payload?.cmd);
	}
}
