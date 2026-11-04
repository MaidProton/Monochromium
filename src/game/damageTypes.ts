export const DAMAGE_TYPES = ["bullet", "energy", "explosive", "fire", "melee"] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number] | (string & {});

export const DAMAGE_TYPE_LABELS: Record<string, string> = {
  bullet: "Bullet",
  energy: "Energy",
  explosive: "Explosive",
  fire: "Fire",
  melee: "Melee",
};

export type EnemyResistances = Partial<Record<DamageType, number>>;

export const DEFAULT_ENEMY_RESISTANCES: Record<(typeof DAMAGE_TYPES)[number], number> = {
  bullet: 0,
  energy: 0,
  explosive: 0,
  fire: 0,
  melee: 0,
};

export const sanitizeResistances = (source: unknown): Record<(typeof DAMAGE_TYPES)[number], number> => {
  const result: Record<(typeof DAMAGE_TYPES)[number], number> = { ...DEFAULT_ENEMY_RESISTANCES };
  if (!source || typeof source !== "object") return result;
  const record = source as Record<string, unknown>;
  for (const type of DAMAGE_TYPES) {
    const value = record[type];
    if (typeof value === "number" && Number.isFinite(value)) {
      result[type] = Math.min(1, value);
    }
  }
  return result;
};

export const calculateResistanceMultiplier = (resistance: number | undefined): number => {
  if (typeof resistance !== "number" || !Number.isFinite(resistance)) return 1;
  const effectiveResistance = Math.min(1, resistance);
  return Math.max(0, 1 - effectiveResistance);
};
