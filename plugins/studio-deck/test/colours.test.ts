import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { contrast, GROUPS, groupOf, keyImage, keyImageUrl, type KeyKind, ON } from "../src/lib/colours";

const PANEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "com.runplaywin.firstpass-studio.sdPlugin", "ui", "source.html");
const groups = Object.keys(GROUPS) as (keyof typeof GROUPS)[];
const kinds: KeyKind[] = ["source", "scene", "sequence"];

test("colour groups: the five phases, blue when not set or unknown", () => {
	assert.deepEqual(groups, ["blue", "green", "grey", "yellow", "purple"]);
	assert.equal(groupOf(undefined), "blue");
	assert.equal(groupOf(""), "blue");
	assert.equal(groupOf("orange"), "blue");
	assert.equal(groupOf("toString"), "blue");
	assert.equal(groupOf("yellow"), "yellow");
});

test("key images: group body while off, orange while on, group band in both, for every kind", () => {
	for (const kind of kinds) {
		for (const g of groups) {
			const off = keyImage(kind, g, 0);
			const on = keyImage(kind, g, 1);
			assert.match(off, /^<svg [^>]*viewBox="0 0 144 144"/);
			assert.ok(off.includes(`fill="${GROUPS[g].off}"`), `${kind} ${g} off body`);
			assert.ok(!off.includes(ON), `${kind} ${g} off has no orange`);
			assert.ok(on.includes(`fill="${ON}"`), `${kind} ${g} on body`);
			assert.ok(off.includes(`fill="${GROUPS[g].band}"`) && on.includes(`fill="${GROUPS[g].band}"`), `${kind} ${g} band`);
		}
		assert.equal(keyImage(kind, undefined, 1), keyImage(kind, "blue", 1));
		// Every group looks different from every other, off and on.
		assert.equal(new Set(groups.map((g) => keyImage(kind, g, 0))).size, groups.length);
		assert.equal(new Set(groups.map((g) => keyImage(kind, g, 1))).size, groups.length);
	}
});

test("key images: Source, Scene and Sequence keys each have their own picture and band", () => {
	for (const g of groups) {
		for (const state of [0, 1] as const) {
			const images = kinds.map((kind) => keyImage(kind, g, state));
			assert.equal(new Set(images).size, kinds.length, `${g} ${state}`);
		}
	}
	// Source: one solid band. Scene: a frame over the top and sides too. Sequence: the band in four steps.
	const bands = (svg: string) => (svg.match(new RegExp(`fill="${GROUPS.blue.band}"`, "g")) ?? []).length;
	assert.equal(bands(keyImage("source", "blue", 0)), 1);
	assert.equal(bands(keyImage("scene", "blue", 0)), 2);
	assert.equal(bands(keyImage("sequence", "blue", 0)), 4);
});

test("key images go to Stream Deck as SVG data URLs", () => {
	for (const kind of kinds) {
		for (const g of groups) {
			for (const state of [0, 1] as const) {
				const url = keyImageUrl(kind, g, state);
				assert.match(url, /^data:image\/svg\+xml,%3Csvg%20/);
				assert.ok(!/[<>"#\s]/.test(url), `${kind} ${g} ${state}: no characters a URL must encode`);
				assert.equal(decodeURIComponent(url.slice("data:image/svg+xml,".length)), keyImage(kind, g, state));
			}
		}
	}
});

test("contrast: on stands out from off in every colour, titles and bands read", () => {
	assert.equal(contrast("#ffffff", "#000000"), 21);
	assert.equal(contrast("#123456", "#123456"), 1);
	for (const g of groups) {
		const { off, band } = GROUPS[g];
		// WCAG's 3:1 for parts of a control: a lit key can't be mistaken for an unlit one, grey and yellow included.
		assert.ok(contrast(off, ON) >= 3, `${g}: off vs on ${contrast(off, ON).toFixed(2)}`);
		// Stream Deck's white title on the dark body.
		assert.ok(contrast(off, "#ffffff") >= 7, `${g}: title ${contrast(off, "#ffffff").toFixed(2)}`);
		// The group's band stands out from the body it sits under.
		assert.ok(contrast(off, band) >= 3, `${g}: band ${contrast(off, band).toFixed(2)}`);
	}
});

test("settings panel lists every group, in order, with the same labels", () => {
	const html = fs.readFileSync(PANEL, "utf8");
	const select = html.match(/<select id="colour">([\s\S]*?)<\/select>/)?.[1] ?? "";
	const options = [...select.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]);
	assert.deepEqual(options, groups.map((g) => [g, GROUPS[g].label]));
});
