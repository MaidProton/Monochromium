import "./style.css";
import {
  COMBAT_RULES,
  ECONOMY_RULES,
  MAP_DEFINITIONS,
  NORMAL_MODE,
  TOWER_DEFINITIONS,
  TOWER_ORDER,
} from "./game/config.ts";
import { Game, type GameUiState } from "./game/Game.ts";
import {
  cacheCustomEnemiesLocally,
  cloneCustomEnemy,
  createCustomEnemy,
  loadCustomEnemies,
  sanitizeCustomEnemies,
  saveCustomEnemies,
  upsertCustomEnemy,
  type CustomEnemyDraft,
} from "./game/customEnemies.ts";
import {
  cacheCustomModesLocally,
  cloneCustomMode,
  createCustomMode,
  customModeToDefinition,
  deleteCustomMode,
  loadCustomModes,
  sanitizeCustomModes,
  upsertCustomMode,
  type CustomModeDraft,
} from "./game/customModes.ts";
import { getAllEnemyDefinitions, getOfficialEnemyDefinitions, isKnownEnemyKind, setCustomEnemyRegistry } from "./game/enemyRegistry.ts";
import { cacheProgressLocally, loadProgress, sanitizeProgress, saveProgress, unlockEveryTower, unlockTower } from "./game/meta.ts";
import { getDesktopEnvironment, hasDiskSaveApi, loadDiskSave, replaceDiskSave, type SaveBundle } from "./game/persistence.ts";
import type { MapKind, ModeDefinition, TargetingMode, TowerKind } from "./game/types.ts";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app root");

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="#" aria-label="Monochromium home">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span><strong>MONOCHROMIUM</strong><small id="brand-map-label">COMMAND // PATHBOUND DEFENSE</small></span>
      </a>
      <div class="top-stats" aria-label="Game status">
        <div class="stat core-stat">
          <span class="stat-label">CORE</span>
          <div class="integrity-track"><i id="integrity-fill"></i></div>
          <strong id="integrity-value">12 / 12</strong>
        </div>
        <div class="stat cash-stat">
          <span class="stat-label">CASH</span>
          <strong id="shard-value">500</strong>
          <small id="pending-refund" hidden>+$0 NEXT WAVE</small>
        </div>
        <div class="stat">
          <span class="stat-label">WAVE</span>
          <strong id="wave-value">00</strong>
        </div>
      </div>
      <div class="utility-controls">
        <button class="icon-button" data-action="debug" aria-label="Open debug tools" title="Debug tools (F1)">
          <span>DBG</span>
        </button>
        <button class="icon-button" data-action="main-menu" aria-label="Return to main menu" title="Main menu">
          <span>MNU</span>
        </button>
        <button class="icon-button" data-action="sound" aria-label="Toggle sound" title="Toggle sound">
          <span id="sound-icon">SND</span>
        </button>
        <button class="icon-button" data-action="speed" aria-label="Change game speed" title="Change speed">
          <span id="speed-label">1×</span>
        </button>
        <button class="icon-button" data-action="pause" aria-label="Pause game" title="Pause (P)">
          <span id="pause-icon">Ⅱ</span>
        </button>
      </div>
    </header>

    <main class="game-stage" aria-label="Battlefield">
      <canvas id="game-canvas" aria-label="Monochromium game battlefield"></canvas>
      <div class="scanline" aria-hidden="true"></div>
      <div class="stage-topline">
        <span id="mode-label">MODE 01 // NORMAL</span>
        <span id="threat-label">THREAT: DORMANT</span>
      </div>
      <div class="event-console" id="battle-log" aria-label="Event log">
        <div class="console-head"><span>FIELD LOG</span><time id="clock">00:00:00</time></div>
        <div id="log-entries" class="log-entries" aria-live="polite">
          <p><time>SYS</time><span>Awaiting operator authorization.</span></p>
        </div>
      </div>
      <div class="placement-chip" id="placement-chip" hidden></div>
      <div class="pause-banner" id="pause-banner" hidden>SIMULATION SUSPENDED</div>

      <aside class="debug-panel" id="debug-panel" aria-label="Debug tools" hidden>
        <div class="debug-header">
          <div><span>OPERATOR OVERRIDES</span><small>DEVELOPMENT TOOLS // F1</small></div>
          <button data-action="debug-close" aria-label="Close debug tools">×</button>
        </div>
        <p>These controls intentionally bypass the run economy. Balance data remains editable in <code>src/game/config.ts</code>.</p>
        <div class="debug-grid">
          <button data-action="debug-cash-toggle"><span>INFINITE CASH</span><b id="debug-cash-state">OFF</b></button>
          <button data-action="debug-cash"><span>ADD CASH</span><b>+$1,000</b></button>
          <button data-action="debug-heal"><span>RESTORE CORE</span><b>12 / 12</b></button>
          <button data-action="debug-clear"><span>CLEAR WAVE</span><b>DESPAWN</b></button>
          <button data-action="debug-stock"><span>RESTORE STOCK</span><b>ALL TOWERS</b></button>
          <button data-action="debug-max"><span>MAX SELECTED</span><b>FREE</b></button>
          <button data-action="debug-unlock"><span>UNLOCK TOWERS</span><b>PERMANENT</b></button>
        </div>
      </aside>

      <div class="menu-screen main-menu" id="main-menu">
        <div class="onboarding-kicker">MONOCHROMIUM // COMMAND</div>
        <h1>Every contact<br><em>must matter.</em></h1>
        <p>Choose a battlefield, survive finite modes, and expand your permanent construct roster.</p>
        <div class="meta-wallet" aria-label="Persistent currencies">
          <div><span>COINS</span><strong id="meta-coins">0</strong></div>
          <div><span>TOKENS</span><strong id="meta-tokens">0</strong></div>
        </div>
        <div class="menu-actions">
          <button class="primary-button wide" data-action="open-modes">PLAY MODES <span>→</span></button>
          <button class="secondary-button wide" data-action="new-mode">MODE CREATOR</button>
          <button class="secondary-button wide" data-action="open-enemies">ENEMY CREATOR</button>
          <button class="secondary-button wide" data-action="open-shop">TOWER SHOP</button>
        </div>
      <div class="save-tools">
        <button data-action="export-save">EXPORT SAVE</button>
        <button data-action="import-save">IMPORT SAVE</button>
        <input id="save-import-input" type="file" accept="application/json,.json" hidden>
      </div>
      <small class="save-notice" id="save-status">Checking disk save service…</small>
      <section class="update-panel" id="update-panel" hidden aria-live="polite">
        <div><span>SYSTEM UPDATE</span><strong id="update-status">Updater unavailable</strong></div>
        <div class="update-actions"><button class="secondary-button" data-action="check-update" id="check-update-button">CHECK</button><button class="primary-button" data-action="install-update" id="install-update-button" hidden>RESTART &amp; INSTALL</button></div>
      </section>
      </div>

      <div class="menu-screen enemy-selection" id="enemy-selection" hidden>
        <div class="mode-browser-heading">
          <div><div class="onboarding-kicker">HOSTILE DATABASE</div><h2>ENEMY LIST</h2></div>
          <div class="creator-actions">
            <input id="enemy-import-input" type="file" accept="application/json,.json" hidden>
            <button class="secondary-button" data-action="import-enemies">IMPORT ENEMIES</button>
            <button class="secondary-button" data-action="export-selected-enemies" id="export-selected-enemies">EXPORT SELECTED <span id="selected-enemy-count">0</span></button>
            <button class="primary-button" data-action="new-enemy">CREATE ENEMY <span>+</span></button>
          </div>
        </div>
        <div class="enemy-library">
          <section>
            <div class="library-label"><span>OFFICIAL ENEMIES</span><small>READ ONLY</small></div>
            <div class="enemy-card-grid" id="official-enemy-list"></div>
          </section>
          <section>
            <div class="library-label"><span>CREATED ENEMIES</span><small>LOCAL // EDITABLE</small></div>
            <div class="enemy-card-grid" id="custom-enemy-list"></div>
          </section>
        </div>
        <button class="secondary-button" data-action="back-main">BACK TO COMMAND</button>
      </div>

      <div class="menu-screen enemy-creator" id="enemy-creator" hidden>
        <div class="creator-topbar">
          <div><div class="onboarding-kicker">HOSTILE ASSEMBLY</div><h2>ENEMY CREATOR</h2></div>
          <div class="creator-actions"><button class="secondary-button" data-action="enemy-back">CANCEL</button><button class="primary-button" data-action="enemy-save">SAVE ENEMY</button></div>
        </div>
        <div class="enemy-editor-shell">
          <aside class="enemy-preview-panel">
            <div class="enemy-preview-ring"><div id="enemy-shape-preview"><span id="enemy-glyph-preview">CE</span></div></div>
            <strong id="enemy-name-preview">CUSTOM ENEMY</strong>
            <small id="enemy-preview-stats">100 HP // 36 SPEED</small>
          </aside>
          <section class="enemy-form">
            <div class="enemy-field-grid">
              <label><span>NAME</span><input data-enemy-field="name" maxlength="40"></label>
              <label><span>COLOR</span><input data-enemy-field="color" type="color"></label>
              <label class="sides-field"><span>SHAPE SIDES <b id="enemy-sides-value">5</b></span><input data-enemy-field="sides" type="range" min="3" max="12" step="1"></label>
              <label><span>HP</span><input data-enemy-field="hp" type="number" min="1" step="1"></label>
              <label><span>SPEED</span><input data-enemy-field="speed" type="number" min="1" step="0.1"></label>
              <label><span>TOWER DAMAGE</span><input data-enemy-field="damage" type="number" min="0" step="1"></label>
              <label><span>ATTACK COOLDOWN</span><input data-enemy-field="attackInterval" type="number" min="0.1" step="0.05"></label>
              <label><span>TELEGRAPH TIME</span><input data-enemy-field="telegraphDuration" type="number" min="0.05" step="0.05"></label>
              <label><span>CORE DAMAGE</span><input data-enemy-field="coreDamage" type="number" min="0" step="1"></label>
              <label><span>BODY RADIUS</span><input data-enemy-field="radius" type="number" min="6" max="60" step="1"></label>
            </div>
            <div class="enemy-toggle-row">
              <label><input data-enemy-field="hidden" type="checkbox"><span>HIDDEN</span><small>Requires tower detection</small></label>
              <label><input data-enemy-field="boss" type="checkbox"><span>BOSS</span><small>Shows a global healthbar</small></label>
              <label><input data-enemy-field="summoningEnabled" type="checkbox"><span>SUMMONING</span><small>Periodically creates enemies</small></label>
              <label><input data-enemy-field="stunningEnabled" type="checkbox"><span>STUN SHOCKWAVE</span><small>Disables nearby towers</small></label>
            </div>
            <section class="special-editor" id="summoning-editor" hidden>
              <header><div><span>SPECIAL ABILITY</span><strong>SUMMONING</strong></div><small>Summons appear slightly behind this enemy.</small></header>
              <div class="special-fields"><label><span>COOLDOWN</span><input data-enemy-field="summonInterval" type="number" min="0.2" step="0.1"></label><label><span>AMOUNT</span><input data-enemy-field="summonCount" type="number" min="1" max="100" step="1"></label></div>
              <div class="summon-targets"><span>SUMMON POOL // OFFICIAL + CREATED</span><div id="summon-enemy-options"></div></div>
            </section>
            <section class="special-editor" id="stunning-editor" hidden>
              <header><div><span>SPECIAL ABILITY</span><strong>STUN SHOCKWAVE</strong></div><small>Uses the same tower-stun system as Big Dummy.</small></header>
              <div class="special-fields triple"><label><span>COOLDOWN</span><input data-enemy-field="stunInterval" type="number" min="0.2" step="0.1"></label><label><span>RADIUS</span><input data-enemy-field="stunRadius" type="number" min="20" step="1"></label><label><span>STUN DURATION</span><input data-enemy-field="stunDuration" type="number" min="0.1" step="0.1"></label></div>
            </section>
          </section>
        </div>
      </div>

      <div class="menu-screen mode-selection" id="mode-selection" hidden>
        <div class="mode-browser-heading">
          <div><div class="onboarding-kicker">FINITE TIMELINES</div><h2>MODE LIST</h2></div>
          <div class="creator-actions">
            <input id="mode-import-input" type="file" accept="application/json,.json" hidden>
            <button class="secondary-button" data-action="import-mode">IMPORT MODE</button>
            <button class="primary-button" data-action="new-mode">CREATE MODE <span>+</span></button>
          </div>
        </div>
        <div class="mode-library">
          <section>
            <div class="library-label"><span>OFFICIAL MODES</span><small>PROFILE REWARDS ENABLED</small></div>
            <div class="mode-list official-mode-list">
              <article class="mode-entry official">
                <div><small>OFFICIAL // ${NORMAL_MODE.waves.length} WAVES</small><strong>${NORMAL_MODE.name}</strong><p>${NORMAL_MODE.description}</p></div>
                <div class="mode-entry-actions"><button class="primary-button" data-action="select-mode" data-mode-id="normal">SELECT</button></div>
              </article>
            </div>
          </section>
          <section>
            <div class="library-label"><span>CREATED MODES</span><small>LOCAL // NO PROFILE REWARDS</small></div>
            <div class="mode-list" id="custom-mode-list"></div>
          </section>
        </div>
        <button class="secondary-button" data-action="back-main">BACK TO COMMAND</button>
      </div>

      <div class="menu-screen map-selection" id="map-selection" hidden>
        <div class="onboarding-kicker">BATTLEFIELD SELECT</div>
        <h2>CHOOSE<br>A ROUTE</h2>
        <p id="selected-mode-copy">Normal Mode // 25 finite waves.</p>
        <div class="map-grid">
          ${Object.values(MAP_DEFINITIONS).map((map) => `
            <button class="map-card ${map.kind === "sector07" ? "selected" : ""}" data-action="select-map" data-map="${map.kind}">
              <span>MAP ${map.index.toString().padStart(2, "0")} // ${map.difficulty.toUpperCase()}</span>
              <strong>${map.name}</strong>
              <p>${map.description}</p>
              <small><span id="map-reward-${map.kind}">${Math.round(map.rewardMultiplier * 100)}% COIN REWARD</span> <b id="clear-${map.kind}"></b></small>
            </button>
          `).join("")}
        </div>
        <div class="menu-actions horizontal">
          <button class="secondary-button" data-action="back-modes">BACK</button>
          <button class="primary-button wide" id="start-mode-button" data-action="start-map" data-testid="begin-button">START NORMAL <span>→</span></button>
        </div>
      </div>

      <div class="menu-screen mode-creator" id="mode-creator" hidden>
        <div class="creator-topbar">
          <div><div class="onboarding-kicker">LOCAL TIMELINE EDITOR</div><h2>MODE CREATOR</h2></div>
          <div class="creator-actions">
            <button class="secondary-button" data-action="creator-back">CANCEL</button>
            <button class="primary-button" data-action="creator-save">SAVE MODE</button>
          </div>
        </div>
        <div class="creator-shell">
          <section class="creator-settings">
            <label><span>MODE NAME</span><input data-mode-field="name" maxlength="48"></label>
            <label class="wide"><span>DESCRIPTION</span><textarea data-mode-field="description" maxlength="220" rows="2"></textarea></label>
            <label><span>STARTING CASH</span><input data-mode-field="startingCash" type="number" min="0" step="1"></label>
            <label><span>CORE INTEGRITY</span><input data-mode-field="coreIntegrity" type="number" min="1" step="1"></label>
          </section>
          <div class="creator-workspace">
            <aside class="wave-rail">
              <div class="rail-heading"><span>WAVES</span><button data-action="creator-add-wave" title="Add wave">+</button></div>
              <div id="creator-wave-list" class="creator-wave-list"></div>
            </aside>
            <section class="wave-editor">
              <div class="wave-editor-head">
                <div><small id="creator-wave-kicker">WAVE 01</small><strong>BLOCK LAYOUT</strong></div>
                <label><span>WAVE CLEAR CASH</span><input data-wave-field="cashReward" type="number" min="0" step="1"></label>
                <div class="wave-actions">
                  <button data-action="creator-wave-up" title="Move wave up">↑</button>
                  <button data-action="creator-wave-down" title="Move wave down">↓</button>
                  <button data-action="creator-delete-wave" class="danger" title="Delete wave">DELETE</button>
                </div>
              </div>
              <p class="block-help">Each block starts after the previous block's <b>Next Block</b> delay. Enemy spawning continues independently, so blocks can overlap.</p>
              <div id="creator-block-list" class="creator-block-list"></div>
              <button class="add-block-button" data-action="creator-add-block"><span>+</span> ADD ENEMY GROUP BLOCK</button>
            </section>
          </div>
        </div>
      </div>

      <div class="menu-screen tower-shop" id="tower-shop" hidden>
        <div class="shop-heading">
          <div><div class="onboarding-kicker">PERMANENT ARMORY</div><h2>TOWER SHOP</h2></div>
          <div class="meta-wallet compact"><div><span>COINS</span><strong id="shop-coins">0</strong></div><div><span>TOKENS</span><strong id="shop-tokens">0</strong></div></div>
        </div>
        <p>Purchased towers remain unlocked in this browser. Towers currently use Coins only.</p>
        <div class="shop-grid">
          ${TOWER_ORDER.map((kind) => {
            const tower = TOWER_DEFINITIONS[kind];
            return `<button class="shop-card" data-action="buy-tower" data-tower-kind="${kind}" style="--accent:${tower.accent};--dim:${tower.dimAccent}">
              <span class="shop-glyph">${tower.glyph}</span>
              <span class="shop-copy"><strong>${tower.name}</strong><small>${tower.offPath.title} // $${tower.cost} DEPLOY</small></span>
              <b class="shop-price" id="shop-price-${kind}">${tower.unlockCost === 0 ? "STARTER" : `${tower.unlockCost} COINS`}</b>
            </button>`;
          }).join("")}
        </div>
        <button class="secondary-button" data-action="back-main">BACK TO COMMAND</button>
      </div>

      <div class="game-over" id="game-over" hidden>
        <div class="onboarding-kicker danger">CORE SIGNAL LOST</div>
        <h2>THE LINE<br>WENT DARK</h2>
        <p id="game-over-copy">Your defense held through wave 00.</p>
        <div class="menu-actions horizontal"><button class="secondary-button" data-action="main-menu">MAIN MENU</button><button class="primary-button wide" data-action="restart">TRY AGAIN <span>↻</span></button></div>
      </div>

      <div class="victory" id="victory" hidden>
        <div class="onboarding-kicker victory-tone">MODE 01 COMPLETE</div>
        <h2>NORMAL<br>SECURED</h2>
        <p id="victory-copy">All 25 waves were cleared.</p>
        <div class="menu-actions horizontal"><button class="secondary-button" data-action="main-menu">MAIN MENU</button><button class="primary-button wide" data-action="restart">RUN AGAIN <span>↻</span></button></div>
      </div>

      <div class="bottom-hud">
        <div class="build-dock">
          <div class="dock-label"><span>DEPLOY</span><small>1—0</small></div>
          <div class="tower-list" id="tower-list">
          ${TOWER_ORDER.map((kind) => TOWER_DEFINITIONS[kind])
            .map(
              (tower, index) => `
                <button class="tower-card" data-kind="${tower.kind}" data-testid="tower-${tower.kind}">
                  <span class="hotkey">${index === 9 ? "0" : index + 1}</span>
                  <span class="tower-glyph" style="--accent:${tower.accent};--dim:${tower.dimAccent}">${tower.glyph}</span>
                  <span class="tower-copy">
                    <strong>${tower.name}</strong>
                    <small>${tower.onPath.title} / ${tower.offPath.title}</small>
                  </span>
                  <span class="cost-stack">
                    <small class="stock-count" id="stock-${tower.kind}">x${tower.copyLimit}</small>
                    <span class="cost">$${tower.cost}</span>
                  </span>
                </button>
              `,
            )
            .join("")}
          </div>
        </div>
        <div class="wave-controls">
          <span id="enemy-count">NO HOSTILES</span>
          <div class="wave-button automatic" id="wave-button" data-testid="wave-button">NEXT WAVE <b>3</b></div>
        </div>
      </div>

      <button class="selected-pill" id="selected-pill" data-action="reopen-inspector" hidden>
        <span id="selected-pill-label">CONSTRUCT SELECTED</span>
        <b id="selected-pill-state">OPEN PANEL</b>
      </button>

      <aside class="tower-inspector" id="tower-inspector" aria-label="Selected tower controls" hidden>
        <div class="inspector-header">
          <div><span>CONSTRUCT LINK</span><small>UPGRADE // TARGET // COUNTER + ABILITY</small></div>
          <button data-action="close-inspector" aria-label="Close tower inspector">×</button>
        </div>
        <section class="selection-panel" id="selection-panel"></section>
        <div class="combat-dock">
          <div class="action-module counter-module">
            <div class="action-readout"><span>COUNTER</span><strong id="counter-status">NO LINK</strong></div>
            <div class="cooldown-track"><i id="counter-cooldown-fill"></i></div>
            <button class="combat-button counter-button" data-action="counter" data-testid="counter-button" disabled>
              <span>REACT</span><kbd>SPACE</kbd>
            </button>
            <small id="counter-hint">Requires a pathbound construct</small>
          </div>
          <div class="action-module ability-module">
            <div class="action-readout"><span>ABILITY</span><strong id="ability-status">NO LINK</strong></div>
            <div class="cooldown-track"><i id="ability-cooldown-fill"></i></div>
            <button class="combat-button ability-button" data-action="ability" data-testid="ability-button" disabled>
              <span>ACTIVATE</span><kbd>Q</kbd>
            </button>
            <small id="ability-hint">No active ability unlocked</small>
          </div>
        </div>
      </aside>
    </main>

    <footer class="site-footer">
      <span>RMB / ESC <b>CANCEL</b></span>
      <span>CLICK TOWER <b>INSPECT</b></span>
      <span>SPACE <b>COUNTER</b></span>
      <span>Q <b>ABILITY</b></span>
      <span>TAB <b>LOG</b></span>
      <span class="build">FIELD OS // LOW-SIGNAL PROTOCOL</span>
    </footer>
  </div>
