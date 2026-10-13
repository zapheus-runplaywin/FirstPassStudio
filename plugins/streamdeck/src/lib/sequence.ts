/**
 * Parsing for the step script, times of day and durations. No Stream Deck dependencies.
 *
 * Script: one step per line; blank lines and lines starting with # or // are ignored.
 *
 *   wait 5s                  delay (also: delay, sleep). 500ms, 90, 1m30s, 2h, 00:01:30
 *   at 14:30                 wait until a local time of day (next occurrence)
 *   open <target>            open a URL, file, folder or app with the OS default handler
 *   run <command>            run a shell command and wait for it to finish
 *   start <command>          launch a shell command and carry on without waiting
 *   http POST <url> [body]   HTTP request (GET/POST/PUT/PATCH/DELETE/HEAD); get/post/... <url> shorthand
 *   keys ctrl+shift+s        press key combos (several separated by spaces)
 *   type <text>              type literal text into the focused window
 *   ok | alert               flash the key's check mark / warning triangle
 *   log <message>            write to the plugin log
 */

export type TimeOfDay = { h: number; m: number; s: number };
export type Modifier = "ctrl" | "shift" | "alt" | "cmd";
export type KeyCombo = { mods: Modifier[]; key: string; text: string };

type StepBase = { line: number; label: string };
export type Step = StepBase &
	(
		| { type: "wait"; ms: number }
		| { type: "at"; tod: TimeOfDay }
		| { type: "open"; target: string }
		| { type: "run"; command: string }
		| { type: "start"; command: string }
		| { type: "http"; method: string; url: string; body: string }
		| { type: "keys"; combos: KeyCombo[] }
		| { type: "type"; text: string }
		| { type: "ok" }
		| { type: "alert" }
		| { type: "log"; message: string }
	);
export type StepType = Step["type"];
export type ScriptError = { line: number; message: string };

const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, sec: 1000, m: 60000, min: 60000, h: 3600000, hr: 3600000 };

/** "5" (seconds), "500ms", "1m30s", "2h", "01:30", "00:02:00" -> milliseconds, or null. */
export function parseDuration(input: string | undefined): number | null {
	const str = String(input ?? "").trim().toLowerCase();
	if (!str) return null;
	if (/^\d+(\.\d+)?$/.test(str)) return Math.round(parseFloat(str) * 1000);
	if (/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(str)) {
		let secs = 0;
		for (const p of str.split(":").map(Number)) secs = secs * 60 + p;
		return Math.round(secs * 1000);
	}
	const re = /(\d+(?:\.\d+)?)\s*(ms|sec|min|hr|h|m|s)/g;
	let total = 0;
	let consumed = "";
	let m: RegExpExecArray | null;
	while ((m = re.exec(str))) {
		total += parseFloat(m[1]) * UNIT_MS[m[2]];
		consumed += m[0];
	}
	if (!consumed || consumed.replace(/\s/g, "") !== str.replace(/\s/g, "")) return null;
	return Math.round(total);
}

/** "14:30", "14:30:15", "2:30pm", "2:30:05 PM", "7am" -> TimeOfDay or null. */
export function parseTimeOfDay(input: string | undefined): TimeOfDay | null {
	const str = String(input ?? "").trim().toLowerCase();
	const m = str.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/);
	if (!m) return null;
	let h = Number(m[1]);
	const min = Number(m[2] ?? 0);
	const s = Number(m[3] ?? 0);
	const ampm = m[4];
	if (!m[2] && !ampm) return null; // bare "7" is ambiguous; require 7:00 or 7am
	if (ampm) {
		if (h < 1 || h > 12) return null;
		if (ampm === "pm" && h !== 12) h += 12;
		if (ampm === "am" && h === 12) h = 0;
	}
	if (h > 23 || min > 59 || s > 59) return null;
	return { h, m: min, s };
}

/** Next local Date at that time of day, strictly after `from`. */
export function nextOccurrence(tod: TimeOfDay, from: Date = new Date()): Date {
	const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), tod.h, tod.m, tod.s, 0);
	if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1); // setDate keeps local time across DST
	return d;
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function formatTod(tod: TimeOfDay): string {
	return tod.s ? `${pad(tod.h)}:${pad(tod.m)}:${pad(tod.s)}` : `${pad(tod.h)}:${pad(tod.m)}`;
}

