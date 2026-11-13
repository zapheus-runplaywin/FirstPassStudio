// Follows the scene live: calls onScene(scene) with the whole scene now and on every change.
// sceneEvents(onScene, { board: onBoard }) also follows the scoreboard over the same socket: onBoard gets
// what GET /api/scoreboard gives, now and whenever it changes (a press, a PlayHQ reading, the clock), so
// the scoreboard, the control page, the goals and the countdown don't poll. { switcher: onSwitcher } follows the
// ATEM switcher the same way (what GET /api/switcher gives), for the Output page. Any handler can be null.
// Over a WebSocket, not server-sent events, because a browser keeps only six ordinary connections
// open to Studio at once: with a few scene pages open (preview, pop out, outputs) each holding one,
// a click's request waited until one closed. Reconnects by itself if Studio restarts.
// Studio's own messages over the socket, typed by the page that follows them: the scene (S), the board (B), the switcher (W).
function sceneEvents<S = unknown, B = unknown, W = unknown>(onScene: ((scene: S) => void) | null,
  { board, switcher }: { board?: ((board: B) => void) | null, switcher?: ((switcher: W) => void) | null } = {}) {
  let ws: WebSocket | null = null;
  const open = () => {
    const socket = ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/scene/socket`);
    socket.onopen = () => {
      if (board) socket.send(JSON.stringify({ subscribe: 'board' }));
      if (switcher) socket.send(JSON.stringify({ subscribe: 'switcher' }));
    };
    socket.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'board') { if (board) board(msg.board); }
        else if (msg.type === 'switcher') { if (switcher) switcher(msg.switcher); }
        else if (onScene) onScene(msg);
      } catch (err) { console.error('Scene update failed', err); }
    };
    socket.onclose = () => setTimeout(open, 1000);
  };
  open();
  return { close: () => { const w = ws; ws = null; if (w) { w.onclose = null; w.close(); } } };
}
