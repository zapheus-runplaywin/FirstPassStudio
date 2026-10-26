import assert from "node:assert/strict";
import { test } from "node:test";

import { TALLY } from "../src/lib/colours";
import { pressOf, switcherLinkFor, type SwitcherSettings, switcherViewOf, verbOf } from "../src/lib/switcher-key";
import type { Switcher } from "../src/lib/studio";

const extreme = (changes: Partial<Switcher> = {}): Switcher => ({
	setUp: true,
	state: "connected",
	model: "ATEM Mini Extreme",
	inputs: [
		{ id: 1, name: "Wide", short: "WIDE" },
		{ id: 2, name: "Court", short: "CRT" },
		{ id: 3, name: "Bench camera", short: "BNCH" },
	],
	program: 1,
	preview: 2,
	inTransition: false,
	usk: [false, true, false, false],
	dsk: [true, false],
	ftb: false,
	...changes,
});

test("Switcher key: a camera lights red on program and green on preview, by the switcher's own name", () => {
	const wide: SwitcherSettings = { press: "preview", input: "1", inputName: "Wide" };
	assert.deepEqual(switcherViewOf(wide, extreme()), { state: 1, lit: TALLY.program, title: "Wide", dot: false });
	assert.deepEqual(switcherViewOf({ press: "program", input: "2" }, extreme()), { state: 1, lit: TALLY.preview, title: "Court", dot: false });
	const bench = switcherViewOf({ input: "3", inputName: "Cam 3" }, extreme());
	assert.equal(bench.state, 0);
	assert.equal(bench.title, "Bench\ncamera", "renamed on the switcher: its name now");
	// A stinger key shows the tally of the camera it goes to.
	assert.deepEqual(switcherViewOf({ press: "stinger", input: "2" }, extreme()), { state: 1, lit: TALLY.preview, title: "Stinger\nCourt", dot: false });
	assert.equal(switcherViewOf({ press: "stinger" }, extreme()).title, "Stinger");
	// A camera the switcher hasn't got (moved from an Extreme to a Mini Pro, say).
	assert.equal(switcherViewOf({ input: "7", inputName: "Crowd" }, extreme()).title, "Crowd\n(not on it)");
	assert.equal(switcherViewOf({}, extreme()).title, "Pick an\ninput");
});

test("Switcher key: keys and Fade to black light while on air, Auto during a transition", () => {
	assert.equal(switcherViewOf({ press: "usk", key: "2" }, extreme()).state, 1);
	assert.equal(switcherViewOf({ press: "usk", key: "1" }, extreme()).state, 0);
	assert.deepEqual(switcherViewOf({ press: "dsk", key: "1" }, extreme()), { state: 1, lit: TALLY.program, title: "Down key\n1", dot: false });
	assert.equal(switcherViewOf({ press: "dsk", key: "3" }, extreme()).title, "Down key\n3\n(not on it)");
	assert.equal(switcherViewOf({ press: "ftb" }, extreme()).state, 0);
	assert.equal(switcherViewOf({ press: "ftb" }, extreme({ ftb: true })).state, 1);
	assert.equal(switcherViewOf({ press: "auto" }, extreme({ inTransition: true })).state, 1);
	assert.equal(switcherViewOf({ press: "cut" }, extreme()).title, "Cut");
	assert.equal(switcherViewOf({ press: "macro", macro: "4" }, extreme()).title, "Macro\n4");
});

test("Switcher key: says why when the switcher isn't there, with the warning dot while it isn't answering", () => {
	const wide: SwitcherSettings = { input: "1", inputName: "Wide" };
	assert.deepEqual(switcherViewOf(wide, null), { state: 0, lit: TALLY.program, title: "Wide\n(off air)", dot: false });
	assert.equal(switcherViewOf(wide, extreme({ setUp: false })).title, "Wide\n(not set up)");
	for (const state of ["lost", "connecting", "error"]) {
		const v = switcherViewOf(wide, extreme({ state }));
		assert.equal(v.title, "Wide\n(offline)");
		assert.equal(v.state, 0, "no tally from a switcher that isn't answering");
		assert.equal(v.dot, true);
	}
});

test("Switcher key: each press opens its /deck/switcher link", () => {
	assert.equal(switcherLinkFor({ input: "2" }), "/deck/switcher/preview/2");
	assert.equal(switcherLinkFor({ press: "program", input: "3" }), "/deck/switcher/program/3");
	assert.equal(switcherLinkFor({ press: "stinger", input: "2" }), "/deck/switcher/stinger/2");
	assert.equal(switcherLinkFor({ press: "stinger" }), "/deck/switcher/stinger");
	assert.equal(switcherLinkFor({ press: "cut" }), "/deck/switcher/cut");
	assert.equal(switcherLinkFor({ press: "auto" }), "/deck/switcher/auto");
	assert.equal(switcherLinkFor({ press: "ftb" }), "/deck/switcher/ftb");
	assert.equal(switcherLinkFor({ press: "usk", key: "1" }), "/deck/switcher/usk/1/toggle");
	assert.equal(switcherLinkFor({ press: "dsk", key: "2", verb: "auto" }), "/deck/switcher/dsk/2/auto");
	assert.equal(switcherLinkFor({ press: "dsk", key: "1", verb: "off" }), "/deck/switcher/dsk/1/off");
	assert.equal(switcherLinkFor({ press: "macro", macro: "3" }), "/deck/switcher/macro/3");
	// Not set up enough to press anything.
	assert.equal(switcherLinkFor({}), null);
	assert.equal(switcherLinkFor({ press: "usk" }), null);
	assert.equal(switcherLinkFor({ press: "macro", macro: "x" }), null);
	assert.equal(switcherLinkFor({ input: "0" }), null);
});

test("Switcher key: preview when not set, toggle unless set, and At its rate only for a downstream key", () => {
	assert.equal(pressOf({}), "preview");
	assert.equal(pressOf({ press: "nonsense" as never }), "preview");
	assert.equal(verbOf({ press: "usk" }), "toggle");
	assert.equal(verbOf({ press: "usk", verb: "auto" }), "toggle");
	assert.equal(verbOf({ press: "dsk", verb: "auto" }), "auto");
	assert.equal(verbOf({ press: "usk", verb: "on" }), "on");
});
