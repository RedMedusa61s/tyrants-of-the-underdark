// Page-screenshot helper for the bug-report flow. Wraps html2canvas in a
// lazy-import so the ~250KB rasterizer isn't bundled into the main chunk —
// only fetched when the player clicks "Report a problem".
//
// We capture the document body BEFORE the problem-report modal mounts so
// the screenshot shows what the player was looking at when they decided
// to report, not the modal itself. The caller is App.tsx; it stashes the
// resulting PNG and hands it to ProblemReportDialog as a prop.

/** Capture the visible page as a PNG. Returns base64-encoded data without the
 *  data-URL prefix (just the bytes), suitable for posting as a string in JSON
 *  and for the worker to feed straight into the GitHub Contents API. */
export async function capturePageScreenshot(): Promise<string | null> {
  try {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(document.body, {
      // Match the player's actual viewport — html2canvas defaults to full
      // document, which would clip large maps but more importantly would
      // grab parts not in view.
      width: window.innerWidth,
      height: window.innerHeight,
      x: window.scrollX,
      y: window.scrollY,
      // Cap output resolution; phones with high DPR produce huge images
      // otherwise. 1.5 keeps text readable without blowing past GitHub's
      // image-size limits.
      scale: Math.min(window.devicePixelRatio || 1, 1.5),
      // External card sheets / board image are CORS-tagged; html2canvas
      // skips images it can't read pixels from. useCORS lets it try.
      useCORS: true,
      // Faster on slower devices; we don't need pixel-perfect background
      // rendering for a bug-report snapshot.
      logging: false,
      backgroundColor: '#0c0814',
    });
    // Compress to JPEG-style PNG: prefer PNG for crisp text, accept the
    // size cost — at 1.5x DPR on an iPad screen this is ~300-700KB raw,
    // ~400KB-1MB base64-encoded. Well within Cloudflare Worker request
    // body limits (100MB) and GitHub Contents API limits (100MB).
    const dataUrl = canvas.toDataURL('image/png');
    // Strip the "data:image/png;base64," prefix; the worker re-adds it
    // when it commits the file to GitHub.
    const comma = dataUrl.indexOf(',');
    return comma >= 0 ? dataUrl.slice(comma + 1) : null;
  } catch (err) {
    // Lazy-import failed, canvas-tainted-by-CORS error, or browser
    // doesn't support the necessary APIs. Don't break the bug-report
    // flow — just return null and the dialog renders without a
    // preview.
    // eslint-disable-next-line no-console
    console.warn('[screenshot] capture failed:', err);
    return null;
  }
}
