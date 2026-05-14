// Auto-detect slot positions via flood-fill on bright pixels in a per-site window.
// Slots are bright disc-shaped regions; we filter by area / aspect / fill ratio and
// pick the N best matches (where N = site's troopSlots).

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve('.');
const BOARD = path.join(ROOT, 'assets/board/map.jpg');
const POSITIONS = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/site-positions-ocr.json'), 'utf8'));

const sitesSrc = fs.readFileSync(path.join(ROOT, 'src/data/sites.ts'), 'utf8');
const sites = [];
const re = /seed\(\s*'([^']+)',\s*(?:'([^']*)'|"([^"]*)"),\s*'[^']+',\s*\d+,\s*(\d+)(?:,\s*\{([^}]*)\})?/g;
let m;
while ((m = re.exec(sitesSrc))) {
  const id = m[1];
  const name = m[2] ?? m[3] ?? '';
  const slots = parseInt(m[4]);
  const flags = m[5] ?? '';
  const hasControlMarker = /control:\s*true/.test(flags);
  if (POSITIONS[name]) sites.push({ id, name, slots, hasControlMarker, ...POSITIONS[name] });
}

const meta = await sharp(BOARD).metadata();
const W = meta.width, H = meta.height;
const raw = await sharp(BOARD).raw().toBuffer();

const BRIGHT = 180;
const MIN_AREA = 500;
const MAX_AREA = 12000;

function detectSlots(cx, cy, expected) {
  const WIN = 320;
  const x0 = Math.max(0, cx - WIN);
  const y0 = Math.max(0, cy - WIN);
  const x1 = Math.min(W, cx + WIN);
  const y1 = Math.min(H, cy + WIN);
  const ww = x1 - x0, hh = y1 - y0;

  const grid = new Uint8Array(ww * hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < ww; x++) {
      const gi = ((y0 + y) * W + (x0 + x)) * 3;
      if (raw[gi] > BRIGHT && raw[gi + 1] > BRIGHT && raw[gi + 2] > BRIGHT) {
        grid[y * ww + x] = 1;
      }
    }
  }

  const visited = new Uint8Array(ww * hh);
  const blobs = [];
  const stackX = new Int32Array(ww * hh);
  const stackY = new Int32Array(ww * hh);
  for (let sy = 0; sy < hh; sy++) {
    for (let sx = 0; sx < ww; sx++) {
      const si = sy * ww + sx;
      if (!grid[si] || visited[si]) continue;
      let top = 0;
      stackX[top] = sx; stackY[top] = sy; top++;
      visited[si] = 1;
      let area = 0, sumX = 0, sumY = 0, minX = sx, minY = sy, maxX = sx, maxY = sy;
      while (top > 0) {
        top--;
        const x = stackX[top], y = stackY[top];
        area++; sumX += x; sumY += y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= ww || ny >= hh) continue;
          const ni = ny * ww + nx;
          if (grid[ni] && !visited[ni]) {
            visited[ni] = 1;
            stackX[top] = nx; stackY[top] = ny; top++;
          }
        }
      }
      if (area < MIN_AREA || area > MAX_AREA) continue;
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      const ratio = bw / bh;
      if (ratio < 0.45 || ratio > 2.2) continue;
      const fill = area / (bw * bh);
      if (fill < 0.45 || fill > 1.05) continue;
      blobs.push({ cx: x0 + sumX / area, cy: y0 + sumY / area, area, bw, bh });
    }
  }

  blobs.sort((a, b) => Math.abs(a.area - 2500) - Math.abs(b.area - 2500));
  const picked = blobs.slice(0, expected);
  picked.sort((a, b) => {
    if (Math.abs(a.cy - b.cy) > 35) return a.cy - b.cy;
    return a.cx - b.cx;
  });
  return picked;
}

const out = {};
const failed = [];
for (const s of sites) {
  let cx = Math.round(s.x * W);
  let cy = Math.round(s.y * H);
  if (s.hasControlMarker) cy += Math.round(H * 0.13);
  const blobs = detectSlots(cx, cy, s.slots);
  const ok = blobs.length === s.slots;
  console.log(`${s.name.padEnd(28)} need=${s.slots} found=${blobs.length}` + (ok ? ' ✓' : ' ✗'));
  if (!ok) failed.push(s.name);
  for (let i = 0; i < blobs.length; i++) {
    out[`${s.id}:${i}`] = { x: blobs[i].cx / W, y: blobs[i].cy / H };
  }
}

fs.writeFileSync(path.join(ROOT, 'assets/slot-positions-auto.json'), JSON.stringify(out, null, 2));
console.log(`\nWrote ${Object.keys(out).length} slot positions.`);
console.log(`Failed sites (need manual calibration): ${failed.join(', ') || 'none'}`);
