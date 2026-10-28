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
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { DOT, GROUPS, ON, TALLY } from "../src/lib/colours";

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
const SEQUENCE_ACTION = "com.runplaywin.firstpass-studio.sequence";
const SWITCHER_ACTION = "com.runplaywin.firstpass-studio.switcher";
// Studio's stand-in ATEM switcher (CommonJS, shared with Studio's own tests).
const { startAtem } = createRequire(import.meta.url)(path.join(REPO, "test", "support", "atem.js"));

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

/** A fake Stream Deck app: accepts the plugin's WebSocket, records what it sends and keeps its global settings. */
async function startDeck() {
	const received: Msg[] = [];
	let globalSettings: object = {};
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
				if (opcode !== 1) continue;
				const msg = { ...JSON.parse(Buffer.from(payload).toString()), _at: Date.now() };
				received.push(msg);
				if (msg.event === "setGlobalSettings") globalSettings = msg.payload;
				if (msg.event === "getGlobalSettings") socket.write(frame(JSON.stringify({ event: "didReceiveGlobalSettings", payload: { settings: globalSettings } })));
			}
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return {
		port: (server.address() as { port: number }).port,
		received,
		globalSettings: () => globalSettings,
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
	// Stream Deck links need the key, so every press below also proves the plugin gets through: by its old x-studio-deck
	// header while no plugin has paired, then signed (the pairing test at the end).
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

/** Where a link pressed by hand (a Website key, say) starts: Studio's address with its Stream Deck key. */
async function deckBase(host: string): Promise<string> {
	const { key } = (await (await fetch(`${host}/api/deck-key`)).json()) as { key: string };
	return `${host}/k/${key}`;
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
		await fetch(`${await deckBase(host)}/deck/layer/up-next/on`);
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
		await fetch(`${await deckBase(host)}/deck/layer/scoreboard/on`);
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

test("real SDK and real Studio: Sequence keys play and stop a sequence and show its step", { timeout: 60000 }, async () => {
	const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-deck-"));
	const studioPort = 20000 + Math.floor(Math.random() * 20000);
	const studio = await startStudio(studioPort, dataDir);
	const host = `http://127.0.0.1:${studioPort}`;
	const deck = await startDeck();
	const plugin = launchPlugin(deck.port);
	const post = (body: object) => fetch(`${host}/api/scene`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	type Studio = { sources: { id: string; name: string; visible: boolean }[]; sequences: { id: string; name: string }[]; playing: { id: string; step: number } | null };
	const scene = async () => (await (await fetch(`${host}/api/scene`)).json()) as Studio;
	const after = (mark: number) => (m: Msg) => deck.received.indexOf(m) >= mark;

	try {
		await deck.waitFor((m) => m.event === "registerPlugin", "registration", 15000);
		await post({ type: "add", sources: [{ type: "browser", name: "Ladder", url: "ladder.html" }, { type: "browser", name: "Fixtures", url: "fixtures.html" }] });
		const [ladder, fixtures] = (await scene()).sources;
		await post({ type: "seqAdd", changes: { name: "Quarter break", colour: "purple", steps: [
			{ sources: [ladder.id], length: { type: "next" } }, { sources: [fixtures.id], length: { type: "time", sec: 30 } }] } });
		const [qb] = (await scene()).sequences;
		const settings = { host, sequence: qb.id, sequenceName: qb.name };

		deck.send(keyEvent("willAppear", "Q1", settings, SEQUENCE_ACTION));
		deck.send(keyEvent("willAppear", "Q2", { host, press: "next" }, SEQUENCE_ACTION));
		await deck.waitFor((m) => m.event === "setTitle" && m.context === "Q1" && m.payload?.title === "Quarter\nbreak\n▶", "sequence title");
		await deck.waitFor((m) => m.event === "setImage" && m.context === "Q1" && m.payload?.state === 0 && svgOf(m).includes(GROUPS.purple.off), "sequence's own colour");
		await deck.waitFor((m) => m.event === "setTitle" && m.context === "Q2" && m.payload?.title === "Next ⏭\n(none on)", "next with nothing playing");

		// Pressing it plays it: it lights and shows the first step waiting for Next.
		let mark = deck.received.length;
		deck.send(keyEvent("keyDown", "Q1", settings, SEQUENCE_ACTION));
		await deck.waitFor((m) => after(mark)(m) && m.event === "setState" && m.context === "Q1" && m.payload?.state === 1, "lit while playing");
		await deck.waitFor((m) => after(mark)(m) && m.event === "setTitle" && m.context === "Q1" && m.payload?.title === "Quarter\nbreak\n1/2 Next", "first step");
		assert.equal((await scene()).playing?.id, qb.id);

		// Next moves on: the key counts down the 30 s step.
		mark = deck.received.length;
		deck.send(keyEvent("keyDown", "Q2", { host, press: "next" }, SEQUENCE_ACTION));
		await deck.waitFor((m) => after(mark)(m) && m.event === "setTitle" && m.context === "Q1" && /^Quarter\nbreak\n2\/2 0:(30|29|28)$/.test(m.payload?.title), "second step counting down");
		assert.equal((await scene()).playing?.step, 1);

		// Pressing the key again stops it.
		mark = deck.received.length;
		deck.send(keyEvent("keyDown", "Q1", settings, SEQUENCE_ACTION));
		await deck.waitFor((m) => after(mark)(m) && m.event === "setState" && m.context === "Q1" && m.payload?.state === 0, "dark when stopped");
		assert.equal((await scene()).playing, null);

		// The settings panel asks for the sequences.
		deck.send({ event: "propertyInspectorDidAppear", action: SEQUENCE_ACTION, context: "Q1", device: "DEV" });
		deck.send({ event: "sendToPlugin", action: SEQUENCE_ACTION, context: "Q1", payload: { cmd: "sequences", host } });
		const list = await deck.waitFor((m) => m.event === "sendToPropertyInspector" && m.payload?.type === "sequences", "sequence list");
		assert.deepEqual(list.payload.sequences, [{ id: qb.id, name: "Quarter break", colour: "purple" }]);
	} finally {
		plugin.kill();
		studio.kill();
		deck.close();
		fs.rmSync(dataDir, { recursive: true, force: true });
	}
});

test("real SDK and real Studio: Switcher keys show the tally and press the switcher", { timeout: 60000 }, async () => {
	const atem = await startAtem({ model: "MiniExtreme", names: ["Wide", "Court", "Bench"] });
	const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-deck-"));
	const studioPort = 20000 + Math.floor(Math.random() * 20000);
	const studio = await startStudio(studioPort, dataDir);
	const host = `http://127.0.0.1:${studioPort}`;
	const deck = await startDeck();
	const plugin = launchPlugin(deck.port);
	const after = (mark: number) => (m: Msg) => deck.received.indexOf(m) >= mark;
	const title = (context: string, t: string | RegExp, mark = 0) => (m: Msg) =>
		after(mark)(m) && m.event === "setTitle" && m.context === context && (typeof t === "string" ? m.payload?.title === t : t.test(m.payload?.title));
	const stateOf = (context: string, state: number, mark: number) => (m: Msg) => after(mark)(m) && m.event === "setState" && m.context === context && m.payload?.state === state;
	const court = { host, press: "preview", input: "2", inputName: "Court" };
	const bench = { host, press: "program", input: "3", inputName: "Bench" };
	const dsk = { host, press: "dsk", key: "1" };

	try {
		await deck.waitFor((m) => m.event === "registerPlugin", "registration", 15000);
		// No switcher picked yet: the keys say so.
		deck.send(keyEvent("willAppear", "W1", court, SWITCHER_ACTION));
		await deck.waitFor(title("W1", "Court\n(not set up)"), "no switcher");

		// Picked on the Output page: the keys follow the switcher's own tally (Wide on program and preview).
		atem.set({ program: 1, preview: 1 });
		await fetch(`${host}/api/switcher`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "use", address: `127.0.0.1:${atem.port}` }) });
		await deck.waitFor(title("W1", "Court"), "connected", 15000);
		deck.send(keyEvent("willAppear", "W2", bench, SWITCHER_ACTION));
		deck.send(keyEvent("willAppear", "W3", dsk, SWITCHER_ACTION));
		await deck.waitFor(title("W3", "Down key\n1"), "downstream key");
		const off = await deck.waitFor((m) => m.event === "setImage" && m.context === "W2" && m.payload?.state === 0, "dark image");
		assert.ok(svgOf(off).includes(GROUPS.blue.off));

		// Court to preview from the key: it lights green.
		let mark = deck.received.length;
		deck.send(keyEvent("keyDown", "W1", court, SWITCHER_ACTION));
		await deck.waitFor(stateOf("W1", 1, mark), "lit on preview");
		const green = await deck.waitFor((m) => after(mark)(m) && m.event === "setImage" && m.context === "W1" && m.payload?.state === 1, "green image");
		assert.ok(svgOf(green).includes(TALLY.preview));
		assert.equal(atem.state.preview, 2);

		// Bench cut straight to program: it lights red; Court stays green on preview.
		mark = deck.received.length;
		deck.send(keyEvent("keyDown", "W2", bench, SWITCHER_ACTION));
		await deck.waitFor(stateOf("W2", 1, mark), "lit on program");
		// Its lit image was red from the start (red is a camera key's lit colour unless it's on preview).
		const red = await deck.waitFor((m) => m.event === "setImage" && m.context === "W2" && m.payload?.state === 1, "red image");
		assert.ok(svgOf(red).includes(TALLY.program));
		assert.equal(atem.state.program, 3);

		// A cut on the switcher's own panel: the keys follow it (Court red now, Bench dark).
		mark = deck.received.length;
		atem.set({ program: 2, preview: 1 });
		await deck.waitFor((m) => after(mark)(m) && m.event === "setImage" && m.context === "W1" && m.payload?.state === 1 && svgOf(m).includes(TALLY.program), "Court red after a panel cut");
		await deck.waitFor(stateOf("W2", 0, mark), "Bench dark after a panel cut");

		// The downstream key on from its key, lit while on air.
		mark = deck.received.length;
		deck.send(keyEvent("keyDown", "W3", dsk, SWITCHER_ACTION));
		await deck.waitFor(stateOf("W3", 1, mark), "downstream key on air");
		assert.equal(atem.state.dsk[0], true);

		// The settings panel asks what the switcher has.
		deck.send({ event: "propertyInspectorDidAppear", action: SWITCHER_ACTION, context: "W1", device: "DEV" });
		deck.send({ event: "sendToPlugin", action: SWITCHER_ACTION, context: "W1", payload: { cmd: "switcher", host } });
		const list = await deck.waitFor((m) => m.event === "sendToPropertyInspector" && m.payload?.type === "switcher", "switcher list");
		assert.equal(list.payload.connected, true);
		assert.equal(list.payload.model, "ATEM Mini Extreme");
		assert.deepEqual(list.payload.inputs.slice(0, 3), [{ id: 1, name: "Wide" }, { id: 2, name: "Court" }, { id: 3, name: "Bench" }]);
		assert.equal(list.payload.usk, 4);
		assert.equal(list.payload.dsk, 2);

		// The switcher stops answering: the keys go dark with the warning dot, and a press is refused with an alert.
		mark = deck.received.length;
		atem.drop();
		await deck.waitFor(title("W1", "Court\n(offline)", mark), "not answering", 15000);
		const warned = await deck.waitFor((m) => after(mark)(m) && m.event === "setImage" && m.context === "W1" && m.payload?.state === 0, "warning dot");
		assert.ok(svgOf(warned).includes(`fill="${DOT}"`));
		deck.send(keyEvent("keyDown", "W2", bench, SWITCHER_ACTION));
		await deck.waitFor((m) => after(mark)(m) && m.event === "showAlert" && m.context === "W2", "alert while not answering");
		assert.equal(atem.state.program, 2, "nothing saved up");
	} finally {
		plugin.kill();
		studio.kill();
		deck.close();
		await atem.close();
		fs.rmSync(dataDir, { recursive: true, force: true });
	}
});

