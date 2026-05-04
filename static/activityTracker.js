/**
 * activityTracker.js
 * ──────────────────
 * Tracks real browser activity using native browser APIs only.
 * No randomness. No simulation.
 *
 * What it does:
 *   - Polls document.title every 2s to detect page/tab changes
 *   - Tracks keystrokes and mouse movement for activity/idle detection
 *   - Extracts domain from window.location (current tab only — browsers
 *     cannot access other tabs due to Same-Origin Policy)
 *   - Emits events via callbacks when activity state changes
 *
 * Browser limitation: A pure web app cannot read the URL or title of
 * other browser tabs or native applications. This tracker gives you
 * accurate data for the current tab only. For cross-app tracking,
 * the Python system_tracker.py sidecar is required.
 */

window.ActivityTracker = (() => {

  // ── Config ────────────────────────────────────────────────
  const IDLE_THRESHOLD_MS   = 30_000;  // 30s without input = idle
  const TITLE_POLL_INTERVAL = 2_000;   // check page title every 2s
  const MIN_ACTIVE_MS       = 500;     // ignore sub-500ms activity bursts

  // ── State ─────────────────────────────────────────────────
  let lastInputTime    = Date.now();
  let lastTitle        = '';
  let lastDomain       = '';
  let isIdle           = false;
  let isTracking       = false;
  let totalKeystrokes  = 0;
  let intervalKeystrokes = 0;  // reset each poll cycle
  let totalMouseMoves  = 0;
  let pollTimer        = null;

  // ── Callbacks ─────────────────────────────────────────────
  let onPageChange  = null;   // (domain, title, classification) => void
  let onIdleChange  = null;   // (isIdle, idleSeconds) => void
  let onKeystroke   = null;   // (totalKeys, intervalKeys) => void

  // ── Input listeners ───────────────────────────────────────
  function onKeyDown() {
    totalKeystrokes++;
    intervalKeystrokes++;
    lastInputTime = Date.now();
    if (isIdle) {
      isIdle = false;
      onIdleChange?.(false, 0);
    }
    onKeystroke?.(totalKeystrokes, intervalKeystrokes);
  }

  function onMouseMove() {
    totalMouseMoves++;
    lastInputTime = Date.now();
    if (isIdle) {
      isIdle = false;
      onIdleChange?.(false, 0);
    }
  }

  function onMouseClick() {
    lastInputTime = Date.now();
    if (isIdle) {
      isIdle = false;
      onIdleChange?.(false, 0);
    }
  }

  // ── Page title polling ────────────────────────────────────
  function pollPage() {
    const title  = document.title || '';
    const domain = getCurrentDomain();

    // Check idle
    const idleSecs = Math.round((Date.now() - lastInputTime) / 1000);
    const nowIdle  = idleSecs >= IDLE_THRESHOLD_MS / 1000;
    if (nowIdle !== isIdle) {
      isIdle = nowIdle;
      onIdleChange?.(isIdle, idleSecs);
    }

    // Check page change
    if (title !== lastTitle || domain !== lastDomain) {
      lastTitle  = title;
      lastDomain = domain;
      const classification = window.Classifier?.classify(domain, title) || { label: 'neutral', confidence: 0, reason: 'no classifier' };
      onPageChange?.(domain, title, classification);
    }

    // Reset interval keystroke counter
    intervalKeystrokes = 0;
  }

  // ── Domain extraction ─────────────────────────────────────
  function getCurrentDomain() {
    try {
      return window.location.hostname || 'localhost';
    } catch {
      return 'unknown';
    }
  }

  function getIdleSeconds() {
    return Math.round((Date.now() - lastInputTime) / 1000);
  }

  function isCurrentlyIdle() {
    return getIdleSeconds() >= IDLE_THRESHOLD_MS / 1000;
  }

  // ── Start / Stop ──────────────────────────────────────────
  function start(callbacks = {}) {
    if (isTracking) return;
    isTracking = true;

    onPageChange  = callbacks.onPageChange  || null;
    onIdleChange  = callbacks.onIdleChange  || null;
    onKeystroke   = callbacks.onKeystroke   || null;

    // Reset counters on start
    totalKeystrokes    = 0;
    intervalKeystrokes = 0;
    totalMouseMoves    = 0;
    lastInputTime      = Date.now();
    lastTitle          = '';
    lastDomain         = '';

    // Attach listeners
    document.addEventListener('keydown',   onKeyDown,   { passive: true });
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mousedown', onMouseClick,{ passive: true });

    // Start polling
    pollTimer = setInterval(pollPage, TITLE_POLL_INTERVAL);

    // Immediate first poll
    setTimeout(pollPage, 100);
  }

  function stop() {
    if (!isTracking) return;
    isTracking = false;

    document.removeEventListener('keydown',   onKeyDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mousedown', onMouseClick);

    clearInterval(pollTimer);
    pollTimer = null;
  }

  function reset() {
    totalKeystrokes    = 0;
    intervalKeystrokes = 0;
    totalMouseMoves    = 0;
    lastInputTime      = Date.now();
    isIdle             = false;
  }

  // ── Snapshot for session save ─────────────────────────────
  function getSnapshot() {
    return {
      domain:         getCurrentDomain(),
      pageTitle:      document.title || '',
      totalKeystrokes,
      totalMouseMoves,
      idleSeconds:    getIdleSeconds(),
      isIdle:         isCurrentlyIdle(),
    };
  }

  return { start, stop, reset, getSnapshot, getIdleSeconds, isCurrentlyIdle, getCurrentDomain };
})();
