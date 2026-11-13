// Sends this page's errors and warnings to the helper's debug log
// (logs/playhq-graphics.log, or http://localhost:8080/api/log).
// pageLog(level, message, detail): another line in the log, for the scripts that say what a page did.
var pageLog: ((level: string, message: unknown, detail?: string) => void) | undefined;

(function () {
  const page = location.pathname.replace(/^\//, '') + location.search || 'output.html';
  let sent = 0;
  function send(level: string, message: unknown, detail?: string) {
    if (++sent > 200) return; // stop a broken page from filling the log
    try {
      fetch('/api/log', {
        method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ page, level, message: String(message).slice(0, 2000), detail }),
      }).catch(() => {});
    } catch { /* helper not running */ }
  }
  const text = (args: unknown[]) => args.map(a => (a instanceof Error ? a.stack || a.message : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => { original(...args); send(level, text(args)); };
  }
  window.addEventListener('error', e => {
    // A script, picture or stylesheet that didn't load: its link, or at least what it was.
    const t = e.target instanceof Element ? e.target as Element & { src?: string, href?: string } : null;
    if (t) send('error', `Could not load ${t.src || t.href || t.tagName}`);
    else send('error', e.message, `${e.filename}:${e.lineno}:${e.colno}`);
  }, true);
  window.addEventListener('unhandledrejection', e => send('error', `Unhandled: ${(e.reason && (e.reason.stack || e.reason.message)) || e.reason}`));
  send('info', 'Page opened', navigator.userAgent);
  pageLog = send;
})();
