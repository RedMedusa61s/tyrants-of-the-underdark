import fs from 'node:fs';

const path = 'src/data/sites.ts';
let src = fs.readFileSync(path, 'utf8');

const overrides = {
  'phaerlin': 2, 'tsenviilyq': 4, 'sszuraassnee': 2, 'llacerellyn': 2,
  'gauntlgrym': 2, 'chchitl': 2, 'kanaglym': 3, 'skullport': 4,
  'wormwrithings': 3, 'buiyrandyn': 3, 'jhachalkhyn': 4, 'dekanter': 5,
  'ched-nasad': 3, 'labyrinth': 3, 'chaulssin': 4, 'stoneshaft': 4,
  'yathchol': 4,
};

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

let fixed = 0;
for (const [id, newVp] of Object.entries(overrides)) {
  // Rewrite the 4th positional arg (VP) of the seed() call for this id.
  const re = new RegExp(`(seed\\(\\s*'${escapeRe(id)}',[^,]+,[^,]+,\\s*)(\\d+)(,)`);
  const m = src.match(re);
  if (!m) { console.log('  NO MATCH for id:', id); continue; }
  if (parseInt(m[2]) === newVp) continue;
  src = src.replace(re, `$1${newVp}$3`);
  fixed++;
}

fs.writeFileSync(path, src);
console.log('Updated', fixed, 'site VPs.');