`;

const query = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const canvas = query<HTMLCanvasElement>("#game-canvas");
const mainMenu = query<HTMLDivElement>("#main-menu");
const enemySelection = query<HTMLDivElement>("#enemy-selection");
const enemyCreator = query<HTMLDivElement>("#enemy-creator");
const modeSelection = query<HTMLDivElement>("#mode-selection");
const mapSelection = query<HTMLDivElement>("#map-selection");
const modeCreator = query<HTMLDivElement>("#mode-creator");
const towerShop = query<HTMLDivElement>("#tower-shop");
const gameOverPanel = query<HTMLDivElement>("#game-over");
const victoryPanel = query<HTMLDivElement>("#victory");
const logs = query<HTMLDivElement>("#log-entries");
const battleLog = query<HTMLElement>("#battle-log");
const towerInspector = query<HTMLElement>("#tower-inspector");
const selectedPill = query<HTMLButtonElement>("#selected-pill");
const debugPanel = query<HTMLElement>("#debug-panel");
const updatePanel = query<HTMLElement>("#update-panel");
const updateStatus = query<HTMLElement>("#update-status");
const checkUpdateButton = query<HTMLButtonElement>("#check-update-button");
const installUpdateButton = query<HTMLButtonElement>("#install-update-button");
let stopUpdateStateSubscription: (() => void) | null = null;
let selectionSignature = "";
let inspectorSuppressed = false;
let lastSelectedTowerId: number | null = null;
let progress = loadProgress();
let selectedMapKind: MapKind = "sector07";
let activeMapKind: MapKind = "sector07";
let customEnemies = loadCustomEnemies();
setCustomEnemyRegistry(customEnemies);
let customModes = loadCustomModes();
let selectedMode: ModeDefinition = NORMAL_MODE;
let activeMode: ModeDefinition = NORMAL_MODE;
let creatorDraft: CustomModeDraft | null = null;
let creatorWaveIndex = 0;
let enemyDraft: CustomEnemyDraft | null = null;
const selectedEnemyIds = new Set<string>();
let runSettled = false;
const BATTLE_LOG_HIDDEN_KEY = "monochromium:battle-log-hidden";
try {
  battleLog.hidden = window.localStorage.getItem(BATTLE_LOG_HIDDEN_KEY) === "1";
} catch {
  battleLog.hidden = false;
}
battleLog.style.display = battleLog.hidden ? "none" : "block";

const toggleBattleLog = (): void => {
  battleLog.hidden = !battleLog.hidden;
  battleLog.style.display = battleLog.hidden ? "none" : "block";
  try {
    window.localStorage.setItem(BATTLE_LOG_HIDDEN_KEY, battleLog.hidden ? "1" : "0");
  } catch {
    // The toggle still works for this session when browser storage is unavailable.
  }
};

const setSaveStatus = (message: string, tone: "good" | "danger" | "neutral" = "neutral"): void => {
  const status = query<HTMLElement>("#save-status");
  status.textContent = message;
  status.className = `save-notice ${tone}`;
};

type EnemyReferenceMode = {
  readonly waves: readonly { readonly blocks?: readonly { readonly enemy: string }[] }[];
};

const getRequiredCustomEnemyIds = (mode: EnemyReferenceMode): string[] => {
  const required = new Set<string>();
  const visit = (kind: string): void => {
    if (!kind.startsWith("custom-enemy:") || required.has(kind)) return;
    required.add(kind);
    const enemy = customEnemies.find((candidate) => candidate.id === kind);
    enemy?.summonKinds.forEach((summonKind) => visit(summonKind));
  };
  mode.waves.forEach((wave) => wave.blocks?.forEach((block) => visit(block.enemy)));
  return [...required];
};

const getMissingCustomEnemyIds = (mode: EnemyReferenceMode): string[] => {
  const available = new Set<string>(customEnemies.map((enemy) => enemy.id));
  return getRequiredCustomEnemyIds(mode).filter((id) => !available.has(id));
};

const formatMissingCustomEnemies = (ids: readonly string[]): string => ids.map((id) => {
  const known = customEnemies.find((enemy) => enemy.id === id);
  return known?.name ?? id.replace("custom-enemy:", "CUSTOM ");
}).join(", ");

const safeFilename = (value: string): string => value
  .replace(/[^a-z0-9]+/gi, "-")
  .replace(/^-|-$/g, "")
  .toLowerCase()
  .slice(0, 60) || "monochromium-export";

const downloadJson = (filename: string, value: unknown): void => {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const updateSelectedEnemyCount = (): void => {
  query<HTMLElement>("#selected-enemy-count").textContent = selectedEnemyIds.size.toString();
  query<HTMLButtonElement>("#export-selected-enemies").disabled = selectedEnemyIds.size === 0;
};

const exportEnemyBundle = (enemies: readonly CustomEnemyDraft[], filename: string): void => {
  downloadJson(filename, {
    type: "monochromium-custom-enemies",
    version: 1,
    enemies,
  });
  setSaveStatus(`${enemies.length} ${enemies.length === 1 ? "enemy" : "enemies"} exported.`, "good");
};

const exportModeFile = (mode: CustomModeDraft): void => {
  downloadJson(`monochromium-mode-${safeFilename(mode.name)}.json`, {
    type: "monochromium-custom-mode",
    version: 1,
    mode,
  });
  setSaveStatus(`Mode "${mode.name}" exported.`, "good");
};

const renderUpdateState = (state: MonochromiumUpdateState): void => {
  updateStatus.textContent = state.message;
  updateStatus.dataset["status"] = state.status;
  checkUpdateButton.disabled = ["checking", "downloading"].includes(state.status);
  installUpdateButton.hidden = state.status !== "downloaded";
  if (state.status === "downloaded") updateStatus.classList.add("ready");
  else updateStatus.classList.remove("ready");
};

const checkForUpdate = async (): Promise<void> => {
  if (!window.monochromiumDesktop) return;
  renderUpdateState(await window.monochromiumDesktop.checkForUpdate());
};

const hydrateUpdater = async (): Promise<void> => {
  if (!window.monochromiumDesktop) return;
  const environment = await getDesktopEnvironment();
  if (!environment?.packaged) return;
  updatePanel.hidden = false;
  renderUpdateState(await window.monochromiumDesktop.getUpdateState());
  stopUpdateStateSubscription = window.monochromiumDesktop.onUpdateState(renderUpdateState);
};

const currentSaveBundle = (): SaveBundle => ({
  version: 1,
  meta: progress,
  customModes,
  customEnemies,
});

const exportSaveBackup = async (): Promise<void> => {
  const disk = await loadDiskSave();
  const bundle = disk.available && disk.data ? disk.data : currentSaveBundle();
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `monochromium-save-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  setSaveStatus("Save backup exported.", "good");
};

