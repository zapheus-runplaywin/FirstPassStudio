// What a test's page code (page.evaluate) reaches into on a Studio page: the pages' own globals, named here as far as
// the tests use them (their full types are in public/env.d.ts, public/view.d.ts and the pages' scripts).

// Every page (zoom.js, studio.js, unsaved.js): how far the page is zoomed, the status line, and the Mac app's check
// before it leaves a page with changes not saved.
declare var studioZoom: number;
declare function studioStatus(text: string, kind?: string): void;
declare var studioBeforeLeave: () => Promise<boolean>;

// The Output page (public/output/): the status board's countdowns and times, the last /api/health answer it drew, and
// the scene editor's ATEM part.
declare function boardLeft(ms: number): string;
declare function boardAt(time: number): string;
declare function renderBoard(): void;
// any: Studio's health answer, changed by hand to draw the board in a state the test can't otherwise reach
declare var lastHealth: any;
declare function editSceneSwitcher(scene: { id: string }): void;
// The Output page's scene, as far as the tests read it.
declare var scene: { scenes: { id: string; switcher?: unknown[] }[] };
// A page's own window inside the Scene View's frame.
interface Window { studioZoom: number }
// A Socials picture page: true once drawn, or why it can't be drawn.
interface Window { socialReady?: true | string }
// A page with chroma key safe graphics (chroma.js): its style fixes, which the tests check one by one.
declare var studioChromaSafe: { solidShadows(v: string): string; solidFilter(v: string): string; noGlows(v: string): string };

// The scene (scene.js) and its test hooks: whether its sound plays, its two music players, and its sound internals.
declare function soundState(): { videos: number; pages: number; blocked: boolean; music: boolean };
declare function musicPlayers(): Record<string, { src: string; playing: boolean; volume: number; at: number }>;
// any: the scene's sound internals (mixers, mic chains, phone connections, layers), which the sound tests reach deep into
declare function sceneSound(): any;
declare function setSilent(on: boolean): void;
// The Commentator page: how loud what comes back from Studio is, in dB.
declare function backLevel(): number;
// The Output page: the outputs' sound out list, and the output the Scene View draws (and whether it is switching).
declare function loadOut(): Promise<void>;
declare var previewOutput: string;
declare function previewSwitching(): boolean;
// The same hooks, as the Scene View's frame on the Output page has them (a frame may still be loading: no hooks yet).
interface Window {
  musicPlayers?: () => Record<string, { src: string; playing: boolean; volume: number; at: number }>;
  standbyReady?: () => boolean;
}
