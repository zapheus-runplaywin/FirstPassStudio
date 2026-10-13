/**
 * End-to-end: a fake Stream Deck app (WebSocket server) launches the real plugin (src/plugin.ts via tsx,
 * using the real @elgato/streamdeck SDK), arms a key a few seconds ahead, and checks the sequence runs.
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

import { startMockObs } from "./support/mock-obs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SD_PLUGIN = path.join(ROOT, "com.runplaywin.timed-sequence.sdPlugin");
const ACTION = "com.runplaywin.timed-sequence.run";

type Msg = { event: string; context?: string; payload?: any; _at: number }; // eslint-disable-line @typescript-eslint/no-explicit-any

function frame(text: string): Buffer {
	const p = Buffer.from(text);
	let h: Buffer;
	if (p.length < 126) h = Buffer.from([0x81, p.length]);
	else if (p.length < 65536) {
		h = Buffer.alloc(4);
		h[0] = 0x81;
		h[1] = 126;
		h.writeUInt16BE(p.length, 2);
	} else {
		h = Buffer.alloc(10);
		h[0] = 0x81;
		h[1] = 127;
		h.writeBigUInt64BE(BigInt(p.length), 2);
	}
	return Buffer.concat([h, p]);
}

async function startHost(globalSettings: Record<string, unknown> = {}) {
	const received: Msg[] = [];
	const hooks: { method: string; body: string; at: number }[] = [];
	let sock: Socket | null = null;
	let buf = Buffer.alloc(0);

	const server = http.createServer((req, res) => {
		let body = "";
		req.on("data", (d) => (body += d));
		req.on("end", () => {
			hooks.push({ method: req.method!, body, at: Date.now() });
			res.end("ok");
		});
	});
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
				// Answer the plugin's global settings requests like Stream Deck does.
				if (msg.event === "getGlobalSettings") {
					socket.write(frame(JSON.stringify({ event: "didReceiveGlobalSettings", id: msg.id, payload: { settings: globalSettings } })));
				}
			}
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const port = (server.address() as { port: number }).port;

	return {
		port,
		received,
		hooks,
		send: (obj: object) => sock!.write(frame(JSON.stringify(obj))),
		async waitFor(pred: (m: Msg) => boolean, ms = 5000, label = "message"): Promise<Msg> {
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

function launchPlugin(port: number): ChildProcess {
	const info = {
		application: { font: "", language: "en", platform: process.platform === "win32" ? "windows" : "mac", platformVersion: "14.0", version: "7.1.0.21000" },
		colors: {},
		devicePixelRatio: 2,
		devices: [{ id: "DEV", name: "Stream Deck", size: { columns: 5, rows: 3 }, type: 0 }],
		plugin: { uuid: "com.runplaywin.timed-sequence", version: "1.0.0.0" },
	};
	return spawn(
		process.execPath,
		["--import", "tsx", path.join(ROOT, "src", "plugin.ts"), "-port", String(port), "-pluginUUID", "PLUGIN-UUID", "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)],
		{ cwd: SD_PLUGIN, stdio: ["ignore", "ignore", "inherit"] },
	);
}

const hhmmss = (d: Date): string => [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");

const appear = (context: string, settings: object) => ({
	event: "willAppear",
	action: ACTION,
	context,
	device: "DEV",
	payload: { controller: "Keypad", coordinates: { column: 0, row: 0 }, isInMultiAction: false, settings, state: 0 },
});
const keyDown = (context: string, settings: object) => ({
	event: "keyDown",
	action: ACTION,
	context,
	device: "DEV",
	payload: { coordinates: { column: 0, row: 0 }, isInMultiAction: false, settings, state: 0 },
});

test("real SDK: arm, wait for the local time, run steps with delays and OBS, PI status and commands", { timeout: 40000 }, async () => {
	const obs = await startMockObs({ password: "obs-pass" });
	const host = await startHost({ obsAddress: obs.address, obsPassword: "obs-pass" });
	const child = launchPlugin(host.port);
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ts-e2e-"));
	const outFile = path.join(tmp, "out.txt");

	try {
		const reg = await host.waitFor((m) => m.event === "registerPlugin", 15000, "registration");
		assert.equal((reg as unknown as { uuid: string }).uuid, "PLUGIN-UUID");

		const target = new Date(Math.ceil(Date.now() / 1000) * 1000 + 3000);
		const settings = {
			time: hhmmss(target),
			script: [
				"log starting",
				"wait 1500ms",
				`run echo hello> "${outFile}"`,
				"wait 1s",
				`post http://127.0.0.1:${host.port}/hook {"go": true}`,
				"obs scene Full Time",
				"obs show Winner",
				"ok",
			].join("\n"),
		};
		host.send(appear("CTX1", settings));
		const idle = await host.waitFor((m) => m.event === "setTitle" && m.context === "CTX1", 5000, "idle title");
		assert.match(idle.payload.title, /OFF$/);

		// Property inspector opens and gets a status message.
		host.send({ event: "propertyInspectorDidAppear", action: ACTION, context: "CTX1", device: "DEV" });
		const status = await host.waitFor((m) => m.event === "sendToPropertyInspector" && m.payload?.type === "status", 3000, "PI status");
		assert.equal(status.payload.state, "idle");

		host.send(keyDown("CTX1", settings));
		const saved = await host.waitFor((m) => m.event === "setSettings" && !!m.payload?.armedFor, 3000, "armedFor saved");
		assert.equal(saved.payload.armedFor, target.getTime());
		await host.waitFor((m) => m.event === "setState" && m.payload?.state === 1, 3000, "armed image");
		await host.waitFor((m) => m.event === "setTitle" && /\n0:0[1-3]$/.test(m.payload?.title), 3000, "countdown");

		const running = await host.waitFor((m) => m.event === "setTitle" && /^RUN/.test(m.payload?.title), 8000, "running");
		assert.ok(running._at >= target.getTime() - 5, "must not start early");
		assert.ok(running._at - target.getTime() < 500, `started ${running._at - target.getTime()}ms late`);

		await host.waitFor((m) => m.event === "showOk" && m._at > running._at, 10000, "ok step");
		assert.equal(host.hooks.length, 1);
		assert.equal(host.hooks[0].body, '{"go": true}');
		const elapsed = host.hooks[0].at - target.getTime();
		assert.ok(elapsed >= 2500 && elapsed < 4000, `webhook fired ${elapsed}ms after start; expected ~2.5s of waits`);
		assert.equal(fs.readFileSync(outFile, "utf8").trim(), "hello");
		assert.equal(obs.programScene, "Full Time", "OBS switched scene");
		assert.equal(obs.scenes["Full Time"].Winner, true, "OBS showed the source in the new scene");
		const sceneSwitch = obs.requests.find((r) => r.requestType === "SetCurrentProgramScene")!;
		assert.ok(sceneSwitch.at >= host.hooks[0].at, "OBS steps ran in order after the webhook");

		// Settings panel: Test connection with the typed address and password.
		host.send({ event: "sendToPlugin", action: ACTION, context: "CTX1", payload: { cmd: "testObs", address: obs.address, password: "obs-pass" } });
		const tested = await host.waitFor((m) => m.event === "sendToPropertyInspector" && m.payload?.type === "obsTest", 5000, "OBS test reply");
		assert.equal(tested.payload.ok, true);
		assert.match(tested.payload.message, /^Connected to OBS 31\.0\.0\. Scenes: Live, Full Time$/);
		host.send({ event: "sendToPlugin", action: ACTION, context: "CTX1", payload: { cmd: "testObs", address: obs.address, password: "nope" } });
		const failed = await host.waitFor((m) => m.event === "sendToPropertyInspector" && m.payload?.type === "obsTest" && m.payload.ok === false, 5000, "OBS test failure");
		assert.match(failed.payload.message, /rejected the password/);

		await host.waitFor((m) => m.event === "setState" && m.payload?.state === 0 && m._at > running._at, 3000, "back to idle");
		const last = host.received.filter((m) => m.event === "setSettings").at(-1)!;
		assert.equal(last.payload.armedFor, undefined, "armedFor cleared after the run");

		// "Test run now" from the property inspector, then stop it with a key press mid-wait.
		const longScript = { ...settings, script: `wait 10s\nget http://127.0.0.1:${host.port}/never` };
		host.send({ event: "didReceiveSettings", action: ACTION, context: "CTX1", device: "DEV", payload: { settings: longScript, coordinates: { column: 0, row: 0 }, isInMultiAction: false } });
		host.send({ event: "sendToPlugin", action: ACTION, context: "CTX1", payload: { cmd: "runNow" } });
		await host.waitFor((m) => m.event === "setTitle" && /^RUN 1\/2\n0:(09|10)$/.test(m.payload?.title), 3000, "manual run countdown");
		const before = host.received.length;
		host.send(keyDown("CTX1", longScript));
		await host.waitFor((m) => host.received.indexOf(m) >= before && m.event === "setTitle" && /OFF$/.test(m.payload?.title), 3000, "stopped");
		await new Promise((r) => setTimeout(r, 300));
		assert.equal(host.hooks.length, 1, "stopped sequence must not continue");

		// Restart recovery: a key that appears with a future armedFor re-arms itself.
		const armedFor = Date.now() + 3_600_000;
		host.send(appear("CTX2", { time: hhmmss(new Date(armedFor)), script: "ok", armedFor }));
		await host.waitFor((m) => m.event === "setTitle" && m.context === "CTX2" && /\n(1:00:00|59:5\d)$/.test(m.payload?.title), 3000, "restored countdown");
	} finally {
		child.kill();
		host.close();
		await obs.close();
	}
});