const renderMeta = (): void => {
  query<HTMLElement>("#meta-coins").textContent = progress.coins.toLocaleString();
  query<HTMLElement>("#meta-tokens").textContent = progress.tokens.toLocaleString();
  query<HTMLElement>("#shop-coins").textContent = progress.coins.toLocaleString();
  query<HTMLElement>("#shop-tokens").textContent = progress.tokens.toLocaleString();
  TOWER_ORDER.forEach((kind) => {
    const card = query<HTMLButtonElement>(`[data-tower-kind='${kind}']`);
    const owned = progress.unlockedTowers.includes(kind);
    const cost = TOWER_DEFINITIONS[kind].unlockCost;
    card.classList.toggle("owned", owned);
    card.classList.toggle("unaffordable", !owned && progress.coins < cost);
    card.disabled = owned;
    query<HTMLElement>(`#shop-price-${kind}`).textContent = owned ? "OWNED" : `${cost.toLocaleString()} COINS`;
  });
  (Object.keys(MAP_DEFINITIONS) as MapKind[]).forEach((kind) => {
    query<HTMLElement>(`#clear-${kind}`).textContent = progress.clearedMaps.includes(kind) ? "// CLEARED" : "";
  });
};

const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
})[character] ?? character);

const polygonClipPath = (sides: number): string => {
  const count = Math.max(3, Math.min(12, Math.round(sides)));
  const points = Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + index / count * Math.PI * 2;
    return `${50 + Math.cos(angle) * 48}% ${50 + Math.sin(angle) * 48}%`;
  });
  return `polygon(${points.join(",")})`;
};

const enemyShapeCard = (name: string, color: string, sides: number): string => {
  const glyph = name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "E";
  return `<span class="enemy-card-shape" style="background:${color};clip-path:${polygonClipPath(sides)}">${glyph}</span>`;
};

const renderEnemyList = (): void => {
  query<HTMLElement>("#official-enemy-list").innerHTML = getOfficialEnemyDefinitions().map((enemy) => {
    const sides = enemy.sprite.shape === "circle" ? 12 : enemy.sprite.shape === "hexagon" ? 6 : 4;
    const specials = [enemy.hidden ? "HIDDEN" : "", enemy.summon ? "SUMMONER" : "", enemy.shockwave ? "STUN" : "", enemy.boss ? "BOSS" : ""].filter(Boolean).join(" // ");
    return `<article class="enemy-library-card official">${enemyShapeCard(enemy.name, enemy.sprite.fill.startsWith("#") ? enemy.sprite.fill : enemy.sprite.accent, sides)}<div><small>OFFICIAL // READ ONLY</small><strong>${escapeHtml(enemy.name)}</strong><p>${enemy.hp.toLocaleString()} HP · ${enemy.speed} SPEED · ${enemy.damage} DMG</p>${specials ? `<b>${specials}</b>` : ""}</div></article>`;
  }).join("");
  const list = query<HTMLElement>("#custom-enemy-list");
  if (customEnemies.length === 0) {
    list.innerHTML = `<div class="empty-mode-list"><strong>NO CREATED ENEMIES</strong><span>Create a polygon hostile for custom modes.</span></div>`;
    updateSelectedEnemyCount();
    return;
  }
  list.innerHTML = customEnemies.map((enemy) => {
    const specials = [enemy.hidden ? "HIDDEN" : "", enemy.summoningEnabled ? "SUMMONER" : "", enemy.stunningEnabled ? "STUN" : "", enemy.boss ? "BOSS" : ""].filter(Boolean).join(" // ");
    return `<article class="enemy-library-card">${enemyShapeCard(enemy.name, enemy.color, enemy.sides)}<div><small>CREATED // ${enemy.sides} SIDES</small><strong>${escapeHtml(enemy.name)}</strong><p>${enemy.hp.toLocaleString()} HP · ${enemy.speed} SPEED · ${enemy.damage} DMG</p>${specials ? `<b>${specials}</b>` : ""}</div><div class="enemy-card-actions"><label class="enemy-select"><input type="checkbox" data-enemy-select="${escapeHtml(enemy.id)}" ${selectedEnemyIds.has(enemy.id) ? "checked" : ""}><span>SELECT</span></label><button data-action="export-enemy" data-enemy-id="${escapeHtml(enemy.id)}">EXPORT</button><button data-action="edit-enemy" data-enemy-id="${escapeHtml(enemy.id)}">EDIT</button><button class="danger" data-action="delete-enemy" data-enemy-id="${escapeHtml(enemy.id)}">DELETE</button></div></article>`;
  }).join("");
  updateSelectedEnemyCount();
};

