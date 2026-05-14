// First-run image-import gate.
//
// Shown the first time the app loads (no images cached yet) when a remote
// image source is configured. Walks the card data, fetches every image into
// IndexedDB, and shows a progress bar. After completion, sets a localStorage
// flag so this is a one-and-done — subsequent loads skip the gate even if
// blob URLs need re-creating from the cached blobs.
//
// If no remote source is configured (VITE_TOTU_IMAGE_BASE_URL is unset) the
// component renders nothing — local-dev users with the extracted assets get
// the regular `/cards/*` paths via the cache helper.

import { useEffect, useState } from 'react';
import { allCards } from '../card-data';
import { bulkImport, clearImageCache, type BulkImportProgress } from '../image-cache';

const FLAG_KEY = 'totu.image-cache-ready';

function hasRemoteSource(): boolean {
  // Imgur deck sheets are always available (compiled into sheet-config.ts), so
  // the importer is unconditionally useful — no need for an env-var base URL.
  return true;
}

function uniqueImagePaths(): string[] {
  const set = new Set<string>();
  for (const c of allCards()) if (c.image) set.add(c.image);
  return [...set];
}

export function FirstRunImageImport({ onClose }: { onClose?: () => void }) {
  const [progress, setProgress] = useState<BulkImportProgress | null>(null);
  const [started, setStarted] = useState(false);
  const [closed, setClosed] = useState(false);

  // Auto-skip if we've already done this, or no remote source is configured.
  useEffect(() => {
    if (!hasRemoteSource()) { setClosed(true); onClose?.(); return; }
    if (localStorage.getItem(FLAG_KEY) === '1') { setClosed(true); onClose?.(); return; }
  }, [onClose]);

  if (closed || !hasRemoteSource()) return null;

  async function start() {
    setStarted(true);
    const paths = uniqueImagePaths();
    const final = await bulkImport(paths, p => setProgress(p));
    if (final.failed === 0) localStorage.setItem(FLAG_KEY, '1');
  }

  function skip() {
    // Mark as done without fetching — user can re-import later via settings.
    localStorage.setItem(FLAG_KEY, '1');
    setClosed(true);
    onClose?.();
  }

  function done() {
    setClosed(true);
    onClose?.();
  }

  const isComplete = progress?.finished === true;
  const pct = progress && progress.total > 0
    ? Math.round(((progress.done + progress.failed) / progress.total) * 100)
    : 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000,
    }}>
      <div style={{
        background: '#1a1228', color: '#e6e1f2',
        border: '2px solid #3a2055', borderRadius: 6,
        padding: 24, width: 540, maxWidth: '95vw',
      }}>
        <h2 style={{ marginTop: 0 }}>One-time setup: download card art</h2>
        <p style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>
          Tyrants of the Underdark uses card and board art published by Wizards
          of the Coast. This app doesn't host or redistribute that art. With
          your consent it can download four deck sheets from a public Imgur
          mirror (the Tabletop Simulator workshop mod), slice the cards out of
          them in your browser, and cache the results locally. After this
          one-time setup, network usage is zero.
        </p>
        <p style={{ fontSize: 12, opacity: 0.6 }}>
          Card art © Wizards of the Coast / Gale Force Nine. By continuing
          you confirm this is for your personal use only. You can clear the
          cache later from settings.
        </p>

        {!started && (
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button onClick={start}
              style={{ padding: '10px 20px', background: '#5a3380', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14 }}>
              Download images
            </button>
            <button onClick={skip}
              style={{ padding: '10px 20px', background: '#2a1840', color: '#e6e1f2', border: '1px solid #3a2055', borderRadius: 4, cursor: 'pointer', fontSize: 14 }}>
              Skip — play with placeholders
            </button>
          </div>
        )}

        {started && progress && (
          <div style={{ marginTop: 16 }}>
            <div style={{ height: 8, background: '#0c0814', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                width: `${pct}%`, height: '100%', background: '#5a3380',
                transition: 'width 120ms ease-out',
              }} />
            </div>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
              {progress.done + progress.failed}/{progress.total} images
              {progress.failed > 0 && <span style={{ color: '#ff8888', marginLeft: 8 }}>· {progress.failed} failed</span>}
              {progress.current && !isComplete && (
                <span style={{ opacity: 0.5, marginLeft: 8, fontFamily: 'monospace', fontSize: 11 }}>
                  {progress.current.slice(-40)}
                </span>
              )}
            </div>
            {isComplete && (
              <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={done}
                  style={{ padding: '10px 20px', background: '#5a3380', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14 }}>
                  Continue
                </button>
                {progress.failed > 0 && (
                  <button onClick={() => { clearImageCache(); localStorage.removeItem(FLAG_KEY); window.location.reload(); }}
                    style={{ padding: '8px 14px', background: '#2a1840', color: '#e6e1f2', border: '1px solid #3a2055', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
                    Retry from scratch
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
