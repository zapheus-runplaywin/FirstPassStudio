import streamDeck from "@elgato/streamdeck";

import { SceneAction } from "./actions/scene";
import { SequenceAction } from "./actions/sequence";
import { SourceAction } from "./actions/source";
import { SwitcherAction } from "./actions/switcher";

// "info" keeps the log readable. Switch to "trace" to record every message between Stream Deck and the plugin.
streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new SourceAction());
streamDeck.actions.registerAction(new SceneAction());
streamDeck.actions.registerAction(new SequenceAction());
streamDeck.actions.registerAction(new SwitcherAction());

streamDeck.connect();