const renderEnemyCreator = (): void => {
  if (!enemyDraft) return;
  const field = <T extends HTMLInputElement>(name: string): T => query<T>(`[data-enemy-field='${name}']`);
  field("name").value = enemyDraft.name;
  field("color").value = enemyDraft.color;
  field("sides").value = enemyDraft.sides.toString();
  field("hp").value = enemyDraft.hp.toString();
  field("speed").value = enemyDraft.speed.toString();
  field("damage").value = enemyDraft.damage.toString();
  field("attackInterval").value = enemyDraft.attackInterval.toString();
  field("telegraphDuration").value = enemyDraft.telegraphDuration.toString();
  field("coreDamage").value = enemyDraft.coreDamage.toString();
  field("radius").value = enemyDraft.radius.toString();
  field("hidden").checked = enemyDraft.hidden;
  field("boss").checked = enemyDraft.boss;
  field("summoningEnabled").checked = enemyDraft.summoningEnabled;
  field("stunningEnabled").checked = enemyDraft.stunningEnabled;
  field("summonInterval").value = enemyDraft.summonInterval.toString();
  field("summonCount").value = enemyDraft.summonCount.toString();
  field("stunInterval").value = enemyDraft.stunInterval.toString();
  field("stunRadius").value = enemyDraft.stunRadius.toString();
  field("stunDuration").value = enemyDraft.stunDuration.toString();
  query<HTMLElement>("#summoning-editor").hidden = !enemyDraft.summoningEnabled;
  query<HTMLElement>("#stunning-editor").hidden = !enemyDraft.stunningEnabled;
  query<HTMLElement>("#enemy-sides-value").textContent = enemyDraft.sides.toString();
  const preview = query<HTMLElement>("#enemy-shape-preview");
  preview.style.clipPath = polygonClipPath(enemyDraft.sides);
  preview.style.background = enemyDraft.color;
  query<HTMLElement>("#enemy-glyph-preview").textContent = enemyDraft.name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "CE";
  query<HTMLElement>("#enemy-name-preview").textContent = enemyDraft.name.toUpperCase();
  query<HTMLElement>("#enemy-preview-stats").textContent = `${enemyDraft.hp.toLocaleString()} HP // ${enemyDraft.speed} SPEED // ${enemyDraft.damage} DMG`;
  query<HTMLElement>("#summon-enemy-options").innerHTML = getAllEnemyDefinitions()
    .filter((enemy) => enemy.kind !== enemyDraft!.id)
    .map((enemy) => `<label><input type="checkbox" data-summon-kind="${escapeHtml(enemy.kind)}" ${enemyDraft!.summonKinds.includes(enemy.kind) ? "checked" : ""}><span>${escapeHtml(enemy.name)}</span><small>${enemy.kind.startsWith("custom-enemy:") ? "CREATED" : "OFFICIAL"} // ${enemy.hp} HP</small></label>`)
    .join("");
};

const renderModeList = (): void => {
  const list = query<HTMLElement>("#custom-mode-list");
  if (customModes.length === 0) {
    list.innerHTML = `<div class="empty-mode-list"><strong>NO CREATED MODES</strong><span>Open the creator to build a local finite timeline.</span></div>`;
    return;
  }
  list.innerHTML = customModes.map((mode) => {
    const missingEnemies = getMissingCustomEnemyIds(mode);
    const dependencyNotice = missingEnemies.length > 0
      ? `<b class="missing-dependency">LOCKED // IMPORT: ${escapeHtml(formatMissingCustomEnemies(missingEnemies))}</b>`
      : "";
    return `
    <article class="mode-entry${missingEnemies.length > 0 ? " missing-dependency-entry" : ""}">
      <div>
        <small>CREATED // ${mode.waves.length} ${mode.waves.length === 1 ? "WAVE" : "WAVES"} // NO REWARDS</small>
        <strong>${escapeHtml(mode.name)}</strong>
        <p>${escapeHtml(mode.description)}</p>${dependencyNotice}
      </div>
      <div class="mode-entry-actions">
        <button class="primary-button" data-action="select-mode" data-mode-id="${escapeHtml(mode.id)}" ${missingEnemies.length > 0 ? "disabled" : ""}>${missingEnemies.length > 0 ? "LOCKED" : "SELECT"}</button>
        <button class="secondary-button" data-action="export-mode" data-mode-id="${escapeHtml(mode.id)}">EXPORT</button>
        <button class="secondary-button" data-action="edit-mode" data-mode-id="${escapeHtml(mode.id)}">EDIT</button>
        <button class="entry-delete" data-action="delete-mode" data-mode-id="${escapeHtml(mode.id)}">DELETE</button>
      </div>
    </article>
  `;
  }).join("");
};

const updateSelectedModeCopy = (): void => {
  query<HTMLElement>("#selected-mode-copy").textContent = `${selectedMode.name} // ${selectedMode.waves.length} finite ${selectedMode.waves.length === 1 ? "wave" : "waves"}.${selectedMode.isCustom ? " Created modes provide no profile rewards." : " Official map-adjusted profile rewards are enabled."}`;
  const compactName = selectedMode.name.length > 24 ? `${selectedMode.name.slice(0, 23)}…` : selectedMode.name;
  query<HTMLButtonElement>("#start-mode-button").innerHTML = `START ${escapeHtml(compactName.toUpperCase())} <span>→</span>`;
  Object.values(MAP_DEFINITIONS).forEach((map) => {
    query<HTMLElement>(`#map-reward-${map.kind}`).textContent = selectedMode.isCustom
      ? "CUSTOM MODE // NO PROFILE REWARD"
      : `${Math.round(map.rewardMultiplier * 100)}% COIN REWARD`;
  });
};

const renderCreator = (): void => {
  if (!creatorDraft) return;
  creatorWaveIndex = Math.min(Math.max(0, creatorWaveIndex), creatorDraft.waves.length - 1);
  const wave = creatorDraft.waves[creatorWaveIndex];
  if (!wave) return;
  query<HTMLInputElement>("[data-mode-field='name']").value = creatorDraft.name;
  query<HTMLTextAreaElement>("[data-mode-field='description']").value = creatorDraft.description;
  query<HTMLInputElement>("[data-mode-field='startingCash']").value = creatorDraft.startingCash.toString();
  query<HTMLInputElement>("[data-mode-field='coreIntegrity']").value = creatorDraft.coreIntegrity.toString();
  query<HTMLInputElement>("[data-wave-field='cashReward']").value = wave.cashReward.toString();
  query<HTMLElement>("#creator-wave-kicker").textContent = `WAVE ${(creatorWaveIndex + 1).toString().padStart(2, "0")}`;
  query<HTMLElement>("#creator-wave-list").innerHTML = creatorDraft.waves.map((candidate, index) => {
    const enemyCount = candidate.blocks.reduce((total, block) => total + block.count, 0);
    return `<button class="${index === creatorWaveIndex ? "active" : ""}" data-action="creator-select-wave" data-wave-index="${index}"><span>WAVE ${(index + 1).toString().padStart(2, "0")}</span><small>${candidate.blocks.length} BLOCKS // ${enemyCount} ENEMIES</small></button>`;
  }).join("");

  let blockStart = 0;
  query<HTMLElement>("#creator-block-list").innerHTML = wave.blocks.map((block, index) => {
    const start = blockStart;
    blockStart += block.nextBlockDelay;
    const enemyOptions = getAllEnemyDefinitions().map((enemy) =>
      `<option value="${enemy.kind}" ${enemy.kind === block.enemy ? "selected" : ""}>${escapeHtml(enemy.name)} // ${enemy.hp} HP${enemy.kind.startsWith("custom-enemy:") ? " // CREATED" : ""}</option>`,
    ).join("");
    return `
      <article class="command-block" data-block-index="${index}">
        <header>
          <div><span>BLOCK ${(index + 1).toString().padStart(2, "0")}</span><strong>ENEMY GROUP</strong></div>
          <small>START +${start.toFixed(2)}s</small>
          <div class="block-actions">
            <button data-action="creator-block-up" data-block-index="${index}" ${index === 0 ? "disabled" : ""}>↑</button>
            <button data-action="creator-block-down" data-block-index="${index}" ${index === wave.blocks.length - 1 ? "disabled" : ""}>↓</button>
            <button class="danger" data-action="creator-delete-block" data-block-index="${index}" ${wave.blocks.length === 1 ? "disabled" : ""}>×</button>
          </div>
        </header>
        <div class="block-fields">
          <label class="enemy-field"><span>ENEMY</span><select data-block-field="enemy" data-block-index="${index}">${enemyOptions}</select></label>
          <label><span>AMOUNT</span><input type="number" min="1" max="10000" step="1" value="${block.count}" data-block-field="count" data-block-index="${index}"></label>
          <label><span>SPAWN DELAY</span><input type="number" min="0.02" step="0.01" value="${block.spawnDelay}" data-block-field="spawnDelay" data-block-index="${index}"><small>seconds between enemies</small></label>
          <label><span>NEXT BLOCK</span><input type="number" min="0" step="0.01" value="${block.nextBlockDelay}" data-block-field="nextBlockDelay" data-block-index="${index}"><small>seconds from this block's start</small></label>
        </div>
      </article>`;
  }).join("");
  document.querySelectorAll<HTMLButtonElement>("[data-action='creator-delete-wave']").forEach((button) => {
    button.disabled = creatorDraft!.waves.length === 1;
  });
};

const showFrontScreen = (screen: "main" | "enemies" | "enemy-creator" | "modes" | "maps" | "creator" | "shop"): void => {
  mainMenu.hidden = screen !== "main";
  enemySelection.hidden = screen !== "enemies";
  enemyCreator.hidden = screen !== "enemy-creator";
  modeSelection.hidden = screen !== "modes";
  mapSelection.hidden = screen !== "maps";
  modeCreator.hidden = screen !== "creator";
  towerShop.hidden = screen !== "shop";
  gameOverPanel.hidden = true;
  victoryPanel.hidden = true;
  debugPanel.hidden = true;
  renderMeta();
  if (screen === "modes") renderModeList();
  if (screen === "enemies") renderEnemyList();
  if (screen === "enemy-creator") renderEnemyCreator();
  if (screen === "maps") updateSelectedModeCopy();
  if (screen === "creator") renderCreator();
};

const selectMapCard = (kind: MapKind): void => {
  selectedMapKind = kind;
  document.querySelectorAll<HTMLButtonElement>(".map-card").forEach((card) => {
    card.classList.toggle("selected", card.dataset["map"] === kind);
  });
};

const settleRun = (victory: boolean, wave: number, mode: ModeDefinition): { coins: number; tokens: number } => {
  if (runSettled) return { coins: 0, tokens: 0 };
  runSettled = true;
  if (mode.isCustom) return { coins: 0, tokens: 0 };
  const map = MAP_DEFINITIONS[activeMapKind];
  const progressRatio = Math.min(1, wave / mode.waves.length);
  const coins = victory
    ? Math.round(mode.reward.coins * map.rewardMultiplier)
    : Math.round((15 + 75 * progressRatio) * map.rewardMultiplier);
  const tokens = victory ? mode.reward.tokens : wave >= 20 ? 1 : 0;
  progress.coins += coins;
  progress.tokens += tokens;
  progress.runs += 1;
  if (victory) {
    progress.victories += 1;
    if (!progress.clearedMaps.includes(activeMapKind)) progress.clearedMaps.push(activeMapKind);
  }
  saveProgress(progress);
  renderMeta();
  return { coins, tokens };
};

