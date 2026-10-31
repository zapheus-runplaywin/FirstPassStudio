import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { queueOf, runOrderLinkFor, runOrderViewOf } from "../src/lib/runorder-key";
import type { RunOrderItem, Scene } from "../src/lib/studio";

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "com.runplaywin.firstpass-studio.sdPlugin");

const studio = (runOrder: RunOrderItem[] = [], more: Partial<Scene> = {}): Scene => ({
	rev: 1,
	sources: [],
	scenes: [{ id: "live", name: "Live game", colour: "blue", states: {} }],
	sequences: [
		{ id: "run", name: "Run-up", colour: "green" },
		{ id: "qb", name: "Quarter break", colour: "purple" },
	],
	runOrder,
	runOrders: [{ id: "thu", name: "Thursday night", count: 5 }],
	...more,
});
const qb: RunOrderItem = { key: "k1", kind: "sequence", id: "qb", name: "Quarter break" };
const live: RunOrderItem = { key: "k2", kind: "scene", id: "live", name: "Live game" };
const run: RunOrderItem = { key: "k3", kind: "sequence", id: "run", name: "Run-up" };

test("Play next key: dark and (empty) with nothing queued, lit with the head's name and colour, counting the rest", () => {
	assert.deepEqual(runOrderViewOf({}, studio()), { state: 0, title: "Play next ▶\n(empty)", colour: "blue" });
	assert.deepEqual(runOrderViewOf({}, studio([qb])), { state: 1, title: "Play next ▶\nQuarter\nbreak", colour: "purple" });
	assert.deepEqual(runOrderViewOf({}, studio([live, qb, run])), { state: 1, title: "Play next ▶\nLive game\n+2 more", colour: "blue" });
	// A scene's own colour too; a group picked in the settings wins.
	assert.equal(runOrderViewOf({}, studio([{ ...live }], { scenes: [{ id: "live", name: "Live game", colour: "grey", states: {} }] })).colour, "grey");
	assert.equal(runOrderViewOf({ colour: "yellow" }, studio([qb])).colour, "yellow");
	assert.equal(runOrderLinkFor({}), "/deck/runorder/next");
	assert.equal(runOrderLinkFor({ press: "next", output: "commentary" }), "/deck/output/commentary/runorder/next");
});

test("Play next key: off air, no output, a Studio from before the run order", () => {
	assert.equal(runOrderViewOf({}, null).title, "Play next ▶\n(off air)");
	assert.equal(runOrderViewOf({ output: "old" }, studio([qb], { outputs: [{ id: "main", name: "Output 1" }] })).title, "Play next ▶\n(no output)");
	assert.equal(runOrderViewOf({}, { rev: 1, sources: [] }).title, "Play next ▶\n(empty)");
});

test("items that have gone are left out: the head is the first that still exists", () => {
	const gone: RunOrderItem = { key: "k0", kind: "sequence", id: "old", name: "a sequence that has gone", gone: true };
	assert.deepEqual(queueOf(studio([gone, qb])), [qb]);
	assert.equal(runOrderViewOf({}, studio([gone, qb])).title, "Play next ▶\nQuarter\nbreak");
	assert.equal(runOrderViewOf({}, studio([gone])).title, "Play next ▶\n(empty)");
});

test("another output's run order: the key follows that output's queue", () => {
	const scene = studio([qb], { outputs: [{ id: "main", name: "Output 1" }, { id: "commentary", name: "Commentary", colour: "#f24f91" }], runOrderOut: { commentary: [live] } });
	assert.equal(runOrderViewOf({ output: "commentary" }, scene).title, "Play next ▶\nLive game");
	assert.equal(runOrderViewOf({}, scene).title, "Play next ▶\nQuarter\nbreak");
	// Nothing queued there.
	assert.equal(runOrderViewOf({ output: "commentary" }, studio([qb], { outputs: scene.outputs })).title, "Play next ▶\n(empty)");
});

test("Skip and Clear keys: lit while something is queued, naming the head", () => {
	assert.deepEqual(runOrderViewOf({ press: "skip" }, studio([qb, live])), { state: 1, title: "Skip ⏭\nQuarter\nbreak\n+1 more", colour: "purple" });
	assert.equal(runOrderViewOf({ press: "skip" }, studio()).title, "Skip ⏭\n(empty)");
	assert.equal(runOrderLinkFor({ press: "skip" }), "/deck/runorder/skip");
	assert.deepEqual(runOrderViewOf({ press: "clear" }, studio([run])), { state: 1, title: "Clear\nRun-up", colour: "green" });
	assert.equal(runOrderLinkFor({ press: "clear" }), "/deck/runorder/clear");
	// An unknown press is Play next.
	assert.equal(runOrderLinkFor({ press: "dance" as never }), "/deck/runorder/next");
});

test("Load key: names its saved order and how many items it holds; gone, off air, not picked", () => {
	const s = { press: "load" as const, order: "thu", orderName: "Thursday night" };
	assert.deepEqual(runOrderViewOf(s, studio()), { state: 0, title: "Thursday\nnight\nload 5", colour: "blue" });
	assert.equal(runOrderLinkFor(s), "/deck/runorder/load/thu");
	assert.equal(runOrderLinkFor({ ...s, output: "commentary" }), "/deck/output/commentary/runorder/load/thu");
	assert.equal(runOrderViewOf(s, null).title, "Thursday\nnight\n(off air)");
	assert.equal(runOrderViewOf({ press: "load", order: "fri", orderName: "Friday" }, studio()).title, "Friday\n(gone)");
	assert.equal(runOrderViewOf({ press: "load" }, studio()).title, "Pick a saved\norder");
	assert.equal(runOrderLinkFor({ press: "load" }), null);
	// Its own colour setting still applies.
	assert.equal(runOrderViewOf({ ...s, colour: "grey" }, studio()).colour, "grey");
});

test("Run order key: in the manifest, with its images and settings panel", () => {
	const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN, "manifest.json"), "utf8"));
	const a = manifest.Actions.find((x: { UUID: string }) => x.UUID === "com.runplaywin.firstpass-studio.runorder");
	assert.ok(a);
	for (const img of [a.Icon, ...a.States.map((s: { Image: string }) => s.Image)]) {
		for (const size of ["", "@2x"]) assert.ok(fs.existsSync(path.join(PLUGIN, `${img}${size}.png`)), `${img}${size}.png`);
	}
	const panel = fs.readFileSync(path.join(PLUGIN, a.PropertyInspectorPath), "utf8");
	for (const press of ["next", "skip", "load", "clear"]) assert.match(panel, new RegExp(`value="${press}"`));
	for (const group of ["blue", "green", "grey", "yellow", "purple"]) assert.match(panel, new RegExp(`value="${group}"`));
	assert.match(panel, /cmd: "orders"/);
});
