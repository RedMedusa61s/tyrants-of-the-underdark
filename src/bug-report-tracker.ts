// Tracks bug reports the player has filed so we can show a thank-you
// dialog when the dev posts a "fix note" comment and closes the issue.
//
// Storage shape (localStorage key `totu.bug-reports`):
//   [
//     {
//       number: 17,
//       createdAt: "2026-05-15T18:00:00.000Z",
//       title: "Supplant didn't apply",
//       seenFixCommentAt: "2026-05-16T12:00:00.000Z"  // set once dismissed
//     },
//     ...
//   ]
//
// The worker's /report-status endpoint takes the list of issueNumbers and
// returns updates for any closed issue with a "**Fix note:**" comment.
// The client compares each update's commentCreatedAt against the locally-
// stored seenFixCommentAt; if it's newer (or unset), we surface a modal.

export interface TrackedReport {
  number: number;
  createdAt: string;
  title: string;
  /** ISO timestamp of the fix-note comment we last showed to the user.
   *  When unset, we haven't shown them anything yet. */
  seenFixCommentAt?: string;
}

export interface FixNoteUpdate {
  number: number;
  title: string;
  fixNote: string;
  closedAt: string | null;
  commentCreatedAt: string;
  issueUrl: string;
  commentUrl: string;
}

const STORAGE_KEY = 'totu.bug-reports';

export function loadTrackedReports(): TrackedReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r): r is TrackedReport =>
      typeof r === 'object' && r !== null
      && typeof (r as TrackedReport).number === 'number'
      && typeof (r as TrackedReport).createdAt === 'string'
    );
  } catch {
    return [];
  }
}

function saveTrackedReports(reports: TrackedReport[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
  } catch { /* ignore quota errors */ }
}

/** Record a freshly-filed bug report. Called from ProblemReportDialog after
 *  the relay returns a successful issue number. Dedups by number so the
 *  same issue can't be tracked twice. */
export function recordFiledReport(report: { number: number; title: string }): void {
  const existing = loadTrackedReports();
  if (existing.some(r => r.number === report.number)) return;
  existing.push({
    number: report.number,
    createdAt: new Date().toISOString(),
    title: report.title,
  });
  saveTrackedReports(existing);
}

/** Mark a fix-note comment as seen so it doesn't pop up again on the next
 *  load. The comment timestamp is what's compared on subsequent polls, so
 *  if the dev edits the fix-note later we'll still re-surface it. */
export function markFixNoteSeen(issueNumber: number, commentCreatedAt: string): void {
  const reports = loadTrackedReports();
  const idx = reports.findIndex(r => r.number === issueNumber);
  if (idx < 0) return;
  reports[idx] = { ...reports[idx], seenFixCommentAt: commentCreatedAt };
  saveTrackedReports(reports);
}

/** POST the tracked issue numbers to the relay's /report-status and return
 *  the subset that have unseen fix notes. Empty array on no-relay,
 *  no-reports, or any network/parse failure (silent — the thank-you modal
 *  is a polish feature, not core gameplay). */
export async function fetchUnseenFixNotes(): Promise<FixNoteUpdate[]> {
  const reports = loadTrackedReports();
  if (reports.length === 0) return [];
  const relayUrl = import.meta.env.VITE_TOTU_RELAY_URL as string | undefined;
  if (!relayUrl) return [];
  try {
    const resp = await fetch(`${relayUrl.replace(/\/$/, '')}/report-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueNumbers: reports.map(r => r.number) }),
    });
    if (!resp.ok) return [];
    const data = await resp.json().catch(() => null) as { updates?: FixNoteUpdate[] } | null;
    if (!data || !Array.isArray(data.updates)) return [];
    // Filter to updates whose comment timestamp is newer than what we've
    // already shown to the user.
    const byNumber = new Map(reports.map(r => [r.number, r] as const));
    return data.updates.filter(u => {
      const tracked = byNumber.get(u.number);
      if (!tracked) return false;
      if (!tracked.seenFixCommentAt) return true;
      return u.commentCreatedAt > tracked.seenFixCommentAt;
    });
  } catch {
    return [];
  }
}
