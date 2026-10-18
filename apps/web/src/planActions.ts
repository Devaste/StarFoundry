import { createContext, useContext } from 'react';
import type { MachineConfig } from '@starfoundry/solver';
import type { PlanState } from './plan';

/** What tree rows and the recipe picker can change in the plan. */
export interface PlanActions {
  state: PlanState;
  /** goods currently treated as raw (defaults plus the user's changes) */
  raw: ReadonlySet<number>;
  /** recipe ids running in the solved plan */
  active: ReadonlySet<string>;
  setState: (state: PlanState) => void;
  openPicker: (good: number) => void;
  /** opens the machine setup of a recipe in the plan */
  openConfig: (recipe: string) => void;
}

export const PlanActionsContext = createContext<PlanActions | undefined>(undefined);

export function usePlanActions(): PlanActions {
  const actions = useContext(PlanActionsContext);
  if (!actions) throw new Error('usePlanActions outside PlanActionsContext');
  return actions;
}

export function toggleRaw(actions: PlanActions, good: number) {
  const { state } = actions;
  const without = (list: number[]) => list.filter((g) => g !== good);
  const next = actions.raw.has(good)
    ? { ...state, rawAdd: without(state.rawAdd), rawRemove: state.rawAdd.includes(good) ? state.rawRemove : [...state.rawRemove, good] }
    : { ...state, rawRemove: without(state.rawRemove), rawAdd: state.rawRemove.includes(good) ? state.rawAdd : [...state.rawAdd, good] };
  actions.setState(next);
}

export function lockRecipe(actions: PlanActions, good: number, recipe: string | undefined) {
  const locks = { ...actions.state.locks };
  if (recipe === undefined) delete locks[good];
  else locks[good] = recipe;
  actions.setState({ ...actions.state, locks, bans: recipe ? actions.state.bans.filter((b) => b !== recipe) : actions.state.bans });
}

export function toggleBan(actions: PlanActions, recipe: string) {
  const { state } = actions;
  const banned = state.bans.includes(recipe);
  const locks = Object.fromEntries(Object.entries(state.locks).filter(([, r]) => banned || r !== recipe));
  actions.setState({ ...state, locks, bans: banned ? state.bans.filter((b) => b !== recipe) : [...state.bans, recipe] });
}

export function setConfig(actions: PlanActions, recipe: string, config: MachineConfig | undefined) {
  const configs = { ...actions.state.configs };
  if (config === undefined) delete configs[recipe];
  else configs[recipe] = config;
  actions.setState({ ...actions.state, configs });
}
