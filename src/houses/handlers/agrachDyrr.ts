// House Agrach Dyrr — logic only. Names/rules text live in houses/house-data.ts.

import { HouseRegistry } from '../registry';
import { moveOwnTroopToAdjacent, sacrificeTrophyThenReclaimTroop } from '../handler-helpers';

HouseRegistry.registerAction('agrach-dyrr', 'tunnel-patrols', { handler: moveOwnTroopToAdjacent() });
HouseRegistry.registerAction('agrach-dyrr', 'lich-matrons-claim', { handler: sacrificeTrophyThenReclaimTroop() });
