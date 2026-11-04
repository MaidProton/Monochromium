import { describe, expect, it } from "vitest";
import { createEnemyAbilityPreset } from "../../game/enemyAbilities.ts";
import type { EnemyAbilityActionDefinition, EnemyAbilityDefinition, EnemyDefinition } from "../../game/types.ts";
import { actionFields, EnemyCreatorV4Editor, generateHumanReadableSummary } from "./editor.ts";

describe("EnemyCreatorV4Editor human-readable summaries", () => {
  it("generates clear human-readable combat summaries for built-in ability presets", () => {
    const ranged = createEnemyAbilityPreset("ranged");
    const summaryRanged = generateHumanReadableSummary(ranged);
    expect(summaryRanged).toContain("TRIGGER: Every 8s");
    expect(summaryRanged).toContain("TARGETING: Targeted construct projectile (220px range)");
    expect(summaryRanged).toContain("ACTIONS: Deal 20 damage");

    const lastStand = createEnemyAbilityPreset("last-stand");
    const summaryLastStand = generateHumanReadableSummary(lastStand);
    expect(summaryLastStand).toContain("TRIGGER: When Health ≤ 25%");
    expect(summaryLastStand).toContain("Invulnerable (3s)");

    const cone = createEnemyAbilityPreset("cone");
    const summaryCone = generateHumanReadableSummary(cone);
    expect(summaryCone).toContain("TRIGGER: Every 8s");
    expect(summaryCone).toContain("TARGETING: 60° forward cone (180px reach)");

    const wave = createEnemyAbilityPreset("wave");
    const summaryWave = generateHumanReadableSummary(wave);
    expect(summaryWave).toContain("TARGETING: Path shockwave (180px reach, 60px wide)");

    const shockwave = createEnemyAbilityPreset("shockwave");
    const summaryShockwave = generateHumanReadableSummary(shockwave);
    expect(summaryShockwave).toContain("TARGETING: 360° radial pulse (180px radius)");
  });

  it("handles all trigger types and condition mode variations correctly in summaries", () => {
    const custom: EnemyAbilityDefinition = {
      id: "test-custom-summary",
      name: "Tactical Execution",
      enabled: true,
      editorMode: "basic",
      priority: 1,
      cooldown: 5,
      maxUses: 0,
      exclusiveGroup: null,
      trigger: {
        type: "hp-threshold",
        direction: "below",
        threshold: { unit: "percent", value: 40 },
      },
      conditions: [
        { type: "hp", minimum: { unit: "percent", value: 10 }, maximum: { unit: "percent", value: 40 } },
        { type: "age", minimum: 5, maximum: null },
        { type: "target-state", state: "blocked" },
      ],
      attack: {
        targeting: "closest",
        range: 200,
        maxTargets: 3,
        delivery: { type: "cone", angle: 90, depth: 150 },
        telegraphDuration: 0.3,
        targetLock: "activation",
        impactTime: 0.3,
        visuals: [],
      },
      actions: [
        { id: "act-1", type: "damage", delay: 0, amount: 50 },
        { id: "act-2", type: "stun", delay: 0, duration: 2.5 },
        { id: "act-3", type: "blink", delay: 0, distance: 80 },
      ],
    };

    const summary = generateHumanReadableSummary(custom);
    expect(summary).toContain("TRIGGER: When Health ≤ 40%");
    expect(summary).toContain("Health between 10% and 40%");
    expect(summary).toContain("Alive ≥ 5s");
    expect(summary).toContain("Blocked by construct");
    expect(summary).toContain("TARGETING: 90° forward cone (150px reach)");
    expect(summary).toContain("ACTIONS: Deal 50 damage, then Stun for 2.5s, then Blink forward 80px");
  });

  it("describes direct/passive abilities with no targeting delivery", () => {
    const passive: EnemyAbilityDefinition = {
      id: "test-passive",
      name: "Death Rattle Aura",
      enabled: true,
      editorMode: "basic",
      priority: 0,
      cooldown: 0,
      maxUses: 1,
      exclusiveGroup: null,
      trigger: { type: "death" },
      conditions: [],
      attack: null,
      actions: [
        { id: "act-summon", type: "summon", delay: 0, count: 4, kinds: ["dummy"], modifiers: {} as any },
        { id: "act-heal", type: "regeneration", delay: 0, mode: "rate", amount: 15, duration: 5 },
      ],
    };

    const summary = generateHumanReadableSummary(passive);
    expect(summary).toContain("TRIGGER: Upon death (Death Rattle)");
    expect(summary).toContain("ONLY IF: No restrictions");
    expect(summary).toContain("TARGETING: Self / Area Aura");
    expect(summary).toContain("ACTIONS: Summon 4 minion(s), then Heal 15 HP/s");
  });
});