const addLog = (message: string, tone: "neutral" | "good" | "danger" = "neutral"): void => {
  const entry = document.createElement("p");
  entry.className = tone;
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  entry.innerHTML = `<time>${time}</time><span>${message}</span>`;
  logs.prepend(entry);
  while (logs.children.length > 4) logs.lastElementChild?.remove();
};

const renderSelection = (state: GameUiState): void => {
  const panel = query<HTMLElement>("#selection-panel");
  const view = state.selectedTower;
  const nextUpgradeCost = view?.definition.upgrades[view.tower.level]?.cost;
  const upgradeAffordable = nextUpgradeCost !== undefined && (state.infiniteCash || state.shards >= nextUpgradeCost);
  const moveAffordable = state.infiniteCash || state.shards >= ECONOMY_RULES.relocationCost;
  const signature = view
    ? `${view.tower.id}:${view.tower.level}:${view.tower.onPath}:${Math.ceil(view.tower.hp)}:${view.tower.engaged.size}:${view.tower.targeting}:${upgradeAffordable}:${moveAffordable}:${state.relocating}:${state.infiniteCash}`
    : "none";
  if (signature === selectionSignature) return;
  selectionSignature = signature;
  const previousScroll = panel.scrollTop;
  if (!view) {
    panel.innerHTML = `
      <div class="empty-selection">
        <span>◇</span><b>NO CONSTRUCT LINKED</b>
        <small>Select a deployed construct<br>to inspect its combat lattice.</small>
      </div>`;
    return;
  }
  const { tower, definition } = view;
  const form = tower.onPath ? definition.onPath : definition.offPath;
  const mode = tower.onPath ? "PATHBOUND + ARMED" : "RANGED FIELD";
  const levelStats = definition.levels[tower.level];
  if (!levelStats) return;
  const damage = levelStats.damage;
  const fireInterval = levelStats.fireRate;
  const range = levelStats.range;
  const burstCount = definition.kind === "recon" ? 5 : definition.kind === "gunner" ? (tower.level >= 5 ? 6 : tower.level >= 4 ? 4 : 3) : 1;
  const gunnerBurstRate = tower.level >= 5 ? 0.1 : 0.2;
  const damageReadout = definition.kind === "tempest"
    ? `${damage} x2`
    : burstCount > 1
      ? `${damage} x${burstCount}`
      : `${damage}`;
  const maxLevel = definition.levels.length - 1;
  const nextUpgrade = definition.upgrades[tower.level];
  const upgradeSkill = nextUpgrade ? (tower.onPath ? nextUpgrade.onPathSkill : nextUpgrade.offPathSkill) : "All evolution protocols are active.";
  const nextLevelStats = nextUpgrade ? definition.levels[nextUpgrade.level] : levelStats;
  const nextDamage = nextLevelStats?.damage ?? damage;
  const nextFireInterval = nextLevelStats?.fireRate ?? fireInterval;
  const detectionLevel = definition.hiddenDetectionLevel;
  const detectionState = detectionLevel === undefined
    ? "NO HIDDEN DETECTION"
    : tower.level >= detectionLevel
      ? "HIDDEN DETECTION // ONLINE"
      : `HIDDEN DETECTION // UNLOCKS LEVEL ${detectionLevel}`;
  const nextStats = nextUpgrade
    ? tower.onPath
      ? `DMG ${damage}→${nextDamage} · HP ${tower.maxHp}→${Math.round(definition.onPath.hp * (nextLevelStats?.hpMultiplier ?? 1))} · AGGRO ${tower.maxAggro} (ROLE CAP)`
      : `DMG ${damage}→${nextDamage} · RATE ${(1 / fireInterval).toFixed(1)}→${(1 / nextFireInterval).toFixed(1)} · RANGE ${range}→${nextLevelStats?.range ?? range}`
    : "All systems at maximum output";
  const sellRate = tower.kind === "cyborg" && tower.level >= 5 ? 0.8 : 0.5;
  const targetingModes: ReadonlyArray<{ value: TargetingMode; label: string }> = [
    { value: "first", label: "First" },
    { value: "last", label: "Last" },
    { value: "strongest", label: "Strongest" },
    { value: "weakest", label: "Weakest" },
    { value: "closest", label: "Closest" },
  ];
  const ability = definition.ability;
  const abilityUnlocked = Boolean(ability && tower.level >= ability.unlockLevel);
  panel.innerHTML = `
    <div class="selected-head" style="--accent:${definition.accent}">
      <span class="selected-glyph">${definition.glyph}</span>
      <div><small>${mode} // ${definition.name.toUpperCase()}</small><strong>${form.title}</strong></div>
      <div class="level-pips" aria-label="Level ${tower.level} of ${maxLevel}">${Array.from({ length: definition.levels.length }, (_, level) => `<i class="${level <= tower.level ? "filled" : ""}"></i>`).join("")}</div>
      <button data-action="sell" class="sell-button" title="Sell for $${Math.floor(tower.totalInvested * sellRate)}; this copy is not restored">⌁</button>
    </div>
    <p class="selected-description">${form.description}</p>
    <div class="selected-stats">
      <div><span>LEVEL</span><b>${tower.level} / ${maxLevel}</b></div>
       <div><span>DAMAGE / VOLLEY</span><b>${damageReadout}</b></div>
       ${definition.kind === "gunner"
         ? `<div><span>COOLDOWN / BURST RATE</span><b>${fireInterval.toFixed(1)}s / ${gunnerBurstRate.toFixed(1)}s</b></div>`
         : `<div><span>ATTACKS / SEC</span><b>${(1 / fireInterval).toFixed(1)}</b></div>`}
      ${tower.onPath
        ? `<div><span>INTEGRITY / AGGRO</span><b>${Math.ceil(tower.hp)}/${tower.maxHp} · ${tower.engaged.size}/${tower.maxAggro}</b></div>`
        : `<div><span>RANGE</span><b>${range}</b></div>`}
    </div>
    <div class="trait-strip ${detectionLevel !== undefined && tower.level >= detectionLevel ? "online" : ""}">${detectionState}</div>
    <button data-action="move" class="move-button" ${!moveAffordable ? "disabled" : ""}>
      <span>RELOCATE</span><b>${state.infiniteCash ? "FREE" : `$${ECONOMY_RULES.relocationCost}`}</b><small>Move on or off the path</small>
    </button>
    <div class="targeting-control">
      <span>TARGET PRIORITY</span>
      <div>${targetingModes.map(({ value, label }) => `<button data-action="target" data-targeting="${value}" class="${tower.targeting === value ? "active" : ""}" title="Target ${value}">${label}</button>`).join("")}</div>
    </div>
    <div class="upgrade-panel ${nextUpgrade ? "" : "maxed"}">
      <div class="upgrade-copy">
        <span>${nextUpgrade ? `LEVEL ${nextUpgrade.level} // ${nextUpgrade.title.toUpperCase()}` : `LEVEL ${maxLevel} // MAXIMUM`}</span>
        <p>${upgradeSkill}</p>
        <small>${nextStats}</small>
      </div>
      ${nextUpgrade
        ? `<button data-action="upgrade" data-testid="upgrade-button" ${!state.infiniteCash && state.shards < nextUpgrade.cost ? "disabled" : ""}><span>UPGRADE</span><b>${state.infiniteCash ? "FREE" : `$${nextUpgrade.cost}`}</b></button>`
        : `<strong class="max-level">MAX</strong>`}
    </div>
    ${tower.onPath
      ? `<div class="ability-copy"><span>COUNTER SIGNATURE // SPACE</span><p>${definition.counter}</p></div>`
      : `<div class="ability-copy muted"><span>RANGED FORM</span><p>Cannot be attacked or countered. Automatic attacks and active abilities remain available.</p></div>`}
    ${ability
      ? `<div class="ability-copy ${abilityUnlocked ? "" : "muted"}"><span>${abilityUnlocked ? `ACTIVE ABILITY // Q // ${ability.name.toUpperCase()}` : `ABILITY UNLOCKS AT LEVEL ${ability.unlockLevel}`}</span><p>${ability.description}</p></div>`
      : ""}
  `;
  panel.scrollTop = previousScroll;
};

const render = (state: GameUiState): void => {
  const selectedId = state.selectedTower?.tower.id ?? null;
  if (selectedId !== lastSelectedTowerId) {
    inspectorSuppressed = false;
    lastSelectedTowerId = selectedId;
  }
  towerInspector.hidden = !state.selectedTower || inspectorSuppressed;
  selectedPill.hidden = !state.selectedTower || !inspectorSuppressed;
  if (state.selectedTower) {
    const selected = state.selectedTower;
    query<HTMLElement>("#selected-pill-label").textContent = `LVL ${selected.tower.level} ${selected.definition.name.toUpperCase()}`;
    const miniState = query<HTMLElement>("#selected-pill-state");
    selectedPill.classList.remove("live");
    if (selected.tower.stunTimer > 0) miniState.textContent = `STUNNED ${selected.tower.stunTimer.toFixed(1)}s`;
    else if (
      selected.tower.onPath &&
      selected.tower.counterCooldown <= 0 &&
      selected.incomingAttack !== null &&
      selected.incomingAttack <= COMBAT_RULES.counterWindow
    ) {
      miniState.textContent = "COUNTER NOW // SPACE";
      selectedPill.classList.add("live");
    } else if (selected.tower.kind === "samurai" && selected.tower.abilityTimer > 0) {
      miniState.textContent = `STANCE ${selected.tower.abilityTimer.toFixed(1)}s // Q`;
      selectedPill.classList.add("live");
    } else {
      const ability = selected.definition.ability;
      const abilityReady = Boolean(
        ability && selected.tower.level >= ability.unlockLevel && selected.tower.abilityCooldown <= 0,
      );
      if (abilityReady) {
        miniState.textContent = `${ability!.name.toUpperCase()} READY // Q`;
        selectedPill.classList.add("live");
      } else if (selected.tower.onPath && selected.tower.counterCooldown > 0) {
        miniState.textContent = `COUNTER ${selected.tower.counterCooldown.toFixed(1)}s`;
      } else miniState.textContent = selected.tower.onPath ? "COUNTER ARMED // SPACE" : "OPEN PANEL";
    }
  }
  query<HTMLElement>("#integrity-value").textContent = `${state.integrity} / ${state.maxIntegrity}`;
  query<HTMLElement>("#integrity-fill").style.width = `${(state.integrity / state.maxIntegrity) * 100}%`;
  query<HTMLElement>("#integrity-fill").classList.toggle("critical", state.integrity <= 6);
  query<HTMLElement>("#shard-value").textContent = state.infiniteCash ? "∞" : state.shards.toString().padStart(3, "0");
  const pendingRefund = query<HTMLElement>("#pending-refund");
  pendingRefund.hidden = state.pendingCasualtyRefund <= 0;
  pendingRefund.textContent = `+$${state.pendingCasualtyRefund} NEXT WAVE`;
  const debugCashState = query<HTMLElement>("#debug-cash-state");
  debugCashState.textContent = state.infiniteCash ? "ON" : "OFF";
  debugCashState.classList.toggle("active", state.infiniteCash);
  query<HTMLElement>("#wave-value").textContent = `${state.wave.toString().padStart(2, "0")} / ${state.totalWaves}`;
  query<HTMLElement>("#mode-label").textContent = `${state.mapName.toUpperCase()} // ${state.modeName.toUpperCase()}`;
  query<HTMLElement>("#brand-map-label").textContent = `${state.started ? state.mapName.toUpperCase() : "COMMAND"} // PATHBOUND DEFENSE`;
  query<HTMLElement>("#speed-label").textContent = `${state.speed}×`;
  query<HTMLElement>("#sound-icon").textContent = state.soundEnabled ? "SND" : "OFF";
  query<HTMLElement>("#pause-icon").textContent = state.paused ? "▶" : "Ⅱ";
  query<HTMLDivElement>("#pause-banner").hidden = !state.paused;
  const enemyCount = query<HTMLElement>("#enemy-count");
  enemyCount.textContent = state.enemiesRemaining > 0 ? `${state.enemiesRemaining.toString().padStart(2, "0")} HOSTILES` : "NO HOSTILES";
  enemyCount.classList.toggle("danger", state.enemiesRemaining > 0);
  query<HTMLElement>("#threat-label").textContent = state.modeComplete
    ? "MODE: COMPLETE"
    : state.waveActive
      ? "THREAT: ACTIVE"
      : `NEXT WAVE: ${state.intermissionRemaining.toFixed(1)}s`;
  query<HTMLElement>("#threat-label").classList.toggle("danger", state.waveActive);

  const waveButton = query<HTMLElement>("#wave-button");
  waveButton.innerHTML = state.modeComplete
    ? `MODE COMPLETE <b>✓</b>`
    : state.waveActive
      ? `WAVE ACTIVE <b>${state.enemiesRemaining}</b>`
      : `NEXT WAVE <b>${Math.max(0, Math.ceil(state.intermissionRemaining))}</b>`;
  document.querySelectorAll<HTMLButtonElement>(".tower-card").forEach((card) => {
    const kind = card.dataset["kind"] as TowerKind;
    const available = state.availableTowers.includes(kind);
    card.hidden = !available;
    const remaining = state.copiesRemaining[kind];
    card.classList.toggle("active", kind === state.selectedKind);
    card.classList.toggle("unaffordable", !state.infiniteCash && TOWER_DEFINITIONS[kind].cost > state.shards);
    card.classList.toggle("exhausted", remaining <= 0);
    card.disabled = remaining <= 0;
    query<HTMLElement>(`#stock-${kind}`).textContent = `x${remaining}`;
    card.title = remaining > 0
      ? `${remaining} of ${TOWER_DEFINITIONS[kind].copyLimit} permanent copies remain`
      : "No copies remain for this run";
  });

  const placementChip = query<HTMLDivElement>("#placement-chip");
  placementChip.hidden = !state.placement || (!state.selectedKind && !state.relocating);
  if (state.placement && (state.selectedKind || state.relocating)) {
    const definition = state.selectedKind
      ? TOWER_DEFINITIONS[state.selectedKind]
      : state.selectedTower?.definition;
    if (!definition) return;
    placementChip.textContent = state.placement.valid
      ? `${state.relocating ? "RELOCATE // " : ""}${state.placement.onPath ? "PATHBOUND" : "RANGED"} // ${state.placement.onPath ? definition.onPath.title : definition.offPath.title}${state.relocating ? ` // $${ECONOMY_RULES.relocationCost}` : ""}`
      : "RESTRICTED SITE";
    placementChip.classList.toggle("invalid", !state.placement.valid);
  }

  renderSelection(state);
  const counter = query<HTMLButtonElement>("[data-action='counter']");
  const abilityButton = query<HTMLButtonElement>("[data-action='ability']");
  const counterStatus = query<HTMLElement>("#counter-status");
  const counterHint = query<HTMLElement>("#counter-hint");
  const abilityStatus = query<HTMLElement>("#ability-status");
  const abilityHint = query<HTMLElement>("#ability-hint");
  const counterFill = query<HTMLElement>("#counter-cooldown-fill");
  const abilityFill = query<HTMLElement>("#ability-cooldown-fill");
  const selected = state.selectedTower;
  const selectedAbility = selected?.definition.ability;
  const abilityUnlocked = Boolean(selected && selectedAbility && selected.tower.level >= selectedAbility.unlockLevel);
  const samuraiStanceActive = Boolean(selected?.tower.kind === "samurai" && selected.tower.abilityTimer > 0);
  const counterRecharging = Boolean(selected && selected.tower.counterCooldown > 0);
  counter.disabled = !selected?.tower.onPath || counterRecharging || state.paused || Boolean(selected.tower.stunTimer > 0);
  abilityButton.disabled = !abilityUnlocked || state.paused || Boolean(selected && selected.tower.stunTimer > 0) || Boolean(
    selected && selected.tower.abilityCooldown > 0 && !samuraiStanceActive,
  );
  counter.classList.remove("live", "charging");
  abilityButton.classList.remove("live", "charging");
  const counterProgress = selected?.tower.onPath
    ? selected.tower.counterCooldown <= 0 ? 1 : 1 - selected.tower.counterCooldown / COMBAT_RULES.counterCooldown
    : 0;
  counterFill.style.width = `${Math.max(0, Math.min(1, counterProgress)) * 100}%`;
  const abilityMaxCooldown = selected?.tower.kind === "mercenary" && selected.tower.level >= 6
    ? 30
    : selectedAbility?.cooldown ?? 1;
  const abilityProgress = abilityUnlocked && selected
    ? selected.tower.abilityCooldown <= 0 ? 1 : 1 - selected.tower.abilityCooldown / abilityMaxCooldown
    : 0;
  abilityFill.style.width = `${Math.max(0, Math.min(1, abilityProgress)) * 100}%`;
  if (!selected) {
    counterStatus.textContent = "NO LINK";
    counterHint.textContent = "Select an on-path construct";
  } else if (selected.tower.stunTimer > 0) {
    counterStatus.textContent = `STUNNED ${selected.tower.stunTimer.toFixed(1)}s`;
    counterHint.textContent = "Big Dummy shockwave disabled this tower";
    counter.classList.add("charging");
  } else if (!selected.tower.onPath) {
    counterStatus.textContent = "RANGED FORM";
    counterHint.textContent = "Counter requires a pathbound form";
  } else if (selected.tower.counterCooldown > 0) {
    counterStatus.textContent = `RECHARGE ${selected.tower.counterCooldown.toFixed(1)}s`;
    counterHint.textContent = "Reactive lattice is recovering";
    counter.classList.add("charging");
  } else if (selected.incomingAttack === null) {
    counterStatus.textContent = "ARMED";
    counterHint.textContent = "Wait for a hostile attack ring";
  } else if (selected.incomingAttack > COMBAT_RULES.counterWindow) {
    counterStatus.textContent = `HOLD ${selected.incomingAttack.toFixed(1)}s`;
    counterHint.textContent = "Let the red ring close further";
  } else {
    counterStatus.textContent = "COUNTER NOW";
    counterHint.textContent = "Reactive window open — press Space";
    counter.classList.add("live");
  }

  if (!selected) {
    abilityStatus.textContent = "NO LINK";
    abilityHint.textContent = "Select a construct";
  } else if (!selectedAbility) {
    abilityStatus.textContent = "PASSIVE";
    abilityHint.textContent = "This construct has no active ability";
  } else if (!abilityUnlocked) {
    abilityStatus.textContent = `LEVEL ${selectedAbility.unlockLevel}`;
    abilityHint.textContent = `${selectedAbility.name} is still locked`;
  } else if (selected.tower.stunTimer > 0) {
    abilityStatus.textContent = `STUNNED ${selected.tower.stunTimer.toFixed(1)}s`;
    abilityHint.textContent = "Active system temporarily disabled";
    abilityButton.classList.add("charging");
  } else if (samuraiStanceActive) {
    abilityStatus.textContent = `STANCE ${selected.tower.abilityTimer.toFixed(1)}s`;
    abilityHint.textContent = "Press Q to sheathe early";
    abilityButton.classList.add("live");
  } else if (selected.tower.abilityCooldown > 0) {
    abilityStatus.textContent = `${selected.tower.abilityCooldown.toFixed(1)}s`;
    abilityHint.textContent = `${selectedAbility.name} is recharging`;
    abilityButton.classList.add("charging");
  } else {
    abilityStatus.textContent = `${selectedAbility.name.toUpperCase()} READY`;
    abilityHint.textContent = "Press Q to activate";
    abilityButton.classList.add("live");
  }
};

