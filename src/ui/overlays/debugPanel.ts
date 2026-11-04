import { TOWER_DEFINITIONS } from "../../game/config.ts";
import type { GameUiState } from "../../game/Game.ts";
import type { MetaProgress } from "../../game/meta.ts";
import type { TowerDefinition, TowerKind } from "../../game/types.ts";

export function formatDebugDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
}

export function cloneTowerDefinition(kind: TowerKind): TowerDefinition {
  return JSON.parse(JSON.stringify(TOWER_DEFINITIONS[kind])) as TowerDefinition;
}

export function balanceValueAtPath(draft: TowerDefinition | null, path: string): number {
  let current: unknown = draft;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return 0;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : 0;
}

export function setBalanceValueAtPath(draft: TowerDefinition | null, path: string, value: number): void {
  if (!draft) return;
  const parts = path.split(".");
  let current = draft as unknown as Record<string, unknown>;
  parts.slice(0, -1).forEach((part) => {
    const next = current[part];
    if (!next || typeof next !== "object") return;
    current = next as Record<string, unknown>;
  });
  const finalPart = parts[parts.length - 1];
  if (finalPart) current[finalPart] = value;
}

export function balanceFieldLabel(path: string): string {
  return path
    .replace(/^onPath\./, "PATH // ")
    .replace(/^levels\.(\d+)\./, (_match, level) => "LEVEL " + (Number(level) + 1) + " // ")
    .replace(/^upgrades\.(\d+)\./, (_match, level) => "UPGRADE " + (Number(level) + 1) + " // ")
    .replace(/^ability\./, "ABILITY // ")
    .replace(/^abilities\.([qfgh])\./, (_match, slot) => `ABILITY ${String(slot).toUpperCase()} // `)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll(".", " // ")
    .toUpperCase();
}

export function balanceFieldStep(path: string): string {
  return /fireRate|reload|hpMultiplier/.test(path) ? "0.01" : "1";
}

export function renderBalanceFieldsHtml(draft: TowerDefinition): string {
  const paths: string[] = ["cost", "unlockCost", "copyLimit"];
  if (draft.hiddenDetectionLevel !== undefined) paths.push("hiddenDetectionLevel");
  paths.push("onPath.hp", "onPath.maxAggro");
  const levelKeys = [...new Set(draft.levels.flatMap((level) => Object.entries(level)
    .filter(([, value]) => typeof value === "number")
    .map(([key]) => key)))];
  draft.levels.forEach((_level, index) => levelKeys.forEach((key) => paths.push("levels." + index + "." + key)));
  draft.upgrades.forEach((_upgrade, index) => paths.push("upgrades." + index + ".cost"));
  if (draft.ability) {
    Object.entries(draft.ability)
      .filter(([, value]) => typeof value === "number")
      .forEach(([key]) => paths.push("ability." + key));
  }
  if (draft.abilities) {
    Object.entries(draft.abilities).forEach(([slot, ability]) => {
      if (!ability) return;
      Object.entries(ability)
        .filter(([, value]) => typeof value === "number")
        .forEach(([key]) => paths.push(`abilities.${slot}.${key}`));
    });
  }
  return paths.map((path) =>
    `<label class="balance-field"><span>${balanceFieldLabel(path)}</span><input type="number" min="0" step="${balanceFieldStep(path)}" data-balance-path="${path}" value="${balanceValueAtPath(draft, path)}"></label>`
  ).join("");
}

export interface DebugDashboardOptions {
  activeSimulationConfig: unknown;
  capturedReplayCommandsCount: number;
  latestSimulationReplay: unknown;
}