describe("EnemyCreatorV4Editor summon hostile picker and search", () => {
  const dummyEnemies: EnemyDefinition[] = [
    {
      kind: "rusher",
      name: "Runner",
      hp: 35,
      shieldHp: 0,
      speed: 1.8,
      damage: 1,
      attackInterval: 1,
      telegraphDuration: 0,
      coreDamage: 1,
      radius: 10,
      sprite: { shape: "circle", fill: "#ff0000", stroke: "#ffffff", accent: "#ff0000", glyph: "R" },
    },
    {
      kind: "bulwark",
      name: "Armored Tank",
      hp: 350,
      shieldHp: 50,
      speed: 0.7,
      damage: 4,
      attackInterval: 1,
      telegraphDuration: 0,
      coreDamage: 2,
      radius: 14,
      sprite: { shape: "square", fill: "#0000ff", stroke: "#ffffff", accent: "#0000ff", glyph: "B" },
    },
    {
      kind: "swiftRusher",
      name: "Swarmer Scout",
      hp: 20,
      shieldHp: 0,
      speed: 2.2,
      damage: 1,
      attackInterval: 1,
      telegraphDuration: 0,
      coreDamage: 1,
      radius: 8,
      sprite: { shape: "diamond", fill: "#ffff00", stroke: "#ffffff", accent: "#ffff00", glyph: "S" },
    },
    {
      kind: "custom-enemy:mutant",
      name: "Mutant Behemoth",
      hp: 1200,
      shieldHp: 0,
      speed: 0.9,
      damage: 8,
      attackInterval: 1,
      telegraphDuration: 0,
      coreDamage: 5,
      radius: 18,
      sprite: { shape: "polygon", fill: "#00ff00", stroke: "#ffffff", accent: "#00ff00", glyph: "M" },
    },
  ];

  const sampleSummonAction: EnemyAbilityActionDefinition = {
    id: "act-summon-1",
    type: "summon",
    delay: 0,
    count: 3,
    kinds: ["rusher", "bulwark"],
    modifiers: {
      hitCashMultiplier: 0,
      hpMultiplier: 1,
      shieldMultiplier: 1,
      speedMultiplier: 1,
      damageMultiplier: 1,
      attackIntervalMultiplier: 1,
      coreDamageMultiplier: 1,
      defenseBonus: 0,
      protectionBonus: 0,
      armorBonus: 0,
      superarmorBonus: 0,
    },
  };

  const normalize = (str: string) => str.replace(/\s+/g, " ");

  it("renders summon hostile picker with chips and available hostile options", () => {
    const html = normalize(actionFields(sampleSummonAction, dummyEnemies, "", "custom-enemy:summoner-self"));

    expect(html).toContain('class="v4-summon-picker v4-wide-field"');
    expect(html).toContain('data-action-id="act-summon-1"');

    // Chips for currently selected kinds
    expect(html).toContain('class="v4-summon-chip" data-kind="rusher"');
    expect(html).toContain('class="v4-summon-chip" data-kind="bulwark"');
    expect(html).toContain("Runner");
    expect(html).toContain("Armored Tank");
    expect(html).toContain('data-v4-action="summon-remove-kind"');

    // Available hostile options
    expect(html).toContain('data-v4-action="summon-toggle-kind" data-action-id="act-summon-1" data-kind="rusher"');
    expect(html).toContain('data-v4-action="summon-toggle-kind" data-action-id="act-summon-1" data-kind="bulwark"');
    expect(html).toContain('data-v4-action="summon-toggle-kind" data-action-id="act-summon-1" data-kind="swiftRusher"');
    expect(html).toContain('data-v4-action="summon-toggle-kind" data-action-id="act-summon-1" data-kind="custom-enemy:mutant"');

    // Selected class and aria-checked for runner and tank
    expect(html).toContain('class="v4-summon-option selected" data-v4-action="summon-toggle-kind" data-action-id="act-summon-1" data-kind="rusher" role="checkbox" aria-checked="true"');
    expect(html).toContain('class="v4-summon-option " data-v4-action="summon-toggle-kind" data-action-id="act-summon-1" data-kind="swiftRusher" role="checkbox" aria-checked="false"');

    // Badges and stats
    expect(html).toContain('<span class="v4-summon-badge official">OFFICIAL</span>');
    expect(html).toContain('<span class="v4-summon-badge custom">CREATED</span>');
    expect(html).toContain("35 HP · 1.8 SPD · 1 DMG");
    expect(html).toContain("350 HP · 0.7 SPD · 4 DMG · 50 SHIELD");

    // Search input and manual fallback details
    expect(html).toContain('data-v4-action="summon-search"');
    expect(html).toContain('data-v4-field="action.kinds"');
    expect(html).toContain('value="rusher, bulwark"');
  });

  it("filters hostile options based on search query", () => {
    // Search for "swarm"
    const swarmHtml = normalize(actionFields(sampleSummonAction, dummyEnemies, "swarm"));
    // Swarmer should be visible (no style="display:none")
    expect(swarmHtml).toMatch(/data-kind="swiftRusher"[^>]*>(?!style="display:none")/);
    // Runner and Tank should be hidden with style="display:none"
    expect(swarmHtml).toContain('data-kind="rusher" role="checkbox" aria-checked="true" tabindex="0" style="display:none"');
    expect(swarmHtml).toContain('data-kind="bulwark" role="checkbox" aria-checked="true" tabindex="0" style="display:none"');

    // Search clear button should not be hidden when query is active
    expect(swarmHtml).not.toContain('data-v4-action="summon-search-clear" data-action-id="act-summon-1" title="Clear search" hidden');

    // Non-existent hostile search
    const emptyHtml = actionFields(sampleSummonAction, dummyEnemies, "nonexistent");
    expect(emptyHtml).toContain("No hostiles match search filter.");
  });

  it("excludes self draft enemy from available hostile options to prevent recursive summon loops", () => {
    const htmlWithSelf = normalize(actionFields(sampleSummonAction, dummyEnemies, "", "bulwark"));
    // Bulwark is the current enemy draft ID, so it must not be in the summon options list
    expect(htmlWithSelf).not.toContain('data-v4-action="summon-toggle-kind" data-action-id="act-summon-1" data-kind="bulwark"');
    // Runner and swarmer should still be available
    expect(htmlWithSelf).toContain('data-v4-action="summon-toggle-kind" data-action-id="act-summon-1" data-kind="rusher"');
    expect(htmlWithSelf).toContain('data-v4-action="summon-toggle-kind" data-action-id="act-summon-1" data-kind="swiftRusher"');
  });

  it("renders empty hostile notification when no hostiles are selected", () => {
    const emptyAction: EnemyAbilityActionDefinition = { ...sampleSummonAction, kinds: [] };
    const html = actionFields(emptyAction, dummyEnemies);
    expect(html).toContain("No hostiles selected. Click hostiles below to add them to the summon pool.");
  });

  it("instantiates and renders via EnemyCreatorV4Editor without errors", () => {
    const eventListeners: Record<string, Array<(event: unknown) => void>> = {};
    let innerHTMLContent = "";
    const mockRoot = {
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        eventListeners[type] ??= [];
        eventListeners[type].push(listener);
      },
      get innerHTML() {
        return innerHTMLContent;
      },
      set innerHTML(val: string) {
        innerHTMLContent = val;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
    } as unknown as HTMLElement;

    const draft = {
      id: "custom-enemy:test",
      name: "Test Enemy",
      hp: 100,
      shieldHp: 0,
      speed: 1,
      damage: 1,
      coreDamage: 1,
      radius: 14,
      sides: 4,
      color: "#ff0000",
      opacity: 1,
      summoningEnabled: false,
      summonInterval: 8,
      summonCount: 1,
      summonKinds: ["rusher"],
      summonHitCashMultiplier: 0,
      summonHpMultiplier: 1,
      summonShieldMultiplier: 1,
      summonSpeedMultiplier: 1,
      summonDamageMultiplier: 1,
      summonAttackIntervalMultiplier: 1,
      summonCoreDamageMultiplier: 1,
      summonDefenseBonus: 0,
      summonProtectionBonus: 0,
      summonArmorBonus: 0,
      summonSuperarmorBonus: 0,
      stunningEnabled: false,
      stunInterval: 10,
      stunRadius: 80,
      stunDuration: 2,
      regenerationEnabled: false,
      regenerationRate: 10,
      hasteEnabled: false,
      hasteInterval: 10,
      hasteRadius: 100,
      hasteDuration: 3,
      hasteMultiplier: 1.5,
      drainEnabled: false,
      drainInterval: 10,
      drainRadius: 100,
      drainDamage: 10,
      drainHealing: 20,
      phaseEnabled: false,
      phaseInterval: 10,
      phaseDuration: 2,
      blinkEnabled: false,
      blinkInterval: 10,
      blinkDistance: 100,
      timeLockEnabled: false,
      timeLockDistance: 200,
      timeLockDuration: 3,
      waveLockEnabled: false,
      waveLockDistance: 200,
      waveLockWaves: 1,
      defense: 0,
      protection: 0,
      armor: 0,
      superarmor: 0,
      resistances: { physical: 0, energy: 0, elemental: 0, pure: 0 },
      appearance: { mode: "procedural" as const, pngDataUrl: null, drawingResolution: 128 as const, layers: [] },
      attacks: [],
      behaviorRules: [],
      abilities: [
        {
          id: "ability-test",
          name: "Reinforcements",
          enabled: true,
          editorMode: "basic" as const,
          priority: 0,
          cooldown: 5,
          maxUses: 0,
          exclusiveGroup: null,
          trigger: { type: "interval" as const, every: 8, initialDelay: 8 },
          conditions: [],
          attack: null,
          actions: [sampleSummonAction],
        },
      ],
    };

    const editor = new EnemyCreatorV4Editor(mockRoot, {
      getDraft: () => draft as any,
      getEnemyDefinitions: () => dummyEnemies,
      isDirty: () => false,
      onChange: () => {},
    });

    editor.render();
    expect(mockRoot.innerHTML).toContain("v4-summon-picker");
    expect(mockRoot.innerHTML).toContain("Runner");
    expect(mockRoot.innerHTML).toContain("Armored Tank");
    expect(eventListeners["click"]).toBeDefined();
    expect(eventListeners["input"]).toBeDefined();
  });
});

