import { Flags } from './fiberFlags';

export type HookDeps = any[] | null;
type EffectCallback = () => void;

export interface Effect {
  tag: Flags;
  create: EffectCallback | void;
  destroy: EffectCallback | void;
  deps: HookDeps;
  next: Effect | null;
}