const game = new Game(canvas, {
  onUi: render,
  onLog: addLog,
  onGameOver: (wave) => {
    const reward = settleRun(false, wave, activeMode);
    query<HTMLElement>("#game-over-copy").textContent = activeMode.isCustom
      ? `Your custom simulation held through wave ${wave.toString().padStart(2, "0")}. Created modes do not provide profile rewards.`
      : `Your defense held through wave ${wave.toString().padStart(2, "0")}. Recovery paid ${reward.coins} Coins${reward.tokens > 0 ? ` and ${reward.tokens} Token` : ""}.`;
    gameOverPanel.hidden = false;
  },
  onVictory: (mode) => {
    const reward = settleRun(true, mode.waves.length, mode);
    query<HTMLElement>("#victory-copy").textContent = mode.isCustom
      ? `${mode.name} cleared on ${MAP_DEFINITIONS[activeMapKind].name}. Created modes do not provide profile rewards.`
      : `${MAP_DEFINITIONS[activeMapKind].name} secured. Reward: ${reward.coins} Coins and ${reward.tokens} Tokens.`;
    query<HTMLElement>("#victory h2").innerHTML = `${escapeHtml(mode.name.toUpperCase())}<br>SECURED`;
    victoryPanel.hidden = false;
  },
});

game.setAvailableTowers(progress.unlockedTowers);
renderMeta();

const hydrateDiskPersistence = async (): Promise<void> => {
  if (!hasDiskSaveApi()) {
    setSaveStatus("Browser fallback active // launch_game.py enables disk saves.", "danger");
    return;
  }
  const [disk, desktopEnvironment] = await Promise.all([loadDiskSave(), getDesktopEnvironment()]);
  if (!disk.available) {
    setSaveStatus("Disk save service unavailable // browser fallback active.", "danger");
    return;
  }
  if (disk.exists && disk.data) {
    if (disk.data.meta && typeof disk.data.meta === "object") progress = sanitizeProgress(disk.data.meta);
    if (Array.isArray(disk.data.customEnemies)) customEnemies = sanitizeCustomEnemies(disk.data.customEnemies);
    setCustomEnemyRegistry(customEnemies);
    if (Array.isArray(disk.data.customModes)) customModes = sanitizeCustomModes(disk.data.customModes);
    cacheProgressLocally(progress);
    cacheCustomEnemiesLocally(customEnemies);
    cacheCustomModesLocally(customModes);
    await replaceDiskSave(currentSaveBundle());
    game.setAvailableTowers(progress.unlockedTowers);
    renderMeta();
    renderModeList();
    setSaveStatus(
      desktopEnvironment
        ? `Desktop save active // ${desktopEnvironment.savePath}`
        : "Disk save active // save_data/monochromium_save.json",
      "good",
    );
    return;
  }
  const migrated = await replaceDiskSave(currentSaveBundle());
  setSaveStatus(
    migrated ? "Disk save created // existing browser progress migrated." : "Could not create disk save // browser fallback active.",
    migrated ? "good" : "danger",
  );
};

