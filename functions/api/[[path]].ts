// Cloudflare Pages Function — production path for the online multiplayer API.
// Catches all /api/* requests and delegates to the same handleApi router the
// Vite dev middleware uses (true dev/prod parity). LOCAL DEV does not use this
// file — it's here for a later manual deploy to a SEPARATE Supabase + Pages
// project. It coexists with the existing worker/ (the GitHub bug-report relay),
// which serves different paths.
//
// NOTE: imports the Workers-SAFE server barrel (no node:fs). FsStore lives at
// digital-boardgame-framework/server/node and is NEVER imported here.

import { GameServer, SupabaseStore, ResendNotifier, NoopNotifier } from 'digital-boardgame-framework/server';
import { createClient } from '@supabase/supabase-js';
import { tyrantsAdapter, type BgioState, type TyrantsAction, type PlayerId } from '../../src/adapter/tyrantsAdapter';
import { snapshotCodec } from '../../src/online/snapshotCodec';
import { handleApi } from '../../server/handlers';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_KEY?: string;
  RESEND_FROM?: string;
  SITE_URL?: string;
}

// Module-scoped cache — persists across requests within a warm isolate.
let _supabase: ReturnType<typeof createClient> | null = null;

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const url = new URL(request.url);

  if (!_supabase) {
    _supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  }

  const notifier = env.RESEND_KEY
    ? new ResendNotifier({ apiKey: env.RESEND_KEY, from: env.RESEND_FROM ?? 'games@example.com' })
    : new NoopNotifier();

  const site = env.SITE_URL ?? url.origin;
  const server = new GameServer<BgioState, TyrantsAction, PlayerId>({
    adapter: tyrantsAdapter,
    codec: snapshotCodec(),
    store: new SupabaseStore(_supabase),
    notifier,
    gameUrl: (gameId, token) => `${site}/play/${gameId}?as=${token}`,
  });

  let body: unknown = undefined;
  if (request.method === 'POST') {
    try { body = await request.json(); } catch { body = {}; }
  }

  const result = await handleApi(server, request.method, url.pathname, url.searchParams, body);
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
};
