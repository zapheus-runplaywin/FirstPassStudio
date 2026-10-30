import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { contrast, GROUPS, keyImage, ON, OUTPUT_COLOURS } from "../src/lib/colours";
import { sceneLinkFor, sceneViewOf } from "../src/lib/scene-key";
import { sequenceLinkFor, sequenceViewOf } from "../src/lib/sequence-key";
import { linkFor, viewOf } from "../src/lib/source-key";
import { deckBase, forOutput, outputColour, outputGone, outputsOf, type Scene } from "../src/lib/studio";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "com.runplaywin.firstpass-studio.sdPlugin");

// Output 1 shows the ladder and is on Live, Commentary shows game stats, is on Desk and plays its loop.
const studio = (): Scene => ({
	rev: 1,
	sources: [
		{ id: "ladder", name: "Ladder", type: "browser", visible: true, out: {} },
		{ id: "stats", name: "Game stats", type: "browser", visible: false, out: { com: true } },
	],
	scenes: [
		{ id: "live", name: "Live", colour: "blue", states: {} },
		{ id: "desk", name: "Desk", colour: "green", states: {} },
	],
	current: "live",
	changed: [],
	currentOut: { com: "desk" },
	changedOut: { com: ["ladder"] },
	sequences: [{ id: "loop", name: "commentaryLoop", colour: "purple" }],
	playing: null,
	playingOut: { com: { id: "loop", step: 0, steps: 2, paused: false, leftMs: 5000 } },
	outputs: [
		{ id: "main", name: "Output 1", slot: 1, colour: OUTPUT_COLOURS[0], link: "output-1" },
		{ id: "com", name: "Commentary", slot: 2, colour: OUTPUT_COLOURS[1], link: "commentary" },
	],
});

test("an output's view of the scene: its own sources on, current scene, changes and playing sequence", () => {
	const s = studio();
	assert.equal(forOutput(s, undefined), s);
	assert.equal(forOutput(s, "main"), s);
	const com = forOutput(s, "com")!;
	assert.deepEqual(com.sources.map((x) => x.visible), [false, true]);
	assert.equal(com.current, "desk");
	assert.deepEqual(com.changed, ["ladder"]);
	assert.equal(com.playing?.id, "loop");
	const none = forOutput({ ...s, currentOut: undefined, playingOut: undefined }, "com")!;
	assert.equal(none.current, null);
	assert.equal(none.playing, null);
	assert.equal(forOutput(null, "com"), null);
});

test("keys follow their own output", () => {
	const s = studio();
	assert.equal(viewOf({ source: "stats" }, s).state, 0);
	assert.equal(viewOf({ source: "stats", output: "com" }, s).state, 1);
	assert.equal(viewOf({ source: "ladder", output: "com" }, s).state, 0);
	assert.deepEqual(sceneViewOf({ scene: "desk", output: "com" }, s), { state: 1, title: "Desk", dot: true, colour: "green" });
	assert.equal(sceneViewOf({ scene: "desk" }, s).state, 0);
	assert.equal(sceneViewOf({ scene: "live" }, s).state, 1);
	assert.equal(sequenceViewOf({ sequence: "loop", output: "com" }, s).state, 1);
	assert.equal(sequenceViewOf({ sequence: "loop" }, s).state, 0);
	assert.equal(sequenceViewOf({ press: "stop", output: "com" }, s).state, 1);
	assert.equal(sequenceViewOf({ press: "stop" }, s).title, "Stop\n(none on)");
});

test("a key for a removed output says so; an older Studio without outputs counts as Output 1 only", () => {
	const s = studio();
	s.outputs = s.outputs!.filter((o) => o.id !== "com");
	assert.ok(outputGone(s, "com"));
	assert.ok(!outputGone(s, "main") && !outputGone(s, undefined) && !outputGone(null, "com"));
	assert.equal(viewOf({ source: "stats", sourceName: "Game stats", output: "com" }, s).title, "Game\nstats\n(no output)");
	assert.equal(sceneViewOf({ scene: "desk", sceneName: "Desk", output: "com" }, s).title, "Desk\n(no output)");
	assert.equal(sceneViewOf({ press: "next", output: "com" }, s).title, "Next\n(no output)");
	assert.equal(sequenceViewOf({ sequence: "loop", sequenceName: "Loop", output: "com" }, s).title, "Loop\n(no output)");
	assert.equal(sequenceViewOf({ press: "next", output: "com" }, s).title, "Next ⏭\n(no output)");
	assert.deepEqual(outputsOf({ rev: 1, sources: [] }), [{ id: "main", name: "Output 1", slot: 1 }]);
	assert.equal(outputsOf(s).length, 1);
});