void hydrateDiskPersistence();
void hydrateUpdater();

const importEnemiesFromFile = async (file: File): Promise<void> => {
  try {
    const parsed = JSON.parse(await file.text()) as { type?: unknown; enemies?: unknown };
    if (parsed?.type !== "monochromium-custom-enemies" || !Array.isArray(parsed.enemies)) {
      throw new Error("This is not a Monochromium enemy export.");
    }
    const imported = sanitizeCustomEnemies(parsed.enemies);
    if (imported.length === 0) throw new Error("The export did not contain any valid enemies.");
    const conflicts = imported.filter((enemy) => customEnemies.some((current) => current.id === enemy.id));
    if (conflicts.length > 0 && !window.confirm(`Replace ${conflicts.length} existing custom ${conflicts.length === 1 ? "enemy" : "enemies"}?`)) return;
    customEnemies = [...customEnemies.filter((current) => !imported.some((enemy) => enemy.id === current.id)), ...imported];
    setCustomEnemyRegistry(customEnemies);
    saveCustomEnemies(customEnemies);
    renderEnemyList();
    renderModeList();
    addLog(`${imported.length} custom ${imported.length === 1 ? "enemy" : "enemies"} imported.`, "good");
    setSaveStatus(`${imported.length} ${imported.length === 1 ? "enemy" : "enemies"} imported.`, "good");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid enemy export.";
    addLog(`Enemy import failed // ${message}`, "danger");
    setSaveStatus(`Enemy import failed // ${message}`, "danger");
  }
};

const importModeFromFile = async (file: File): Promise<void> => {
  try {
    const parsed = JSON.parse(await file.text()) as { type?: unknown; mode?: unknown };
    if (parsed?.type !== "monochromium-custom-mode" || !parsed.mode) {
      throw new Error("This is not a Monochromium mode export.");
    }
    const imported = sanitizeCustomModes([parsed.mode])[0];
    if (!imported) throw new Error("The export did not contain a valid mode.");
    if (customModes.some((mode) => mode.id === imported.id) && !window.confirm(`Replace the existing mode "${imported.name}"?`)) return;
    customModes = upsertCustomMode(customModes, imported);
    renderModeList();
    const missingEnemies = getMissingCustomEnemyIds(imported);
    const suffix = missingEnemies.length > 0
      ? ` Locked // import: ${formatMissingCustomEnemies(missingEnemies)}.`
      : "";
    addLog(`Mode "${imported.name}" imported.${suffix}`, missingEnemies.length > 0 ? "danger" : "good");
    setSaveStatus(`Mode "${imported.name}" imported.${suffix}`, missingEnemies.length > 0 ? "danger" : "good");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid mode export.";
    addLog(`Mode import failed // ${message}`, "danger");
    setSaveStatus(`Mode import failed // ${message}`, "danger");
  }
};

const runAction = (action: string, value?: string, source?: HTMLElement): void => {
  switch (action) {
    case "open-modes":
      showFrontScreen("modes");
      break;
    case "open-shop":
      showFrontScreen("shop");
      break;
    case "open-enemies":
      showFrontScreen("enemies");
      break;
    case "new-enemy":
      enemyDraft = createCustomEnemy();
      showFrontScreen("enemy-creator");
      break;
    case "import-enemies":
      query<HTMLInputElement>("#enemy-import-input").click();
      break;
    case "export-selected-enemies": {
      const selected = customEnemies.filter((enemy) => selectedEnemyIds.has(enemy.id));
      if (selected.length > 0) exportEnemyBundle(selected, `monochromium-enemies-${selected.length}.json`);
      break;
    }
    case "export-enemy": {
      const enemy = customEnemies.find((candidate) => candidate.id === source?.dataset["enemyId"]);
      if (enemy) exportEnemyBundle([enemy], `monochromium-enemy-${safeFilename(enemy.name)}.json`);
      break;
    }
    case "edit-enemy": {
      const enemy = customEnemies.find((candidate) => candidate.id === source?.dataset["enemyId"]);
      if (!enemy) break;
      enemyDraft = cloneCustomEnemy(enemy);
      showFrontScreen("enemy-creator");
      break;
    }
    case "delete-enemy": {
      const enemy = customEnemies.find((candidate) => candidate.id === source?.dataset["enemyId"]);
      if (!enemy || !window.confirm(`Delete "${enemy.name}"? Custom wave references will be changed to Dummy.`)) break;
      customEnemies = customEnemies.filter((candidate) => candidate.id !== enemy.id);
      selectedEnemyIds.delete(enemy.id);
      setCustomEnemyRegistry(customEnemies);
      saveCustomEnemies(customEnemies);
      renderEnemyList();
      renderModeList();
      addLog(`${enemy.name} deleted // dependent modes remain locked until it is imported again.`, "danger");
      break;
    }
    case "enemy-back":
      enemyDraft = null;
      showFrontScreen("enemies");
      break;
    case "enemy-save":
      if (!enemyDraft) break;
      customEnemies = upsertCustomEnemy(customEnemies, enemyDraft);
      setCustomEnemyRegistry(customEnemies);
      enemyDraft = null;
      addLog("Custom enemy saved and added to the mode creator.", "good");
      showFrontScreen("enemies");
      break;
    case "export-save":
      void exportSaveBackup();
      break;
    case "import-save":
      query<HTMLInputElement>("#save-import-input").click();
      break;
    case "import-mode":
      query<HTMLInputElement>("#mode-import-input").click();
      break;
    case "check-update":
      void checkForUpdate();
      break;
    case "install-update":
      void window.monochromiumDesktop?.installUpdate();
      break;
    case "back-main":
      showFrontScreen("main");
      break;
    case "back-modes":
      showFrontScreen("modes");
      break;
    case "select-mode": {
      const modeId = source?.dataset["modeId"] ?? value;
      if (!modeId) break;
      if (modeId === "normal") selectedMode = NORMAL_MODE;
      else {
        const custom = customModes.find((mode) => mode.id === modeId);
        if (!custom) break;
        const missingEnemies = getMissingCustomEnemyIds(custom);
        if (missingEnemies.length > 0) {
          window.alert(`This mode is locked. Import these custom enemies first: ${formatMissingCustomEnemies(missingEnemies)}.`);
          break;
        }
        selectedMode = customModeToDefinition(custom);
      }
      showFrontScreen("maps");
      break;
    }
    case "new-mode":
      creatorDraft = createCustomMode();
      creatorWaveIndex = 0;
      showFrontScreen("creator");
      break;
    case "edit-mode": {
      const modeId = source?.dataset["modeId"];
      const custom = customModes.find((mode) => mode.id === modeId);
      if (!custom) break;
      creatorDraft = cloneCustomMode(custom);
      creatorWaveIndex = 0;
      showFrontScreen("creator");
      break;
    }
    case "export-mode": {
      const mode = customModes.find((candidate) => candidate.id === source?.dataset["modeId"]);
      if (mode) exportModeFile(mode);
      break;
    }
    case "delete-mode": {
      const modeId = source?.dataset["modeId"];
      const custom = customModes.find((mode) => mode.id === modeId);
      if (!custom || !window.confirm(`Delete "${custom.name}" from this browser?`)) break;
      customModes = deleteCustomMode(customModes, custom.id);
      if (selectedMode.kind === custom.id) selectedMode = NORMAL_MODE;
      renderModeList();
      break;
    }
    case "creator-back":
      creatorDraft = null;
      showFrontScreen("modes");
      break;
    case "creator-save":
      if (!creatorDraft) break;
      customModes = upsertCustomMode(customModes, creatorDraft);
      creatorDraft = null;
      addLog("Custom mode saved to this browser.", "good");
      showFrontScreen("modes");
      break;
    case "creator-select-wave": {
      const index = Number(source?.dataset["waveIndex"]);
      if (creatorDraft && Number.isInteger(index) && creatorDraft.waves[index]) {
        creatorWaveIndex = index;
        renderCreator();
      }
      break;
    }
    case "creator-add-wave":
      if (creatorDraft) {
        const template = createCustomMode().waves[0];
        if (template) creatorDraft.waves.push({ cashReward: template.cashReward, blocks: template.blocks.map((block) => ({ ...block })) });
        creatorWaveIndex = creatorDraft.waves.length - 1;
        renderCreator();
      }
      break;
    case "creator-delete-wave":
      if (creatorDraft && creatorDraft.waves.length > 1) {
        creatorDraft.waves.splice(creatorWaveIndex, 1);
        creatorWaveIndex = Math.min(creatorWaveIndex, creatorDraft.waves.length - 1);
        renderCreator();
      }
      break;
    case "creator-wave-up":
    case "creator-wave-down": {
      if (!creatorDraft) break;
      const direction = action === "creator-wave-up" ? -1 : 1;
      const destination = creatorWaveIndex + direction;
      if (!creatorDraft.waves[destination]) break;
      [creatorDraft.waves[creatorWaveIndex], creatorDraft.waves[destination]] = [creatorDraft.waves[destination]!, creatorDraft.waves[creatorWaveIndex]!];
      creatorWaveIndex = destination;
      renderCreator();
      break;
    }
    case "creator-add-block": {
      const wave = creatorDraft?.waves[creatorWaveIndex];
      const template = createCustomMode().waves[0]?.blocks[0];
      if (wave && template) {
        wave.blocks.push({ ...template });
        renderCreator();
      }
      break;
    }
    case "creator-delete-block":
    case "creator-block-up":
    case "creator-block-down": {
      const wave = creatorDraft?.waves[creatorWaveIndex];
      const index = Number(source?.dataset["blockIndex"]);
      if (!wave || !Number.isInteger(index) || !wave.blocks[index]) break;
      if (action === "creator-delete-block") {
        if (wave.blocks.length > 1) wave.blocks.splice(index, 1);
      } else {
        const direction = action === "creator-block-up" ? -1 : 1;
        const destination = index + direction;
        if (wave.blocks[destination]) [wave.blocks[index], wave.blocks[destination]] = [wave.blocks[destination]!, wave.blocks[index]!];
      }
      renderCreator();
      break;
    }
    case "select-map":
      if (value) selectMapCard(value as MapKind);
      break;
    case "start-map":
      {
      const missingEnemies = getMissingCustomEnemyIds(selectedMode);
      if (missingEnemies.length > 0) {
        window.alert(`This mode is locked. Import these custom enemies first: ${formatMissingCustomEnemies(missingEnemies)}.`);
        showFrontScreen("modes");
        break;
      }
      activeMapKind = selectedMapKind;
      runSettled = false;
      mainMenu.hidden = true;
      enemySelection.hidden = true;
      enemyCreator.hidden = true;
      modeSelection.hidden = true;
      mapSelection.hidden = true;
      modeCreator.hidden = true;
      towerShop.hidden = true;
      gameOverPanel.hidden = true;
      victoryPanel.hidden = true;
      activeMode = selectedMode;
      game.startRun(activeMapKind, progress.unlockedTowers, activeMode);
      break;
      }
    case "main-menu":
      game.leaveRun();
      showFrontScreen("main");
      break;
    case "buy-tower":
      if (value) {
        const kind = value as TowerKind;
        if (unlockTower(progress, kind)) {
          game.setAvailableTowers(progress.unlockedTowers);
          addLog(`${TOWER_DEFINITIONS[kind].name} permanently unlocked.`, "good");
        }
        renderMeta();
      }
      break;
    case "restart":
      gameOverPanel.hidden = true;
      victoryPanel.hidden = true;
      runSettled = false;
      game.restart();
      break;
    case "pause":
      game.togglePause();
      break;
    case "speed":
      game.cycleSpeed();
      break;
    case "sound":
      game.toggleSound();
      break;
    case "debug":
      debugPanel.hidden = !debugPanel.hidden;
      break;
    case "debug-close":
      debugPanel.hidden = true;
      break;
    case "debug-cash-toggle":
      game.toggleInfiniteCash();
      break;
    case "debug-cash":
      game.debugAddCash();
      break;
    case "debug-heal":
      game.debugHealCore();
      break;
    case "debug-clear":
      game.debugClearWave();
      break;
    case "debug-stock":
      game.debugRestock();
      break;
    case "debug-max":
      game.debugMaxSelected();
      break;
    case "debug-unlock":
      unlockEveryTower(progress);
      game.setAvailableTowers(progress.unlockedTowers);
      renderMeta();
      addLog("Debug // every tower permanently unlocked.", "good");
      break;
    case "counter":
      game.counterSelected();
      break;
    case "ability":
      game.activateSelectedAbility();
      break;
    case "sell":
      game.sellSelected();
      break;
    case "move":
      inspectorSuppressed = true;
      game.startMoveSelected();
      break;
    case "close-inspector":
      inspectorSuppressed = true;
      towerInspector.hidden = true;
      selectedPill.hidden = false;
      break;
    case "reopen-inspector":
      inspectorSuppressed = false;
      towerInspector.hidden = false;
      selectedPill.hidden = true;
      break;
    case "upgrade":
      game.upgradeSelected();
      break;
    case "target":
      if (value) game.setSelectedTargeting(value as TargetingMode);
      break;
    case "select":
      if (value) game.selectKind(value as TowerKind);
      break;
  }
};

