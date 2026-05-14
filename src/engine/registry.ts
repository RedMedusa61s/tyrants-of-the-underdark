import type { EffectHandler } from './types';

class CardRegistryImpl {
  private handlers = new Map<string, EffectHandler>();

  register(effectKey: string, handler: EffectHandler) {
    if (this.handlers.has(effectKey)) {
      throw new Error(`Duplicate effect handler registered: ${effectKey}`);
    }
    this.handlers.set(effectKey, handler);
  }

  get(effectKey: string): EffectHandler | undefined {
    return this.handlers.get(effectKey);
  }

  has(effectKey: string): boolean {
    return this.handlers.has(effectKey);
  }

  /** Diagnostic: list every registered key. */
  keys(): string[] { return [...this.handlers.keys()]; }
}

export const CardRegistry = new CardRegistryImpl();