test("real SDK and real Studio: the plugin asks to pair, then signs every press", { timeout: 60000 }, async () => {
	const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-deck-"));
	const studioPort = 20000 + Math.floor(Math.random() * 20000);
	const studio = await startStudio(studioPort, dataDir);
	const host = `http://127.0.0.1:${studioPort}`;
	const deck = await startDeck();
	const plugin = launchPlugin(deck.port);
	const post = (body: object) => fetch(`${host}/api/scene`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	const scene = async () => (await (await fetch(`${host}/api/scene`)).json()) as { sources: { id: string; name: string; visible: boolean }[] };
	type Devices = { devices: { id: string; kind: string; name: string; lastSeen: string | null }[]; asking: { id: string; name: string } | null };
	const devices = async () => (await (await fetch(`${host}/api/devices`)).json()) as Devices;
	const until = async <T>(get: () => Promise<T>, ok: (v: T) => boolean, label: string): Promise<T> => {
		for (let i = 0; i < 100; i++) {
			const v = await get();
			if (ok(v)) return v;
			await new Promise((r) => setTimeout(r, 100));
		}
		throw new Error(`timed out waiting for ${label}`);
	};

	try {
		await deck.waitFor((m) => m.event === "registerPlugin", "registration", 15000);
		assert.ok((await post({ type: "add", source: { type: "browser", name: "Up Next", url: "upnext.html" } })).ok);
		const src = (await scene()).sources[0];
		const settings = { host, source: src.id, sourceName: src.name };
		deck.send(keyEvent("willAppear", "K1", settings));
		await deck.waitFor((m) => m.event === "setTitle" && m.context === "K1" && m.payload?.title === "Up Next", "source title");

		// First press: no plugin has paired yet, so the old header still presses it, and the plugin asks to pair.
		deck.send(keyEvent("keyDown", "K1", settings));
		await until(scene, (s) => s.sources[0].visible, "shown by the first press");
		const { asking } = await until(devices, (d) => !!d.asking, "the pairing request");
		assert.match(asking!.name, /^Stream Deck on /);
		const saved = deck.globalSettings() as { identity?: { publicKey: string; privateKey: string } };
		assert.ok(saved.identity?.publicKey && saved.identity.privateKey, "its key pair is kept in the global settings");

		// Allowed on the Mac: the plugin saves the device id and signs from now on.
		assert.ok((await fetch(`${host}/api/devices/requests/${asking!.id}/allow`, { method: "POST" })).ok);
		await until(async () => deck.globalSettings() as { identity?: { studios: Record<string, string> } }, (g) => !!g.identity?.studios?.[host], "the device id saved");
		const paired = (await devices()).devices.find((d) => d.kind === "plugin")!;
		assert.ok(paired && paired.lastSeen === null);
		deck.send(keyEvent("keyDown", "K1", settings));
		await until(scene, (s) => !s.sources[0].visible, "hidden by a signed press");
		assert.ok((await devices()).devices.find((d) => d.id === paired.id)!.lastSeen, "the press was signed by this device");

		// The bare header no longer presses anything.
		assert.equal((await fetch(`${host}/deck/layer/up-next/on`, { headers: { "x-studio-deck": "1" } })).status, 403);

		// Removed in Devices…: the next press is refused and asks again.
		assert.ok((await fetch(`${host}/api/devices/${paired.id}/revoke`, { method: "POST" })).ok);
		const mark = deck.received.length;
		deck.send(keyEvent("keyDown", "K1", settings));
		await deck.waitFor((m) => deck.received.indexOf(m) >= mark && m.event === "showAlert", "alert when removed");
		await until(devices, (d) => !!d.asking, "asking again");
	} finally {
		plugin.kill();
		studio.kill();
		deck.close();
		fs.rmSync(dataDir, { recursive: true, force: true });
	}
});
