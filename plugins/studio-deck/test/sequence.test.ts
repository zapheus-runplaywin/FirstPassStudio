import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { GROUPS } from "../src/lib/colours";
import { clock, sequenceLinkFor, sequenceViewOf, timeOf } from "../src/lib/sequence-key";
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
const playingQb = (more: Partial<Playing> = {}): Playing => ({ id: "qb", step: 2, steps: 5, paused: false, leftMs: 4200, ...more });

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

test("next, pause and stop keys: light while anything plays and show where it is", () => {
	assert.deepEqual(sequenceViewOf({ press: "next" }, studio()), { state: 0, title: "Next ⏭\n(none on)", colour: "blue", ticking: false });
	assert.deepEqual(sequenceViewOf({ press: "next" }, studio(playingQb())), { state: 1, title: "Next ⏭\n3/5 0:05", colour: "purple", ticking: true });
	assert.equal(sequenceViewOf({ press: "pause" }, studio(playingQb())).title, "Pause\n3/5 0:05");
	assert.equal(sequenceViewOf({ press: "pause" }, studio(playingQb({ paused: true }))).title, "Carry on\n3/5 paused");
	assert.equal(sequenceViewOf({ press: "stop" }, null).title, "Stop\n(off air)");
});

test("next when waiting: lights only while the step on now waits for Next", () => {
	assert.equal(sequenceViewOf({ press: "advance" }, studio()).title, "Next ⏭\n(none on)");
	const timed = sequenceViewOf({ press: "advance" }, studio(playingQb({ length: "time" })));
	assert.equal(timed.title, "Next ⏭\nnot waiting");
	assert.equal(timed.state, 0);
	const waiting = sequenceViewOf({ press: "advance" }, studio(playingQb({ length: "next", leftMs: null })));
	assert.deepEqual(waiting, { state: 1, title: "Next ⏭\n3/5 Next", colour: "purple", ticking: false });
	assert.equal(sequenceLinkFor({ press: "advance" }), "/deck/sequence/advance");
});

test("a sequence about to start by itself: its key counts down to it", () => {
	const scene: Scene = { ...studio(), pending: { id: "qb", leftMs: 4200 } };
	const play = sequenceViewOf({ sequence: "qb", sequenceName: "Quarter break" }, scene, 1000);
	assert.equal(play.title, "Quarter\nbreak\nin 0:04");
	assert.equal(play.state, 0);
	assert.equal(play.ticking, true);
	// Waiting for the playing sequence to finish its step: no countdown yet.
	const waiting = sequenceViewOf({ sequence: "qb" }, { ...scene, pending: { id: "qb", leftMs: null } });
	assert.equal(waiting.title, "Quarter\nbreak\nnext");
});

test("time left setting: the step's (default), the whole sequence's, both or none", () => {
	const s = { sequence: "qb", sequenceName: "Quarter break" };
	const p = playingQb({ totalLeftMs: 100200, totalOpen: false, repeats: false });
	assert.equal(sequenceViewOf(s, studio(p)).title, "Quarter\nbreak\n3/5 0:05");
	assert.deepEqual(sequenceViewOf({ ...s, time: "total" }, studio(p), 1300), { state: 1, title: "Quarter\nbreak\nall 1:39", colour: "purple", ticking: true });
	// Both: one line of name, then the step's and the whole sequence's.
	assert.equal(sequenceViewOf({ ...s, time: "both" }, studio(p), 1300).title, "Quarter\n3/5 0:03\nall 1:39");
	assert.deepEqual(sequenceViewOf({ ...s, time: "none" }, studio(p)), { state: 1, title: "Quarter\nbreak\n3/5", colour: "purple", ticking: false });
	assert.equal(sequenceViewOf({ press: "next", time: "both" }, studio(p)).title, "Next ⏭\n3/5 0:05\nall 1:41");
	// Part of it waits: at least that; it repeats: this time round; all that's left waits.
	assert.equal(sequenceViewOf({ ...s, time: "total" }, studio({ ...p, totalOpen: true })).title, "Quarter\nbreak\nall 1:41+");
	assert.equal(sequenceViewOf({ ...s, time: "total" }, studio({ ...p, repeats: true })).title, "Quarter\nbreak\nall 1:41↻");
	assert.equal(sequenceViewOf({ ...s, time: "both" }, studio({ ...p, leftMs: null, totalLeftMs: 0, totalOpen: true })).title, "Quarter\n3/5 Next\nall –");
	// Waiting on Next or paused, the whole sequence's time stands still.
	const still = sequenceViewOf({ ...s, time: "both" }, studio({ ...p, paused: true }), 5000);
	assert.equal(still.title, "Quarter\n3/5 paused\nall 1:41");
	assert.equal(still.ticking, false);
	// A Studio from before the whole sequence's time left: the step's shows.
	assert.equal(sequenceViewOf({ ...s, time: "total" }, studio(playingQb())).title, "Quarter\nbreak\n3/5 0:05");
	assert.equal(timeOf({ time: "bogus" as never }), "step");
});

test("sequence settings panel offers every time left choice", () => {
	const html = fs.readFileSync(PANEL, "utf8");
	const select = html.match(/<select id="time">([\s\S]*?)<\/select>/)?.[1] ?? "";
	assert.deepEqual([...select.matchAll(/<option value="([^"]*)">/g)].map((m) => m[1]), ["step", "total", "both", "none"]);
	assert.match(html, /time: \$\("time"\)\.value/);
});

test("links", () => {
	assert.equal(sequenceLinkFor({ sequence: "qb" }), "/deck/sequence/qb/toggle");
	assert.equal(sequenceLinkFor({ press: "start", sequence: "qb" }), "/deck/sequence/qb/play");
	assert.equal(sequenceLinkFor({}), null);
	for (const p of ["next", "pause", "stop"] as const) assert.equal(sequenceLinkFor({ press: p }), `/deck/sequence/${p}`);
	assert.equal(sequenceLinkFor({ press: "bogus" as never, sequence: "qb" }), "/deck/sequence/qb/toggle");
	// A Delay key set up before Delay was removed plays its sequence instead.
	assert.equal(sequenceLinkFor({ press: "delay" as never, sequence: "qb" }), "/deck/sequence/qb/toggle");
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
