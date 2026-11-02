import assert from "node:assert/strict";
import { test } from "node:test";

import { DOT, keyImage, keyImageUrl } from "../src/lib/colours";
import { sceneLinkFor, sceneViewOf, stepTarget } from "../src/lib/scene-key";
import type { Scene } from "../src/lib/studio";

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
	assert.deepEqual(sceneViewOf(s, studio("live")), { state: 1, title: "Live", dot: false });
	assert.deepEqual(sceneViewOf(s, studio("live", ["x"])), { state: 1, title: "Live", dot: true });
	assert.deepEqual(sceneViewOf(s, studio("pre", ["x"])), { state: 0, title: "Live", dot: false });
	assert.deepEqual(sceneViewOf(s, studio(null)), { state: 0, title: "Live", dot: false });
});

test("go to a scene: off air, gone, not picked", () => {
	assert.deepEqual(sceneViewOf({ scene: "live", sceneName: "Live" }, null), { state: 0, title: "Live\n(off air)", dot: false });
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

	assert.deepEqual(sceneViewOf({ press: "next" }, studio("pre")), { state: 0, title: "▶\nLive", dot: false });
	assert.deepEqual(sceneViewOf({ press: "prev" }, studio("qt")), { state: 0, title: "◀\nLive", dot: false });
	assert.equal(sceneViewOf({ press: "next" }, studio("qt")).title, "▶\n(last)");
	assert.equal(sceneViewOf({ press: "prev" }, studio("pre")).title, "◀\n(first)");
	assert.equal(sceneViewOf({ press: "next" }, { rev: 1, sources: [], scenes: [] }).title, "Next\n(no scenes)");
	assert.equal(sceneViewOf({ press: "prev" }, null).title, "Previous\n(off air)");
});

test("back to saved: names the current scene, with the dot when there's something to put back", () => {
	assert.deepEqual(sceneViewOf({ press: "again" }, studio("live", ["x"])), { state: 0, title: "Back to\nLive", dot: true });
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

test("changed dot: only when asked, on both states", () => {
	assert.ok(!keyImage("scene", 0).includes(`fill="${DOT}"`));
	assert.ok(keyImage("scene", 0, { dot: true }).includes(`<circle cx="72" cy="26" r="10" fill="${DOT}"`));
	assert.ok(keyImage("scene", 1, { dot: true }).includes(`fill="${DOT}"`));
	// Sent to Stream Deck as a data URL, dot included.
	assert.equal(decodeURIComponent(keyImageUrl("scene", 1, { dot: true }).replace("data:image/svg+xml,", "")), keyImage("scene", 1, { dot: true }));
});
