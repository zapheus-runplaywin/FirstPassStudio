import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { type Playback, playbackLinkFor, playbackViewOf } from "../src/lib/playback-key";

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "com.runplaywin.firstpass-studio.sdPlugin");

const none: Playback = { replay: { active: false }, practice: { active: false } };
const replay = (more = {}): Playback => ({ replay: { active: true, paused: false, follow: { kind: "none" }, ...more }, practice: { active: false } });
const practice = (more = {}): Playback => ({ replay: { active: false }, practice: { active: true, paused: true, ...more } });

test("Replay key: Play or pause whichever is running, lit while one runs", () => {
	assert.deepEqual(playbackViewOf({}, null), { state: 0, title: "Play ▶\n(off air)" });
	assert.deepEqual(playbackViewOf({}, none), { state: 0, title: "Play ▶\n(none on)" });
	assert.equal(playbackLinkFor({}, none), null);
	assert.deepEqual(playbackViewOf({}, replay()), { state: 1, title: "Pause ⏸\n4K replay" });
	assert.equal(playbackLinkFor({}, replay()), "/deck/replay/toggle");
	assert.deepEqual(playbackViewOf({}, practice()), { state: 1, title: "Play ▶\nPractice" });
	assert.equal(playbackLinkFor({ press: "toggle" }, practice()), "/deck/practice/toggle");
	assert.equal(playbackViewOf({}, practice({ demo: {} })).title, "Play ▶\nDemo");
	// Following the video's timecode, the player plays and pauses it.
	assert.deepEqual(playbackViewOf({}, replay({ follow: { kind: "hyperdeck" } })), { state: 1, title: "4K replay\nfollows\nvideo" });
});

test("Replay key: jumps, nudges and Stop", () => {
	assert.equal(playbackLinkFor({ press: "next" }, replay()), "/deck/replay/next");
	assert.equal(playbackLinkFor({ press: "prev" }, practice()), "/deck/practice/prev");
	assert.equal(playbackLinkFor({ press: "stop" }, practice()), "/deck/practice/stop");
	assert.deepEqual(playbackViewOf({ press: "stop" }, replay()), { state: 1, title: "Stop ■\n4K replay" });
	assert.equal(playbackLinkFor({ press: "frameBack" }, replay()), "/deck/replay/nudge/-40");
	assert.equal(playbackLinkFor({ press: "secondOn" }, replay()), "/deck/replay/nudge/1000");
	// A nudge is the replay's only.
	assert.equal(playbackLinkFor({ press: "frameOn" }, practice()), null);
	assert.deepEqual(playbackViewOf({ press: "frameOn" }, practice()), { state: 0, title: "+1 frame\n(replay only)" });
	// An unknown press is Play.
	assert.equal(playbackLinkFor({ press: "dance" as never }, replay()), "/deck/replay/toggle");
});

test("Replay key: in the manifest, with its images and settings panel", () => {
	const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN, "manifest.json"), "utf8"));
	const a = manifest.Actions.find((x: { UUID: string }) => x.UUID === "com.runplaywin.firstpass-studio.playback");
	assert.ok(a);
	for (const img of [a.Icon, ...a.States.map((s: { Image: string }) => s.Image)]) {
		for (const size of ["", "@2x"]) assert.ok(fs.existsSync(path.join(PLUGIN, `${img}${size}.png`)), `${img}${size}.png`);
	}
	const panel = fs.readFileSync(path.join(PLUGIN, a.PropertyInspectorPath), "utf8");
	for (const press of ["toggle", "next", "prev", "frameBack", "frameOn", "secondBack", "secondOn", "stop"]) assert.match(panel, new RegExp(`value="${press}"`));
});
