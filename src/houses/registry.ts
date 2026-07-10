import type { HouseId, HouseActionImpl, HousePassiveHooks } from './types';

class HouseRegistryImpl {
  private actions = new Map<string, HouseActionImpl>();
  private passives = new Map<HouseId, HousePassiveHooks>();

  private actionKey(houseId: HouseId, abilityKey: string): string {
    return `${houseId}::${abilityKey}`;
  }

  /** Register the runnable implementation of one 'action' ability. Called
   *  once per ability from houses/handlers/<house>.ts. */
  registerAction(houseId: HouseId, abilityKey: string, impl: HouseActionImpl) {
    const k = this.actionKey(houseId, abilityKey);
    if (this.actions.has(k)) {
      throw new Error(`Duplicate house action registered: ${k}`);
    }
    this.actions.set(k, impl);
  }

  getAction(houseId: HouseId, abilityKey: string): HouseActionImpl | undefined {
    return this.actions.get(this.actionKey(houseId, abilityKey));
  }

  /** Register a house's passive hooks (turn-begin grants, recruit/control/
   *  assassinate reactions, flags). At most one call per house. */
  registerPassives(houseId: HouseId, hooks: HousePassiveHooks) {
    if (this.passives.has(houseId)) {
      throw new Error(`Duplicate house passives registered: ${houseId}`);
    }
    this.passives.set(houseId, hooks);
  }

  getPassives(houseId: HouseId): HousePassiveHooks | undefined {
    return this.passives.get(houseId);
  }
}

export const HouseRegistry = new HouseRegistryImpl();
