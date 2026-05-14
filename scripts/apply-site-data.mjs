// Apply slot count, whites count, and starting-site corrections to sites.ts
// based on visual reading of the per-site crops.

import fs from 'node:fs';

const path = 'src/data/sites.ts';
let src = fs.readFileSync(path, 'utf8');

const data = {
  'mantol-derith':  { slots: 5, whites: 2, start: true },
  'eryndlyn':       { slots: 3, whites: 0, start: true },
  'jhachalkhyn':    { slots: 4, whites: 0, start: true },
  'ched-nasad':     { slots: 4, whites: 0, start: true },
  'chaulssin':      { slots: 5, whites: 0, start: true },
  'skullport':      { slots: 5, whites: 2, start: true },
  'dekanter':       { slots: 5, whites: 2 },
  'buiyrandyn':     { slots: 3, whites: 1 },
  'blingdenstone':  { slots: 2, whites: 2 },
  'gracklstugh':    { slots: 4, whites: 2 },
  'stoneshaft':     { slots: 2, whites: 2 },
  'wormwrithings':  { slots: 3, whites: 0 },
  'chasmleap':      { slots: 1, whites: 0 },
  'labyrinth':      { slots: 3, whites: 1 },
  'halls-legion':   { slots: 2, whites: 1 },
  'yathchol':       { slots: 2, whites: 2 },
  'everfire':       { slots: 3, whites: 0 },
  'kanaglym':       { slots: 3, whites: 0 },
  'llacerellyn':    { slots: 2, whites: 0 },
  'menzoberranzan': { slots: 6, whites: 3 },
  'gauntlgrym':     { slots: 3, whites: 2, start: true },
  'araumycos':      { slots: 4, whites: 4 },
  'chchitl':        { slots: 3, whites: 2, start: true },
  'sszuraassnee':   { slots: 3, whites: 2 },
  'phaerlin':       { slots: 4, whites: 3 },
  'tsenviilyq':     { slots: 3, whites: 3 },
};

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

let fixed = 0;
for (const [id, d] of Object.entries(data)) {
  // Match: seed('id', 'Name', 'section', VP, SLOTS [, {flags}] )
  const re = new RegExp(
    `(seed\\(\\s*'${esc(id)}',\\s*(?:'[^']*'|"[^"]*"),\\s*'[^']+',\\s*\\d+,\\s*)(\\d+)(?:(\\s*,\\s*)(\\{[^}]*\\}))?(\\s*\\))`
  );
  const m = src.match(re);
  if (!m) { console.log(`  NO MATCH for ${id}`); continue; }

  const oldSlots = m[2];
  const oldFlags = m[4] ?? '';

  const hasControl = /control:\s*true/.test(oldFlags);
  const newStart = d.start ?? /start:\s*true/.test(oldFlags);
  const flagParts = [];
  if (hasControl) flagParts.push('control: true');
  if (newStart) flagParts.push('start: true');
  flagParts.push(`whites: ${d.whites}`);
  const newFlags = `{ ${flagParts.join(', ')} }`;

  // Always inject ", { ... }" since we're now setting whites explicitly.
  const replacement = `${m[1]}${d.slots}, ${newFlags}${m[5]}`;
  if (m[0] !== replacement) {
    src = src.replace(re, replacement);
    if (oldSlots !== String(d.slots)) console.log(`  ${id}: slots ${oldSlots} → ${d.slots}`);
    fixed++;
  }
}

fs.writeFileSync(path, src);
console.log(`\nUpdated ${fixed} site rows.`);
