import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";

import { getIdentity, type Identity, signedHeaders, useIdentityStore } from "../src/lib/identity";

test("the key pair is made once and kept, and a press is signed over its method, path, query and time", async () => {
	let saved: Identity | null = null;
	let saves = 0;
	useIdentityStore({ load: async () => saved, save: async (id) => { saved = JSON.parse(JSON.stringify(id)); saves++; } });
	const id = await getIdentity();
	assert.equal(saves, 1);
	assert.equal(await getIdentity(), id, "the same one while running");

	useIdentityStore({ load: async () => saved, save: async () => { saves++; } });
	const again = await getIdentity();
	assert.equal(again.publicKey, id.publicKey, "the same one after a restart");
	assert.equal(saves, 1, "not made again");

	const h = signedHeaders(id, "dev1", "/deck/home/add1?n=2", 1700000000000);
	assert.equal(h["x-studio-device"], "dev1");
	assert.equal(h["x-studio-time"], "1700000000000");
	const pub = crypto.createPublicKey({ key: Buffer.from(id.publicKey, "base64url"), format: "der", type: "spki" });
	assert.equal(pub.asymmetricKeyType, "ed25519");
	assert.ok(crypto.verify(null, Buffer.from("GET\n/deck/home/add1?n=2\n1700000000000"), pub, Buffer.from(h["x-studio-sign"], "base64url")));
	assert.ok(!crypto.verify(null, Buffer.from("GET\n/deck/home/add1\n1700000000000"), pub, Buffer.from(h["x-studio-sign"], "base64url")), "the query counts");
});
