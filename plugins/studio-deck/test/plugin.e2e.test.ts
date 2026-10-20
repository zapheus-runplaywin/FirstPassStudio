/**
 * End-to-end: a real Studio (server.js with an empty data folder), a fake Stream Deck app (WebSocket
 * server) and the real plugin (src/plugin.ts via tsx, with the real @elgato/streamdeck SDK).
 * A Source key lights when its source is shown from anywhere, and a press toggles it.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { DOT, GROUPS, ON } from "../src/lib/colours";

/** The SVG inside a setImage data URL; fails if the image isn't one. */
const svgOf = (m: { payload?: { image?: string } }): string => {
	const image = m.payload?.image ?? "";
	assert.match(image, /^data:image\/svg\+xml,/);
	return decodeURIComponent(image.slice("data:image/svg+xml,".length));
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(ROOT, "..", "..");
const SD_PLUGIN = path.join(ROOT, "com.runplaywin.firstpass-studio.sdPlugin");
const ACTION = "com.runplaywin.firstpass-studio.source";
const SCENE_ACTION = "com.runplaywin.firstpass-studio.scene";

type Msg = { event: string; context?: string; payload?: any; _at: number }; // eslint-disable-line @typescript-eslint/no-explicit-any

function frame(text: string): Buffer {
	const p = Buffer.from(text);
	let h: Buffer;
	if (p.length < 126) h = Buffer.from([0x81, p.length]);
	else {
		h = Buffer.alloc(4);
		h[0] = 0x81;
		h[1] = 126;
		h.writeUInt16BE(p.length, 2);
	}
	return Buffer.concat([h, p]);
}

/** A fake Stream Deck app: accepts the plugin's WebSocket and records what it sends. */
async function startDeck() {
	const received: Msg[] = [];
	let sock: Socket | null = null;
	let buf = Buffer.alloc(0);
	const server = http.createServer();
	server.on("upgrade", (req, socket: Socket) => {
		const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
		socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
		sock = socket;
		socket.on("data", (d: Buffer) => {
			buf = Buffer.concat([buf, d]);
			for (;;) {
				if (buf.length < 2) return;
				let len = buf[1] & 0x7f;
				let off = 2;
				if (len === 126) {
					len = buf.readUInt16BE(2);
					off = 4;
				} else if (len === 127) {
					len = Number(buf.readBigUInt64BE(2));
					off = 10;
				}
				if (buf.length < off + 4 + len) return;
				const mask = buf.subarray(off, off + 4);
				const payload = Buffer.from(buf.subarray(off + 4, off + 4 + len)).map((b, i) => b ^ mask[i & 3]);
				const opcode = buf[0] & 0x0f;
				buf = buf.subarray(off + 4 + len);
				if (opcode === 1) received.push({ ...JSON.parse(Buffer.from(payload).toString()), _at: Date.now() });
			}
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return {
		port: (server.address() as { port: number }).port,
		received,
		send: (obj: object) => sock!.write(frame(JSON.stringify(obj))),
		async waitFor(pred: (m: Msg) => boolean, label: string, ms = 8000): Promise<Msg> {
			const end = Date.now() + ms;
			for (;;) {
				const hit = received.find(pred);
				if (hit) return hit;
				if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
				await new Promise((r) => setTimeout(r, 20));
			}
		},
		close: () => {
			sock?.destroy();
			server.close();
		},
	};
}

async function startStudio(port: number, dataDir: string): Promise<ChildProcess> {
	const child = spawn(process.execPath, [path.join(REPO, "server.js")], {
		cwd: REPO,
		env: { ...process.env, PORT: String(port), FIRSTPASS_DATA_DIR: dataDir },
		stdio: ["ignore", "ignore", "ignore"],
	});
	for (let i = 0; i < 100; i++) {
		try {
			if ((await fetch(`http://127.0.0.1:${port}/api/scene`)).ok) return child;
		} catch {
			/* not up yet */
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	child.kill();
	throw new Error("Studio didn't start");
}

function launchPlugin(port: number): ChildProcess {
	const info = {
		application: { font: "", language: "en", platform: "mac", platformVersion: "14.0", version: "7.1.0.21000" },
		colors: {},
		devicePixelRatio: 2,
		devices: [{ id: "DEV", name: "Stream Deck", size: { columns: 5, rows: 3 }, type: 0 }],
		plugin: { uuid: "com.runplaywin.firstpass-studio", version: "1.0.0.0" },
	};
	return spawn(
		process.execPath,
		["--import", "tsx", path.join(ROOT, "src", "plugin.ts"), "-port", String(port), "-pluginUUID", "PLUGIN-UUID", "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)],
		{ cwd: SD_PLUGIN, stdio: ["ignore", "ignore", "inherit"] },
	);
}

const keyEvent = (event: string, context: string, settings: object, action = ACTION) => ({
	event,
	action,
	context,
	device: "DEV",
	payload: { controller: "Keypad", coordinates: { column: 0, row: 0 }, isInMultiAction: false, settings, state: 0 },
});

test("real SDK and real Studio: key follows its source and toggles it", { timeout: 60000 }, async () => {
	const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-deck-"));
	const studioPort = 20000 + Math.floor(Math.random() * 20000);
	const studio = await startStudio(studioPort, dataDir);
	const host = `http://127.0.0.1:${studioPort}`;
	const deck = await startDeck();
	const plugin = launchPlugin(deck.port);
	const post = (body: object) => fetch(`${host}/api/scene`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	const scene = async () => (await (await fetch(`${host}/api/scene`)).json()) as { sources: { id: string; name: string; visible: boolean }[] };

	try {
		await deck.waitFor((m) => m.event === "registerPlugin", "registration", 15000);
		assert.ok((await post({ type: "add", source: { type: "browser", name: "Up Next", url: "upnext.html" } })).ok);
		const src = (await scene()).sources[0];
		const settings = { host, source: src.id, sourceName: src.name };

		deck.send(keyEvent("willAppear", "K1", settings));
		await deck.waitFor((m) => m.event === "setTitle" && m.context === "K1" && m.payload?.title === "Up Next", "source title");
		await deck.waitFor((m) => m.event === "setState" && m.payload?.state === 0, "off");
		// No colour picked: both states drawn in blue, lit orange.
		const blueOff = await deck.waitFor((m) => m.event === "setImage" && m.context === "K1" && m.payload?.state === 0, "blue off image");
		assert.ok(svgOf(blueOff).includes(GROUPS.blue.off));
		const blueOn = await deck.waitFor((m) => m.event === "setImage" && m.context === "K1" && m.payload?.state === 1, "blue on image");
		assert.ok(svgOf(blueOn).includes(ON) && svgOf(blueOn).includes(GROUPS.blue.band));

		// Picking the yellow (ads) group in the settings panel redraws both states once.
		let mark = deck.received.length;
		deck.send({ ...keyEvent("didReceiveSettings", "K1", { ...settings, colour: "yellow" }) });
		const yellowOff = await deck.waitFor((m) => deck.received.indexOf(m) >= mark && m.event === "setImage" && m.payload?.state === 0, "yellow off image");
		assert.ok(svgOf(yellowOff).includes(GROUPS.yellow.off));
		const yellowOn = await deck.waitFor((m) => deck.received.indexOf(m) >= mark && m.event === "setImage" && m.payload?.state === 1, "yellow on image");
		assert.ok(svgOf(yellowOn).includes(ON) && svgOf(yellowOn).includes(GROUPS.yellow.band));
		await new Promise((r) => setTimeout(r, 200));
		assert.equal(deck.received.filter((m) => deck.received.indexOf(m) >= mark && m.event === "setImage").length, 2, "images sent once per group change");

		// Shown from somewhere else (the Output page, a link): the key lights.
		mark = deck.received.length;
		await fetch(`${host}/deck/layer/up-next/on`);
		await deck.waitFor((m) => deck.received.indexOf(m) >= mark && m.event === "setState" && m.payload?.state === 1, "lit after a link");

		// Pressed: Studio hides it, and the key goes dark.
		mark = deck.received.length;
		deck.send(keyEvent("keyDown", "K1", settings));
		await deck.waitFor((m) => deck.received.indexOf(m) >= mark && m.event === "setState" && m.payload?.state === 0, "dark after a press");
		assert.equal((await scene()).sources[0].visible, false);

		// The settings panel asks for the list of sources.
		deck.send({ event: "propertyInspectorDidAppear", action: ACTION, context: "K1", device: "DEV" });
		deck.send({ event: "sendToPlugin", action: ACTION, context: "K1", payload: { cmd: "sources", host } });
		const list = await deck.waitFor((m) => m.event === "sendToPropertyInspector" && m.payload?.type === "sources", "source list");
		assert.equal(list.payload.ok, true);
		assert.deepEqual(list.payload.sources, [{ id: src.id, name: "Up Next", type: "browser" }]);

		// Renamed on the Output page: same key, new title (it follows the id).
		mark = deck.received.length;
		await post({ type: "update", id: src.id, changes: { ...src, name: "Next Game" } });
		await deck.waitFor((m) => deck.received.indexOf(m) >= mark && m.event === "setTitle" && m.payload?.title === "Next Game", "renamed");

		// Studio goes off air: the key says so, and a press shows an alert.
		mark = deck.received.length;
		studio.kill();
		await deck.waitFor((m) => deck.received.indexOf(m) >= mark && m.event === "setTitle" && /off air/.test(m.payload?.title), "off air");
		deck.send(keyEvent("keyDown", "K1", settings));
		await deck.waitFor((m) => deck.received.indexOf(m) >= mark && m.event === "showAlert", "alert when Studio is off air");
	} finally {
		plugin.kill();
		studio.kill();
		deck.close();
		fs.rmSync(dataDir, { recursive: true, force: true });
	}
});

test("real SDK and real Studio: Scene keys go to scenes, light for the current one and show changes", { timeout: 60000 }, async () => {
	const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-deck-"));
	const studioPort = 20000 + Math.floor(Math.random() * 20000);
	const studio = await startStudio(studioPort, dataDir);
	const host = `http://127.0.0.1:${studioPort}`;
	const deck = await startDeck();
	const plugin = launchPlugin(deck.port);
	const post = (body: object) => fetch(`${host}/api/scene`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	type Studio = { sources: { id: string; name: string; visible: boolean }[]; scenes: { id: string; name: string }[]; current: string | null };
	const scene = async () => (await (await fetch(`${host}/api/scene`)).json()) as Studio;
	const after = (mark: number) => (m: Msg) => deck.received.indexOf(m) >= mark;

	try {
		await deck.waitFor((m) => m.event === "registerPlugin", "registration", 15000);
		assert.ok((await post({ type: "add", sources: [{ type: "browser", name: "Scoreboard", url: "scoreboard.html" }, { type: "browser", name: "Up Next", url: "upnext.html" }] })).ok);
		await post({ type: "show", name: "Up Next" });
		await post({ type: "sceneSave", name: "Pre-game", colour: "green" });
		await post({ type: "hide", name: "Up Next" });
		await post({ type: "show", name: "Scoreboard" });
		await post({ type: "sceneSave", name: "Live" });
		const [pre, live] = (await scene()).scenes;

		deck.send(keyEvent("willAppear", "S1", { host, scene: pre.id, sceneName: pre.name }, SCENE_ACTION));
		deck.send(keyEvent("willAppear", "S2", { host, press: "next" }, SCENE_ACTION));
		await deck.waitFor((m) => m.event === "setTitle" && m.context === "S1" && m.payload?.title === "Pre-game", "scene title");
		// Drawn in the scene's own colour once Studio answers.
		await deck.waitFor((m) => m.event === "setImage" && m.context === "S1" && m.payload?.state === 0 && svgOf(m).includes(GROUPS.green.off), "scene's own colour");
		// Live is current and last: Next has nowhere to go.
		await deck.waitFor((m) => m.event === "setTitle" && m.context === "S2" && m.payload?.title === "▶\n(last)", "next at the end");

		// Pressing the Pre-game key goes there: it lights, and Next now shows Live.
		let mark = deck.received.length;
		deck.send(keyEvent("keyDown", "S1", { host, scene: pre.id, sceneName: pre.name }, SCENE_ACTION));
		await deck.waitFor((m) => after(mark)(m) && m.event === "setState" && m.context === "S1" && m.payload?.state === 1, "lit when current");
		await deck.waitFor((m) => after(mark)(m) && m.event === "setTitle" && m.context === "S2" && m.payload?.title === "▶\nLive", "next shows Live");
		let now = await scene();
		assert.equal(now.current, pre.id);
		assert.deepEqual(now.sources.filter((s) => s.visible).map((s) => s.name), ["Up Next"]);

		// A source changed from the Output page: the key gets the changed dot.
		mark = deck.received.length;
		await fetch(`${host}/deck/layer/scoreboard/on`);
		const dotted = await deck.waitFor((m) => after(mark)(m) && m.event === "setImage" && m.context === "S1" && m.payload?.state === 1, "changed dot");
		assert.ok(svgOf(dotted).includes(`fill="${DOT}"`) && svgOf(dotted).includes("<circle"));

		// Pressing it again puts it back: the dot goes.
		mark = deck.received.length;
		deck.send(keyEvent("keyDown", "S1", { host, scene: pre.id, sceneName: pre.name }, SCENE_ACTION));
		const clean = await deck.waitFor((m) => after(mark)(m) && m.event === "setImage" && m.context === "S1" && m.payload?.state === 1, "dot gone");
		assert.ok(!svgOf(clean).includes("<circle"));
		now = await scene();
		assert.deepEqual(now.sources.filter((s) => s.visible).map((s) => s.name), ["Up Next"]);

		// Next goes to Live: Pre-game goes dark.
		mark = deck.received.length;
		deck.send(keyEvent("keyDown", "S2", { host, press: "next" }, SCENE_ACTION));
		await deck.waitFor((m) => after(mark)(m) && m.event === "setState" && m.context === "S1" && m.payload?.state === 0, "dark when another scene is on");
		assert.equal((await scene()).current, live.id);

		// The settings panel asks for the scenes.
		deck.send({ event: "propertyInspectorDidAppear", action: SCENE_ACTION, context: "S1", device: "DEV" });
		deck.send({ event: "sendToPlugin", action: SCENE_ACTION, context: "S1", payload: { cmd: "scenes", host } });
		const list = await deck.waitFor((m) => m.event === "sendToPropertyInspector" && m.payload?.type === "scenes", "scene list");
		assert.deepEqual(list.payload.scenes, [{ id: pre.id, name: "Pre-game", colour: "green" }, { id: live.id, name: "Live", colour: "blue" }]);

		// Deleted on the Output page: the key says gone.
		mark = deck.received.length;
		await post({ type: "sceneRemove", scene: pre.id });
		await deck.waitFor((m) => after(mark)(m) && m.event === "setTitle" && m.context === "S1" && m.payload?.title === "Pre-game\n(gone)", "gone");
	} finally {
		plugin.kill();
		studio.kill();
		deck.close();
		fs.rmSync(dataDir, { recursive: true, force: true });
	}
});
