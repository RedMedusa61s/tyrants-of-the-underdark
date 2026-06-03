// Tyrants' POLICY for the framework's ReportForwarder mechanism (dbf@0.4.0).
//
// GameServer.report() stores the report row, then calls forwardReport() best-
// effort (a throw only logs — the row is already durable). This forwarder turns
// a stored online report into a GitHub issue by POSTing to the SAME relay
// /problem-report endpoint the hotseat client uses, so both modes produce
// identically-shaped issues from one formatter. The GitHub token never lives
// here — it stays in the relay worker. In dev the endpoint is the local Vite
// /__report-problem middleware, so no token touches the Pages project at all.
//
// Mechanism (fire a sink after storing) lives in the framework; policy (which
// endpoint, which labels) lives here:
//   - category 'multiplayer'  -> area:multiplayer label (framework-class bug)
//   - the framework reportId is embedded in the issue meta so triage can pull
//     the exact stored snapshot (issue -> snapshot link). Storing the issue URL
//     back onto the report row would need a BugReportRow field — a framework
//     change, deliberately NOT done game-side.

import type { ReportForwarder, BugReportRow } from 'digital-boardgame-framework/server';

export interface GitHubIssueForwarderOpts {
  /** Absolute URL of the issue sink: the relay worker's /problem-report in
   *  production, or the local /__report-problem Vite middleware in dev. */
  endpoint: string;
}

/** Game policy: map our report category to extra GitHub labels. The base
 *  ['bug','from-game'] labels are added by the relay; we only contribute the
 *  area tag. */
function extraLabelsFor(category?: string): string[] {
  return category === 'multiplayer' ? ['area:multiplayer'] : [];
}

export class GitHubIssueForwarder implements ReportForwarder {
  constructor(private readonly opts: GitHubIssueForwarderOpts) {}

  async forwardReport(report: BugReportRow): Promise<void> {
    const payload = {
      description: report.message,
      labels: extraLabelsFor(report.category),
      // Relay renders this as a "Build / context" block. No game state is sent
      // here — the authoritative snapshot lives in the framework store, keyed
      // by frameworkReportId, which the issue references.
      meta: {
        mode: 'online',
        gameId: report.gameId,
        seat: report.reporterSide,
        turn: report.turnNumber,
        category: report.category ?? 'game',
        frameworkReportId: report.reportId,
        build: report.clientBuild ?? null,
        userAgent: report.userAgent ?? null,
      },
    };

    const resp = await fetch(this.opts.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      // Thrown errors are non-fatal per the ReportForwarder contract (the row
      // is already stored); surface enough to debug in the server logs.
      const text = await resp.text().catch(() => '');
      throw new Error(`GitHubIssueForwarder ${resp.status}: ${text.slice(0, 200)}`);
    }
  }
}
