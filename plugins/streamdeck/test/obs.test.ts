import assert from "node:assert/strict";
import { test } from "node:test";

import { ObsClient, obsUrl, setSourceVisible, switchScene, testObsConnection } from "../src/lib/obs";
import { parseScript } from "../src/lib/sequence";
import { runSteps, type RunContext } from "../src/lib/steps";
import { startMockObs } from "./support/mock-obs";

test("obs addresses", () => {
	assert.equal(obsUrl(undefined), "ws://localhost:4455");
	assert.equal(obsUrl(""), "ws://localhost:4455");
	assert.equal(obsUrl("192.168.1.20"), "ws://192.168.1.20:4455");
	assert.equal(obsUrl("studio-pc:4460"), "ws://studio-pc:4460");
	assert.equal(obsUrl("ws://localhost:4455"), "ws://localhost:4455");
});

test("parses obs steps", () => {
	const { steps, errors } = parseScript(
		[
			"obs scene Full Time",
			"obs show Winner",
			"obs hide Winner in Full Time",
			'obs toggle "Sign in board" in "Full Time"',
			'obs scene "Pre Game"',
		].join("\n"),
	);
	assert.deepEqual(errors, []);
	assert.deepEqual(
		steps.map((s) => (s.type === "obs" ? [s.op, s.name, s.scene] : null)),
		[
			["scene", "Full Time", undefined],
			["show", "Winner", undefined],
			["hide", "Winner", "Full Time"],
			["toggle", "Sign in board", "Full Time"],
			["scene", "Pre Game", undefined],
		],
	);

	const bad = parseScript("obs\nobs scene\nobs mute Mic\nobs show a in b in c\nobs hide Winner in");
	assert.deepEqual(
		bad.errors.map((e) => e.line),
		[1, 2, 3, 4, 5],
	);
});

test("authenticates with a password, switches scenes and shows/hides sources", async () => {
	const obs = await startMockObs({ password: "s3cret" });
	const client = new ObsClient(obsUrl(obs.address), "s3cret");
	try {
		await switchScene(client, "Full Time");
		assert.equal(obs.programScene, "Full Time");

		// Unnamed scene = the current program scene (now Full Time).
		assert.deepEqual(await setSourceVisible(client, "Winner", true), { sceneName: "Full Time", visible: true });
		assert.equal(obs.scenes["Full Time"].Winner, true);

		assert.deepEqual(await setSourceVisible(client, "Scoreboard", false, "Live"), { sceneName: "Live", visible: false });
		assert.equal(obs.scenes.Live.Scoreboard, false);

		await setSourceVisible(client, "Ladder", "toggle", "Full Time");
		assert.equal(obs.scenes["Full Time"].Ladder, false);
		await setSourceVisible(client, "Ladder", "toggle", "Full Time");
		assert.equal(obs.scenes["Full Time"].Ladder, true);

		await assert.rejects(switchScene(client, "Nope"), /OBS couldn't do SetCurrentProgramScene/);
		await assert.rejects(setSourceVisible(client, "Ghost", true, "Live"), /OBS has no source "Ghost" in scene "Live"/);
	} finally {
		client.close();
		await obs.close();
	}
});

test("clear errors for a wrong password, a missing password and OBS not running", async () => {
	const obs = await startMockObs({ password: "s3cret" });
	try {
		await assert.rejects(new ObsClient(obsUrl(obs.address), "wrong").connect(), /rejected the password/);
		await assert.rejects(new ObsClient(obsUrl(obs.address), "").connect(), /OBS needs a password/);
	} finally {
		await obs.close();
	}
	await assert.rejects(new ObsClient(obsUrl(obs.address), "").connect(), /Can't reach OBS at ws:\/\/127\.0\.0\.1:\d+.*Enable WebSocket server/);
});

test("reconnects by itself after OBS drops the connection", async () => {
	const obs = await startMockObs();
	const client = new ObsClient(obsUrl(obs.address), "");
	try {
		await switchScene(client, "Full Time");
		obs.dropConnections();
		await new Promise((r) => setTimeout(r, 200));
		assert.equal(client.connected, false);
		await switchScene(client, "Live");
		assert.equal(obs.programScene, "Live");
	} finally {
		client.close();
		await obs.close();
	}
});

test("test button reports the OBS version and scenes in OBS's order", async () => {
	const obs = await startMockObs();
	try {
		assert.equal(await testObsConnection(obs.address, ""), "Connected to OBS 31.0.0. Scenes: Live, Full Time");
	} finally {
		await obs.close();
	}
});

test("obs steps run inside a sequence with waits, reusing one connection", async () => {
	const obs = await startMockObs();
	const client = new ObsClient(obsUrl(obs.address), "");
	const logs: string[] = [];
	const ctx: RunContext = {
		signal: new AbortController().signal,
		stopOnError: true,
		onStep: () => undefined,
		progress: () => undefined,
		log: (m) => logs.push(m),
		showOk: () => undefined,
		showAlert: () => undefined,
		openUrl: async () => undefined,
		obs: async () => client,
	};
	try {
		const { steps } = parseScript("obs scene Full Time\nwait 300ms\nobs show Winner\nwait 200ms\nobs hide Winner\nobs scene Live");
		const start = Date.now();
		assert.deepEqual(await runSteps(steps, ctx), { ok: true });
		assert.equal(obs.programScene, "Live");
		assert.equal(obs.scenes["Full Time"].Winner, false);
		const shown = obs.requests.find((r) => r.requestType === "SetSceneItemEnabled" && r.requestData?.sceneItemEnabled === true)!;
		const hidden = obs.requests.find((r) => r.requestType === "SetSceneItemEnabled" && r.requestData?.sceneItemEnabled === false)!;
		assert.ok(shown.at - start >= 300, "first wait honoured");
		assert.ok(hidden.at - shown.at >= 200, "second wait honoured");
		assert.ok(logs.includes('OBS showed "Winner" in "Full Time"'));

		// A failing OBS step stops the sequence with the line number.
		const bad = await runSteps(parseScript("obs scene Nope\nlog after").steps, ctx);
		assert.equal(bad.ok, false);
		assert.match(!bad.ok ? bad.error : "", /^Line 1 \(obs scene\): OBS couldn't do SetCurrentProgramScene/);
		assert.ok(!logs.includes("after"));
	} finally {
		client.close();
		await obs.close();
	}
});
