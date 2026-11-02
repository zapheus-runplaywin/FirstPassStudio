import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { keyImageUrl } from "../lib/colours";
import { type Playback, playbackLinkFor, type PlaybackSettings, playbackViewOf } from "../lib/playback-key";
import { cleanHost, fetchPlayback, press } from "../lib/studio";

const logger = streamDeck.logger.createScope("Replay");
const log = (message: string) => logger.info(message);

// Studio sends no events for these, so the key asks every second while it's on screen (two small reads).
const POLL_MS = 1000;

/** One Replay key on screen: asks Studio what's playing back and redraws when that changes. */
class PlaybackKey {
	private host = "";
	private timer: ReturnType<typeof setInterval> | null = null;
	private drawn = "";
	private painted = false;
	private stopped = false;
	playback: Playback = null;

	constructor(
		private key: KeyAction<PlaybackSettings>,
		private settings: PlaybackSettings,
	) {
		this.follow();
	}

	update(key: KeyAction<PlaybackSettings>, settings: PlaybackSettings): void {
		this.key = key;
		this.settings = settings;
		this.follow();
		this.draw();
	}

	private follow(): void {
		const host = cleanHost(this.settings.host);
		if (host === this.host && this.timer) return;
		this.host = host;
		this.drawn = "";
		if (this.timer) clearInterval(this.timer);
		this.timer = setInterval(() => void this.ask(), POLL_MS);
		void this.ask();
	}

	private async ask(): Promise<void> {
		const host = this.host;
		const pb = await fetchPlayback(host);
		if (this.stopped || host !== this.host) return;
		this.playback = pb;
		this.draw();
	}

	private draw(): void {
		if (!this.painted) {
			this.painted = true;
			void this.key.setImage(keyImageUrl("playback", 0), { state: 0 });
			void this.key.setImage(keyImageUrl("playback", 1), { state: 1 });
		}
		const view = playbackViewOf(this.settings, this.playback);
		const title = this.settings.keepTitle ? undefined : view.title;
		const sig = `${view.state}|${title}`;
		if (sig === this.drawn) return;
		this.drawn = sig;
		void this.key.setState(view.state);
		void this.key.setTitle(title as string);
	}

	async press(): Promise<void> {
		// What's running now, not as of the last second, so a press never goes to one that has just stopped.
		this.playback = await fetchPlayback(this.host);
		const link = playbackLinkFor(this.settings, this.playback);
		if (!link) {
			this.draw();
			return void this.key.showAlert();
		}
		const ok = await press(this.host, link);
		if (!ok) {
			log(`Studio at ${this.host} didn't accept ${link}`);
			void this.key.showAlert();
		}
		await this.ask();
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}
}

@action({ UUID: "com.runplaywin.firstpass-studio.playback" })
export class PlaybackAction extends SingletonAction<PlaybackSettings> {
	private readonly keys = new Map<string, PlaybackKey>();

	override onWillAppear(ev: WillAppearEvent<PlaybackSettings>): void {
		if (!ev.action.isKey()) return;
		const existing = this.keys.get(ev.action.id);
		if (existing) existing.update(ev.action, ev.payload.settings);
		else this.keys.set(ev.action.id, new PlaybackKey(ev.action, ev.payload.settings));
	}

	override onWillDisappear(ev: WillDisappearEvent<PlaybackSettings>): void {
		this.keys.get(ev.action.id)?.stop();
		this.keys.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<PlaybackSettings>): Promise<void> {
		const key = this.keys.get(ev.action.id);
		if (key) return key.press();
		// Inside a multi action there's no key on screen to follow; ask what's running and press.
		const host = cleanHost(ev.payload.settings.host);
		const link = playbackLinkFor(ev.payload.settings, await fetchPlayback(host));
		if (!link || !(await press(host, link))) void ev.action.showAlert();
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<PlaybackSettings>): void {
		if (!ev.action.isKey()) return;
		this.keys.get(ev.action.id)?.update(ev.action, ev.payload.settings);
	}
}
