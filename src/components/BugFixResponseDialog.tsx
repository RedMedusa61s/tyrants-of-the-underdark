// Thank-you modal shown when the dev posts a "Fix note" on a bug the
// player previously filed via Report-a-problem. The pattern is borrowed
// from the dispute-response flow in the ITS project: the user sees the
// response once on next app load, dismisses it, and we record the
// comment timestamp so it doesn't pop up again.
//
// If multiple fix-notes are unseen at the same time (the player filed
// several bugs and we shipped fixes for several), the parent (App.tsx)
// surfaces them one at a time via this dialog's onDismiss callback.

import type { FixNoteUpdate } from '../bug-report-tracker';

interface Props {
  update: FixNoteUpdate;
  onDismiss: () => void;
}

export function BugFixResponseDialog({ update, onDismiss }: Props) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 200, padding: 24,
    }} onClick={onDismiss}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#1a1228', color: '#e6e1f2',
        border: '2px solid #3a2055', borderRadius: 8, padding: 24,
        maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto',
        lineHeight: 1.55, fontSize: 13,
      }}>
        <h2 style={{ marginTop: 0, marginBottom: 6, color: '#9bd' }}>
          A bug you reported was fixed — thank you!
        </h2>
        <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 16 }}>
          Issue #{update.number}: {update.title}
        </div>

        <div style={{
          background: '#0c0814', border: '1px solid #3a2055', borderRadius: 4,
          padding: 12, whiteSpace: 'pre-wrap', fontFamily: 'inherit',
        }}>
          {update.fixNote}
        </div>

        <p style={{ opacity: 0.7, fontSize: 12, marginTop: 16 }}>
          Reports like yours are how the game improves. If you run into
          anything else, the <b>Report a problem</b> button in the header
          is the fastest way to flag it.
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20, alignItems: 'center' }}>
          <a href={update.issueUrl} target="_blank" rel="noreferrer"
            style={{ marginRight: 'auto', fontSize: 12, color: '#9bd', textDecoration: 'underline' }}>
            View on GitHub ↗
          </a>
          <button onClick={onDismiss} style={{
            padding: '8px 22px', background: '#5a3380', color: '#fff',
            border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
          }}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
