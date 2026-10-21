import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { GROUPS } from "../src/lib/colours";
import { clock, sequenceLinkFor, sequenceViewOf } from "../src/lib/sequence-key";
import type { Playing, Scene } from "../src/lib/studio";

const PANEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "com.runplaywin.firstpass-studio.sdPlugin", "ui", "sequence.html");

const studio = (playing: Playing | null = null): Scene => ({
	rev: 1,
	sources: [],
	sequences: [
		{ id: "run", name: "Run-up", colour: "green" },
		{ id: "qb", name: "Quarter break", colour: "purple" },
	],
	playing,
});
const playingQb = (more: Partial<Playing> = {}): Playing => ({ id: "qb", step: 2, steps: 5, paused: false, leftMs: 4200, delayMs: 0, ...more });

test("play key: shows ▶ until its sequence plays, then lights with the step and the time left", () => {
	const s = { sequence: "qb", sequenceName: "Quarter break" };
	assert.deepEqual(sequenceViewOf(s, studio()), { state: 0, title: "Quarter\nbreak\n▶", colour: "purple", ticking: false });
	assert.deepEqual(sequenceViewOf(s, studio(playingQb())), { state: 1, title: "Quarter\nbreak\n3/5 0:05", colour: "purple", ticking: true });
	// Counts down from when Studio sent it.
	assert.equal(sequenceViewOf(s, studio(playingQb()), 1300).title, "Quarter\nbreak\n3/5 0:03");
	assert.equal(sequenceViewOf(s, studio(playingQb()), 9000).title, "Quarter\nbreak\n3/5 0:00");
	assert.deepEqual(sequenceViewOf(s, studio(playingQb({ paused: true }))), { state: 1, title: "Quarter\nbreak\n3/5 paused", colour: "purple", ticking: false });
	assert.equal(sequenceViewOf(s, studio(playingQb({ leftMs: null }))).title, "Quarter\nbreak\n3/5 Next");
	// Another sequence playing: this key stays dark.
	assert.equal(sequenceViewOf(s, studio({ ...playingQb(), id: "run" })).state, 0);
});

test("play key: off air, gone, not picked, own colour", () => {
	assert.equal(sequenceViewOf({ sequence: "qb", sequenceName: "Quarter break" }, null).title, "Quarter\nbreak\n(off air)");
	assert.equal(sequenceViewOf({ sequence: "old", sequenceName: "Old" }, studio()).title, "Old\n(gone)");
	assert.equal(sequenceViewOf({}, studio()).title, "Pick a\nsequence");
	assert.equal(sequenceViewOf({ sequence: "run", colour: "yellow" }, studio()).colour, "yellow");
	// A Studio from before sequences sends none.
	assert.equal(sequenceViewOf({ sequence: "run", sequenceName: "Run-up" }, { rev: 1, sources: [] }).title, "Run-up\n(gone)");
});

test("next, delay, pause and stop keys: light while anything plays and show where it is", () => {
	assert.deepEqual(sequenceViewOf({ press: "next" }, studio()), { state: 0, title: "Next ⏭\n(none on)", colour: "blue", ticking: false });
	assert.deepEqual(sequenceViewOf({ press: "next" }, studio(playingQb())), { state: 1, title: "Next ⏭\n3/5 0:05", colour: "purple", ticking: true });
	assert.equal(sequenceViewOf({ press: "delay" }, studio(playingQb({ delayMs: 20000 }))).title, "Delay +10\n3/5 0:05 (+20)");
	assert.equal(sequenceViewOf({ press: "pause" }, studio(playingQb())).title, "Pause\n3/5 0:05");
	assert.equal(sequenceViewOf({ press: "pause" }, studio(playingQb({ paused: true }))).title, "Carry on\n3/5 paused");
	assert.equal(sequenceViewOf({ press: "stop" }, null).title, "Stop\n(off air)");
});

test("links", () => {
	assert.equal(sequenceLinkFor({ sequence: "qb" }), "/deck/sequence/qb/toggle");
	assert.equal(sequenceLinkFor({ press: "start", sequence: "qb" }), "/deck/sequence/qb/play");
	assert.equal(sequenceLinkFor({}), null);
	for (const p of ["next", "delay", "pause", "stop"] as const) assert.equal(sequenceLinkFor({ press: p }), `/deck/sequence/${p}`);
	assert.equal(sequenceLinkFor({ press: "bogus" as never, sequence: "qb" }), "/deck/sequence/qb/toggle");
});

test("clock rounds up so it reaches 0:00 as the step ends", () => {
	assert.equal(clock(4200), "0:05");
	assert.equal(clock(60000), "1:00");
	assert.equal(clock(-5), "0:00");
});

test("sequence settings panel lists the sequence's own colour first, then every group with the same labels", () => {
	const html = fs.readFileSync(PANEL, "utf8");
	const select = html.match(/<select id="colour">([\s\S]*?)<\/select>/)?.[1] ?? "";
	const options = [...select.matchAll(/<option value="([^"]*)">([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]);
	assert.deepEqual(options, [["", "The sequence's own colour"], ...Object.entries(GROUPS).map(([g, c]) => [g, c.label])]);
});
