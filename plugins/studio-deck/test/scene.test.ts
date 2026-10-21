import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { DOT, GROUPS, keyImage, keyImageUrl } from "../src/lib/colours";
import { sceneLinkFor, sceneViewOf, stepTarget } from "../src/lib/scene-key";
import type { Scene } from "../src/lib/studio";

const PANEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "com.runplaywin.firstpass-studio.sdPlugin", "ui", "scene.html");

const studio = (current: string | null, changed: string[] = []): Scene => ({
	rev: 1,
	sources: [],
	scenes: [
		{ id: "pre", name: "Pre-game", colour: "green", states: {} },
		{ id: "live", name: "Live", colour: "blue", states: {} },
		{ id: "qt", name: "Quarter time", colour: "purple", states: {} },
	],
	current,
	changed,
});

test("go to a scene: lit while it's the current one, with the dot when something's changed", () => {
	const s = { scene: "live", sceneName: "Live" };
	assert.deepEqual(sceneViewOf(s, studio("live")), { state: 1, title: "Live", dot: false, colour: "blue" });
	assert.deepEqual(sceneViewOf(s, studio("live", ["x"])), { state: 1, title: "Live", dot: true, colour: "blue" });
	assert.deepEqual(sceneViewOf(s, studio("pre", ["x"])), { state: 0, title: "Live", dot: false, colour: "blue" });
	assert.deepEqual(sceneViewOf(s, studio(null)), { state: 0, title: "Live", dot: false, colour: "blue" });
});

test("go to a scene: the scene's own colour unless the key picks one; off air, gone, not picked", () => {
	assert.equal(sceneViewOf({ scene: "qt" }, studio(null)).colour, "purple");
	assert.equal(sceneViewOf({ scene: "qt", colour: "yellow" }, studio(null)).colour, "yellow");
	assert.deepEqual(sceneViewOf({ scene: "live", sceneName: "Live" }, null), { state: 0, title: "Live\n(off air)", dot: false, colour: "blue" });
	assert.equal(sceneViewOf({ scene: "old", sceneName: "Old" }, studio("live")).title, "Old\n(gone)");
	assert.equal(sceneViewOf({}, studio("live")).title, "Pick a\nscene");
	// A Studio from before scenes sends none: the key says the scene has gone.
	assert.equal(sceneViewOf({ scene: "live", sceneName: "Live" }, { rev: 1, sources: [] }).title, "Live\n(gone)");
});

test("next and previous: show where they'll go, in order, and stop at the ends", () => {
	assert.equal(stepTarget(studio("pre"), "next")?.id, "live");
	assert.equal(stepTarget(studio("live"), "prev")?.id, "pre");
	assert.equal(stepTarget(studio("qt"), "next"), undefined);
	assert.equal(stepTarget(studio("pre"), "prev"), undefined);
	// No current scene: next goes to the first, previous to the last, as Studio does.
	assert.equal(stepTarget(studio(null), "next")?.id, "pre");
	assert.equal(stepTarget(studio(null), "prev")?.id, "qt");

	assert.deepEqual(sceneViewOf({ press: "next" }, studio("pre")), { state: 0, title: "▶\nLive", dot: false, colour: "blue" });
	assert.deepEqual(sceneViewOf({ press: "prev" }, studio("qt")), { state: 0, title: "◀\nLive", dot: false, colour: "blue" });
	assert.equal(sceneViewOf({ press: "next" }, studio("live")).colour, "purple", "drawn in the colour of where it goes");
	assert.equal(sceneViewOf({ press: "next" }, studio("qt")).title, "▶\n(last)");
	assert.equal(sceneViewOf({ press: "prev" }, studio("pre")).title, "◀\n(first)");
	assert.equal(sceneViewOf({ press: "next" }, { rev: 1, sources: [], scenes: [] }).title, "Next\n(no scenes)");
	assert.equal(sceneViewOf({ press: "prev" }, null).title, "Previous\n(off air)");
});

test("back to saved: names the current scene, with the dot when there's something to put back", () => {
	assert.deepEqual(sceneViewOf({ press: "again" }, studio("live", ["x"])), { state: 0, title: "Back to\nLive", dot: true, colour: "blue" });
	assert.equal(sceneViewOf({ press: "again" }, studio("live")).dot, false);
	assert.equal(sceneViewOf({ press: "again" }, studio(null)).title, "Back to\nsaved\n(no scene)");
});

test("links", () => {
	assert.equal(sceneLinkFor({ scene: "live" }), "/deck/scene/live");
	assert.equal(sceneLinkFor({ press: "go", scene: "a b" }), "/deck/scene/a%20b");
	assert.equal(sceneLinkFor({}), null);
	assert.equal(sceneLinkFor({ press: "next" }), "/deck/scene/next");
	assert.equal(sceneLinkFor({ press: "prev" }), "/deck/scene/prev");
	assert.equal(sceneLinkFor({ press: "again" }), "/deck/scene/again");
	assert.equal(sceneLinkFor({ press: "bogus" as never, scene: "live" }), "/deck/scene/live");
});

test("changed dot: only when asked, on both states, in every colour", () => {
	for (const g of Object.keys(GROUPS)) {
		assert.ok(!keyImage("scene", g, 0).includes("<circle"));
		assert.ok(keyImage("scene", g, 0, true).includes(`<circle cx="124" cy="20" r="11" fill="${DOT}"`) && keyImage("scene", g, 1, true).includes("<circle"));
	}
	// Sent to Stream Deck as a data URL, dot included.
	assert.equal(decodeURIComponent(keyImageUrl("scene", "green", 1, true).replace("data:image/svg+xml,", "")), keyImage("scene", "green", 1, true));
});

test("scene settings panel lists the scene's own colour first, then every group with the same labels", () => {
	const html = fs.readFileSync(PANEL, "utf8");
	const select = html.match(/<select id="colour">([\s\S]*?)<\/select>/)?.[1] ?? "";
	const options = [...select.matchAll(/<option value="([^"]*)">([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]);
	assert.deepEqual(options, [["", "The scene's own colour"], ...Object.entries(GROUPS).map(([g, c]) => [g, c.label])]);
});
