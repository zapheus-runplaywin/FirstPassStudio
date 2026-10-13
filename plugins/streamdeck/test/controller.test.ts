import assert from "node:assert/strict";
import { test } from "node:test";

import { type KeyHost, SequenceController, type StatusPayload, type TimedSequenceSettings } from "../src/lib/controller";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const hhmmss = (d: Date): string => [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");

/** A fake key that records everything the controller does. */
function fakeHost() {
	const events: { kind: string; value?: unknown; at: number }[] = [];
	const host: KeyHost & { events: typeof events; saved: TimedSequenceSettings[]; statuses: StatusPayload[]; logs: string[] } = {
		visible: true,
		events,
		saved: [],
		statuses: [],
		logs: [],
		setTitle: (t) => events.push({ kind: "title", value: t, at: Date.now() }),
		setState: (s) => events.push({ kind: "state", value: s, at: Date.now() }),
		showOk: () => events.push({ kind: "ok", at: Date.now() }),
		showAlert: () => events.push({ kind: "alert", at: Date.now() }),
		saveSettings: (s) => host.saved.push(s),
		sendStatus: (s) => host.statuses.push(s),
		openUrl: async (u) => void events.push({ kind: "openUrl", value: u, at: Date.now() }),
		log: (m) => host.logs.push(m),
	};
	return host;
}

async function until(pred: () => boolean, ms = 5000, label = "condition"): Promise<void> {
	const end = Date.now() + ms;
	while (!pred()) {
		if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
		await sleep(20);
	}
}

test("arms, counts down, runs at the set second with delays, then goes idle", async () => {
	const host = fakeHost();
	const target = new Date(Math.ceil(Date.now() / 1000) * 1000 + 2000);
	const c = new SequenceController({ time: hhmmss(target), script: "log go\nwait 400ms\nopen https://example.com\nwait 300ms\nok" }, host);

	c.press();
	assert.equal(c.state, "armed");
	assert.equal(c.targetMs, target.getTime());
	assert.equal(host.saved.at(-1)?.armedFor, target.getTime());
	assert.ok(host.events.some((e) => e.kind === "title" && /\n0:0[1-3]$/.test(String(e.value))));

	await until(() => host.logs.includes("go"), 4000, "first step");
	const started = Date.now();
	assert.ok(started >= target.getTime(), "must not start early");
	assert.ok(started - target.getTime() < 300, `started ${started - target.getTime()}ms late`);

	await until(() => c.state === "idle", 3000, "finish");
	const opened = host.events.find((e) => e.kind === "openUrl");
	assert.equal(opened?.value, "https://example.com");
	assert.ok(opened!.at - target.getTime() >= 400, "first wait honoured");
	assert.ok(host.events.filter((e) => e.kind === "ok").at(-1)!.at - opened!.at >= 300, "second wait honoured");
	assert.equal(host.saved.at(-1)?.armedFor, undefined, "armedFor cleared");
	assert.match(c.message, /^Completed/);
	assert.ok(host.events.some((e) => e.kind === "title" && /^RUN \d\/5/.test(String(e.value))));
});

test("repeat daily re-arms for the same time tomorrow", async () => {
	const host = fakeHost();
	const target = new Date(Math.ceil(Date.now() / 1000) * 1000 + 1000);
	const c = new SequenceController({ time: hhmmss(target), script: "log ran", repeatDaily: true }, host);
	c.press();
	await until(() => host.logs.includes("ran"), 3000, "run");
	await until(() => c.state === "armed", 2000, "re-armed");
	const next = new Date(c.targetMs!);
	const tomorrow = new Date(target);
	tomorrow.setDate(tomorrow.getDate() + 1);
	assert.equal(next.getTime(), tomorrow.getTime());
	c.dispose();
});

test("pressing while running stops the sequence", async () => {
	const host = fakeHost();
	const c = new SequenceController({ time: "03:00", script: "wait 5s\nlog never" }, host);
	void c.run(false);
	await until(() => host.events.some((e) => e.kind === "title" && /^RUN 1\/2\n0:0\d/.test(String(e.value))), 2000, "waiting");
	c.press();
	assert.equal(c.state, "idle");
	assert.equal(c.message, "Stopped");
	await sleep(200);
	assert.ok(!host.logs.includes("never"));
});

test("a manual test run while armed keeps the schedule", async () => {
	const host = fakeHost();
	const c = new SequenceController({ time: "03:00", script: "log manual" }, host);
	c.press();
	const target = c.targetMs;
	await c.run(false);
	assert.ok(host.logs.includes("manual"));
	assert.equal(c.state, "armed");
	assert.equal(c.targetMs, target);
	c.dispose();
});

test("refuses to arm with a bad script and reports the line", () => {
	const host = fakeHost();
	const c = new SequenceController({ time: "09:00", script: "wiat 5s" }, host);
	c.press();
	assert.equal(c.state, "idle");
	assert.ok(host.events.some((e) => e.kind === "alert"));
	assert.match(c.message, /line 1: Unknown step "wiat"/);
	assert.match(host.statuses.at(-1)!.message, /Can't arm/);
});

test("restore: re-arms a future schedule, reports a missed one", () => {
	const future = Date.now() + 3_600_000;
	const h1 = fakeHost();
	const c1 = new SequenceController({ time: "03:00", script: "ok", armedFor: future }, h1);
	c1.restore();
	assert.equal(c1.state, "armed");
	assert.equal(c1.targetMs, future);
	c1.dispose();

	const h2 = fakeHost();
	const c2 = new SequenceController({ time: "03:00", script: "ok", armedFor: Date.now() - 60_000 }, h2);
	c2.restore();
	assert.equal(c2.state, "idle");
	assert.match(c2.message, /^Missed/);
	assert.equal(h2.saved.at(-1)?.armedFor, undefined);
});

test("changing the time while armed re-arms; script errors stop on a failing step", async () => {
	const host = fakeHost();
	const c = new SequenceController({ time: "03:00", script: "ok" }, host);
	c.press();
	c.updateSettings({ time: "04:00", script: "ok" });
	assert.equal(new Date(c.targetMs!).getHours(), 4);
	c.dispose();

	const h2 = fakeHost();
	const c2 = new SequenceController({ time: "03:00", script: "run exit 3\nlog after" }, h2);
	await c2.run(false);
	assert.match(c2.message, /^Failed: Line 1 \(run\)/);
	assert.ok(!h2.logs.includes("after"));

	const h3 = fakeHost();
	const c3 = new SequenceController({ time: "03:00", script: "run exit 3\nlog after", stopOnError: false }, h3);
	await c3.run(false);
	assert.ok(h3.logs.includes("after"), "continues when stopOnError is off");
});
