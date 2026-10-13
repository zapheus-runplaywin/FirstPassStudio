/**
 * One controller per key: idle -> armed (counting down to a local time) -> running (steps) -> idle/re-armed.
 * Talks to Stream Deck only through the KeyHost interface, so it can be tested without the SDK.
 */
import type { ObsRequester } from "./obs";
import { formatRemaining, formatTod, nextOccurrence, parseScript, parseTimeOfDay, type ScriptError, type Step, type TimeOfDay } from "./sequence";
import { Aborted, runSteps, waitUntil } from "./steps";

/** Settings stored with each key. Kept JSON-compatible for the SDK. */
export type TimedSequenceSettings = {
	time?: string;
	script?: string;
	repeatDaily?: boolean;
	armOnLaunch?: boolean;
	stopOnError?: boolean;
	skipIfLateMin?: number;
	/** Epoch ms the key is armed for; managed by the plugin so arming survives restarts. */
	armedFor?: number;
};

export type RunState = "idle" | "armed" | "running";

export type StatusPayload = {
	type: "status";
	state: RunState;
	targetMs: number | null;
	armedFor: number | null;
	step: { index: number; total: number; label: string } | null;
	message: string;
	errors: ScriptError[];
};

export type KeyHost = {
	/** Whether the key is currently on screen (titles are only drawn when it is). */
	readonly visible: boolean;
	setTitle(title: string): void;
	setState(state: 0 | 1): void;
	showOk(): void;
	showAlert(): void;
	saveSettings(settings: TimedSequenceSettings): void;
	sendStatus(status: StatusPayload): void;
	openUrl(url: string): Promise<void>;
	/** Shared OBS connection, opened on first use. */
	obs(): Promise<ObsRequester>;
	log(message: string): void;
};

type RunInfo = { index: number; total: number; label: string; progress: string };

export class SequenceController {
	settings: TimedSequenceSettings;
	state: RunState = "idle";
	targetMs: number | null = null;
	message = "";

	private readonly host: KeyHost;
	private controller: AbortController | null = null;
	private runInfo: RunInfo | null = null;
	private lastTitle: string | null = null;
	private lastKeyState: 0 | 1 | null = null;

	constructor(settings: TimedSequenceSettings, host: KeyHost) {
		this.settings = { ...settings };
		this.host = host;
	}

	private get tod(): TimeOfDay | null {
		return parseTimeOfDay(this.settings.time);
	}

	// ---------- lifecycle ----------

	/** Call once when the key first appears (e.g. Stream Deck just started). */
	restore(): void {
		const saved = Number(this.settings.armedFor) || 0;
		if (saved > Date.now()) {
			this.arm(saved);
		} else if (saved && this.settings.repeatDaily) {
			this.host.log(`Missed run at ${new Date(saved).toLocaleString()} while Stream Deck was closed; re-arming.`);
			this.arm();
		} else if (saved) {
			this.message = `Missed ${new Date(saved).toLocaleString()} (Stream Deck wasn't running)`;
			this.setArmedFor(null);
		} else if (this.settings.armOnLaunch) {
			this.arm();
		}
		this.render(true);
	}

	/** New settings from the property inspector (or a re-appearing key). */
	updateSettings(next: TimedSequenceSettings): void {
		const oldTime = this.settings.time;
		this.settings = { ...next, armedFor: this.settings.armedFor };
		if (this.settings.armedFor === undefined) delete this.settings.armedFor;
		if (this.state === "armed" && next.time !== oldTime) {
			if (this.tod) this.arm();
			else this.stop("Disarmed: start time cleared");
		}
		this.sendStatus();
		this.render();
	}

	press(): void {
		if (this.state === "idle") this.arm();
		else if (this.state === "armed") this.stop("Disarmed");
		else this.stop("Stopped");
	}

	command(cmd: unknown): void {
		if (cmd === "arm") this.arm();
		else if (cmd === "disarm") this.stop("Disarmed");
		else if (cmd === "runNow") void this.run(false);
		else if (cmd === "stop") this.stop("Stopped");
		else if (cmd === "status") this.sendStatus();
	}

	/** Cancel everything (used when the plugin shuts down a key for good). */
	dispose(): void {
		this.abort();
	}

	// ---------- validation ----------

	validateScript(): { steps: Step[]; errors: ScriptError[] } {
		const { steps, errors } = parseScript(this.settings.script);
		if (!errors.length && !steps.length) errors.push({ line: 0, message: "Add at least one step" });
		return { steps, errors };
	}

	validate(): { steps: Step[]; errors: ScriptError[] } {
		const result = this.validateScript();
		if (!this.tod) result.errors.unshift({ line: 0, message: "Set a valid start time" });
		return result;
	}

	// ---------- arm / run ----------

	arm(targetMs?: number): void {
		const { errors } = this.validate();
		if (errors.length) {
			this.message = `Can't arm: ${describe(errors)}`;
			this.host.log(this.message);
			this.host.showAlert();
			this.sendStatus();
			return;
		}
		this.abort();
		const controller = (this.controller = new AbortController());
		const target = (this.targetMs = targetMs ?? nextOccurrence(this.tod!).getTime());
		this.state = "armed";
		this.message = "";
		this.setArmedFor(target);
		this.host.log(`Armed for ${new Date(target).toLocaleString()}`);
		this.sendStatus();
		this.render(true);

		waitUntil(target, controller.signal, () => this.render())
			.then(() => {
				if (controller !== this.controller) return;
				const lateMs = Date.now() - target;
				const skipAfterMin = Number(this.settings.skipIfLateMin) || 0;
				if (skipAfterMin > 0 && lateMs > skipAfterMin * 60_000) {
					this.message = `Skipped: fired ${formatRemaining(lateMs)} late (computer asleep?)`;
					this.host.log(this.message);
					this.host.showAlert();
					return this.finish(true);
				}
				return this.run(true, controller);
			})
			.catch((e: unknown) => {
				if (!(e instanceof Aborted)) this.host.log(`Timer error: ${String(e)}`);
			});
	}