export function formatRemaining(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

export function parseScript(text: string | undefined): { steps: Step[]; errors: ScriptError[] } {
	const steps: Step[] = [];
	const errors: ScriptError[] = [];

	String(text ?? "")
		.split(/\r?\n/)
		.forEach((raw, i) => {
			const line = raw.trim();
			const lineNo = i + 1;
			if (!line || line.startsWith("#") || line.startsWith("//")) return;
			const sp = line.search(/\s/);
			const cmd = (sp === -1 ? line : line.slice(0, sp)).toLowerCase();
			const arg = sp === -1 ? "" : line.slice(sp + 1).trim();
			const err = (message: string): void => {
				errors.push({ line: lineNo, message });
			};
			const need = (what: string): boolean => {
				if (!arg) err(`"${cmd}" needs ${what}`);
				return !!arg;
			};

			switch (cmd) {
				case "wait":
				case "delay":
				case "sleep": {
					if (!need("a duration, e.g. wait 5s")) return;
					const ms = parseDuration(arg);
					if (ms === null) return err(`Can't read duration "${arg}" (try 500ms, 5s, 1m30s, 00:02:00)`);
					steps.push({ type: "wait", ms, line: lineNo, label: `wait ${arg}` });
					return;
				}
				case "at":
				case "until": {
					if (!need("a time, e.g. at 14:30")) return;
					const tod = parseTimeOfDay(arg);
					if (!tod) return err(`Can't read time "${arg}" (try 14:30, 14:30:15 or 2:30pm)`);
					steps.push({ type: "at", tod, line: lineNo, label: `at ${formatTod(tod)}` });
					return;
				}
				case "open":
					if (!need("a URL, file or app")) return;
					steps.push({ type: "open", target: stripQuotes(arg), line: lineNo, label: "open" });
					return;
				case "run":
				case "start":
					if (!need("a command")) return;
					steps.push({ type: cmd, command: arg, line: lineNo, label: cmd });
					return;
				case "http":
				case "get":
				case "post":
				case "put":
				case "patch":
				case "delete": {
					let rest = arg;
					let method = cmd.toUpperCase();
					if (cmd === "http") {
						const m = rest.match(/^(\S+)\s*([\s\S]*)$/);
						if (!m) return err('"http" needs a method and URL, e.g. http POST https://example.com/hook');
						method = m[1].toUpperCase();
						rest = m[2];
						if (!HTTP_METHODS.includes(method)) return err(`Unknown HTTP method "${m[1]}"`);
					}
					const m2 = rest.match(/^(\S+)\s*([\s\S]*)$/);
					if (!m2) return err(`"${cmd}" needs a URL`);
					const url = m2[1];
					if (!/^https?:\/\//i.test(url)) return err(`URL must start with http:// or https:// ("${url}")`);
					steps.push({ type: "http", method, url, body: m2[2] ?? "", line: lineNo, label: method.toLowerCase() });
					return;
				}
				case "keys":
				case "key":
				case "hotkey": {
					if (!need("a key combo, e.g. keys ctrl+shift+s")) return;
					const parsed = arg.split(/\s+/).map(parseCombo);
					const bad = parsed.find((c): c is { error: string } => "error" in c);
					if (bad) return err(bad.error);
					steps.push({ type: "keys", combos: parsed as KeyCombo[], line: lineNo, label: "keys" });
					return;
				}
				case "type":
					if (!need("some text")) return;
					steps.push({ type: "type", text: stripQuotes(arg), line: lineNo, label: "type" });
					return;
				case "ok":
				case "alert":
					steps.push({ type: cmd, line: lineNo, label: cmd });
					return;
				case "log":
					steps.push({ type: "log", message: arg, line: lineNo, label: "log" });
					return;
				default:
					err(`Unknown step "${cmd}"`);
			}
		});

	return { steps, errors };
}

function stripQuotes(s: string): string {
	const t = s.trim();
	if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) return t.slice(1, -1);
	return t;
}

const MODIFIERS: Record<string, Modifier> = {
	ctrl: "ctrl",
	control: "ctrl",
	shift: "shift",
	alt: "alt",
	option: "alt",
	opt: "alt",
	cmd: "cmd",
	command: "cmd",
	win: "cmd",
	meta: "cmd",
};
const NAMED_KEYS = [
	"enter", "return", "tab", "esc", "escape", "space", "backspace", "delete", "del",
	"up", "down", "left", "right", "home", "end", "pageup", "pgup", "pagedown", "pgdn",
	"f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
];
const KEY_ALIASES: Record<string, string> = { return: "enter", escape: "esc", del: "delete", pgup: "pageup", pgdn: "pagedown" };

export function parseCombo(text: string): KeyCombo | { error: string } {
	const parts = text.toLowerCase().split("+").filter(Boolean);
	const mods: Modifier[] = [];
	let key: string | null = null;
	for (const p of parts) {
		if (MODIFIERS[p]) {
			mods.push(MODIFIERS[p]);
			continue;
		}
		if (key) return { error: `Key combo "${text}" has more than one non-modifier key` };
		if (p.length === 1) key = p;
		else if (NAMED_KEYS.includes(p)) key = KEY_ALIASES[p] ?? p;
		else return { error: `Unknown key "${p}" in "${text}"` };
	}
	if (!key) return { error: `Key combo "${text}" has no key, only modifiers` };
	return { mods: [...new Set(mods)], key, text };
}
