import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Lobby } from './online/Lobby';
import { OnlinePlay } from './online/OnlinePlay';

// Additive root router. ONLINE routes (/lobby, /play/:id?as=token) render the
// minimal online multiplayer UI; EVERY other path renders the existing hotseat
// App unchanged. The hotseat path (App, its AI driver loop, game.ts) is
// untouched — a client online only ever drives its own seat.
function Root() {
  const path = window.location.pathname;

  const playMatch = path.match(/^\/play\/([^/]+)/);
  if (playMatch) {
    const token = new URLSearchParams(window.location.search).get('as');
    if (token) return <OnlinePlay gameId={playMatch[1]!} token={token} />;
  }
  if (path === '/lobby' || path === '/lobby/') {
    return <Lobby />;
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
