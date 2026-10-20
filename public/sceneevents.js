// Follows the scene live: calls onScene(scene) with the whole scene now and on every change.
// Over a WebSocket, not server-sent events, because a browser keeps only six ordinary connections
// open to Studio at once: with a few scene pages open (preview, pop out, outputs) each holding one,
// a click's request waited until one closed. Reconnects by itself if Studio restarts.
window.sceneEvents = function (onScene) {
  let ws = null;
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/scene/socket`);
    ws.onmessage = e => { try { onScene(JSON.parse(e.data)); } catch (err) { console.error('Scene update failed', err); } };
    ws.onclose = () => setTimeout(open, 1000);
  };
  open();
  return { close: () => { const w = ws; ws = null; if (w) { w.onclose = null; w.close(); } } };
};
