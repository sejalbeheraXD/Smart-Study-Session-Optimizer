/**
 * SSO · ML Engine
 * ───────────────
 * face-api.js (TensorFlow.js) powered attention analysis.
 * Models loaded from @vladmandic/face-api CDN.
 *
 * Exports: window.MLEngine = { init, analyseFrame, isReady }
 */
window.MLEngine = (() => {
  const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";
  let ready = false;

  async function init(onProgress) {
    onProgress?.("Loading SSD MobileNet…");
    await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
    onProgress?.("Loading landmarks…");
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    onProgress?.("Loading expressions…");
    await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);
    ready = true;
    onProgress?.("Models ready");
  }

  function isReady() { return ready; }

  /**
   * Analyse a single video frame.
   * Returns null if no face found, otherwise a metrics object.
   */
  async function analyseFrame(videoEl) {
    if (!ready || !videoEl || videoEl.readyState < 2) return null;

    const det = await faceapi
      .detectSingleFace(videoEl, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceExpressions();

    if (!det) return null;

    const lm   = det.landmarks;
    const expr = det.expressions;

    // ── Eye Aspect Ratio (EAR) ───────────────────────────────────────────
    const earOf = (pts) => {
      const v1 = dist(pts[1], pts[5]);
      const v2 = dist(pts[2], pts[4]);
      const h  = dist(pts[0], pts[3]);
      return (v1 + v2) / (2 * h + 1e-6);
    };
    const leftEAR  = earOf(lm.getLeftEye());
    const rightEAR = earOf(lm.getRightEye());
    const avgEAR   = (leftEAR + rightEAR) / 2;
    // EAR: ~0.25–0.35 open, <0.20 closed
    const eyeScore = clamp01((avgEAR - 0.15) / 0.20);

    // ── Gaze (yaw proxy via nose vs eye midpoint) ─────────────────────────
    const noseTip  = lm.getNose()[3];
    const lEyeC    = centroid(lm.getLeftEye());
    const rEyeC    = centroid(lm.getRightEye());
    const eyeMid   = { x: (lEyeC.x + rEyeC.x) / 2, y: (lEyeC.y + rEyeC.y) / 2 };
    const eyeSpan  = dist(lEyeC, rEyeC);
    const yawRatio = Math.abs(noseTip.x - eyeMid.x) / (eyeSpan + 1e-6);
    const gazeScore = clamp01(1 - yawRatio * 2.5);

    // ── Head pitch (brow-chin ratio) ──────────────────────────────────────
    const jaw    = lm.getJawOutline();
    const browL  = lm.getLeftEyeBrow();
    const browR  = lm.getRightEyeBrow();
    const chin   = jaw[8];
    const browMid = {
      x: (centroid(browL).x + centroid(browR).x) / 2,
      y: (centroid(browL).y + centroid(browR).y) / 2,
    };
    const faceH      = dist(browMid, chin);
    const eyeToBrow  = Math.abs(browMid.y - eyeMid.y);
    const pitchRatio = eyeToBrow / (faceH + 1e-6);
    const poseScore  = clamp01((pitchRatio - 0.05) / 0.18);

    // ── Expression ────────────────────────────────────────────────────────
    const attentive  = (expr.neutral || 0) + (expr.happy || 0) * 0.6;
    const distracted = (expr.sad || 0) + (expr.fearful || 0) + (expr.disgusted || 0) + (expr.angry || 0) * 0.5;
    const exprScore  = clamp01(attentive - distracted + 0.5);
    const dominantExpr = Object.entries(expr).sort((a, b) => b[1] - a[1])[0][0];

    // ── Composite (0–100) ─────────────────────────────────────────────────
    const composite = gazeScore * 0.40 + eyeScore * 0.30 + poseScore * 0.20 + exprScore * 0.10;
    const score10   = Math.round(composite * 10);

    return {
      eyeScore:    Math.round(eyeScore   * 100),
      gazeScore:   Math.round(gazeScore  * 100),
      poseScore:   Math.round(poseScore  * 100),
      exprScore:   Math.round(exprScore  * 100),
      composite:   Math.round(composite  * 100),
      score10,
      dominantExpr,
      box:       det.detection.box,
      landmarks: lm,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  function dist(a, b)    { return Math.hypot(a.x - b.x, a.y - b.y); }
  function centroid(pts) { return { x: pts.reduce((s,p)=>s+p.x,0)/pts.length, y: pts.reduce((s,p)=>s+p.y,0)/pts.length }; }
  function clamp01(v)    { return Math.max(0, Math.min(1, v)); }

  return { init, isReady, analyseFrame };
})();
