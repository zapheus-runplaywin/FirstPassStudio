// FirstPass Studio - what the pages' scripts share besides the browser's own.

// The few scripts the helper and the Mac app read too (pages.js, studiobar.js, graphiclinks.js, lineupwait.js) hand
// their lists over to Node this way; in a browser there is no module.
declare var module: { exports: unknown } | undefined;
