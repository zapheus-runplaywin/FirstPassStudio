/**
 * Executors for each step type, plus a wall-clock wait. No Stream Deck dependencies:
 * anything that needs the SDK (opening URLs, flashing the key, logging) comes in through RunContext.
 */
import { exec, execFile, spawn, type ChildProcess } from "node:child_process";
import { type ObsRequester, setSourceVisible, switchScene } from "./obs";
import { formatRemaining, nextOccurrence, type KeyCombo, type Step } from "./sequence";

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

export class Aborted extends Error {
	constructor() {
		super("Stopped");
		this.name = "Aborted";
	}
}

export type RunContext = {
	signal: AbortSignal;
	stopOnError: boolean;
	onStep(index: number, step: Step): void;
	progress(text: string): void;
	log(message: string): void;
	showOk(): void;
	showAlert(): void;
	openUrl(url: string): Promise<void>;
	/** Connection to OBS, opened on first use. */
	obs(): Promise<ObsRequester>;
};

export type RunResult = { ok: true } | { ok: false; error: string };

/**
 * Wait until a wall-clock time. Re-checks Date.now() on every whole second of the countdown,
 * so it stays accurate after the computer sleeps and reports the remaining time for display.
 */
export function waitUntil(targetMs: number, signal: AbortSignal, onTick?: (remainingMs: number) => void): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) return reject(new Aborted());
		let timer: NodeJS.Timeout | undefined;
		const onAbort = (): void => {
			clearTimeout(timer);
			reject(new Aborted());
		};
		signal.addEventListener("abort", onAbort, { once: true });
		const tick = (): void => {
			const remaining = targetMs - Date.now();
			if (remaining <= 0) {
				signal.removeEventListener("abort", onAbort);
				return resolve();
			}
			onTick?.(remaining);
			timer = setTimeout(tick, remaining % 1000 || 1000);
		};
		tick();
	});
}

type ProcessCallback = (error: Error | null, stdout: string, stderr: string) => void;

const OPTS = { encoding: "utf8", windowsHide: true } as const;