app.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const actionable = target.closest<HTMLElement>("[data-action], [data-kind]");
  if (!actionable) return;
  const kind = actionable.dataset["kind"];
  const targeting = actionable.dataset["targeting"];
  const value = targeting ?? kind ?? actionable.dataset["map"] ?? actionable.dataset["towerKind"];
  runAction(actionable.dataset["action"] ?? (kind ? "select" : ""), value, actionable);
});

app.addEventListener("input", (event) => {
  const field = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const enemyField = field.dataset["enemyField"];
  const summonKind = field.dataset["summonKind"];
  if (enemyDraft && (enemyField || summonKind)) {
    if (summonKind && field instanceof HTMLInputElement) {
      if (isKnownEnemyKind(summonKind)) {
        enemyDraft.summonKinds = field.checked
          ? [...new Set([...enemyDraft.summonKinds, summonKind])]
          : enemyDraft.summonKinds.filter((kind) => kind !== summonKind);
      }
      return;
    }

    const number = Number(field.value);
    if (enemyField === "name") enemyDraft.name = field.value.slice(0, 40);
    else if (enemyField === "color") enemyDraft.color = field.value;
    else if (enemyField === "sides") enemyDraft.sides = Math.max(3, Math.min(12, Math.round(number || 3)));
    else if (enemyField === "hp") enemyDraft.hp = Math.max(1, Math.min(10_000_000, Math.round(number || 1)));
    else if (enemyField === "speed") enemyDraft.speed = Math.max(1, Math.min(500, number || 1));
    else if (enemyField === "damage") enemyDraft.damage = Math.max(0, Math.min(1_000_000, Math.round(number || 0)));
    else if (enemyField === "attackInterval") enemyDraft.attackInterval = Math.max(0.1, Math.min(120, number || 0.1));
    else if (enemyField === "telegraphDuration") enemyDraft.telegraphDuration = Math.max(0.05, Math.min(30, number || 0.05));
    else if (enemyField === "coreDamage") enemyDraft.coreDamage = Math.max(0, Math.min(9999, Math.round(number || 0)));
    else if (enemyField === "radius") enemyDraft.radius = Math.max(6, Math.min(60, number || 6));
    else if (enemyField === "hidden" && field instanceof HTMLInputElement) enemyDraft.hidden = field.checked;
    else if (enemyField === "boss" && field instanceof HTMLInputElement) enemyDraft.boss = field.checked;
    else if (enemyField === "summoningEnabled" && field instanceof HTMLInputElement) enemyDraft.summoningEnabled = field.checked;
    else if (enemyField === "stunningEnabled" && field instanceof HTMLInputElement) enemyDraft.stunningEnabled = field.checked;
    else if (enemyField === "summonInterval") enemyDraft.summonInterval = Math.max(0.2, Math.min(600, number || 0.2));
    else if (enemyField === "summonCount") enemyDraft.summonCount = Math.max(1, Math.min(100, Math.round(number || 1)));
    else if (enemyField === "stunInterval") enemyDraft.stunInterval = Math.max(0.2, Math.min(600, number || 0.2));
    else if (enemyField === "stunRadius") enemyDraft.stunRadius = Math.max(20, Math.min(1000, number || 20));
    else if (enemyField === "stunDuration") enemyDraft.stunDuration = Math.max(0.1, Math.min(60, number || 0.1));

    if (enemyField === "summoningEnabled" || enemyField === "stunningEnabled") {
      renderEnemyCreator();
      return;
    }
    query<HTMLElement>("#enemy-sides-value").textContent = enemyDraft.sides.toString();
    const preview = query<HTMLElement>("#enemy-shape-preview");
    preview.style.clipPath = polygonClipPath(enemyDraft.sides);
    preview.style.background = enemyDraft.color;
    query<HTMLElement>("#enemy-glyph-preview").textContent = enemyDraft.name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "CE";
    query<HTMLElement>("#enemy-name-preview").textContent = enemyDraft.name.toUpperCase() || "CUSTOM ENEMY";
    query<HTMLElement>("#enemy-preview-stats").textContent = `${enemyDraft.hp.toLocaleString()} HP // ${enemyDraft.speed} SPEED // ${enemyDraft.damage} DMG`;
    return;
  }

  if (!creatorDraft) return;
  const modeField = field.dataset["modeField"];
  if (modeField === "name") creatorDraft.name = field.value;
  else if (modeField === "description") creatorDraft.description = field.value;
  else if (modeField === "startingCash") creatorDraft.startingCash = Math.max(0, Math.round(Number(field.value) || 0));
  else if (modeField === "coreIntegrity") creatorDraft.coreIntegrity = Math.max(1, Math.round(Number(field.value) || 1));

  const wave = creatorDraft.waves[creatorWaveIndex];
  if (!wave) return;
  if (field.dataset["waveField"] === "cashReward") wave.cashReward = Math.max(0, Math.round(Number(field.value) || 0));
  const blockIndex = Number(field.dataset["blockIndex"]);
  const block = wave.blocks[blockIndex];
  const blockField = field.dataset["blockField"];
  if (!block || !blockField) return;
  if (blockField === "enemy") {
    const selectedKind = field.value;
    if (isKnownEnemyKind(selectedKind)) block.enemy = selectedKind;
  }
  else if (blockField === "count") block.count = Math.max(1, Math.round(Number(field.value) || 1));
  else if (blockField === "spawnDelay") block.spawnDelay = Math.max(0.02, Number(field.value) || 0.02);
  else if (blockField === "nextBlockDelay") block.nextBlockDelay = Math.max(0, Number(field.value) || 0);
});

app.addEventListener("change", (event) => {
  const field = event.target as HTMLInputElement | HTMLSelectElement;
  const enemyId = field.dataset["enemySelect"];
  if (field instanceof HTMLInputElement && enemyId) {
    if (field.checked) selectedEnemyIds.add(enemyId);
    else selectedEnemyIds.delete(enemyId);
    updateSelectedEnemyCount();
    return;
  }
  if (creatorDraft && field.dataset["blockField"] === "nextBlockDelay") renderCreator();
});

query<HTMLInputElement>("#save-import-input").addEventListener("change", async (event) => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text()) as Partial<SaveBundle>;
    if (!parsed || typeof parsed !== "object" || !("meta" in parsed) || !Array.isArray(parsed.customModes)) {
      throw new Error("This is not a Monochromium save bundle.");
    }
    progress = sanitizeProgress(parsed.meta);
    customEnemies = sanitizeCustomEnemies(parsed.customEnemies);
    setCustomEnemyRegistry(customEnemies);
    customModes = sanitizeCustomModes(parsed.customModes);
    cacheProgressLocally(progress);
    cacheCustomEnemiesLocally(customEnemies);
    cacheCustomModesLocally(customModes);
    const written = await replaceDiskSave(currentSaveBundle());
    game.setAvailableTowers(progress.unlockedTowers);
    selectedMode = NORMAL_MODE;
    renderMeta();
    renderModeList();
    setSaveStatus(
      written ? "Backup imported into the disk save." : "Backup imported into browser fallback storage.",
      written ? "good" : "danger",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid save file.";
    setSaveStatus(`Import failed // ${message}`, "danger");
  }
});

query<HTMLInputElement>("#enemy-import-input").addEventListener("change", async (event) => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) await importEnemiesFromFile(file);
});

query<HTMLInputElement>("#mode-import-input").addEventListener("change", async (event) => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) await importModeFromFile(file);
});

window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === "Tab") {
    event.preventDefault();
    toggleBattleLog();
  } else if (event.key === "F1") {
    event.preventDefault();
    debugPanel.hidden = !debugPanel.hidden;
  } else if (event.code === "Space") {
    event.preventDefault();
    game.counterSelected();
  } else if (event.key.toLowerCase() === "q") {
    event.preventDefault();
    game.activateSelectedAbility();
  } else if (event.key.toLowerCase() === "p") game.togglePause();
  else if (event.key === "Escape") {
    game.cancelPlacement();
    debugPanel.hidden = true;
    if (!towerInspector.hidden) {
      inspectorSuppressed = true;
      towerInspector.hidden = true;
      selectedPill.hidden = false;
    }
  }
  else if (["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].includes(event.key)) {
    const kind = TOWER_ORDER[event.key === "0" ? 9 : Number(event.key) - 1];
    if (kind) game.selectKind(kind);
  }
});

window.setInterval(() => {
  query<HTMLElement>("#clock").textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}, 1000);

window.addEventListener("beforeunload", () => {
  stopUpdateStateSubscription?.();
  game.destroy();
});
