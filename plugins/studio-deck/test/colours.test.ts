import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { contrast, DOT, keyImage, keyImageUrl, type KeyKind, KINDS, OUTPUT_COLOURS, TALLY } from "../src/lib/colours";

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "com.runplaywin.firstpass-studio.sdPlugin", "ui");
const kinds = Object.keys(KINDS) as KeyKind[];
const out = (slot: number) => ({ slot, colour: OUTPUT_COLOURS[slot - 1] });

test("key kinds: seven, each in its own colour off and on", () => {
	assert.deepEqual(kinds, ["source", "sound", "scene", "sequence", "runorder", "switcher", "playback"]);
	assert.equal(new Set(kinds.map((k) => KINDS[k].on)).size, kinds.length);
	assert.equal(new Set(kinds.map((k) => KINDS[k].off)).size, kinds.length);
});

test("key images: dark in the kind's colour while off, lit in it while on, for every kind", () => {
	for (const kind of kinds) {
		const off = keyImage(kind, 0);
		const on = keyImage(kind, 1);
		assert.match(off, /^<svg [^>]*viewBox="0 0 144 144"/);
		assert.ok(off.includes(`<rect width="144" height="144" fill="${KINDS[kind].off}"/>`), `${kind} off body`);
		assert.ok(on.includes(`<rect width="144" height="144" fill="${KINDS[kind].on}"/>`), `${kind} on body`);
	}
	// Every kind looks different from every other, off and on.
	for (const state of [0, 1] as const) assert.equal(new Set(kinds.map((k) => keyImage(k, state))).size, kinds.length);
	// The picture is in the kind's colour while off and black while lit.
	assert.ok(keyImage("scene", 0).includes(`fill="${KINDS.scene.on}"`));
	assert.ok(keyImage("scene", 1).includes(`fill="#000"`));
});

test("key images: the output's disc in its colour with its number, none without an output", () => {
	for (const slot of [1, 2, 3, 4]) {
		const svg = keyImage("source", 0, { output: out(slot) });
		assert.ok(svg.includes(`<circle cx="112" cy="32" r="22" fill="${OUTPUT_COLOURS[slot - 1]}"`), `output ${slot} disc`);
		assert.match(svg, /<path transform="translate\(112 32\)" d="M/);
	}
	// Each output's number is drawn differently.
	assert.equal(new Set([1, 2, 3, 4].map((s) => keyImage("scene", 1, { output: { slot: s, colour: OUTPUT_COLOURS[0] } }))).size, 4);
	assert.ok(!keyImage("switcher", 0).includes("<circle"));
	// A colour that isn't one falls back to Output 1's orange.
	assert.ok(keyImage("source", 0, { output: { slot: 2, colour: "nonsense" } }).includes(`fill="${OUTPUT_COLOURS[0]}"`));
});

test("key images: a Switcher key lights in its tally colour; other kinds ignore lit", () => {
	assert.ok(keyImage("switcher", 1, { lit: TALLY.preview }).includes(`fill="${TALLY.preview}"`));
	assert.equal(keyImage("switcher", 1, { lit: "nonsense" }), keyImage("switcher", 1));
	assert.equal(keyImage("scene", 1, { lit: TALLY.preview }), keyImage("scene", 1));
	assert.ok(keyImage("scene", 0, { dot: true }).includes(`fill="${DOT}"`));
	assert.ok(!keyImage("scene", 0).includes(DOT));
});

test("key images go to Stream Deck as SVG data URLs", () => {
	for (const kind of kinds) {
		for (const state of [0, 1] as const) {
			const look = { output: out(2), dot: true };
			const url = keyImageUrl(kind, state, look);
			assert.match(url, /^data:image\/svg\+xml,%3Csvg%20/);
			assert.ok(!/[<>"#\s]/.test(url), `${kind} ${state}: no characters a URL must encode`);
			assert.equal(decodeURIComponent(url.slice("data:image/svg+xml,".length)), keyImage(kind, state, look));
		}
	}
});

test("contrast: on stands out from off, titles, pictures and discs read", () => {
	assert.equal(contrast("#ffffff", "#000000"), 21);
	assert.equal(contrast("#123456", "#123456"), 1);
	for (const kind of kinds) {
		const { off, on } = KINDS[kind];
		// WCAG's 3:1 for parts of a control: a lit key can't be mistaken for an unlit one.
		assert.ok(contrast(off, on) >= 3, `${kind}: off vs on ${contrast(off, on).toFixed(2)}`);
		// Stream Deck's white title on the dark body, its black title on the lit one.
		assert.ok(contrast(off, "#ffffff") >= 7, `${kind}: white title ${contrast(off, "#ffffff").toFixed(2)}`);
		assert.ok(contrast(on, "#000000") >= 4.5, `${kind}: black title ${contrast(on, "#000000").toFixed(2)}`);
		// Every output's disc stands out from the dark body.
		for (const c of OUTPUT_COLOURS) assert.ok(contrast(off, c) >= 3, `${kind}: disc ${c} ${contrast(off, c).toFixed(2)}`);
	}
	// A Switcher key's tally colours stand out from its dark body, and its black title reads on them.
	for (const [name, lit] of Object.entries(TALLY)) {
		assert.ok(contrast(KINDS.switcher.off, lit) >= 3, `off vs ${name}`);
		assert.ok(contrast(lit, "#000000") >= 4.5, `${name}: black title ${contrast(lit, "#000000").toFixed(2)}`);
	}
});

test("settings panels have no colour to pick: colour is the kind", () => {
	for (const file of fs.readdirSync(UI)) assert.ok(!fs.readFileSync(path.join(UI, file), "utf8").includes('id="colour"'), file);
});
