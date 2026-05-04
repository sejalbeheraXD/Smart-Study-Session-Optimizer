/**
 * SSO · Session Store
 * ────────────────────
 * Single source of truth for all session data.
 * Handles: localStorage persistence, CSV export, session aggregation.
 */
window.Store = (() => {
  const KEY_SESSIONS = "sso_sessions_v2";
  const KEY_RULES    = "sso_rules_v2";
  const KEY_SETTINGS = "sso_settings_v2";

  // ── Default productivity rules ─────────────────────────────────────────
  const DEFAULT_RULES = {
    "VS Code": "prod", "PyCharm": "prod", "Xcode": "prod", "IntelliJ": "prod",
    "Notion": "prod", "Obsidian": "prod", "Zotero": "prod", "Anki": "prod",
    "Terminal": "prod", "iTerm2": "prod", "Figma": "prod", "Sketch": "prod",
    "Google Docs": "prod", "Overleaf": "prod", "Papers": "prod",
    "Instagram": "unprod", "YouTube": "unprod", "Twitter/X": "unprod",
    "Reddit": "unprod", "Netflix": "unprod", "TikTok": "unprod",
    "Facebook": "unprod", "Snapchat": "unprod",
    "Discord": "neutral", "Slack": "neutral", "Zoom": "neutral",
    "Chrome": "neutral", "Firefox": "neutral", "Safari": "neutral",
    "Calendar": "neutral", "Mail": "neutral", "Messages": "neutral",
  };

  // ── Default settings ──────────────────────────────────────────────────
  const DEFAULT_SETTINGS = {
    focusDuration: 25, shortBreak: 5, longBreak: 15,
    dailyGoalHours: 3, pomosPerLong: 4,
    trackCamera: true, trackKeystrokes: true, trackWindow: true, autoBreak: false,
    trackerPort: 7891,
  };

  let sessions = [];
  let rules    = {};
  let settings = {};

  // ── Load ──────────────────────────────────────────────────────────────
  function load() {
    try { sessions = JSON.parse(localStorage.getItem(KEY_SESSIONS) || "[]"); } catch { sessions = []; }
    try { rules    = JSON.parse(localStorage.getItem(KEY_RULES)    || "null") || { ...DEFAULT_RULES }; } catch { rules = { ...DEFAULT_RULES }; }
    try { settings = JSON.parse(localStorage.getItem(KEY_SETTINGS) || "null") || { ...DEFAULT_SETTINGS }; } catch { settings = { ...DEFAULT_SETTINGS }; }
    // Merge any missing defaults
    settings = { ...DEFAULT_SETTINGS, ...settings };
  }

  function saveRules()    { localStorage.setItem(KEY_RULES,    JSON.stringify(rules));    }
  function saveSettings() { localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings)); }
  function saveSessions() { localStorage.setItem(KEY_SESSIONS, JSON.stringify(sessions.slice(-200))); }

  // ── Session CRUD ──────────────────────────────────────────────────────
  function addSession(session) {
    session.id = Date.now();
    sessions.unshift(session);
    saveSessions();
    return session;
  }

  function getSessions(limit = 200) { return sessions.slice(0, limit); }

  function getLastN(n) { return sessions.slice(0, n); }

  function clearAll() { sessions = []; saveSessions(); }

  // ── Productivity classification ────────────────────────────────────────
  function classify(appName) {
    if (!appName) return "neutral";
    // Direct match
    if (rules[appName]) return rules[appName];
    // Partial match (domain-style)
    const lower = appName.toLowerCase();
    for (const [key, val] of Object.entries(rules)) {
      if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) return val;
    }
    return "neutral";
  }

  // ── Aggregate stats ───────────────────────────────────────────────────
  function getStats(nDays = 7) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - nDays);
    const recent = sessions.filter(s => new Date(s.timestamp) >= cutoff);
    if (!recent.length) return null;

    const avgFocus      = avg(recent, s => s.focusScore);
    const totalMinutes  = recent.reduce((a, s) => a + (s.duration || 0), 0);
    const avgProductive = avg(recent, s => s.productiveRatio);
    const avgAttn       = avg(recent, s => s.attnScore || s.focusScore);
    const avgEye        = avg(recent, s => s.avgEye   || 0);
    const avgGaze       = avg(recent, s => s.avgGaze  || 0);
    const avgPose       = avg(recent, s => s.avgPose  || 0);
    const totalSessions = recent.length;
    const distractions  = recent.reduce((a, s) => a + (s.distractions || 0), 0);

    return {
      avgFocus:      Math.round(avgFocus),
      totalMinutes:  Math.round(totalMinutes),
      totalHours:    (totalMinutes / 60).toFixed(1),
      avgProductive: Math.round(avgProductive),
      avgAttn:       Math.round(avgAttn),
      avgEye:        Math.round(avgEye),
      avgGaze:       Math.round(avgGaze),
      avgPose:       Math.round(avgPose),
      totalSessions,
      distractions,
      sessions:      recent,
    };
  }

  function avg(arr, fn) {
    const vals = arr.map(fn).filter(v => v != null && !isNaN(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }

  // ── Hourly heatmap data ───────────────────────────────────────────────
  function getHourlyData() {
    const hours = Array.from({ length: 24 }, () => ({ scores: [], count: 0 }));
    sessions.forEach(s => {
      const h = new Date(s.timestamp).getHours();
      if (s.focusScore) { hours[h].scores.push(s.focusScore); hours[h].count++; }
    });
    return hours;
  }

  // ── Daily grouped data ────────────────────────────────────────────────
  function getDailyData(nDays = 14) {
    const days = [];
    for (let i = nDays - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days.push(d.toISOString().split("T")[0]);
    }
    const byDay = {};
    days.forEach(d => { byDay[d] = { scores: [], durations: [], attn: [] }; });
    sessions.forEach(s => {
      const d = s.timestamp?.split("T")[0];
      if (byDay[d]) {
        byDay[d].scores.push(s.focusScore || 0);
        byDay[d].durations.push(s.duration || 0);
        if (s.attnScore) byDay[d].attn.push(s.attnScore);
      }
    });
    return { days, byDay };
  }

  // ── CSV Export ────────────────────────────────────────────────────────
  function exportCSV() {
    const headers = [
      "timestamp","date","start_time","duration_min",
      "focus_score","productive_pct","attn_score",
      "avg_eye_pct","avg_gaze_pct","avg_pose_pct","dominant_expr",
      "wpm_estimate","total_keys","mouse_clicks",
      "top_app","distractions","pomo_completed","notes"
    ];
    const rows = sessions.map(s => [
      s.timestamp, s.timestamp?.split("T")[0],
      new Date(s.timestamp).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}),
      s.duration, s.focusScore, s.productiveRatio, s.attnScore,
      s.avgEye, s.avgGaze, s.avgPose, s.dominantExpr,
      s.wpm, s.totalKeys, s.mouseClicks,
      s.topApp, s.distractions, s.pomoCount, s.notes || ""
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v ?? ""}"`).join(",")).join("\n");
    const a   = document.createElement("a");
    a.href     = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = "sso_sessions_" + new Date().toISOString().split("T")[0] + ".csv";
    a.click();
  }

  load();
  return { load, sessions: () => sessions, rules: () => rules, settings: () => settings,
    saveRules, saveSettings, saveSessions,
    addSession, getSessions, getLastN, clearAll,
    classify, getStats, getHourlyData, getDailyData, exportCSV,
    setRule(app, cat) { rules[app] = cat; saveRules(); },
    removeRule(app) { delete rules[app]; saveRules(); },
    setSetting(k, v) { settings[k] = v; saveSettings(); },
  };
})();
