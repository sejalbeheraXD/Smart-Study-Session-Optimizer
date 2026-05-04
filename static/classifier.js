/**
 * classifier.js
 * ─────────────
 * Classifies a website domain + page title as:
 *   'prod'    → Productive
 *   'unprod'  → Unproductive
 *   'neutral' → Neutral / ambiguous
 *
 * Architecture:
 *   1. User rules (Settings) — highest priority, exact/partial match
 *   2. Domain scoring — weighted keyword lists per category
 *   3. Title scoring — semantic hints from page title
 *   4. Combined score → final label + confidence
 *
 * Designed so step 2+3 can be replaced by a real ML model later
 * (e.g. a TF.js text classifier trained on labeled URLs+titles).
 * The interface stays the same: classify(domain, title) → { label, confidence, reason }
 */

window.Classifier = (() => {

  // ── Domain knowledge base ─────────────────────────────────
  // Each entry: score > 0 = productive, score < 0 = unproductive
  // Magnitude = confidence signal (1 = weak, 3 = strong)

  const DOMAIN_RULES = [
    // ── Strong productive ──────────────────────────────────
    { pattern: /github\.com/,           score:  3, label: 'Code repository' },
    { pattern: /gitlab\.com/,           score:  3, label: 'Code repository' },
    { pattern: /stackoverflow\.com/,    score:  3, label: 'Developer Q&A' },
    { pattern: /stackexchange\.com/,    score:  3, label: 'Q&A network' },
    { pattern: /leetcode\.com/,         score:  3, label: 'Coding practice' },
    { pattern: /hackerrank\.com/,       score:  3, label: 'Coding practice' },
    { pattern: /codepen\.io/,           score:  2, label: 'Code playground' },
    { pattern: /replit\.com/,           score:  2, label: 'Online IDE' },
    { pattern: /codesandbox\.io/,       score:  2, label: 'Code sandbox' },
    { pattern: /docs\.google\.com/,     score:  3, label: 'Google Docs' },
    { pattern: /notion\.so/,            score:  3, label: 'Notes/planning' },
    { pattern: /obsidian\.md/,          score:  3, label: 'Notes' },
    { pattern: /roamresearch\.com/,     score:  3, label: 'Notes' },
    { pattern: /overleaf\.com/,         score:  3, label: 'LaTeX editor' },
    { pattern: /scholar\.google\.com/,  score:  3, label: 'Academic search' },
    { pattern: /pubmed\.ncbi\.nlm\.nih\.gov/, score: 3, label: 'Research papers' },
    { pattern: /arxiv\.org/,            score:  3, label: 'Research papers' },
    { pattern: /jstor\.org/,            score:  3, label: 'Academic journals' },
    { pattern: /coursera\.org/,         score:  3, label: 'Online learning' },
    { pattern: /edx\.org/,              score:  3, label: 'Online learning' },
    { pattern: /khanacademy\.org/,      score:  3, label: 'Online learning' },
    { pattern: /udemy\.com/,            score:  2, label: 'Online courses' },
    { pattern: /udacity\.com/,          score:  3, label: 'Online courses' },
    { pattern: /brilliant\.org/,        score:  3, label: 'STEM learning' },
    { pattern: /freecodecamp\.org/,     score:  3, label: 'Coding learning' },
    { pattern: /developer\.mozilla\.org/, score: 3, label: 'MDN Docs' },
    { pattern: /docs\./,                score:  2, label: 'Documentation' },
    { pattern: /wikipedia\.org/,        score:  2, label: 'Reference' },
    { pattern: /wolframalpha\.com/,     score:  3, label: 'Math/computation' },
    { pattern: /desmos\.com/,           score:  3, label: 'Math tool' },
    { pattern: /anki\.apps\.ankiweb\.net/, score: 3, label: 'Flashcards' },
    { pattern: /ankiweb\.net/,          score:  3, label: 'Flashcards' },
    { pattern: /quizlet\.com/,          score:  2, label: 'Study cards' },
    { pattern: /figma\.com/,            score:  2, label: 'Design tool' },
    { pattern: /miro\.com/,             score:  2, label: 'Whiteboard' },
    { pattern: /trello\.com/,           score:  2, label: 'Project management' },
    { pattern: /linear\.app/,           score:  2, label: 'Issue tracker' },
    { pattern: /jira\.atlassian\.com/,  score:  2, label: 'Issue tracker' },
    { pattern: /localhost/,             score:  2, label: 'Local development' },
    { pattern: /127\.0\.0\.1/,          score:  2, label: 'Local development' },

    // ── Moderate productive ────────────────────────────────
    { pattern: /medium\.com/,           score:  1, label: 'Articles (mixed)' },
    { pattern: /dev\.to/,               score:  2, label: 'Developer blog' },
    { pattern: /hashnode\.com/,         score:  2, label: 'Developer blog' },
    { pattern: /towardsdatascience\.com/, score: 2, label: 'Data science blog' },
    { pattern: /google\.com\/search/,   score:  1, label: 'Search' },
    { pattern: /bing\.com\/search/,     score:  1, label: 'Search' },

    // ── Strong unproductive ────────────────────────────────
    { pattern: /youtube\.com/,          score: -2, label: 'Video platform' },  // refined by title
    { pattern: /netflix\.com/,          score: -3, label: 'Streaming' },
    { pattern: /primevideo\.com/,       score: -3, label: 'Streaming' },
    { pattern: /disneyplus\.com/,       score: -3, label: 'Streaming' },
    { pattern: /hulu\.com/,             score: -3, label: 'Streaming' },
    { pattern: /instagram\.com/,        score: -3, label: 'Social media' },
    { pattern: /twitter\.com/,          score: -3, label: 'Social media' },
    { pattern: /x\.com/,                score: -3, label: 'Social media' },
    { pattern: /facebook\.com/,         score: -3, label: 'Social media' },
    { pattern: /tiktok\.com/,           score: -3, label: 'Social media' },
    { pattern: /snapchat\.com/,         score: -3, label: 'Social media' },
    { pattern: /reddit\.com/,           score: -2, label: 'Social forum' },   // refined by title
    { pattern: /twitch\.tv/,            score: -3, label: 'Live streaming' },
    { pattern: /9gag\.com/,             score: -3, label: 'Entertainment' },
    { pattern: /buzzfeed\.com/,         score: -2, label: 'Entertainment' },
    { pattern: /news\.ycombinator\.com/, score: 1, label: 'Tech news' },      // Hacker News is productive-ish
  ];

  // ── Title keyword scoring ─────────────────────────────────
  // Applied on top of domain score. Captures "educational YouTube" etc.
  const TITLE_POSITIVE = [
    /tutorial/i, /course/i, /lecture/i, /learn/i, /how to/i,
    /documentation/i, /docs/i, /reference/i, /guide/i, /study/i,
    /research/i, /paper/i, /thesis/i, /assignment/i, /homework/i,
    /algorithm/i, /programming/i, /code/i, /engineering/i, /science/i,
    /mathematics/i, /math/i, /physics/i, /chemistry/i, /biology/i,
    /introduction to/i, /explained/i, /crash course/i, /full course/i,
    /mit opencourseware/i, /stanford/i, /lecture notes/i,
  ];

  const TITLE_NEGATIVE = [
    /shorts/i, /vlog/i, /reaction/i, /funny/i, /memes/i, /compilation/i,
    /gameplay/i, /let's play/i, /lets play/i, /unboxing/i, /prank/i,
    /challenge/i, /tiktok/i, /reels/i, /trending/i, /viral/i,
    /celebrity/i, /gossip/i, /drama/i, /beef/i,
    /binge/i, /watch party/i, /marathon/i,
  ];

  // ── Core classify function ────────────────────────────────
  /**
   * @param {string} domain  - e.g. "youtube.com", "github.com", "localhost"
   * @param {string} title   - page title from document.title
   * @param {Object} userRules - from Store.rules() — user overrides
   * @returns {{ label: 'prod'|'unprod'|'neutral', confidence: number, reason: string, domainLabel: string }}
   */
  function classify(domain, title = '', userRules = {}) {
    const d = (domain || '').toLowerCase().trim();
    const t = (title  || '').toLowerCase().trim();

    // ── 1. User rules (highest priority) ─────────────────
    if (d && userRules) {
      for (const [key, val] of Object.entries(userRules)) {
        const k = key.toLowerCase();
        if (d === k || d.includes(k) || k.includes(d)) {
          return {
            label:       val,
            confidence:  1.0,
            reason:      `User rule: "${key}"`,
            domainLabel: key,
          };
        }
      }
    }

    // ── 2. Domain scoring ─────────────────────────────────
    let domainScore = 0;
    let domainLabel = '';
    for (const rule of DOMAIN_RULES) {
      if (rule.pattern.test(d)) {
        domainScore = rule.score;
        domainLabel = rule.label;
        break;  // first match wins (rules ordered by specificity)
      }
    }

    // ── 3. Title scoring ──────────────────────────────────
    let titleScore = 0;
    for (const re of TITLE_POSITIVE) { if (re.test(t)) { titleScore += 1.5; break; } }
    for (const re of TITLE_NEGATIVE) { if (re.test(t)) { titleScore -= 1.5; break; } }

    // ── 4. Combine ────────────────────────────────────────
    const totalScore = domainScore + titleScore;
    const absScore   = Math.abs(totalScore);
    const confidence = Math.min(1.0, absScore / 3);

    let label;
    if (totalScore >= 1.5)       label = 'prod';
    else if (totalScore <= -1.5) label = 'unprod';
    else                          label = 'neutral';

    const titleHint = titleScore > 0 ? ' + educational title' : titleScore < 0 ? ' + non-study title' : '';
    const reason = domainLabel
      ? `${domainLabel}${titleHint}`
      : d ? `Unknown domain${titleHint}` : 'No URL available';

    return { label, confidence: Math.round(confidence * 100) / 100, reason, domainLabel };
  }

  /**
   * labelText — human readable string for display
   */
  function labelText(label) {
    return label === 'prod' ? 'Productive' : label === 'unprod' ? 'Unproductive' : 'Neutral';
  }

  /**
   * labelColor — CSS variable string
   */
  function labelColor(label) {
    return label === 'prod' ? 'var(--green)' : label === 'unprod' ? 'var(--red)' : 'var(--muted)';
  }

  /**
   * sessionLabel — given a list of activity events for a session,
   * compute the overall session productivity label.
   * Each event: { label, durationSeconds }
   */
  function sessionLabel(activityEvents) {
    if (!activityEvents?.length) return 'neutral';
    const totals = { prod: 0, unprod: 0, neutral: 0 };
    for (const ev of activityEvents) {
      totals[ev.label] = (totals[ev.label] || 0) + (ev.durationSeconds || 1);
    }
    const total = totals.prod + totals.unprod + totals.neutral || 1;
    const prodPct = totals.prod / total;
    const unprodPct = totals.unprod / total;
    if (prodPct >= 0.55)   return 'prod';
    if (unprodPct >= 0.45) return 'unprod';
    return 'neutral';
  }

  return { classify, labelText, labelColor, sessionLabel };
})();
