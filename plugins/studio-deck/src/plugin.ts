import streamDeck from "@elgato/streamdeck";

import { PlaybackAction } from "./actions/playback";
import { RunOrderAction } from "./actions/runorder";
import { SceneAction } from "./actions/scene";
import { SequenceAction } from "./actions/sequence";
import { SourceAction } from "./actions/source";
import { SwitcherAction } from "./actions/switcher";
import { type Identity, useIdentityStore } from "./lib/identity";

// "info" keeps the log readable. Switch to "trace" to record every message between Stream Deck and the plugin.
streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new SourceAction());
streamDeck.actions.registerAction(new SceneAction());
streamDeck.actions.registerAction(new SequenceAction());
streamDeck.actions.registerAction(new SwitcherAction());
streamDeck.actions.registerAction(new PlaybackAction());
streamDeck.actions.registerAction(new RunOrderAction());

// The plugin's key pair and the Studios that allowed it (lib/identity.ts) live in the plugin's global settings, so they
// survive restarts and updates.
useIdentityStore({
	load: async () => (await streamDeck.settings.getGlobalSettings<{ identity?: Identity }>()).identity ?? null,
	save: async (identity) => {
		const all = await streamDeck.settings.getGlobalSettings();
		await streamDeck.settings.setGlobalSettings({ ...all, identity });
	},
});

streamDeck.connect();
