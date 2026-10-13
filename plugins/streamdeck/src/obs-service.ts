import streamDeck from "@elgato/streamdeck";

import { ObsClient, obsUrl } from "./lib/obs";

/** Plugin-wide settings, shared by every Timed Sequence key. */
export type GlobalSettings = {
	obsAddress?: string;
	obsPassword?: string;
};

let client: ObsClient | null = null;

/**
 * The shared OBS connection. Reads the address and password from the global settings each time,
 * reconnecting if they changed or the connection dropped (e.g. OBS was restarted).
 */
export async function getObs(): Promise<ObsClient> {
	const settings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
	const url = obsUrl(settings.obsAddress);
	const password = settings.obsPassword ?? "";
	if (!client || client.url !== url || client.password !== password) {
		client?.close();
		client = new ObsClient(url, password);
	}
	await client.connect();
	return client;
}
