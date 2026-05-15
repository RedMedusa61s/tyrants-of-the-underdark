import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';

// Dev-only middleware: the running app POSTs its log/snapshots JSON to
// /__save-log on every state change. The handler writes it to a known path
// (training-logs/live.json) so the developer (or an assistant) can read the
// current game state without manual copy/paste.
function liveLogPlugin(): Plugin {
  return {
    name: 'live-log-writer',
    configureServer(server) {
      const outDir = path.resolve(__dirname, 'training-logs');
      const outFile = path.join(outDir, 'live.json');
      mkdirSync(outDir, { recursive: true });
      const clicksFile = path.join(outDir, 'clicks.jsonl');
      server.middlewares.use('/__log-click', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            JSON.parse(body); // validate
            appendFileSync(clicksFile, body + '\n');
            res.statusCode = 204; res.end();
          } catch (err) {
            res.statusCode = 400; res.end(String(err));
          }
        });
      });
      // Problem-report endpoint. Accepts a JSON payload from the in-game
      // "Report a problem" dialog and either:
      //   - Files a GitHub Issue against the configured repo (when both
      //     TOTU_BUGREPORT_TOKEN and TOTU_BUGREPORT_REPO env vars are set), or
      //   - Falls back to writing the report to disk under
      //     training-logs/problem-reports/<timestamp>.json so the user doesn't
      //     lose feedback when GitHub isn't configured.
      // Returns { ok: true, url? , filePath? } as JSON.
      const reportsDir = path.join(outDir, 'problem-reports');
      mkdirSync(reportsDir, { recursive: true });
      const token = process.env.TOTU_BUGREPORT_TOKEN;
      const repo = process.env.TOTU_BUGREPORT_REPO; // e.g. "johnchampaign/tyrants-of-the-underdark"
      server.middlewares.use('/__report-problem', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c));
        req.on('end', async () => {
          let body: {
            description: string;
            expected?: string;
            includeState?: boolean;
            includeLog?: boolean;
            state?: unknown;
            log?: string[];
            meta?: Record<string, unknown>;
          };
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { res.statusCode = 400; res.end('bad json'); return; }

          const description = (body.description || '').trim();
          if (!description) { res.statusCode = 400; res.end('empty description'); return; }

          const title = description.split('\n')[0].slice(0, 80) || 'Problem report';
          const sections: string[] = [`**What happened**\n\n${description}`];
          if (body.expected?.trim()) sections.push(`**What I expected**\n\n${body.expected.trim()}`);
          if (body.meta) {
            const metaLines = Object.entries(body.meta).map(([k, v]) => `- ${k}: \`${JSON.stringify(v)}\``);
            sections.push(`**Build / context**\n\n${metaLines.join('\n')}`);
          }
          if (body.includeLog && body.log?.length) {
            const tail = body.log.slice(-40).join('\n');
            sections.push(`**Last ${Math.min(40, body.log.length)} log lines**\n\n\`\`\`\n${tail}\n\`\`\``);
          }
          if (body.includeState && body.state) {
            const stateJson = JSON.stringify(body.state, null, 2);
            // GitHub issue body cap is ~65k chars. Truncate if needed.
            const truncated = stateJson.length > 50000 ? stateJson.slice(0, 50000) + '\n...(truncated)' : stateJson;
            sections.push(`**Game state**\n\n\`\`\`json\n${truncated}\n\`\`\``);
          }
          const issueBody = sections.join('\n\n---\n\n');

          // Always also write to disk for safety.
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filePath = path.join(reportsDir, `report-${stamp}.json`);
          writeFileSync(filePath, JSON.stringify({
            title, description, expected: body.expected, meta: body.meta,
            log: body.log, state: body.state, writtenAt: new Date().toISOString(),
          }, null, 2));

          if (!token || !repo) {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({
              ok: true,
              filePath: path.relative(__dirname, filePath),
              note: 'GitHub not configured (TOTU_BUGREPORT_TOKEN / TOTU_BUGREPORT_REPO unset). Report saved locally.',
            }));
            return;
          }

          try {
            const resp = await fetch(`https://api.github.com/repos/${repo}/issues`, {
              method: 'POST',
              headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                title,
                body: issueBody,
                labels: ['bug', 'from-game'],
              }),
            });
            if (!resp.ok) {
              const text = await resp.text();
              res.statusCode = 502;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({
                ok: false,
                error: `GitHub ${resp.status}: ${text.slice(0, 400)}`,
                filePath: path.relative(__dirname, filePath),
              }));
              return;
            }
            const issue = await resp.json() as { html_url: string; number: number };
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({
              ok: true,
              url: issue.html_url,
              number: issue.number,
              filePath: path.relative(__dirname, filePath),
            }));
          } catch (err) {
            res.statusCode = 502;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({
              ok: false,
              error: String(err),
              filePath: path.relative(__dirname, filePath),
            }));
          }
        });
      });

      // Local fallback for the auto-publish flow on ctx.gameover. When the
      // client hasn't set VITE_TOTU_RELAY_URL, completed games land here on
      // disk instead of being pushed to the public logs/ repo. Writes one
      // JSON file per game into training-logs/published-locally/.
      const publishLocallyDir = path.join(outDir, 'published-locally');
      mkdirSync(publishLocallyDir, { recursive: true });
      server.middlewares.use('/__publish-game-log', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filePath = path.join(publishLocallyDir, `${body.source || 'game'}-${stamp}.json`);
            writeFileSync(filePath, JSON.stringify(body, null, 2));
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({
              ok: true,
              filePath: path.relative(__dirname, filePath),
              note: 'VITE_TOTU_RELAY_URL unset — game saved locally.',
            }));
          } catch (err) {
            res.statusCode = 400; res.end(String(err));
          }
        });
      });

      server.middlewares.use('/__save-log', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            // Validate it parses; rewrite pretty.
            const parsed = JSON.parse(body);
            writeFileSync(outFile, JSON.stringify(parsed, null, 2));
            res.statusCode = 204;
            res.end();
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load .env (and .env.<mode>) into process.env so the bug-report middleware
  // can see TOTU_BUGREPORT_TOKEN / TOTU_BUGREPORT_REPO at runtime. Vite's
  // default behavior only exposes VITE_-prefixed vars to the client, which we
  // explicitly don't want for the token. The third arg `''` disables the
  // VITE_ prefix filter so we get every var defined in the .env files.
  const env = loadEnv(mode, process.cwd(), '');
  for (const k of Object.keys(env)) {
    if (process.env[k] === undefined) process.env[k] = env[k];
  }
  return {
    // GitHub Pages serves the site under /<repo-name>/, so production
    // builds need every asset URL to be prefixed with that path. Dev keeps
    // the default '/'. Override with VITE_BASE_PATH if you ever deploy to
    // a different sub-path (custom domain, root deploy, etc.).
    base: mode === 'production' ? (env.VITE_BASE_PATH || '/tyrants-of-the-underdark/') : '/',
    plugins: [react(), liveLogPlugin()],
    server: { port: 5173, open: false },
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    publicDir: 'assets',
  };
});
