import { ENEMY_DEFINITIONS } from "./config.ts";
import { customEnemyToDefinition, type CustomEnemyDraft } from "./customEnemies.ts";
import type { EnemyDefinition, EnemyKind, OfficialEnemyKind } from "./types.ts";

const officialDefinitions = ENEMY_DEFINITIONS as Readonly<Record<OfficialEnemyKind, EnemyDefinition>>;
let customDefinitions = new Map<EnemyKind, EnemyDefinition>();

export const setCustomEnemyRegistry = (drafts: readonly CustomEnemyDraft[]): void => {
  customDefinitions = new Map(drafts.map((draft) => [draft.id, customEnemyToDefinition(draft)]));
};

export const getEnemyDefinition = (kind: EnemyKind): EnemyDefinition =>
  customDefinitions.get(kind) ?? officialDefinitions[kind as OfficialEnemyKind] ?? officialDefinitions.dummy;

export const isKnownEnemyKind = (value: unknown): value is EnemyKind =>
  typeof value === "string" && (value in officialDefinitions || customDefinitions.has(value as EnemyKind));

export const getOfficialEnemyDefinitions = (): readonly EnemyDefinition[] => Object.values(officialDefinitions);

export const getCustomEnemyDefinitions = (): readonly EnemyDefinition[] => [...customDefinitions.values()];

export const getAllEnemyDefinitions = (): readonly EnemyDefinition[] => [
  ...getOfficialEnemyDefinitions(),
  ...getCustomEnemyDefinitions(),
];
