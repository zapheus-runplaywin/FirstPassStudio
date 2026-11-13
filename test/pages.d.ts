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
