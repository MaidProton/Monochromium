import { ADMIRAL_BEHAVIOR } from "./admiral.ts";
import { BOMBER_BEHAVIOR } from "./bomber.ts";
import { BANDIT_BEHAVIOR } from "./bandit.ts";
import { CYBORG_BEHAVIOR } from "./cyborg.ts";
import { GUNNER_BEHAVIOR } from "./gunner.ts";
import { INFERNUS_BEHAVIOR } from "./infernus.ts";
import { LATCH_BEHAVIOR } from "./latch.ts";
import { MERCENARY_BEHAVIOR } from "./mercenary.ts";
import { PRISM_BEHAVIOR } from "./prism.ts";
import { RECON_BEHAVIOR } from "./recon.ts";
import { WARRIOR_BEHAVIOR } from "./warrior.ts";
import { VANGUARD_BEHAVIOR } from "./vanguard.ts";
import { TEMPEST_BEHAVIOR } from "./tempest.ts";
import { SAMURAI_BEHAVIOR } from "./samurai.ts";
import { WRAITH_BEHAVIOR } from "./wraith.ts";
import { ZENITH_BEHAVIOR } from "./zenith.ts";
import { MECHA_BEHAVIOR } from "./mecha.ts";
import type { TowerKind } from "../types.ts";
import type { SimulationEvent } from "../simulationProtocol.ts";
import type { TowerBehavior } from "./types.ts";

const TOWER_BEHAVIORS: Partial<Record<TowerKind, TowerBehavior>> = {
  admiral: ADMIRAL_BEHAVIOR,
  bandit: BANDIT_BEHAVIOR,
  bomber: BOMBER_BEHAVIOR,
  cyborg: CYBORG_BEHAVIOR,
  gunner: GUNNER_BEHAVIOR,
  infernus: INFERNUS_BEHAVIOR,
  latch: LATCH_BEHAVIOR,
  mercenary: MERCENARY_BEHAVIOR,
  prism: PRISM_BEHAVIOR,
  recon: RECON_BEHAVIOR,
  samurai: SAMURAI_BEHAVIOR,
  tempest: TEMPEST_BEHAVIOR,
  warrior: WARRIOR_BEHAVIOR,
  vanguard: VANGUARD_BEHAVIOR,
  wraith: WRAITH_BEHAVIOR,
  zenith: ZENITH_BEHAVIOR,
  mecha: MECHA_BEHAVIOR,
};

export const getTowerBehavior = (kind: TowerKind): TowerBehavior | undefined => TOWER_BEHAVIORS[kind];

export const getTowerBehaviorForEvent = (event: SimulationEvent): TowerBehavior | undefined =>
  Object.values(TOWER_BEHAVIORS).find((behavior) => behavior?.persistentEvent?.(event));

export type {
  TowerAttackBehaviorContext,
  TowerArrivalBehaviorContext,
  TowerAbilityBehaviorContext,
  TowerBehavior,
  TowerBehaviorUpdateContext,
  TowerCounterBehaviorContext,
  TowerAimBehaviorContext,
  TowerEnemyKilledBehaviorContext,
  TowerDamageDealtBehaviorContext,
  TowerLifecycleBehaviorContext,
  TowerPresentationBehaviorContext,
  TowerVisualProjectileSpec,
  TowerDashTarget,
  TowerPathSample,
  TowerPathProjection,
  TowerRenderBehaviorContext,
} from "./types.ts";
