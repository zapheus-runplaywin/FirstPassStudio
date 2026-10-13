import assert from "node:assert/strict";
import { test } from "node:test";

import { formatRemaining, nextOccurrence, parseCombo, parseDuration, parseScript, parseTimeOfDay, type KeyCombo } from "../src/lib/sequence";
import { escapeSendKeys, macCombo, winCombo } from "../src/lib/steps";

const combo = (t: string): KeyCombo => parseCombo(t) as KeyCombo;

test("durations", () => {
	assert.equal(parseDuration("5"), 5000);
	assert.equal(parseDuration("2.5"), 2500);
	assert.equal(parseDuration("500ms"), 500);
	assert.equal(parseDuration("5s"), 5000);
	assert.equal(parseDuration("1m30s"), 90000);
	assert.equal(parseDuration("1m 30s"), 90000);
	assert.equal(parseDuration("2h"), 7200000);
	assert.equal(parseDuration("1h2m3s"), 3723000);
	assert.equal(parseDuration("2min"), 120000);
	assert.equal(parseDuration("01:30"), 90000);
	assert.equal(parseDuration("00:02:00"), 120000);
	assert.equal(parseDuration("abc"), null);
	assert.equal(parseDuration("5x"), null);
	assert.equal(parseDuration("5s junk"), null);
});

test("times of day", () => {
	assert.deepEqual(parseTimeOfDay("14:30"), { h: 14, m: 30, s: 0 });
	assert.deepEqual(parseTimeOfDay("07:05:09"), { h: 7, m: 5, s: 9 });
	assert.deepEqual(parseTimeOfDay("2:30pm"), { h: 14, m: 30, s: 0 });
	assert.deepEqual(parseTimeOfDay("12:00 am"), { h: 0, m: 0, s: 0 });
	assert.deepEqual(parseTimeOfDay("12pm"), { h: 12, m: 0, s: 0 });
	assert.deepEqual(parseTimeOfDay("7am"), { h: 7, m: 0, s: 0 });
	assert.equal(parseTimeOfDay("7"), null);
	assert.equal(parseTimeOfDay("25:00"), null);
	assert.equal(parseTimeOfDay(""), null);
});

test("next occurrence rolls to tomorrow once passed", () => {
	const from = new Date(2026, 9, 13, 11, 36, 0);
	assert.equal(nextOccurrence({ h: 14, m: 30, s: 0 }, from).getTime(), new Date(2026, 9, 13, 14, 30).getTime());
	assert.equal(nextOccurrence({ h: 9, m: 0, s: 0 }, from).getTime(), new Date(2026, 9, 14, 9, 0).getTime());
	assert.equal(nextOccurrence({ h: 11, m: 36, s: 0 }, from).getTime(), new Date(2026, 9, 14, 11, 36).getTime());
});

test("remaining time format", () => {
	assert.equal(formatRemaining(59000), "0:59");
	assert.equal(formatRemaining(61000), "1:01");
	assert.equal(formatRemaining(3723000), "1:02:03");
	assert.equal(formatRemaining(1), "0:01");
});

test("script parsing", () => {
	const { steps, errors } = parseScript(
		[
			"# comment",
			"// also a comment",
			"open https://example.com/?a=1&b=2",
			"wait 5s",
			"at 2:45pm",
			"run echo hi",
			"start notepad.exe",
			'http POST https://example.com/hook {"go": true}',
			"get http://localhost:8080/x",
			"keys ctrl+shift+s alt+tab",
			'type "Hello, world"',
			"ok",
			"alert",
			"log done",
		].join("\n"),
	);
	assert.deepEqual(errors, []);
	assert.deepEqual(
		steps.map((s) => s.type),
		["open", "wait", "at", "run", "start", "http", "http", "keys", "type", "ok", "alert", "log"],
	);
	const [open, wait, , , , post, get, keys, type] = steps;
	assert.equal(open.type === "open" && open.target, "https://example.com/?a=1&b=2");
	assert.equal(wait.line, 4);
	assert.equal(post.type === "http" && post.method, "POST");
	assert.equal(post.type === "http" && post.body, '{"go": true}');
	assert.equal(get.type === "http" && get.method, "GET");
	assert.equal(keys.type === "keys" && keys.combos.length, 2);
	assert.equal(type.type === "type" && type.text, "Hello, world");
});

test("script errors carry line numbers", () => {
	const { errors } = parseScript("wait forever\nbogus thing\nhttp FETCH https://x\npost ftp://x\nkeys ctrl+\nkeys ctrl+a+b\nat 99:00\nopen");
	assert.deepEqual(
		errors.map((e) => e.line),
		[1, 2, 3, 4, 5, 6, 7, 8],
	);
});

test("key combos map to SendKeys (Windows) and AppleScript (Mac)", () => {
	assert.equal(winCombo(combo("ctrl+shift+s")), "^+s");
	assert.equal(winCombo(combo("alt+f4")), "%{F4}");
	assert.equal(winCombo(combo("enter")), "{ENTER}");
	assert.equal(winCombo(combo("ctrl+%")), "^{%}");
	assert.throws(() => winCombo(combo("cmd+c")));
	assert.equal(macCombo(combo("cmd+shift+s")), 'keystroke "s" using {command down, shift down}');
	assert.equal(macCombo(combo("enter")), "key code 36");
	assert.equal(macCombo(combo("option+left")), "key code 123 using {option down}");
	assert.equal(escapeSendKeys("a+b (c) {d}~"), "a{+}b {(}c{)} {{}d{}}{~}");
});
