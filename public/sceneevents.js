// Follows the scene live: calls onScene(scene) with the whole scene now and on every change.
// sceneEvents(onScene, { board: onBoard }) also follows the scoreboard over the same socket: onBoard gets
// what GET /api/scoreboard gives, now and whenever it changes (a press, a PlayHQ reading, the clock), so
// the scoreboard, the control page, the goals and the countdown don't poll. { switcher: onSwitcher } follows the
// ATEM switcher the same way (what GET /api/switcher gives), for the Output page. Any handler can be null.
// Over a WebSocket, not server-sent events, because a browser keeps only six ordinary connections
// open to Studio at once: with a few scene pages open (preview, pop out, outputs) each holding one,
// a click's request waited until one closed. Reconnects by itself if Studio restarts.
window.sceneEvents = function (onScene, { board, switcher } = {}) {
  let ws = null;
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/scene/socket`);
    ws.onopen = () => {
      if (board) ws.send(JSON.stringify({ subscribe: 'board' }));
      if (switcher) ws.send(JSON.stringify({ subscribe: 'switcher' }));
    };
    ws.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'board') { if (board) board(msg.board); }
        else if (msg.type === 'switcher') { if (switcher) switcher(msg.switcher); }
        else if (onScene) onScene(msg);
      } catch (err) { console.error('Scene update failed', err); }
    };
    ws.onclose = () => setTimeout(open, 1000);
  };
  open();
  return { close: () => { const w = ws; ws = null; if (w) { w.onclose = null; w.close(); } } };
};
