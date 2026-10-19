// Reloads the page when the helper restarts or a page file changes, so a page
// always shows the latest version without a manual refresh.
// Add &reload=30 to a page link to also force a full reload every 30 minutes.
(function () {
  let known = null;
  async function check() {
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      const { version } = await res.json();
      if (known && version !== known) location.reload();
      known = version;
    } catch { /* helper not running yet; the next check will catch it */ }
  }
  check();
  setInterval(check, 5000);
  const minutes = Number(new URLSearchParams(location.search).get('reload'));
  if (minutes > 0) setTimeout(() => location.reload(), minutes * 60 * 1000);
})();
