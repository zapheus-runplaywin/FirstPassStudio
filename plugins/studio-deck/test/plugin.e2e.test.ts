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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(ROOT, "..", "..");
const SD_PLUGIN = path.join(ROOT, "com.runplaywin.firstpass-studio.sdPlugin");
const ACTION = "com.runplaywin.firstpass-studio.source";

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

const keyEvent = (event: string, context: string, settings: object) => ({
	event,
	action: ACTION,
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

		// Shown from somewhere else (the Output page, a link): the key lights.
		let mark = deck.received.length;
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
