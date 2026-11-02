import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import { linkFor, viewOf, wrapTitle } from "../src/lib/source-key";
import { cleanHost, parseEvents, type Scene, StudioFeed } from "../src/lib/studio";

const scene = (visible: boolean, sound = false): Scene => ({
	rev: 1,
	sources: [{ id: "abc123", name: "Up Next", type: "video", visible, sound }],
});

test("addresses", () => {
	assert.equal(cleanHost(""), "http://localhost:8080");
	assert.equal(cleanHost(undefined), "http://localhost:8080");
	assert.equal(cleanHost("studio.local:8080/"), "http://studio.local:8080");
	assert.equal(cleanHost(" https://x:1// "), "https://x:1");
});

test("server-sent events: complete events only, comments skipped, the rest kept", () => {
	const { events, rest } = parseEvents('retry: 1000\n\ndata: {"a":1}\n\n: ping\n\ndata: {"b"\r\ndata: :2}\r\n\r\ndata: {"c"');
	assert.deepEqual(events, ['{"a":1}', '{"b"\n:2}']);
	assert.equal(rest, 'data: {"c"');
});

test("key view follows the source", () => {
	const s = { source: "abc123", sourceName: "Up Next" };
	assert.deepEqual(viewOf(s, scene(true)), { state: 1, title: "Up Next" });
	assert.deepEqual(viewOf(s, scene(false)), { state: 0, title: "Up Next" });
	assert.deepEqual(viewOf(s, null), { state: 0, title: "Up Next\n(off air)" });
	assert.deepEqual(viewOf({ source: "gone1", sourceName: "Old" }, scene(true)), { state: 0, title: "Old\n(gone)" });
	assert.deepEqual(viewOf({}, scene(true)), { state: 0, title: "Pick a\nsource" });
	// A sound key lights with the sound, not with the source.
	assert.equal(viewOf({ ...s, press: "sound" }, scene(true, false)).state, 0);
	assert.equal(viewOf({ ...s, press: "sound" }, scene(false, true)).state, 1);
});

test("titles wrap to fit a key", () => {
	assert.equal(wrapTitle("Travis' Disciples Score Bug"), "Travis'\nDisciples\nScore Bug");
	assert.equal(wrapTitle("Scoreboard"), "Scoreboard");
	// Too long for a key: broken with a hyphen rather than cut off at both ends.
	assert.equal(wrapTitle("Commentators"), "Commenta-\ntors");
	assert.equal(wrapTitle("Commentator stats"), "Commenta-\ntor stats");
});

test("press links", () => {
	assert.equal(linkFor({ source: "abc123" }), "/deck/layer/abc123/toggle");
	assert.equal(linkFor({ source: "abc123", press: "off" }), "/deck/layer/abc123/off");
	assert.equal(linkFor({ source: "abc123", press: "restart" }), "/deck/layer/abc123/restart");
	assert.equal(linkFor({ source: "abc123", press: "sound" }), "/deck/layer/abc123/sound/toggle");
	assert.equal(linkFor({ source: "abc123", press: "bogus" as never }), "/deck/layer/abc123/toggle");
	assert.equal(linkFor({}), null);
});

test("feed: follows updates, goes off air when Studio stops, and comes back", { timeout: 15000 }, async () => {
	let res: http.ServerResponse | null = null;
	const server = http.createServer((req, r) => {
		res = r;
		r.writeHead(200, { "content-type": "text/event-stream" });
		r.write(`retry: 1000\n\ndata: ${JSON.stringify(scene(false))}\n\n`);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const host = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	const seen: (Scene | null)[] = [];
	const feed = new StudioFeed(host);
	const next = async (pred: (s: Scene | null) => boolean) => {
		for (let i = 0; i < 300; i++) {
			const hit = seen.find(pred);
			if (hit !== undefined) return hit;
			await new Promise((r) => setTimeout(r, 20));
		}
		throw new Error("timed out");
	};
	const stop = feed.subscribe((s) => seen.push(s));
	try {
		await next((s) => s?.sources[0].visible === false);
		res!.write(`data: ${JSON.stringify(scene(true))}\n\n`);
		await next((s) => s?.sources[0].visible === true);
		seen.length = 0;
		res!.destroy();
		await next((s) => s === null);
		await next((s) => s !== null); // reconnects after a couple of seconds
	} finally {
		stop();
		assert.equal(feed.listening, 0);
		server.closeAllConnections();
		server.close();
	}
});
