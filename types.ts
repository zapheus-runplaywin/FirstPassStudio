// FirstPass Studio - types the helper's modules share.

// The helper's log (server.ts log()): a line in the debug log, with something extra to show after it.
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Log = (level: LogLevel, source: string, message: string, extra?: unknown) => void;

// A JSON value: what a saved file, a request's body or PlayHQ's answer holds before it is checked.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

// The Mac app's end of the message port, when the helper runs in Electron's utility process (desktop/main.js
// starts it; Electron's types declare process.parentPort). Not there when the helper runs on its own with node.
export interface ParentPort {
  on(event: 'message', listener: (e: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

// A request's JSON body (server.ts readBody): always an object, each value unchecked until a route reads it.
export type Body = { [key: string]: unknown };
// How a module's route() answers: server.ts send() (JSON for anything but a string or a Buffer) and readBody().
export type Send = (res: import('node:http').ServerResponse, status: number, body: unknown, type?: string, headers?: import('node:http').OutgoingHttpHeaders) => void;
export type ReadBody = (req: import('node:http').IncomingMessage) => Promise<Body>;
export type ReadRaw = (req: import('node:http').IncomingMessage, max: number) => Promise<Buffer>;
