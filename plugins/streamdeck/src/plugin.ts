import streamDeck from "@elgato/streamdeck";

import { TimedSequenceAction } from "./actions/timed-sequence";

// "info" keeps the log readable. Switch to "trace" to record every message between Stream Deck and the plugin.
streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new TimedSequenceAction());

streamDeck.connect();
