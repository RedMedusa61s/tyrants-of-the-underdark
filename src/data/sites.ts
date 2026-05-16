// Static site data for the Tyrants of the Underdark map.
//
// Confidence levels (after multiple full game playthroughs):
//   - id, name, section, vp, troopSlots, hasControlMarker, isStartingSite,
//     whitesAtStart / whiteSlots: validated against the printed board.
//   - position (x, y): mostly OCR-derived against the calibrated map image
//     (see assets/site-positions-ocr.json merged at module load). Sites the
//     OCR missed keep their seed placeholder positions — currently this is
//     Ch'Chitl. Recalibrate via the /calibrate dev tab and re-export.

export type Section = 'left' | 'center' | 'right';

export interface Site {
  id: string;
  name: string;
  section: Section;
  vp: number;
  troopSlots: number;
  /** Number of white troops placed in this site at setup. Slots 0..(whitesAtStart-1)
   *  start occupied by white. Per rulebook p.4 step 6, equals the number of × marks
   *  printed in the site's box on the board. Used as a fallback when
   *  `whiteSlots` is undefined. */
  whitesAtStart: number;
  /** Explicit slot indices that start with a white troop. When set, takes
   *  precedence over `whitesAtStart` (which is a "first N slots" shorthand).
   *  Needed for sites where the printed whites aren't in the lowest-indexed
   *  slots. */
  whiteSlots?: number[];
  hasControlMarker: boolean;
  isStartingSite: boolean;
  /** Normalized 0..1 board-image coords. */
  x: number;
  y: number;
}

// Seeded positions are evenly spaced placeholders by section — they will look wrong on the
// real board image until calibrated. The map will render at the wrong layout but every site
// will be present and clickable.
const seedPos = (() => {
  let counter = { left: 0, center: 0, right: 0 };
  return (section: Section) => {
    const idx = counter[section]++;
    const col = section === 'left' ? 0.12 : section === 'center' ? 0.5 : 0.88;
    return { x: col + ((idx % 2) - 0.5) * 0.08, y: 0.1 + (idx * 0.09) };
  };
})();

const seed = (
  id: string, name: string, section: Section, vp: number, troopSlots: number,
  flags: { control?: boolean; start?: boolean; whites?: number; whiteSlots?: number[] } = {}
): Site => ({
  id, name, section, vp, troopSlots,
  // Default: 0 whites at starting sites (players deploy there), 1 elsewhere. Override
  // per-site by passing `whites: N` until per-site counts are calibrated.
  whitesAtStart: flags.whites ?? (flags.start ? 0 : 1),
  ...(flags.whiteSlots && { whiteSlots: flags.whiteSlots }),
  hasControlMarker: !!flags.control,
  isStartingSite: !!flags.start,
  ...seedPos(section),
});

// 26 sites total. VP / slot / starting / control flags seeded from rulebook setup image.
// Review against the actual board before trusting any of these.
export const SITES: Site[] = [
  // Left section (used in 3p with-left, 4p)
  seed('gauntlgrym',    'Gauntlgrym',                'left',   2, 3, { control: true, start: true, whites: 2 }),
  seed('blingdenstone', 'Blingdenstone',             'center', 4, 2, { whites: 2 }),
  seed('buiyrandyn',    'Buiyrandyn',                'left',   3, 3, { whites: 1 }),
  seed('jhachalkhyn',   'Jhachalkhyn',               'left',   4, 4, { start: true, whites: 0 }),
  seed('stoneshaft',    'Stoneshaft Clanhold',       'left',   4, 2, { whites: 2 }),
  seed('gracklstugh',   'Gracklstugh',               'center', 3, 4, { whites: 2 }),
  seed('wormwrithings', 'The Wormwrithings',         'left',   3, 3, { whites: 0 }),
  seed('skullport',     'Skullport',                 'center', 4, 5, { start: true, whites: 2 }),
  seed('chasmleap',     'Chasmleap Bridge',          'center', 1, 1, { whites: 0 }),

  // Center section (used in 2p, 3p, 4p)
  seed('menzoberranzan','Menzoberranzan',            'center', 5, 6, { control: true, whites: 3 }),
  seed('mantol-derith', 'Mantol-Derith',             'center', 4, 5, { start: true, whites: 2 }),
  seed('araumycos',     'Araumycos',                 'center', 3, 4, { control: true, whites: 4 }),
  seed('eryndlyn',      'Eryndlyn',                  'center', 3, 3, { start: true, whites: 0 }),
  seed('labyrinth',     'The Labyrinth',             'center', 3, 3, { whites: 1 }),
  seed('halls-legion',  'Halls of the Scoured Legion','center', 3, 2, { whites: 1, whiteSlots: [1] }),
  seed('ched-nasad',    'Ched Nasad',                'center', 3, 4, { start: true, whites: 0 }),

  // Right section (used in 3p with-right, 4p)
  seed('chchitl',       "Ch'Chitl",                  'left',   2, 3, { control: true, start: true, whites: 2 }),
  seed('phaerlin',      'The Phaerlin',              'right',  2, 3, { control: true, whites: 2, whiteSlots: [0, 1] }),
  seed('llacerellyn',   'Llacerellyn',               'center', 2, 2, { whites: 0 }),
  seed('sszuraassnee',  "Ss'zuraass'nee",            'right',  2, 3, { control: true, whites: 2 }),
  seed('tsenviilyq',    'Tsenviilyq',                'center', 4, 3, { control: true, whites: 3 }),
  seed('yathchol',      'Yathchol',                  'right',  4, 2, { whites: 2 }),
  seed('chaulssin',     'Chaulssin',                 'right',  4, 5, { start: true, whites: 0 }),
  seed('dekanter',      'Ruins of Dekanter',         'right',  5, 6, { whites: 2 }),
  seed('everfire',      'Everfire',                  'center', 3, 3, { whites: 0 }),
  seed('kanaglym',      'Kanaglym',                  'center', 3, 3, { whites: 0 }),
];

// Auto-derived positions from OCR of the board image (see scripts/ocr-board.mjs).
// Overrides the seeded x/y for any site whose name OCR matched. Sites OCR missed keep
// their placeholder positions and can be calibrated via the in-app calibrate tab.
import OCR_POSITIONS from '../../assets/site-positions-ocr.json';
for (const [name, pos] of Object.entries(OCR_POSITIONS as Record<string, { x: number; y: number }>)) {
  const site = SITES.find(s => s.name === name);
  if (site) { site.x = pos.x; site.y = pos.y; }
}

// Browser-only: merge user-edited `whiteSlots` from localStorage (set via the
// in-app "whites" tab). Mirrors the route-overrides pattern; baked values go
// into the SITES seeds above.
if (typeof localStorage !== 'undefined') {
  try {
    const raw = localStorage.getItem('totu.site-whites-overrides');
    if (raw) {
      const overrides = JSON.parse(raw) as Record<string, { whiteSlots?: number[] }>;
      for (const s of SITES) {
        const o = overrides[s.id];
        if (o?.whiteSlots && Array.isArray(o.whiteSlots)) s.whiteSlots = o.whiteSlots;
      }
    }
  } catch { /* corrupt overrides — ignore */ }
}

export const SITES_BY_ID: Record<string, Site> = Object.fromEntries(SITES.map(s => [s.id, s]));

export function sitesForPlayerCount(n: 2 | 3 | 4, leftOrRight: 'left' | 'right' = 'left'): Site[] {
  if (n === 2) return SITES.filter(s => s.section === 'center');
  if (n === 3) return SITES.filter(s => s.section === 'center' || s.section === leftOrRight);
  return SITES;
}
