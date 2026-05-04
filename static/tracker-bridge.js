/**
 * SSO · Tracker Bridge
 * ─────────────────────
 * Polls the Python system_tracker.py for live system data
 * (active app, keystroke rate, mouse activity, idle state).
 * Falls back gracefully when tracker is offline.
 */
window.TrackerBridge = (() => {
  let port       = 7891;
  let online     = false;
  let pollTimer  = null;
  let onDataCb   = null;
  let onStatusCb = null;

  // Latest data snapshot from tracker
  let latest = {
    activeApp: null, windowTitle: null, website: null,
    wpm: 0, keysInterval: 0, totalKeys: 0,
    mouseClicks: 0, mouseClicksInterval: 0,
    idleSeconds: 0, isIdle: false,
  };

  function init(trackerPort, onData, onStatus) {
    port       = trackerPort || 7891;
    onDataCb   = onData;
    onStatusCb = onStatus;
    startPolling();
  }

  function startPolling() {
    poll();
    pollTimer = setInterval(poll, 3000);
  }

  async function poll() {
    try {
      const res  = await fetch(`http://127.0.0.1:${port}/status`, {
        signal: AbortSignal.timeout(1500),
      });
      const data = await res.json();
      online  = true;
      latest  = { ...latest, ...data };
      onDataCb?.(latest);
      onStatusCb?.(true);
    } catch {
      online = false;
      onStatusCb?.(false);
    }
  }

  async function postSession(session) {
    if (!online) return false;
    try {
      await fetch(`http://127.0.0.1:${port}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(session),
        signal: AbortSignal.timeout(2000),
      });
      return true;
    } catch { return false; }
  }

  function isOnline()    { return online; }
  function getLatest()   { return { ...latest }; }
  function stop()        { clearInterval(pollTimer); }

  return { init, isOnline, getLatest, postSession, stop };
})();
