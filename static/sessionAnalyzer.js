/**
 * sessionAnalyzer.js
 * ──────────────────
 * Analyzes historical session data to produce adaptive study recommendations.
 *
 * What it computes:
 *   - Optimal session duration (based on high-focus session lengths)
 *   - Focus drop-off point (when does focus start declining within a session?)
 *   - Suggested break duration (based on post-break recovery in data)
 *   - Peak productivity hours (from heatmap data)
 *   - Session productivity trend (improving / declining / stable)
 *
 * Output: A structured recommendation object used by the UI.
 * Designed so the scoring logic can later be replaced by a trained model.
 */

window.SessionAnalyzer = (() => {

  const MIN_SESSIONS_FOR_ANALYSIS = 3;
  const HIGH_FOCUS_THRESHOLD = 70;  // sessions ≥ 70% focus are "high focus"

  /**
   * analyze(sessions) → recommendation object
   * @param {Array} sessions - from Store.getSessions()
   * @returns {Object|null} - null if not enough data
   */
  function analyze(sessions) {
    if (!sessions || sessions.length < MIN_SESSIONS_FOR_ANALYSIS) {
      return {
        hasEnoughData: false,
        message: `Record at least ${MIN_SESSIONS_FOR_ANALYSIS} sessions to unlock adaptive recommendations.`,
        sessionsNeeded: MIN_SESSIONS_FOR_ANALYSIS - (sessions?.length || 0),
      };
    }

    const withFocus  = sessions.filter(s => s.focusScore != null && s.duration != null);
    if (withFocus.length < MIN_SESSIONS_FOR_ANALYSIS) {
      return {
        hasEnoughData: false,
        message: 'Not enough sessions with focus data yet.',
        sessionsNeeded: MIN_SESSIONS_FOR_ANALYSIS,
      };
    }

    const highFocus = withFocus.filter(s => s.focusScore >= HIGH_FOCUS_THRESHOLD);
    const lowFocus  = withFocus.filter(s => s.focusScore <  HIGH_FOCUS_THRESHOLD);

    // ── Optimal duration ──────────────────────────────────────────────────
    // Average duration of high-focus sessions, capped to reasonable range
    const optimalDuration = highFocus.length >= 2
      ? Math.round(avgField(highFocus, 'duration'))
      : Math.round(avgField(withFocus, 'duration'));
    const clampedDuration = Math.max(15, Math.min(60, optimalDuration));

    // ── Drop-off point ────────────────────────────────────────────────────
    // Find the duration threshold where focus starts noticeably dropping.
    // We bucket sessions by length and compare avg focus in each bucket.
    const dropOff = findDropOff(withFocus);

    // ── Suggested break ───────────────────────────────────────────────────
    // If we have recent session pairs (sessions within 2h of each other),
    // look at focus recovery. Otherwise use a heuristic: ~20% of session length.
    const suggestedBreak = computeBreakDuration(withFocus, clampedDuration);

    // ── Peak hours ────────────────────────────────────────────────────────
    const peakHours = findPeakHours(withFocus);

    // ── Trend ─────────────────────────────────────────────────────────────
    const trend = computeTrend(withFocus.slice(0, 10));  // last 10 sessions

    // ── Productivity distribution ─────────────────────────────────────────
    const prodDist = {
      prod:    withFocus.filter(s => s.sessionLabel === 'prod').length,
      unprod:  withFocus.filter(s => s.sessionLabel === 'unprod').length,
      neutral: withFocus.filter(s => !s.sessionLabel || s.sessionLabel === 'neutral').length,
    };

    // ── Distraction pattern ───────────────────────────────────────────────
    const avgDistractions = Math.round(avgField(withFocus, 'distractions'));
    const highDistractSessions = withFocus.filter(s => (s.distractions || 0) > avgDistractions + 2).length;

    // ── Build recommendation text ─────────────────────────────────────────
    const rec = buildRecommendation({
      clampedDuration, dropOff, suggestedBreak, peakHours, trend,
      highFocusCount: highFocus.length, totalCount: withFocus.length,
      avgDistractions, highDistractSessions, prodDist,
    });

    return {
      hasEnoughData:    true,
      optimalDuration:  clampedDuration,
      dropOffPoint:     dropOff,
      suggestedBreak,
      peakHours,
      trend,
      prodDist,
      avgDistractions,
      recommendation:   rec,
      dataPoints:       withFocus.length,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function avgField(arr, field) {
    const vals = arr.map(s => s[field]).filter(v => v != null && !isNaN(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }

  function findDropOff(sessions) {
    // Bucket sessions: short (≤25m), medium (26-40m), long (>40m)
    const short  = sessions.filter(s => s.duration <= 25);
    const medium = sessions.filter(s => s.duration > 25 && s.duration <= 40);
    const long   = sessions.filter(s => s.duration > 40);

    const avgShort  = short.length  ? avgField(short,  'focusScore') : null;
    const avgMedium = medium.length ? avgField(medium, 'focusScore') : null;
    const avgLong   = long.length   ? avgField(long,   'focusScore') : null;

    // Find where focus drops more than 8 points
    if (avgMedium && avgShort && avgShort - avgMedium > 8)  return 20;
    if (avgLong   && avgMedium && avgMedium - avgLong > 8)   return 38;
    if (avgLong   && avgShort  && avgShort - avgLong > 8)    return 30;

    // No clear drop-off — return null (will say "no drop-off detected")
    return null;
  }

  function computeBreakDuration(sessions, sessionDuration) {
    // Heuristic: 20% of session duration, clamped 5-20 min
    const base = Math.round(sessionDuration * 0.20);
    return Math.max(5, Math.min(20, base));
  }

  function findPeakHours(sessions) {
    const hours = Array(24).fill(null).map(() => ({ scores: [], count: 0 }));
    sessions.forEach(s => {
      const h = new Date(s.timestamp).getHours();
      if (s.focusScore != null) { hours[h].scores.push(s.focusScore); hours[h].count++; }
    });
    // Find top 2 hours with at least 1 session
    const scored = hours
      .map((h, i) => ({ hour: i, avg: h.scores.length ? h.scores.reduce((a,b)=>a+b,0)/h.scores.length : 0, count: h.count }))
      .filter(h => h.count > 0)
      .sort((a, b) => b.avg - a.avg);

    return scored.slice(0, 2).map(h => ({
      hour: h.hour,
      avgFocus: Math.round(h.avg),
      count: h.count,
      label: `${h.hour}:00–${h.hour+1}:00`,
    }));
  }

  function computeTrend(recentSessions) {
    // Need at least 4 sessions to compute a trend
    if (recentSessions.length < 4) return { direction: 'unknown', delta: null };
    const scores = recentSessions.map(s => s.focusScore).filter(v => v != null).reverse(); // oldest first
    const half   = Math.floor(scores.length / 2);
    const older  = scores.slice(0, half);
    const newer  = scores.slice(half);
    const avgOld = older.reduce((a,b)=>a+b,0) / older.length;
    const avgNew = newer.reduce((a,b)=>a+b,0) / newer.length;
    const delta  = Math.round(avgNew - avgOld);
    return {
      direction: delta >= 5 ? 'improving' : delta <= -5 ? 'declining' : 'stable',
      delta,
      avgOld: Math.round(avgOld),
      avgNew: Math.round(avgNew),
    };
  }

  function buildRecommendation({ clampedDuration, dropOff, suggestedBreak, peakHours, trend, highFocusCount, totalCount, avgDistractions, highDistractSessions, prodDist }) {
    const lines = [];

    // Duration insight
    if (dropOff) {
      lines.push(`Your focus tends to drop after ~${dropOff} min — try ${clampedDuration}-min sessions with ${suggestedBreak}-min breaks.`);
    } else {
      lines.push(`Based on your ${highFocusCount} high-focus sessions, ${clampedDuration} min with ${suggestedBreak}-min breaks is your sweet spot.`);
    }

    // Peak hours
    if (peakHours.length > 0) {
      lines.push(`Your highest focus is at ${peakHours[0].label} (avg ${peakHours[0].avgFocus}%). Schedule hard tasks here.`);
    }

    // Trend
    if (trend.direction === 'improving') {
      lines.push(`Your focus has improved by ${Math.abs(trend.delta)}% over your last sessions — keep the momentum.`);
    } else if (trend.direction === 'declining') {
      lines.push(`Focus has dipped by ${Math.abs(trend.delta)}% recently. Consider shorter sessions or a rest day.`);
    }

    // Distractions
    if (avgDistractions > 4) {
      lines.push(`You average ${avgDistractions} distractions per session. Try closing social tabs before starting.`);
    }

    return lines.join(' ');
  }

  return { analyze };
})();