function runProcess(start: (cb: ProcessCallback) => ChildProcess, signal: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		const onAbort = (): void => {
			try {
				child.kill();
			} catch {
				/* already gone */
			}
		};
		const child = start((error, stdout, stderr) => {
			signal.removeEventListener("abort", onAbort);
			if (signal.aborted) return reject(new Aborted());
			if (error) {
				const detail = (stderr ?? "").trim().split(/\r?\n/).pop();
				return reject(new Error(`${error.message.split(/\r?\n/)[0]}${detail ? ` — ${detail}` : ""}`));
			}
			resolve((stdout ?? "").trim());
		});
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

const psQuote = (s: string): string => `'${s.replace(/'/g, "''")}'`;
const asQuote = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function powershell(script: string, signal: AbortSignal): Promise<string> {
	return runProcess(
		(cb) =>
			execFile(
				"powershell.exe",
				["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
				OPTS,
				cb,
			),
		signal,
	);
}

function osascript(script: string, signal: AbortSignal): Promise<string> {
	return runProcess((cb) => execFile("/usr/bin/osascript", ["-e", script], OPTS, cb), signal);
}

// ---------- key combos ----------
const WIN_KEYS: Record<string, string> = {
	enter: "{ENTER}", tab: "{TAB}", esc: "{ESC}", space: " ", backspace: "{BS}", delete: "{DEL}",
	up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}", home: "{HOME}", end: "{END}",
	pageup: "{PGUP}", pagedown: "{PGDN}",
};
const MAC_KEYCODES: Record<string, number> = {
	enter: 36, tab: 48, esc: 53, space: 49, backspace: 51, delete: 117, up: 126, down: 125, left: 123, right: 124,
	home: 115, end: 119, pageup: 116, pagedown: 121,
	f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
};

/** Escape literal text for WScript.Shell.SendKeys. */
export function escapeSendKeys(text: string): string {
	return text.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`).replace(/\r?\n/g, "{ENTER}");
}

export function winCombo(c: KeyCombo): string {
	if (c.mods.includes("cmd")) throw new Error(`The Windows/Cmd key can't be sent on Windows ("${c.text}")`);
	const prefix = (c.mods.includes("ctrl") ? "^" : "") + (c.mods.includes("shift") ? "+" : "") + (c.mods.includes("alt") ? "%" : "");
	const key = /^f\d+$/.test(c.key) ? `{${c.key.toUpperCase()}}` : (WIN_KEYS[c.key] ?? escapeSendKeys(c.key));
	return prefix + key;
}

export function macCombo(c: KeyCombo): string {
	const names = { ctrl: "control down", shift: "shift down", alt: "option down", cmd: "command down" };
	const using = c.mods.length ? ` using {${c.mods.map((m) => names[m]).join(", ")}}` : "";
	const code = MAC_KEYCODES[c.key];
	return code !== undefined ? `key code ${code}${using}` : `keystroke ${asQuote(c.key)}${using}`;
}

// ---------- executors ----------
type Executor<T extends Step["type"]> = (step: Extract<Step, { type: T }>, ctx: RunContext) => Promise<unknown>;
type Executors = { [T in Step["type"]]: Executor<T> };

const executors: Executors = {
	wait: (step, ctx) => waitUntil(Date.now() + step.ms, ctx.signal, (rem) => ctx.progress(formatRemaining(rem))),

	at: (step, ctx) => waitUntil(nextOccurrence(step.tod).getTime(), ctx.signal, (rem) => ctx.progress(formatRemaining(rem))),

	async open(step, ctx) {
		const t = step.target;
		if (/^https?:\/\//i.test(t)) return ctx.openUrl(t);
		if (IS_WIN) return powershell(`Start-Process -FilePath ${psQuote(t)}`, ctx.signal);
		if (IS_MAC) {
			// A bare app name such as "Spotify" -> open -a Spotify
			const isApp = !/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.includes("/") && !t.includes("~");
			const args = isApp ? ["-a", t] : [t.replace(/^~(?=\/)/, process.env.HOME ?? "~")];
			return runProcess((cb) => execFile("/usr/bin/open", args, OPTS, cb), ctx.signal);
		}
		return runProcess((cb) => execFile("xdg-open", [t], OPTS, cb), ctx.signal);
	},

	async run(step, ctx) {
		const out = await runProcess((cb) => exec(step.command, { ...OPTS, maxBuffer: 4 * 1024 * 1024 }, cb), ctx.signal);
		if (out) ctx.log(`run output: ${out.slice(0, 500)}`);
	},

	async start(step) {
		const child = spawn(step.command, { shell: true, detached: true, stdio: "ignore", windowsHide: true });
		child.on("error", () => undefined);
		child.unref();
	},

	async http(step, ctx) {
		const headers: Record<string, string> = {};
		let body: string | undefined;
		if (step.body && step.method !== "GET" && step.method !== "HEAD") {
			body = step.body;
			const trimmed = body.trim();
			headers["Content-Type"] = trimmed.startsWith("{") || trimmed.startsWith("[") ? "application/json" : "text/plain";
		}
		let res: Response;
		try {
			res = await fetch(step.url, {
				method: step.method,
				headers,
				body,
				signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(30_000)]),
			});
		} catch (e) {
			if (ctx.signal.aborted) throw new Aborted();
			const err = e as Error & { cause?: Error };
			throw new Error(`${step.method} ${step.url} failed: ${err.cause?.message ?? err.message}`);
		}
		if (!res.ok) throw new Error(`${step.method} ${step.url} returned ${res.status} ${res.statusText}`);
		ctx.log(`${step.method} ${step.url} -> ${res.status}`);
	},

	async keys(step, ctx) {
		if (IS_WIN) {
			const seq = step.combos.map(winCombo).join("");
			return powershell(`$w = New-Object -ComObject WScript.Shell; $w.SendKeys(${psQuote(seq)})`, ctx.signal);
		}
		if (IS_MAC) {
			return osascript(`tell application "System Events"\n${step.combos.map(macCombo).join("\n")}\nend tell`, ctx.signal);
		}
		throw new Error("keys is only supported on Windows and macOS");
	},

	async type(step, ctx) {
		if (IS_WIN) {
			return powershell(`$w = New-Object -ComObject WScript.Shell; $w.SendKeys(${psQuote(escapeSendKeys(step.text))})`, ctx.signal);
		}
		if (IS_MAC) return osascript(`tell application "System Events" to keystroke ${asQuote(step.text)}`, ctx.signal);
		throw new Error("type is only supported on Windows and macOS");
	},

	async obs(step, ctx) {
		const obs = await ctx.obs();
		if (step.op === "scene") {
			await switchScene(obs, step.name);
			ctx.log(`OBS scene -> ${step.name}`);
			return;
		}
		const visible = step.op === "toggle" ? "toggle" : step.op === "show";
		const result = await setSourceVisible(obs, step.name, visible, step.scene);
		ctx.log(`OBS ${result.visible ? "showed" : "hid"} "${step.name}" in "${result.sceneName}"`);
	},

	async ok(_step, ctx) {
		ctx.showOk();
	},
	async alert(_step, ctx) {
		ctx.showAlert();
	},
	async log(step, ctx) {
		ctx.log(step.message);
	},
};

function execute(step: Step, ctx: RunContext): Promise<unknown> {
	return (executors[step.type] as Executor<Step["type"]>)(step as never, ctx);
}

/** Run steps in order. Rejects with Aborted if the signal fires. */
export async function runSteps(steps: Step[], ctx: RunContext): Promise<RunResult> {
	const failures: string[] = [];
	for (let i = 0; i < steps.length; i++) {
		if (ctx.signal.aborted) throw new Aborted();
		const step = steps[i];
		ctx.onStep(i, step);
		try {
			await execute(step, ctx);
		} catch (e) {
			if (e instanceof Aborted || ctx.signal.aborted) throw new Aborted();
			const msg = `Line ${step.line} (${step.label}): ${(e as Error).message}`;
			ctx.log(`ERROR ${msg}`);
			if (ctx.stopOnError) return { ok: false, error: msg };
			failures.push(msg);
		}
	}
	return failures.length ? { ok: false, error: failures.join("; ") } : { ok: true };
}
