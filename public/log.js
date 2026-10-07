// Sends this page's errors and warnings to the helper's debug log
// (logs/playhq-graphics.log, or http://localhost:8080/api/log).
(function () {
  const page = location.pathname.replace(/^\//, '') + location.search || 'index.html';
  let sent = 0;
  function send(level, message, detail) {
    if (++sent > 200) return; // stop a broken page from filling the log
    try {
      fetch('/api/log', {
        method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ page, level, message: String(message).slice(0, 2000), detail }),
      }).catch(() => {});
    } catch { /* helper not running */ }
  }
  const text = args => args.map(a => (a instanceof Error ? a.stack || a.message : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  for (const level of ['error', 'warn']) {
    const original = console[level].bind(console);
    console[level] = (...args) => { original(...args); send(level, text(args)); };
  }
  window.addEventListener('error', e => {
    if (e.target && e.target !== window) send('error', `Could not load ${e.target.src || e.target.href || e.target.tagName}`);
    else send('error', e.message, `${e.filename}:${e.lineno}:${e.colno}`);
  }, true);
  window.addEventListener('unhandledrejection', e => send('error', `Unhandled: ${(e.reason && (e.reason.stack || e.reason.message)) || e.reason}`));
  send('info', 'Page opened', navigator.userAgent);
  window.pageLog = send;
})();