	async run(scheduled: boolean, controller?: AbortController): Promise<void> {
		if (!scheduled && this.state === "running") return;
		const { steps, errors } = this.validateScript();
		if (errors.length) {
			this.message = `Script errors: ${describe(errors)}`;
			this.host.showAlert();
			this.sendStatus();
			if (scheduled) this.finish(true);
			return;
		}

		// A manual test run while armed keeps the schedule and re-arms afterwards.
		const resumeTarget = !scheduled && this.state === "armed" ? this.targetMs : null;
		if (!controller) {
			this.abort();
			controller = this.controller = new AbortController();
		}

		this.state = "running";
		this.runInfo = { index: 0, total: steps.length, label: "", progress: "" };
		this.message = "";
		if (scheduled) this.setArmedFor(null);
		this.host.log(`Running ${steps.length} step(s)${scheduled ? "" : " (manual run)"}`);
		this.sendStatus();
		this.render(true);

		try {
			const result = await runSteps(steps, {
				signal: controller.signal,
				stopOnError: this.settings.stopOnError !== false,
				onStep: (index, step) => {
					this.runInfo = { index, total: steps.length, label: step.label, progress: "" };
					this.render();
					this.sendStatus();
				},
				progress: (text) => {
					if (this.runInfo) {
						this.runInfo.progress = text;
						this.render();
					}
				},
				log: (m) => this.host.log(m),
				showOk: () => this.host.showOk(),
				showAlert: () => this.host.showAlert(),
				openUrl: (url) => this.host.openUrl(url),
				obs: () => this.host.obs(),
			});
			if (controller !== this.controller) return;
			if (result.ok) {
				this.message = `Completed ${new Date().toLocaleTimeString()}`;
				this.host.showOk();
			} else {
				this.message = `Failed: ${result.error}`;
				this.host.showAlert();
			}
			this.host.log(this.message);
			this.finish(scheduled, resumeTarget);
		} catch (e) {
			if (e instanceof Aborted) return; // stop() already reset everything
			this.host.log(`Run error: ${String(e)}`);
			this.message = `Error: ${(e as Error).message}`;
			this.host.showAlert();
			if (controller === this.controller) this.finish(scheduled, resumeTarget);
		}
	}

	stop(message: string): void {
		const wasRunning = this.state === "running";
		this.abort();
		this.state = "idle";
		this.targetMs = null;
		this.runInfo = null;
		this.message = message;
		this.setArmedFor(null);
		this.host.log(message + (wasRunning ? " (sequence interrupted)" : ""));
		this.host.showOk();
		this.sendStatus();
		this.render(true);
	}

	/** After a run or skip: re-arm (resumed schedule, or tomorrow if repeating) or go idle. */
	private finish(scheduled: boolean, resumeTarget: number | null = null): void {
		this.runInfo = null;
		this.controller = null;
		if (resumeTarget && resumeTarget > Date.now()) return this.arm(resumeTarget);
		if (scheduled && this.settings.repeatDaily && this.tod) return this.arm();
		this.state = "idle";
		this.targetMs = null;
		if (this.settings.armedFor) this.setArmedFor(null);
		this.sendStatus();
		this.render(true);
	}

	private abort(): void {
		this.controller?.abort();
		this.controller = null;
	}

	private setArmedFor(ms: number | null): void {
		if (ms) this.settings.armedFor = ms;
		else delete this.settings.armedFor;
		this.host.saveSettings({ ...this.settings });
	}

	// ---------- display ----------

	render(force = false): void {
		if (!this.host.visible) return;
		const tod = this.tod;
		let title: string;
		if (this.state === "armed" && this.targetMs !== null) {
			title = `${tod ? formatTod(tod) : ""}\n${formatRemaining(this.targetMs - Date.now())}`;
		} else if (this.state === "running" && this.runInfo) {
			const r = this.runInfo;
			title = `RUN ${Math.min(r.index + 1, r.total)}/${r.total}\n${r.progress || r.label}`;
		} else {
			title = tod ? `${formatTod(tod)}\nOFF` : "Set\ntime";
		}
		const keyState: 0 | 1 = this.state === "idle" ? 0 : 1;
		if (force || title !== this.lastTitle) {
			this.host.setTitle(title);
			this.lastTitle = title;
		}
		if (force || keyState !== this.lastKeyState) {
			this.host.setState(keyState);
			this.lastKeyState = keyState;
		}
	}

	sendStatus(): void {
		const r = this.runInfo;
		this.host.sendStatus({
			type: "status",
			state: this.state,
			targetMs: this.targetMs,
			armedFor: this.settings.armedFor ?? null,
			step: r ? { index: r.index, total: r.total, label: r.label } : null,
			message: this.message,
			errors: this.validate().errors,
		});
	}
}

function describe(errors: ScriptError[]): string {
	return errors.map((e) => (e.line ? `line ${e.line}: ` : "") + e.message).join("; ");
}