test("links go to the key's output; sound stays Output 1's", () => {
	assert.equal(deckBase(undefined), "/deck");
	assert.equal(deckBase("main"), "/deck");
	assert.equal(deckBase("com"), "/deck/output/com");
	assert.equal(linkFor({ source: "stats", output: "com" }), "/deck/output/com/layer/stats/toggle");
	assert.equal(linkFor({ source: "stats", output: "com", press: "restart" }), "/deck/output/com/layer/stats/restart");
	assert.equal(linkFor({ source: "stats", output: "com", press: "sound" }), "/deck/layer/stats/sound/toggle");
	assert.equal(linkFor({ source: "stats" }), "/deck/layer/stats/toggle");
	assert.equal(sceneLinkFor({ scene: "desk", output: "com" }), "/deck/output/com/scene/desk");
	assert.equal(sceneLinkFor({ press: "again", output: "com" }), "/deck/output/com/scene/again");
	assert.equal(sceneLinkFor({ scene: "desk", output: "main" }), "/deck/scene/desk");
	assert.equal(sequenceLinkFor({ sequence: "loop", output: "com" }), "/deck/output/com/sequence/loop/toggle");
	assert.equal(sequenceLinkFor({ press: "pause", output: "com" }), "/deck/output/com/sequence/pause");
});

test("a lit key takes its output's colour, with black titles that read on every one", () => {
	const s = studio();
	assert.equal(outputColour(s, undefined), OUTPUT_COLOURS[0]);
	assert.equal(outputColour(s, "com"), OUTPUT_COLOURS[1]);
	assert.equal(outputColour({ rev: 1, sources: [] }, "com"), undefined);
	assert.equal(ON, OUTPUT_COLOURS[0]);
	assert.ok(keyImage("scene", "blue", 1, false, OUTPUT_COLOURS[2]).includes(`fill="${OUTPUT_COLOURS[2]}"`));
	assert.equal(keyImage("scene", "blue", 1, false, "nonsense"), keyImage("scene", "blue", 1));
	assert.equal(keyImage("scene", "blue", 0, false, OUTPUT_COLOURS[2]), keyImage("scene", "blue", 0));
	for (const lit of OUTPUT_COLOURS) {
		assert.ok(contrast(lit, "#000000") >= 4.5, `black title on ${lit}`);
		for (const [g, { off }] of Object.entries(GROUPS)) assert.ok(contrast(off, lit) >= 3, `${g} off vs ${lit} on`);
	}
	// Stream Deck draws the titles: white on the dark off keys, black on the lit ones.
	const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
	for (const a of manifest.Actions) assert.deepEqual(a.States.map((st: { TitleColor: string }) => st.TitleColor), ["#ffffff", "#000000"], a.Name);
	// One naming for every kind's two states: Off, then the kind's own word for on (On, Playing, On air, Running).
	for (const a of manifest.Actions) {
		const names = a.States.map((st: { Name: string }) => st.Name);
		assert.equal(names[0], "Off", `${a.Name}'s first state`);
		assert.ok(["On", "Playing", "On air", "Running"].includes(names[1]), `${a.Name}'s on state: ${names[1]}`);
	}
});

test("every settings panel has the Output list", () => {
	for (const f of ["source", "scene", "sequence"]) {
		const html = fs.readFileSync(path.join(ROOT, "ui", `${f}.html`), "utf8");
		assert.match(html, /<select id="output">/, f);
		assert.match(html, /output: \$\("output"\)\.value/, f);
	}
});
