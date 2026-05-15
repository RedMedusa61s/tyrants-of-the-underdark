// Consent dialog shown before the bulk log uploader posts anything to the
// public log relay. Mirrors the same disclosure flow we used on the Impulse
// port: tell the player what's in the upload, what isn't, where it goes,
// and that re-clicking later is server-side idempotent. Patterned after the
// "Submit logs to public dataset" prompt from Impulse's WPF MainWindow.

interface Props {
  open: boolean;
  /** Number of game records the upload will attempt — archived games plus
   *  the current in-progress one. Shown in the dialog so the player knows
   *  the scope of what's about to be sent. */
  recordCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function LogUploadConsentDialog({ open, recordCount, onCancel, onConfirm }: Props) {
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, padding: 24,
    }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#1a1228', color: '#e6e1f2',
        border: '2px solid #3a2055', borderRadius: 8, padding: 24,
        maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto',
        lineHeight: 1.5, fontSize: 13,
      }}>
        <h2 style={{ marginTop: 0, marginBottom: 12, color: '#ffcc44' }}>
          Submit logs to public dataset
        </h2>

        <p>
          You are about to submit <b>{recordCount}</b> game log{recordCount === 1 ? '' : 's'} to
          a <b>public</b> dataset hosted on GitHub.
        </p>

        <p style={{ marginBottom: 4 }}><b>What gets sent:</b></p>
        <ul style={{ marginTop: 0, paddingLeft: 22 }}>
          <li>Every move taken in each game — card plays, deploys,
              assassinations, supplants, spy placements, choices.</li>
          <li>Hand contents and card draws (the full random state of each
              turn, captured as per-turn snapshots).</li>
          <li>Half-decks in play, AI styles, player count, final site
              control, trophy counts, and scores.</li>
        </ul>

        <p style={{ marginBottom: 4 }}><b>What is NOT sent:</b></p>
        <ul style={{ marginTop: 0, paddingLeft: 22 }}>
          <li>Your name, email, IP address, or any account information.</li>
          <li>Anything outside the game state — no browser data, no other
              tabs, no cookies, no local files.</li>
        </ul>

        <p>
          Anyone — including researchers — can use the dataset to improve
          Tyrants AIs or study the game. Each upload is identified by the
          content of the record, so duplicate uploads are deduplicated
          server-side: clicking Submit again later only commits NEW logs.
        </p>

        <p style={{ opacity: 0.7, fontSize: 12, marginTop: 16 }}>
          The dataset lives in the same GitHub repo as the source code.
          You can browse it any time. If you'd rather not contribute, just
          cancel — single-player and AI matches all work the same way
          either way.
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button onClick={onCancel} style={{
            padding: '8px 18px', background: 'transparent', color: '#e6e1f2',
            border: '1px solid #5a3380', borderRadius: 4, cursor: 'pointer',
          }}>
            Cancel
          </button>
          <button onClick={onConfirm} style={{
            padding: '8px 18px', background: '#5a3380', color: '#fff',
            border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
          }}>
            Submit {recordCount} log{recordCount === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
