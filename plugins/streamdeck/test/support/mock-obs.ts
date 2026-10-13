/**
 * A fake OBS for tests: a WebSocket server speaking obs-websocket v5 (Hello / Identify / Identified,
 * Request / RequestResponse), with optional password auth, scenes and sources.
 */
import { createHash } from "node:crypto";
import http from "node:http";
import type { Socket } from "node:net";

import { obsAuthResponse } from "../../src/lib/obs";

export type MockObs = {
	port: number;
	address: string;
	programScene: string;
	/** scene -> source -> visible */
	scenes: Record<string, Record<string, boolean>>;
	/** Every request received, in order. */
	requests: { requestType: string; requestData?: Record<string, unknown>; at: number }[];
	/** Drop every client connection but keep listening (like OBS restarting). */
	dropConnections(): void;
	close(): Promise<void>;
};

function frame(opcode: number, payload: Buffer): Buffer {
	const len = payload.length;
	let header: Buffer;
	if (len < 126) header = Buffer.from([0x80 | opcode, len]);
	else if (len < 65536) {
		header = Buffer.alloc(4);
		header[0] = 0x80 | opcode;
		header[1] = 126;
		header.writeUInt16BE(len, 2);
	} else {
		header = Buffer.alloc(10);
		header[0] = 0x80 | opcode;
		header[1] = 127;
		header.writeBigUInt64BE(BigInt(len), 2);
	}
	return Buffer.concat([header, payload]);
}

export async function startMockObs(options: { password?: string; scenes?: Record<string, Record<string, boolean>>; programScene?: string } = {}): Promise<MockObs> {
	const sockets = new Set<Socket>();
	const salt = "c2FsdA==";
	const challenge = "Y2hhbGxlbmdl";

	const obs: MockObs = {
		port: 0,
		address: "",
		programScene: options.programScene ?? "Live",
		scenes: options.scenes ?? { Live: { Scoreboard: true, Winner: false }, "Full Time": { Winner: false, Ladder: true } },
		requests: [],
		dropConnections: () => {
			for (const s of sockets) s.destroy();
		},
		close: () =>
			new Promise((r) => {
				for (const s of sockets) s.destroy();
				server.close(() => r());
			}),
	};

	const server = http.createServer((_req, res) => res.end());
	server.on("upgrade", (req, socket: Socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
		const protocol = req.headers["sec-websocket-protocol"] ? `Sec-WebSocket-Protocol: ${String(req.headers["sec-websocket-protocol"]).split(",")[0].trim()}\r\n` : "";
		socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${protocol}\r\n`);

		const send = (obj: object): void => void socket.write(frame(0x1, Buffer.from(JSON.stringify(obj))));
		const closeWith = (code: number): void => {
			const p = Buffer.alloc(2);
			p.writeUInt16BE(code);
			socket.write(frame(0x8, p));
			socket.end();
		};

		send({ op: 0, d: { obsWebSocketVersion: "5.5.0", rpcVersion: 1, ...(options.password ? { authentication: { challenge, salt } } : {}) } });

		let buf = Buffer.alloc(0);
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
				if (opcode === 0x8) {
					socket.end();
					return;
				}
				if (opcode !== 0x1) continue;
				const msg = JSON.parse(Buffer.from(payload).toString()) as { op: number; d: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
				if (msg.op === 1) {
					if (options.password && msg.d.authentication !== obsAuthResponse(options.password, salt, challenge)) return closeWith(4009);
					send({ op: 2, d: { negotiatedRpcVersion: 1 } });
				} else if (msg.op === 6) {
					handleRequest(msg.d.requestType, msg.d.requestId, msg.d.requestData);
				}
			}
		});

		function handleRequest(requestType: string, requestId: string, data: Record<string, any> = {}): void { // eslint-disable-line @typescript-eslint/no-explicit-any
			obs.requests.push({ requestType, requestData: data, at: Date.now() });
			const ok = (responseData: object = {}): void => send({ op: 7, d: { requestType, requestId, requestStatus: { result: true, code: 100 }, responseData } });
			const fail = (code: number, comment: string): void => send({ op: 7, d: { requestType, requestId, requestStatus: { result: false, code, comment } } });
			const sources = (scene: string): string[] => Object.keys(obs.scenes[scene] ?? {});
			switch (requestType) {
				case "GetVersion":
					return ok({ obsVersion: "31.0.0", obsWebSocketVersion: "5.5.0" });
				case "GetSceneList":
					return ok({ currentProgramSceneName: obs.programScene, scenes: Object.keys(obs.scenes).reverse().map((sceneName, i) => ({ sceneName, sceneIndex: i })) });
				case "GetCurrentProgramScene":
					return ok({ sceneName: obs.programScene, currentProgramSceneName: obs.programScene });
				case "SetCurrentProgramScene":
					if (!obs.scenes[data.sceneName]) return fail(600, `No source was found by the name of \`${data.sceneName}\`.`);
					obs.programScene = data.sceneName;
					return ok();
				case "GetSceneItemId": {
					const i = sources(data.sceneName).indexOf(data.sourceName);
					if (i < 0) return fail(600, "No scene items were found in the specified scene by that name or offset.");
					return ok({ sceneItemId: i + 1 });
				}
				case "GetSceneItemEnabled": {
					const name = sources(data.sceneName)[data.sceneItemId - 1];
					return ok({ sceneItemEnabled: obs.scenes[data.sceneName][name] });
				}
				case "SetSceneItemEnabled": {
					const name = sources(data.sceneName)[data.sceneItemId - 1];
					obs.scenes[data.sceneName][name] = data.sceneItemEnabled;
					return ok();
				}
				default:
					return fail(204, `Unknown request ${requestType}`);
			}
		}
	});

	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	obs.port = (server.address() as { port: number }).port;
	obs.address = `127.0.0.1:${obs.port}`;
	return obs;
}