export function updateDebugDashboardUi(
  root: ParentNode,
  state: GameUiState | null,
  progress: MetaProgress,
  options: DebugDashboardOptions,
): void {
  const query = <T extends Element>(selector: string): T | null => root.querySelector<T>(selector);

  const coins = query<HTMLElement>("#debug-coins-value");
  if (coins) coins.textContent = progress.coins.toLocaleString();

  const tokens = query<HTMLElement>("#debug-tokens-value");
  if (tokens) tokens.textContent = progress.tokens.toLocaleString();

  const profileCount = query<HTMLElement>("#debug-profile-count");
  if (profileCount) profileCount.textContent = `${progress.unlockedTowers.length} towers // ${progress.unlockedPerks.length} perks`;

  const runStatus = query<HTMLElement>("#debug-run-status");
  if (runStatus) {
    runStatus.textContent = state?.started
      ? state.gameOver
        ? "RUN ENDED"
        : state.modeComplete
          ? "RUN COMPLETE"
          : state.paused
            ? "SIMULATION PAUSED"
            : "SIMULATION LIVE"
      : "NO RUN ACTIVE";
  }

  const runContext = query<HTMLElement>("#debug-run-context");
  if (runContext) {
    runContext.textContent = state?.started
      ? `${state.mapName.toUpperCase()} // ${state.modeName.toUpperCase()}`
      : "Start a run to inspect the sandbox.";
  }

  const runMode = query<HTMLElement>("#debug-run-mode");
  if (runMode) {
    runMode.textContent = state?.multiplayer
      ? "MULTIPLAYER LOCKED"
      : state?.started
        ? "LOCAL OVERRIDE"
        : "STANDBY";
  }

  const waveVal = query<HTMLElement>("#debug-wave-value");
  if (waveVal) waveVal.textContent = state?.started ? `${state.wave} / ${state.totalWaves}` : "—";

  const enemyVal = query<HTMLElement>("#debug-enemy-value");
  if (enemyVal) enemyVal.textContent = state?.started ? state.enemiesRemaining.toString() : "—";

  const towerVal = query<HTMLElement>("#debug-tower-value");
  if (towerVal) towerVal.textContent = state?.started ? state.towerCount.toString() : "—";

  const coreVal = query<HTMLElement>("#debug-core-value");
  if (coreVal) coreVal.textContent = state?.started ? `${state.integrity} / ${state.maxIntegrity}` : "—";

  const timeVal = query<HTMLElement>("#debug-time-value");
  if (timeVal) timeVal.textContent = state?.started ? formatDebugDuration(state.elapsed) : "—";

  const cashVal = query<HTMLElement>("#debug-cash-value");
  if (cashVal) cashVal.textContent = state?.started ? (state.infiniteCash ? "∞" : `$${state.shards.toLocaleString()}`) : "—";

  const cashState = query<HTMLElement>("#debug-cash-state");
  if (cashState) {
    cashState.textContent = state?.infiniteCash ? "ON // deploy and upgrade free" : "OFF // deploy and upgrade spend cash";
    cashState.classList.toggle("active", Boolean(state?.infiniteCash));
  }

  const speedNote = query<HTMLElement>("#debug-speed-note");
  if (speedNote) speedNote.textContent = state?.started ? `Current ${state.speed}× simulation speed` : "Simulation speed";

  const selected = state?.selectedTower;
  const selectedVal = query<HTMLElement>("#debug-selected-value");
  if (selectedVal) selectedVal.textContent = selected ? `LVL ${selected.tower.level} ${selected.definition.name.toUpperCase()}` : "NO SELECTION";

  const maxNote = query<HTMLElement>("#debug-max-note");
  if (maxNote) maxNote.textContent = selected ? `Max ${selected.definition.name} instantly` : "Select a tower first";

  const reproCount = query<HTMLElement>("#debug-repro-count");
  if (reproCount) {
    reproCount.textContent = options.activeSimulationConfig
      ? `${options.capturedReplayCommandsCount} COMMANDS`
      : options.latestSimulationReplay
        ? "LAST CAPTURE READY"
        : "NO CAPTURE";
  }

  const waveInput = query<HTMLInputElement>("#debug-wave-input");
  if (waveInput && document.activeElement !== waveInput && state?.started) {
    waveInput.value = Math.max(1, state.wave || 1).toString();
  }

  root.querySelectorAll<HTMLButtonElement>("[data-debug-mutation]").forEach((button) => {
    button.disabled = Boolean(state?.multiplayer);
  });
}
