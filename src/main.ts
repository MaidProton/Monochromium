import "./style.css";
import {
  COMBAT_RULES,
  DEFAULT_MAP_SCALE,
  ECONOMY_RULES,
  MAP_DEFINITIONS,
  MAP_SCALE_MAX,
  MAP_SCALE_MIN,
  NORMAL_MODE,
  TOWER_DEFINITIONS,
  TOWER_ORDER,
  WORLD_WIDTH,
  WORLD_HEIGHT,
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
  saveCustomModes,
  sanitizeCustomModes,
  upsertCustomMode,
  type CustomModeDraft,
} from "./game/customModes.ts";
import {
  MAP_THEME_PRESETS,
  cacheCustomMapsLocally,
  cloneCustomMap,
  createBlockedZone,
  createCustomMap,
  customMapToDefinition,
  deleteCustomMap,
  loadCustomMaps,
  saveCustomMaps,
  sanitizeCustomMaps,
  snapMapCoordinate,
  terminalPoint,
  terminalPosition,
  upsertCustomMap,
  validateCustomMap,
  type CustomMapDraft,
  type MapEdge,
} from "./game/customMaps.ts";
import { getAllEnemyDefinitions, getOfficialEnemyDefinitions, isKnownEnemyKind, setCustomEnemyRegistry } from "./game/enemyRegistry.ts";
import {
  createMapPathShape,
  drawBlockedZone,
  drawMapBackdrop,
  drawMapCore,
  drawMapField,
  drawMapPath,
  mapWorldBounds,
  normalizedMapScale,
  scaleMapDefinition,
  scaleMapPoint,
} from "./game/mapRendering.ts";
import { clamp, distance, Polyline } from "./game/math.ts";
import { cacheProgressLocally, loadProgress, sanitizeProgress, saveProgress, toggleTowerLoadout, unlockEveryTower, unlockTower } from "./game/meta.ts";
import { getDesktopEnvironment, hasDiskSaveApi, loadDiskSave, replaceDiskSave, type SaveBundle } from "./game/persistence.ts";
import {
  assignCreatorAssets,
  assignmentFor,
  cacheCreatorFoldersLocally,
  createCreatorFolder,
  deleteCreatorFolder,
  foldersFor,
  loadCreatorFolders,
  renameCreatorFolder,
  sanitizeCreatorFolders,
  saveCreatorFolders,
  type CreatorFolderKind,
  type CreatorFolderState,
} from "./game/creatorFolders.ts";
import type { BlockedZone, MapDefinition, MapKind, ModeDefinition, Point, TargetingMode, TowerDefinition, TowerKind } from "./game/types.ts";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app root");

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="#" aria-label="Monochromium home">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span><strong>MONOCHROMIUM</strong><small id="brand-map-label">COMMAND // PATHBOUND DEFENSE</small></span>
      </a>
      <div class="stage-topline">
        <span id="mode-label">MODE 01 // NORMAL</span>
        <span id="threat-label">THREAT: DORMANT</span>
      </div>
      <div class="top-stats" aria-label="Game status">
        <div class="stat core-stat">
          <span class="stat-label">CORE INTEGRITY</span>
          <div class="integrity-track"><i id="integrity-fill"></i></div>
          <strong id="integrity-value">12 / 12</strong>
        </div>
        <div class="stat cash-stat">
          <span class="stat-label">CREDITS</span>
          <strong id="shard-value">500</strong>
          <small id="pending-refund" hidden>+$0 NEXT WAVE</small>
        </div>
        <div class="stat">
          <span class="stat-label">WAVE INDEX</span>
          <strong id="wave-value">00</strong>
        </div>
      </div>
      <div class="utility-controls">
        <button class="icon-button" data-action="debug" aria-label="Open debug tools" title="Debug tools (F1)">
          <span>DBG</span>
        </button>
        <button class="icon-button" data-action="main-menu" aria-label="Return to main menu" title="Main menu">
          <span>MENU</span>
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

    <div class="playfield-layout">
    <main class="game-stage" aria-label="Battlefield">
      <canvas id="game-canvas" aria-label="Monochromium game battlefield"></canvas>
      <div class="scanline" aria-hidden="true"></div>
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
          <button data-action="debug-balance" id="debug-balance-button" hidden><span>TOWER BALANCE LAB</span><b>LIVE + SAVE TO CONFIG</b></button>
        </div>
      </aside>

      <section class="balance-lab" id="balance-lab" hidden>
        <div class="balance-lab-head"><div><span>TOWER BALANCE LAB</span><small>DEVELOPMENT ONLY // CHANGES APPLY LIVE</small></div><button data-action="debug-balance-close" aria-label="Close tower balance lab">×</button></div>
        <label class="balance-tower-select"><span>TOWER</span><select id="balance-tower-kind">${TOWER_ORDER.map((kind) => `<option value="${kind}">${TOWER_DEFINITIONS[kind].name.toUpperCase()}</option>`).join("")}</select></label>
        <p class="balance-lab-note">Edit numeric combat, deployment, level, upgrade, and ability values. Input changes apply to the current dev run immediately. SAVE TO CONFIG writes them into <code>src/game/config.ts</code>.</p>
        <div class="balance-fields" id="balance-fields"></div>
        <div class="balance-lab-actions"><button class="secondary-button" data-action="debug-balance-reset">RESET FORM</button><button class="primary-button" data-action="debug-balance-save">SAVE TO CONFIG</button></div>
        <small class="balance-lab-status" id="balance-lab-status"></small>
      </section>

      <div class="menu-screen main-menu" id="main-menu">
        <div class="onboarding-kicker">MONOCHROMIUM // COMMAND</div>
        <h1>Monochromium<br><em>Tower Defense</em></h1>
        <p>In this world, it's to boop or to be booped <span class="boop-smile">=)</span></p>
        <div class="meta-wallet" aria-label="Persistent currencies">
          <div><span>COINS</span><strong id="meta-coins">0</strong></div>
          <div><span>TOKENS</span><strong id="meta-tokens">0</strong></div>
        </div>
        <div class="menu-actions">
          <button class="primary-button wide" data-action="open-modes">PLAY MODES <span>→</span></button>
          <button class="secondary-button wide" data-action="open-creators">CREATORS</button>
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
        <div class="update-actions"><button class="secondary-button" data-action="check-update" id="check-update-button">CHECK</button><button class="secondary-button" data-action="download-update" id="download-update-button" hidden>DOWNLOAD UPDATE</button><button class="primary-button" data-action="install-update" id="install-update-button" hidden>RESTART &amp; INSTALL</button></div>
      </section>
      </div>

      <div class="menu-screen creator-hub" id="creator-hub" hidden>
        <div class="onboarding-kicker">LOCAL DESIGN SYSTEM</div>
        <h2>CREATOR<br>HUB</h2>
        <p>Build and share the hostiles, timelines, and battlefields used by your simulations.</p>
        <div class="creator-hub-grid">
          <button data-action="creator-hub-modes">
            <span>01 // TIMELINES</span><strong>MODE CREATOR</strong><p>Build finite wave schedules with official or custom enemies.</p><small><b id="creator-mode-count">0</b> SAVED MODES</small>
          </button>
          <button data-action="creator-hub-enemies">
            <span>02 // HOSTILES</span><strong>ENEMY CREATOR</strong><p>Design enemy stats, geometry, shields, and special abilities.</p><small><b id="creator-enemy-count">0</b> SAVED ENEMIES</small>
          </button>
          <button data-action="creator-hub-maps">
            <span>03 // BATTLEFIELDS</span><strong>MAP CREATOR</strong><p>Draw routes, themes, terminals, and restricted build zones.</p><small><b id="creator-map-count">0</b> SAVED MAPS</small>
          </button>
        </div>
        <button class="secondary-button" data-action="back-main">BACK TO COMMAND</button>
      </div>

      <div class="menu-screen enemy-selection" id="enemy-selection" hidden>
        <div class="mode-browser-heading">
          <div><div class="onboarding-kicker">HOSTILE DATABASE</div><h2>ENEMY LIST</h2></div>
          <div class="creator-actions">
            <input id="enemy-import-input" type="file" accept="application/json,.json" hidden>
            <button class="secondary-button" data-action="import-enemies">IMPORT ENEMIES</button>
            <button class="secondary-button" data-action="export-selected-enemies" id="export-selected-enemies" disabled>EXPORT SELECTED <span id="selected-enemy-count">0</span></button>
            <button class="primary-button" data-action="new-enemy">CREATE ENEMY <span>+</span></button>
          </div>
        </div>
        <div class="creator-folder-bar" data-folder-kind="enemies">
          <div class="creator-folder-bar-head"><div><span>ORGANIZATION // ENEMY FOLDERS</span><small id="enemy-folder-summary">ALL CREATED ENEMIES</small></div><div class="creator-folder-actions"><button data-action="folder-create" data-folder-kind="enemies">NEW FOLDER</button><button data-action="folder-rename" data-folder-kind="enemies" disabled>RENAME</button><button class="danger" data-action="folder-delete" data-folder-kind="enemies" disabled>DELETE</button></div></div>
          <form class="creator-folder-editor" data-folder-kind="enemies" hidden><label><span data-folder-editor-label>NEW FOLDER NAME</span><input data-folder-name maxlength="40" autocomplete="off" placeholder="e.g. NORMAL MODE ENEMIES"></label><div><button class="primary-button" type="submit" data-folder-editor-submit>CREATE FOLDER</button><button type="button" data-action="folder-editor-cancel" data-folder-kind="enemies">CANCEL</button></div></form>
          <div class="creator-folder-list" id="enemy-folder-list"></div>
          <div class="creator-folder-tools"><small>Select cards below, then organize them into the open folder.</small><div><button data-action="folder-select-all" data-folder-kind="enemies">SELECT ALL IN VIEW</button><button data-action="folder-move-selected" data-folder-kind="enemies" disabled>MOVE SELECTED HERE</button></div></div>
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
        <button class="secondary-button" data-action="library-back">BACK</button>
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
              <label><span>SHIELD HP</span><input data-enemy-field="shieldHp" type="number" min="0" step="1"></label>
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
            <button class="secondary-button" data-action="import-mode">IMPORT MODES</button>
            <button class="secondary-button" data-action="export-selected-modes" id="export-selected-modes" disabled>EXPORT SELECTED <span id="selected-mode-count">0</span></button>
            <button class="primary-button" data-action="new-mode">CREATE MODE <span>+</span></button>
          </div>
        </div>
        <div class="creator-folder-bar" data-folder-kind="modes">
          <div class="creator-folder-bar-head"><div><span>ORGANIZATION // MODE FOLDERS</span><small id="mode-folder-summary">ALL CREATED MODES</small></div><div class="creator-folder-actions"><button data-action="folder-create" data-folder-kind="modes">NEW FOLDER</button><button data-action="folder-rename" data-folder-kind="modes" disabled>RENAME</button><button class="danger" data-action="folder-delete" data-folder-kind="modes" disabled>DELETE</button></div></div>
          <form class="creator-folder-editor" data-folder-kind="modes" hidden><label><span data-folder-editor-label>NEW FOLDER NAME</span><input data-folder-name maxlength="40" autocomplete="off" placeholder="e.g. CHALLENGE MODES"></label><div><button class="primary-button" type="submit" data-folder-editor-submit>CREATE FOLDER</button><button type="button" data-action="folder-editor-cancel" data-folder-kind="modes">CANCEL</button></div></form>
          <div class="creator-folder-list" id="mode-folder-list"></div>
          <div class="creator-folder-tools"><small>Select cards below, then organize them into the open folder.</small><div><button data-action="folder-select-all" data-folder-kind="modes">SELECT ALL IN VIEW</button><button data-action="folder-move-selected" data-folder-kind="modes" disabled>MOVE SELECTED HERE</button></div></div>
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
        <button class="secondary-button" data-action="library-back">BACK</button>
      </div>

      <div class="menu-screen map-selection" id="map-selection" hidden>
        <div class="onboarding-kicker">BATTLEFIELD SELECT</div>
        <h2>CHOOSE<br>A ROUTE</h2>
        <p id="selected-mode-copy">Normal Mode // 25 finite waves.</p>
        <div class="map-grid" id="play-map-grid"></div>
        <div class="menu-actions horizontal">
          <button class="secondary-button" data-action="back-modes">BACK</button>
          <button class="primary-button wide" id="start-mode-button" data-action="start-map" data-testid="begin-button">START NORMAL <span>→</span></button>
        </div>
      </div>

      <div class="menu-screen map-library-screen" id="map-library" hidden>
        <div class="mode-browser-heading">
          <div><div class="onboarding-kicker">BATTLEFIELD DATABASE</div><h2>MAP LIST</h2></div>
          <div class="creator-actions">
            <input id="map-import-input" type="file" accept="application/json,.json" hidden>
            <button class="secondary-button" data-action="import-map">IMPORT MAPS</button>
            <button class="secondary-button" data-action="export-selected-maps" id="export-selected-maps" disabled>EXPORT SELECTED <span id="selected-map-count">0</span></button>
            <button class="primary-button" data-action="new-map">CREATE MAP <span>+</span></button>
          </div>
        </div>
        <div class="creator-folder-bar" data-folder-kind="maps">
          <div class="creator-folder-bar-head"><div><span>ORGANIZATION // MAP FOLDERS</span><small id="map-folder-summary">ALL CREATED MAPS</small></div><div class="creator-folder-actions"><button data-action="folder-create" data-folder-kind="maps">NEW FOLDER</button><button data-action="folder-rename" data-folder-kind="maps" disabled>RENAME</button><button class="danger" data-action="folder-delete" data-folder-kind="maps" disabled>DELETE</button></div></div>
          <form class="creator-folder-editor" data-folder-kind="maps" hidden><label><span data-folder-editor-label>NEW FOLDER NAME</span><input data-folder-name maxlength="40" autocomplete="off" placeholder="e.g. HARD MAPS"></label><div><button class="primary-button" type="submit" data-folder-editor-submit>CREATE FOLDER</button><button type="button" data-action="folder-editor-cancel" data-folder-kind="maps">CANCEL</button></div></form>
          <div class="creator-folder-list" id="map-folder-list"></div>
          <div class="creator-folder-tools"><small>Select cards below, then organize them into the open folder.</small><div><button data-action="folder-select-all" data-folder-kind="maps">SELECT ALL IN VIEW</button><button data-action="folder-move-selected" data-folder-kind="maps" disabled>MOVE SELECTED HERE</button></div></div>
        </div>
        <div class="map-library-grid">
          <section>
            <div class="library-label"><span>OFFICIAL MAPS</span><small>READ ONLY</small></div>
            <div class="map-list" id="official-map-list"></div>
          </section>
          <section>
            <div class="library-label"><span>CREATED MAPS</span><small>LOCAL // SANDBOX</small></div>
            <div class="map-list" id="custom-map-list"></div>
          </section>
        </div>
        <button class="secondary-button" data-action="library-back">BACK</button>
      </div>

      <div class="menu-screen map-creator" id="map-creator" hidden>
        <div class="creator-topbar map-creator-topbar">
          <div><div class="onboarding-kicker">SANDBOX ROUTE EDITOR</div><h2>MAP CREATOR</h2></div>
          <div class="creator-actions">
            <button class="secondary-button" data-action="map-editor-back">CANCEL</button>
            <button class="secondary-button" id="map-test-button" data-action="map-test">TEST MAP</button>
            <button class="primary-button" id="map-save-button" data-action="map-save">SAVE MAP</button>
          </div>
        </div>
        <div class="map-editor-shell">
          <section class="map-editor-settings">
            <label><span>MAP NAME</span><input data-map-field="name" maxlength="48"></label>
            <label class="wide"><span>DESCRIPTION</span><textarea data-map-field="description" maxlength="220" rows="2"></textarea></label>
            <label><span>DIFFICULTY</span><select data-map-field="difficulty"><option>Easy</option><option>Medium</option><option>Hard</option></select></label>
            <label><span>ENTRY EDGE</span><select data-map-field="entryEdge"><option value="left">LEFT</option><option value="right">RIGHT</option><option value="top">TOP</option><option value="bottom">BOTTOM</option></select></label>
            <label><span>EXIT EDGE</span><select data-map-field="exitEdge"><option value="left">LEFT</option><option value="right">RIGHT</option><option value="top">TOP</option><option value="bottom">BOTTOM</option></select></label>
            <label><span>MAP SCALE</span><input data-map-field="mapScale" type="number" min="${MAP_SCALE_MIN}" max="${MAP_SCALE_MAX}" step="0.1" inputmode="decimal"></label>
          </section>
          <div class="map-editor-main">
            <div class="map-canvas-column">
              <div class="map-editor-toolbar">
                <div class="map-tool-group">
                  <button data-action="map-tool-select" class="active" id="map-select-tool">SELECT</button>
                  <button data-action="map-add-point">+ ROUTE POINT</button>
                  <button data-action="map-add-zone">+ BLOCK ZONE</button>
                  <button data-action="map-delete-selection" class="danger">DELETE</button>
                </div>
                <div class="map-tool-group">
                  <button data-action="map-undo" id="map-undo-button">UNDO</button>
                  <button data-action="map-redo" id="map-redo-button">REDO</button>
                  <button data-action="map-reset">RESET</button>
                </div>
              </div>
              <div class="map-editor-canvas-wrap"><canvas id="map-editor-canvas" width="1600" height="700" aria-label="Custom map route editor"></canvas></div>
              <div class="map-editor-status"><span id="map-editor-selection">SELECT A ROUTE POINT OR BLOCKED ZONE</span><b id="map-path-length">0 UNITS</b></div>
            </div>
            <aside class="map-editor-side">
              <section>
                <div class="library-label"><span>PALETTE</span><small>LIVE PREVIEW</small></div>
                <div class="map-theme-grid">
                  ${MAP_THEME_PRESETS.map((theme) => `<button data-action="map-theme" data-theme="${theme.id}" style="--theme-field:${theme.field};--theme-path:${theme.path};--theme-accent:${theme.accent}"><i></i><span>${theme.name.toUpperCase()}</span></button>`).join("")}
                </div>
                <div class="map-color-grid">
                  <label><span>FIELD</span><input data-map-field="field" type="color"></label>
                  <label><span>PATH</span><input data-map-field="path" type="color"></label>
                  <label><span>ACCENT</span><input data-map-field="accent" type="color"></label>
                </div>
              </section>
              <section class="map-help">
                <div class="library-label"><span>CONTROLS</span><small>20 UNIT GRID</small></div>
                <p>Drag route nodes and terminals. Double-click a route segment to insert a point. Drag zones to move them; drag the bright corner to resize.</p>
              </section>
              <section class="map-validation">
                <div class="library-label"><span>VALIDATION</span><small id="map-validation-state">CHECKING</small></div>
                <ul id="map-validation-errors"></ul>
              </section>
            </aside>
          </div>
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
        <p>Purchase towers permanently, then equip up to five for each battle. Your active loadout controls deployment and hotkeys.</p>
        <section class="loadout-panel" aria-label="Active tower loadout">
          <div class="loadout-heading"><div><span>ACTIVE LOADOUT</span><small>THESE TOWERS ENTER BATTLE</small></div><strong id="loadout-count">1 / 5</strong></div>
          <div class="loadout-slots" id="loadout-slots"></div>
          <small class="loadout-note" id="loadout-note">Equip towers from the armory below.</small>
        </section>
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
        <div class="menu-actions horizontal"><button class="secondary-button" id="game-over-exit" data-action="main-menu">MAIN MENU</button><button class="primary-button wide" id="game-over-restart" data-action="restart">TRY AGAIN <span>↻</span></button></div>
      </div>

      <div class="victory" id="victory" hidden>
        <div class="onboarding-kicker victory-tone">MODE 01 COMPLETE</div>
        <h2>NORMAL<br>SECURED</h2>
        <p id="victory-copy">All 25 waves were cleared.</p>
        <div class="menu-actions horizontal"><button class="secondary-button" id="victory-exit" data-action="main-menu">MAIN MENU</button><button class="primary-button wide" id="victory-restart" data-action="restart">RUN AGAIN <span>↻</span></button></div>
      </div>

      <button class="selected-pill" id="selected-pill" data-action="reopen-inspector" hidden>
        <span id="selected-pill-label">CONSTRUCT SELECTED</span>
        <b id="selected-pill-state">OPEN PANEL</b>
      </button>
    </main>

      <aside class="tower-inspector" id="tower-inspector" aria-label="Selected tower controls" hidden>
        <div class="inspector-header">
          <div><span>CONSTRUCT LINK</span><small>UPGRADE // TARGET // SYSTEMS</small></div>
          <button data-action="close-inspector" aria-label="Close tower inspector">×</button>
        </div>
        <section class="selection-panel" id="selection-panel"></section>
        <div class="combat-dock">
          <div class="action-module counter-module">
            <button class="combat-button counter-button" data-action="counter" data-testid="counter-button" disabled>
              <kbd>SPACE</kbd><span>COUNTER</span>
            </button>
            <div class="action-readout"><span>STATE</span><strong id="counter-status">NO LINK</strong></div>
            <div class="cooldown-track"><i id="counter-cooldown-fill"></i></div>
            <small id="counter-hint">Requires a pathbound construct</small>
          </div>
          <div class="action-module ability-module">
            <button class="combat-button ability-button" data-action="ability" data-testid="ability-button" disabled>
              <kbd>Q</kbd><span>ABILITY</span>
            </button>
            <div class="action-readout"><span>STATE</span><strong id="ability-status">NO LINK</strong></div>
            <div class="cooldown-track"><i id="ability-cooldown-fill"></i></div>
            <small id="ability-hint">No active ability unlocked</small>
          </div>
        </div>
      </aside>
    </div>

    <div class="bottom-hud">
      <div class="build-dock">
        <div class="dock-label"><span>LOADOUT</span><small>1—5</small></div>
        <div class="tower-list" id="tower-list"></div>
      </div>
      <div class="wave-controls">
        <span id="enemy-count">NO HOSTILES</span>
        <div class="wave-button automatic" id="wave-button" data-testid="wave-button">NEXT WAVE <b>3</b></div>
      </div>
    </div>

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
const shell = query<HTMLDivElement>(".shell");
const mainMenu = query<HTMLDivElement>("#main-menu");
const creatorHub = query<HTMLDivElement>("#creator-hub");
const enemySelection = query<HTMLDivElement>("#enemy-selection");
const enemyCreator = query<HTMLDivElement>("#enemy-creator");
const modeSelection = query<HTMLDivElement>("#mode-selection");
const mapSelection = query<HTMLDivElement>("#map-selection");
const mapLibrary = query<HTMLDivElement>("#map-library");
const mapCreator = query<HTMLDivElement>("#map-creator");
const mapEditorCanvas = query<HTMLCanvasElement>("#map-editor-canvas");
const modeCreator = query<HTMLDivElement>("#mode-creator");
const towerShop = query<HTMLDivElement>("#tower-shop");
const gameOverPanel = query<HTMLDivElement>("#game-over");
const victoryPanel = query<HTMLDivElement>("#victory");
const logs = query<HTMLDivElement>("#log-entries");
const battleLog = query<HTMLElement>("#battle-log");
const towerInspector = query<HTMLElement>("#tower-inspector");
const selectedPill = query<HTMLButtonElement>("#selected-pill");
const debugPanel = query<HTMLElement>("#debug-panel");
const debugBalanceButton = query<HTMLButtonElement>("#debug-balance-button");
const balanceLab = query<HTMLElement>("#balance-lab");
const balanceTowerKind = query<HTMLSelectElement>("#balance-tower-kind");
const balanceFields = query<HTMLDivElement>("#balance-fields");
const balanceLabStatus = query<HTMLElement>("#balance-lab-status");
const updatePanel = query<HTMLElement>("#update-panel");
const updateStatus = query<HTMLElement>("#update-status");
const checkUpdateButton = query<HTMLButtonElement>("#check-update-button");
const downloadUpdateButton = query<HTMLButtonElement>("#download-update-button");
const installUpdateButton = query<HTMLButtonElement>("#install-update-button");
let stopUpdateStateSubscription: (() => void) | null = null;
let developmentBuild = false;
let balanceKind: TowerKind = TOWER_ORDER[0] ?? "bandit";
let balanceDraft: TowerDefinition | null = null;
let selectionSignature = "";
let inspectorSuppressed = false;
let lastSelectedTowerId: number | null = null;
let battleLoadoutSignature = "";
const LOADOUT_VISUAL_ORDER = [3, 1, 0, 2, 4] as const;

const loadoutIndexForDisplaySlot = (displaySlot: number): number => LOADOUT_VISUAL_ORDER[displaySlot - 1] ?? -1;
let progress = loadProgress();
let selectedMap: MapDefinition = MAP_DEFINITIONS.sector07;
let activeMap: MapDefinition = MAP_DEFINITIONS.sector07;
let customEnemies = loadCustomEnemies();
setCustomEnemyRegistry(customEnemies);
let customModes = loadCustomModes();
let customMaps = loadCustomMaps();
let creatorFolders = loadCreatorFolders();
let selectedMode: ModeDefinition = NORMAL_MODE;
let activeMode: ModeDefinition = NORMAL_MODE;
let creatorDraft: CustomModeDraft | null = null;
let creatorWaveIndex = 0;
let enemyDraft: CustomEnemyDraft | null = null;
let mapDraft: CustomMapDraft | null = null;
let mapHistory: CustomMapDraft[] = [];
let mapFuture: CustomMapDraft[] = [];
let mapSelectionState: { type: "point"; index: number } | { type: "zone"; id: string } | null = null;
let mapDragState: { type: "point" | "zone" | "resize"; start: Point; original: CustomMapDraft } | null = null;
let libraryReturnScreen: "main" | "creators" = "main";
let mapTestActive = false;
const selectedEnemyIds = new Set<string>();
const selectedModeIds = new Set<string>();
const selectedMapIds = new Set<string>();
let activeModeFolderId: string | null = null;
let activeEnemyFolderId: string | null = null;
let activeMapFolderId: string | null = null;
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

const updateSelectedModeCount = (): void => {
  query<HTMLElement>("#selected-mode-count").textContent = selectedModeIds.size.toString();
  query<HTMLButtonElement>("#export-selected-modes").disabled = selectedModeIds.size === 0;
};

const updateSelectedMapCount = (): void => {
  query<HTMLElement>("#selected-map-count").textContent = selectedMapIds.size.toString();
  query<HTMLButtonElement>("#export-selected-maps").disabled = selectedMapIds.size === 0;
};

const exportEnemyBundle = (enemies: readonly CustomEnemyDraft[], filename: string): void => {
  downloadJson(filename, {
    type: "monochromium-custom-enemies",
    version: 1,
    enemies,
  });
  setSaveStatus(`${enemies.length} ${enemies.length === 1 ? "enemy" : "enemies"} exported.`, "good");
};

const exportModeBundle = (modes: readonly CustomModeDraft[], filename: string): void => {
  downloadJson(filename, {
    type: "monochromium-custom-modes",
    version: 1,
    modes,
  });
  setSaveStatus(`${modes.length} ${modes.length === 1 ? "mode" : "modes"} exported.`, "good");
};

const exportMapBundle = (maps: readonly CustomMapDraft[], filename: string): void => {
  downloadJson(filename, {
    type: "monochromium-custom-maps",
    version: 1,
    maps,
  });
  setSaveStatus(`${maps.length} ${maps.length === 1 ? "map" : "maps"} exported.`, "good");
};

const exportModeFile = (mode: CustomModeDraft): void => {
  downloadJson(`monochromium-mode-${safeFilename(mode.name)}.json`, {
    type: "monochromium-custom-mode",
    version: 1,
    mode,
  });
  setSaveStatus(`Mode "${mode.name}" exported.`, "good");
};

const exportMapFile = (map: CustomMapDraft): void => {
  downloadJson(`monochromium-map-${safeFilename(map.name)}.json`, {
    type: "monochromium-custom-map",
    version: 1,
    map,
  });
  setSaveStatus(`Map "${map.name}" exported.`, "good");
};

const getAllMapDefinitions = (): MapDefinition[] => [
  ...Object.values(MAP_DEFINITIONS),
  ...customMaps.map(customMapToDefinition),
];

const getMapDefinition = (kind: string): MapDefinition | null =>
  getAllMapDefinitions().find((map) => map.kind === kind) ?? null;

const renderUpdateState = (state: MonochromiumUpdateState): void => {
  updateStatus.textContent = state.message;
  updateStatus.dataset["status"] = state.status;
  checkUpdateButton.disabled = ["checking", "downloading"].includes(state.status);
  downloadUpdateButton.hidden = state.status !== "available";
  installUpdateButton.hidden = state.status !== "downloaded";
  if (state.status === "downloaded") updateStatus.classList.add("ready");
  else updateStatus.classList.remove("ready");
};

const cloneTowerDefinition = (kind: TowerKind): TowerDefinition =>
  JSON.parse(JSON.stringify(TOWER_DEFINITIONS[kind])) as TowerDefinition;

const balanceValueAtPath = (path: string): number => {
  let current: unknown = balanceDraft;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return 0;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : 0;
};

const setBalanceValueAtPath = (path: string, value: number): void => {
  if (!balanceDraft) return;
  const parts = path.split(".");
  let current = balanceDraft as unknown as Record<string, unknown>;
  parts.slice(0, -1).forEach((part) => {
    const next = current[part];
    if (!next || typeof next !== "object") return;
    current = next as Record<string, unknown>;
  });
  const finalPart = parts[parts.length - 1];
  if (finalPart) current[finalPart] = value;
};

const balanceFieldLabel = (path: string): string => path
  .replace(/^onPath\./, "PATH // ")
  .replace(/^levels\.(\d+)\./, (_match, level) => "LEVEL " + (Number(level) + 1) + " // ")
  .replace(/^upgrades\.(\d+)\./, (_match, level) => "UPGRADE " + (Number(level) + 1) + " // ")
  .replace(/^ability\./, "ABILITY // ")
  .replace(/([a-z])([A-Z])/g, "$1 $2")
  .replaceAll(".", " // ")
  .toUpperCase();

const balanceFieldStep = (path: string): string =>
  /fireRate|reload|hpMultiplier/.test(path) ? "0.01" : "1";

const renderBalanceLab = (): void => {
  if (!balanceDraft) balanceDraft = cloneTowerDefinition(balanceKind);
  balanceTowerKind.value = balanceKind;
  const paths: string[] = ["cost", "unlockCost", "copyLimit"];
  if (balanceDraft.hiddenDetectionLevel !== undefined) paths.push("hiddenDetectionLevel");
  paths.push("onPath.hp", "onPath.maxAggro");
  const levelKeys = [...new Set(balanceDraft.levels.flatMap((level) => Object.entries(level)
    .filter(([, value]) => typeof value === "number")
    .map(([key]) => key)))];
  balanceDraft.levels.forEach((_level, index) => levelKeys.forEach((key) => paths.push("levels." + index + "." + key)));
  balanceDraft.upgrades.forEach((_upgrade, index) => paths.push("upgrades." + index + ".cost"));
  if (balanceDraft.ability) {
    Object.entries(balanceDraft.ability)
      .filter(([, value]) => typeof value === "number")
      .forEach(([key]) => paths.push("ability." + key));
  }
  balanceFields.innerHTML = paths.map((path) => "<label class=\"balance-field\"><span>" + balanceFieldLabel(path) + "</span><input type=\"number\" min=\"0\" step=\"" + balanceFieldStep(path) + "\" data-balance-path=\"" + path + "\" value=\"" + balanceValueAtPath(path) + "\"></label>").join("");
};

const applyBalanceDraft = (): void => {
  if (!balanceDraft) return;
  const runtime = TOWER_DEFINITIONS[balanceKind] as unknown as Record<string, unknown>;
  const source = balanceDraft as unknown as Record<string, unknown>;
  Object.keys(source).forEach((key) => { runtime[key] = JSON.parse(JSON.stringify(source[key])); });
  game.applyDebugTowerBalance(balanceKind);
};

const openBalanceLab = (): void => {
  if (!developmentBuild) return;
  debugPanel.hidden = true;
  balanceDraft = cloneTowerDefinition(balanceKind);
  balanceLab.hidden = false;
  renderBalanceLab();
};

const saveBalanceToConfig = async (): Promise<void> => {
  if (!developmentBuild || !balanceDraft || !window.monochromiumDesktop) return;
  balanceLabStatus.textContent = "SAVING TO SRC/GAME/CONFIG.TS…";
  try {
    const result = await window.monochromiumDesktop.saveTowerBalance(balanceKind, balanceDraft);
    balanceLabStatus.textContent = result.ok ? "SAVED // CONFIG FILE UPDATED" : "SAVE FAILED";
  } catch (error) {
    balanceLabStatus.textContent = "SAVE FAILED // " + (error instanceof Error ? error.message : "UNKNOWN ERROR");
  }
};

const checkForUpdate = async (): Promise<void> => {
  if (!window.monochromiumDesktop) return;
  renderUpdateState(await window.monochromiumDesktop.checkForUpdate());
};

const downloadUpdate = async (): Promise<void> => {
  if (!window.monochromiumDesktop || !window.confirm("Download this update now? The game will not install it until you confirm again.")) return;
  renderUpdateState(await window.monochromiumDesktop.downloadUpdate());
};

const installUpdate = async (): Promise<void> => {
  if (!window.monochromiumDesktop || !window.confirm("Restart Monochromium and install the downloaded update?")) return;
  await window.monochromiumDesktop.installUpdate();
};

const hydrateUpdater = async (): Promise<void> => {
  if (!window.monochromiumDesktop) return;
  const environment = await getDesktopEnvironment();
  if (!environment?.packaged) return;
  updatePanel.hidden = false;
  renderUpdateState(await window.monochromiumDesktop.getUpdateState());
  stopUpdateStateSubscription = window.monochromiumDesktop.onUpdateState(renderUpdateState);
};

const hydrateDevelopmentTools = async (): Promise<void> => {
  const environment = await getDesktopEnvironment();
  developmentBuild = Boolean(environment && !environment.packaged);
  debugBalanceButton.hidden = !developmentBuild;
};

balanceTowerKind.addEventListener("change", () => {
  const nextKind = balanceTowerKind.value as TowerKind;
  if (!TOWER_ORDER.includes(nextKind)) return;
  balanceKind = nextKind;
  balanceDraft = cloneTowerDefinition(balanceKind);
  renderBalanceLab();
});

const currentSaveBundle = (): SaveBundle => ({
  version: 1,
  meta: progress,
  customModes,
  customEnemies,
  customMaps,
  creatorFolders,
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
  query<HTMLElement>("#loadout-count").textContent = `${progress.loadout.length} / 5`;
  query<HTMLElement>("#loadout-slots").innerHTML = Array.from({ length: 5 }, (_, index) => {
    const kind = progress.loadout[index];
    if (!kind) return `<div class="loadout-slot empty"><span>${index + 1}</span><small>EMPTY SLOT</small></div>`;
    const tower = TOWER_DEFINITIONS[kind];
    return `<div class="loadout-slot filled" style="--accent:${tower.accent};--dim:${tower.dimAccent}"><span class="loadout-slot-number">${index + 1}</span><b>${tower.glyph}</b><strong>${tower.name}</strong></div>`;
  }).join("");
  query<HTMLElement>("#loadout-note").textContent = progress.loadout.length >= 5
    ? "Loadout full // toggle an equipped tower below to make room."
    : `${5 - progress.loadout.length} loadout ${5 - progress.loadout.length === 1 ? "slot" : "slots"} available.`;
  TOWER_ORDER.forEach((kind) => {
    const card = query<HTMLButtonElement>(`[data-tower-kind='${kind}']`);
    const owned = progress.unlockedTowers.includes(kind);
    const equipped = progress.loadout.includes(kind);
    const cost = TOWER_DEFINITIONS[kind].unlockCost;
    card.classList.toggle("owned", owned);
    card.classList.toggle("equipped", equipped);
    card.classList.toggle("unaffordable", !owned && progress.coins < cost);
    card.disabled = !owned && progress.coins < cost;
    card.dataset["action"] = owned ? "toggle-loadout" : "buy-tower";
    card.title = !owned
      ? `Unlock ${TOWER_DEFINITIONS[kind].name} for ${cost.toLocaleString()} Coins`
      : equipped
        ? "Remove from active loadout"
        : progress.loadout.length >= 5
          ? "Loadout full // remove another tower first"
          : "Equip for the next battle";
    query<HTMLElement>(`#shop-price-${kind}`).textContent = owned ? equipped ? "EQUIPPED" : "EQUIP" : `${cost.toLocaleString()} COINS`;
  });
  query<HTMLElement>("#creator-mode-count").textContent = customModes.length.toString();
  query<HTMLElement>("#creator-enemy-count").textContent = customEnemies.length.toString();
  query<HTMLElement>("#creator-map-count").textContent = customMaps.length.toString();
};

const escapeHtml = (value: string): string => value.replace(/[&<>"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
})[character] ?? character);

type CreatorAsset = { readonly id: string };
const UNFILED_FOLDER_ID = "__unfiled__";

const isCreatorFolderKind = (value: string | undefined): value is CreatorFolderKind =>
  value === "modes" || value === "enemies" || value === "maps";

const activeFolderIdFor = (kind: CreatorFolderKind): string | null => {
  if (kind === "modes") return activeModeFolderId;
  if (kind === "enemies") return activeEnemyFolderId;
  return activeMapFolderId;
};

const setActiveFolderId = (kind: CreatorFolderKind, folderId: string | null): void => {
  if (kind === "modes") activeModeFolderId = folderId;
  else if (kind === "enemies") activeEnemyFolderId = folderId;
  else activeMapFolderId = folderId;
};

const selectedIdsFor = (kind: CreatorFolderKind): Set<string> => {
  if (kind === "modes") return selectedModeIds;
  if (kind === "enemies") return selectedEnemyIds;
  return selectedMapIds;
};

const folderAssets = (kind: CreatorFolderKind): readonly CreatorAsset[] => {
  if (kind === "modes") return customModes;
  if (kind === "enemies") return customEnemies;
  return customMaps;
};

const folderStem = (kind: CreatorFolderKind): string => kind === "modes" ? "mode" : kind === "enemies" ? "enemy" : "map";

const folderElementId = (kind: CreatorFolderKind): string => `${folderStem(kind)}-folder-list`;

const folderTitle = (kind: CreatorFolderKind): string => kind === "modes" ? "MODES" : kind === "enemies" ? "ENEMIES" : "MAPS";

const folderAssetCount = (kind: CreatorFolderKind, folderId: string | null): number => {
  const assets = folderAssets(kind);
  if (!folderId) return assets.length;
  if (folderId === UNFILED_FOLDER_ID) return assets.filter((asset) => assignmentFor(creatorFolders, kind, asset.id) === null).length;
  return assets.filter((asset) => assignmentFor(creatorFolders, kind, asset.id) === folderId).length;
};

const assetMatchesFolder = (kind: CreatorFolderKind, assetId: string, folderId: string | null): boolean => {
  if (folderId === null) return true;
  const assignment = assignmentFor(creatorFolders, kind, assetId);
  return folderId === UNFILED_FOLDER_ID ? assignment === null : assignment === folderId;
};

const renderCreatorFolderBar = (kind: CreatorFolderKind): void => {
  const list = query<HTMLElement>(`#${folderElementId(kind)}`);
  let activeFolderId = activeFolderIdFor(kind);
  const folders = foldersFor(creatorFolders, kind);
  const assets = folderAssets(kind);
  const selected = selectedIdsFor(kind);
  const activeFolder = folders.find((folder) => folder.id === activeFolderId) ?? null;
  const unfiledActive = activeFolderId === UNFILED_FOLDER_ID;
  if (activeFolderId && !unfiledActive && !activeFolder) {
    setActiveFolderId(kind, null);
    activeFolderId = null;
  }
  list.innerHTML = [
    `<button class="creator-folder-tab system${activeFolderId === null ? " active" : ""}" data-action="folder-select" data-folder-kind="${kind}" data-folder-id=""><span>ALL ${folderTitle(kind)}</span><small>${assets.length}</small></button>`,
    `<button class="creator-folder-tab system${unfiledActive ? " active" : ""}" data-action="folder-select" data-folder-kind="${kind}" data-folder-id="${UNFILED_FOLDER_ID}"><span>UNFILED</span><small>${folderAssetCount(kind, UNFILED_FOLDER_ID)}</small></button>`,
    ...folders.map((folder) => `<button class="creator-folder-tab${folder.id === activeFolderId ? " active" : ""}" data-action="folder-select" data-folder-kind="${kind}" data-folder-id="${escapeHtml(folder.id)}"><span>${escapeHtml(folder.name)}</span><small>${folderAssetCount(kind, folder.id)}</small></button>`),
  ].join("");
  const bar = list.closest<HTMLElement>(".creator-folder-bar");
  if (!bar) return;
  query<HTMLElement>(`#${folderStem(kind)}-folder-summary`).textContent = activeFolder
    ? `${activeFolder.name} // ${folderAssetCount(kind, activeFolder.id)} CHILDREN`
    : unfiledActive
      ? `UNFILED // ${folderAssetCount(kind, UNFILED_FOLDER_ID)} ITEMS`
      : `ALL CREATED ${folderTitle(kind)}`;
  const rename = bar.querySelector<HTMLButtonElement>("[data-action='folder-rename']");
  const remove = bar.querySelector<HTMLButtonElement>("[data-action='folder-delete']");
  const move = bar.querySelector<HTMLButtonElement>("[data-action='folder-move-selected']");
  if (rename) rename.disabled = !activeFolder;
  if (remove) remove.disabled = !activeFolder;
  if (move) {
    move.disabled = activeFolderId === null || selected.size === 0;
    move.textContent = unfiledActive ? "MOVE TO UNFILED" : "MOVE SELECTED HERE";
  }
};

const persistCreatorFolderState = (next: CreatorFolderState): void => {
  creatorFolders = sanitizeCreatorFolders(next);
  saveCreatorFolders(creatorFolders);
};

const closeFolderEditor = (kind: CreatorFolderKind): void => {
  const form = query<HTMLFormElement>(`.creator-folder-editor[data-folder-kind='${kind}']`);
  form.hidden = true;
  form.classList.remove("invalid");
  form.dataset["folderEditorMode"] = "";
  form.dataset["folderId"] = "";
  query<HTMLElement>(`.creator-folder-bar[data-folder-kind='${kind}']`).classList.remove("editing");
};

const openFolderEditor = (kind: CreatorFolderKind, mode: "create" | "rename"): void => {
  const form = query<HTMLFormElement>(`.creator-folder-editor[data-folder-kind='${kind}']`);
  const input = form.querySelector<HTMLInputElement>("[data-folder-name]");
  const label = form.querySelector<HTMLElement>("[data-folder-editor-label]");
  const submit = form.querySelector<HTMLButtonElement>("[data-folder-editor-submit]");
  if (!input || !label || !submit) return;
  const folderId = mode === "rename" ? activeFolderIdFor(kind) : null;
  const folder = folderId ? foldersFor(creatorFolders, kind).find((candidate) => candidate.id === folderId) : null;
  if (mode === "rename" && !folder) return;
  form.hidden = false;
  form.classList.remove("invalid");
  form.dataset["folderEditorMode"] = mode;
  form.dataset["folderId"] = folder?.id ?? "";
  label.textContent = mode === "rename" ? "RENAME FOLDER" : "NEW FOLDER NAME";
  submit.textContent = mode === "rename" ? "SAVE NAME" : "CREATE FOLDER";
  input.value = folder?.name ?? "";
  query<HTMLElement>(`.creator-folder-bar[data-folder-kind='${kind}']`).classList.add("editing");
  window.requestAnimationFrame(() => {
    input.focus();
    if (mode === "rename") input.select();
  });
};

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

const enemyStatLine = (enemy: { hp: number; shieldHp: number; speed: number; damage: number }): string => {
  const shield = enemy.shieldHp > 0 ? ` // ${enemy.shieldHp.toLocaleString()} SHIELD` : "";
  return `${enemy.hp.toLocaleString()} HP${shield} · ${enemy.speed} SPEED · ${enemy.damage} DMG`;
};

const renderEnemyList = (): void => {
  renderCreatorFolderBar("enemies");
  query<HTMLElement>("#official-enemy-list").innerHTML = getOfficialEnemyDefinitions().map((enemy) => {
    const sides = enemy.sprite.shape === "circle" ? 12 : enemy.sprite.shape === "hexagon" ? 6 : 4;
    const specials = [enemy.hidden ? "HIDDEN" : "", enemy.summon ? "SUMMONER" : "", enemy.shockwave ? "STUN" : "", enemy.boss ? "BOSS" : ""].filter(Boolean).join(" // ");
    return `<article class="enemy-library-card official">${enemyShapeCard(enemy.name, enemy.sprite.fill.startsWith("#") ? enemy.sprite.fill : enemy.sprite.accent, sides)}<div><small>OFFICIAL // READ ONLY</small><strong>${escapeHtml(enemy.name)}</strong><p>${enemyStatLine(enemy)}</p>${specials ? `<b>${specials}</b>` : ""}</div></article>`;
  }).join("");
  const list = query<HTMLElement>("#custom-enemy-list");
  const visibleEnemies = customEnemies.filter((enemy) => assetMatchesFolder("enemies", enemy.id, activeEnemyFolderId));
  if (visibleEnemies.length === 0) {
    list.innerHTML = `<div class="empty-mode-list"><strong>${customEnemies.length === 0 ? "NO CREATED ENEMIES" : "FOLDER IS EMPTY"}</strong><span>${customEnemies.length === 0 ? "Create a polygon hostile for custom modes." : "Select another folder or move an enemy here."}</span></div>`;
    updateSelectedEnemyCount();
    return;
  }
  list.innerHTML = visibleEnemies.map((enemy) => {
    const specials = [enemy.hidden ? "HIDDEN" : "", enemy.summoningEnabled ? "SUMMONER" : "", enemy.stunningEnabled ? "STUN" : "", enemy.boss ? "BOSS" : ""].filter(Boolean).join(" // ");
    return `<article class="enemy-library-card">${enemyShapeCard(enemy.name, enemy.color, enemy.sides)}<div><small>CREATED // ${enemy.sides} SIDES</small><strong>${escapeHtml(enemy.name)}</strong><p>${enemyStatLine(enemy)}</p>${specials ? `<b>${specials}</b>` : ""}</div><div class="enemy-card-actions"><label class="enemy-select"><input type="checkbox" data-enemy-select="${escapeHtml(enemy.id)}" ${selectedEnemyIds.has(enemy.id) ? "checked" : ""}><span>SELECT</span></label><button data-action="export-enemy" data-enemy-id="${escapeHtml(enemy.id)}">EXPORT</button><button data-action="edit-enemy" data-enemy-id="${escapeHtml(enemy.id)}">EDIT</button><button class="danger" data-action="delete-enemy" data-enemy-id="${escapeHtml(enemy.id)}">DELETE</button></div></article>`;
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
  field("shieldHp").value = enemyDraft.shieldHp.toString();
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
  query<HTMLElement>("#enemy-preview-stats").textContent = enemyStatLine(enemyDraft).replaceAll(" · ", " // ");
  query<HTMLElement>("#summon-enemy-options").innerHTML = getAllEnemyDefinitions()
    .filter((enemy) => enemy.kind !== enemyDraft!.id)
    .map((enemy) => `<label><input type="checkbox" data-summon-kind="${escapeHtml(enemy.kind)}" ${enemyDraft!.summonKinds.includes(enemy.kind) ? "checked" : ""}><span>${escapeHtml(enemy.name)}</span><small>${enemy.kind.startsWith("custom-enemy:") ? "CREATED" : "OFFICIAL"} // ${enemyStatLine(enemy).replaceAll(" · ", " // ")}</small></label>`)
    .join("");
};

const renderModeList = (): void => {
  renderCreatorFolderBar("modes");
  const list = query<HTMLElement>("#custom-mode-list");
  const visibleModes = customModes.filter((mode) => assetMatchesFolder("modes", mode.id, activeModeFolderId));
  if (visibleModes.length === 0) {
    list.innerHTML = `<div class="empty-mode-list"><strong>${customModes.length === 0 ? "NO CREATED MODES" : "FOLDER IS EMPTY"}</strong><span>${customModes.length === 0 ? "Open the creator to build a local finite timeline." : "Select another folder or move a mode here."}</span></div>`;
    updateSelectedModeCount();
    return;
  }
  list.innerHTML = visibleModes.map((mode) => {
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
        <label class="library-select"><input type="checkbox" data-mode-select="${escapeHtml(mode.id)}" ${selectedModeIds.has(mode.id) ? "checked" : ""}><span>SELECT</span></label>
        <button class="primary-button" data-action="select-mode" data-mode-id="${escapeHtml(mode.id)}" ${missingEnemies.length > 0 ? "disabled" : ""}>${missingEnemies.length > 0 ? "LOCKED" : "SELECT"}</button>
        <button class="secondary-button" data-action="export-mode" data-mode-id="${escapeHtml(mode.id)}">EXPORT</button>
        <button class="secondary-button" data-action="edit-mode" data-mode-id="${escapeHtml(mode.id)}">EDIT</button>
        <button class="entry-delete" data-action="delete-mode" data-mode-id="${escapeHtml(mode.id)}">DELETE</button>
      </div>
    </article>
  `;
  }).join("");
  updateSelectedModeCount();
};

const mapPreviewSvg = (map: MapDefinition): string => {
  const previewMap = scaleMapDefinition(map);
  const bounds = mapWorldBounds(map.mapScale);
  const pathData = previewMap.path.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(0)} ${point.y.toFixed(0)}`).join(" ");
  const zones = previewMap.blockedZones.map((zone) => `<rect x="${zone.x}" y="${zone.y}" width="${zone.width}" height="${zone.height}" fill="${previewMap.palette.accent}" opacity=".18"/>`).join("");
  return `<svg class="map-preview" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" aria-hidden="true"><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${previewMap.palette.field}"/>${zones}<path d="${pathData}" fill="none" stroke="#000" stroke-width="118"/><path d="${pathData}" fill="none" stroke="${previewMap.palette.path}" stroke-width="100"/><circle cx="${previewMap.core.x}" cy="${previewMap.core.y}" r="34" fill="none" stroke="${previewMap.palette.accent}" stroke-width="8"/></svg>`;
};

const mapLibraryCard = (map: MapDefinition, custom: CustomMapDraft | null): string => `
  <article class="map-library-card">
    ${mapPreviewSvg(map)}
    <div><small>${map.isCustom ? "CREATED // SANDBOX" : `OFFICIAL // MAP ${map.index.toString().padStart(2, "0")}`}</small><strong>${escapeHtml(map.name)}</strong><p>${escapeHtml(map.description)}</p><b>${map.difficulty.toUpperCase()} // ${Math.round(new Polyline(map.path).totalLength * normalizedMapScale(map.mapScale)).toLocaleString()} ROUTE UNITS // SCALE ${normalizedMapScale(map.mapScale).toFixed(1)}X // ${map.blockedZones.length} BLOCK ZONES</b></div>
    ${custom ? `<div class="map-card-actions"><label class="library-select"><input type="checkbox" data-map-select="${escapeHtml(custom.id)}" ${selectedMapIds.has(custom.id) ? "checked" : ""}><span>SELECT</span></label><button data-action="export-map" data-map-id="${escapeHtml(custom.id)}">EXPORT</button><button data-action="edit-map" data-map-id="${escapeHtml(custom.id)}">EDIT</button><button class="danger" data-action="delete-map" data-map-id="${escapeHtml(custom.id)}">DELETE</button></div>` : ""}
  </article>`;

const renderMapLibrary = (): void => {
  renderCreatorFolderBar("maps");
  query<HTMLElement>("#official-map-list").innerHTML = Object.values(MAP_DEFINITIONS)
    .map((map) => mapLibraryCard(map, null)).join("");
  const list = query<HTMLElement>("#custom-map-list");
  const visibleMaps = customMaps.filter((draft) => assetMatchesFolder("maps", draft.id, activeMapFolderId));
  list.innerHTML = visibleMaps.length === 0
    ? `<div class="empty-mode-list"><strong>${customMaps.length === 0 ? "NO CREATED MAPS" : "FOLDER IS EMPTY"}</strong><span>${customMaps.length === 0 ? "Create a route, palette, and restricted build layout." : "Select another folder or move a map here."}</span></div>`
    : visibleMaps.map((draft) => mapLibraryCard(customMapToDefinition(draft), draft)).join("");
  updateSelectedMapCount();
};

const renderPlayMapGrid = (): void => {
  const maps = getAllMapDefinitions();
  if (!maps.some((map) => map.kind === selectedMap.kind)) selectedMap = MAP_DEFINITIONS.sector07;
  query<HTMLElement>("#play-map-grid").innerHTML = maps.map((map) => {
    const rewardCopy = map.isCustom || selectedMode.isCustom
      ? "SANDBOX // NO PROFILE REWARDS"
      : `${Math.round(map.rewardMultiplier * 100)}% COIN REWARD`;
    const cleared = !map.isCustom && progress.clearedMaps.some((kind) => kind === map.kind) ? "// CLEARED" : "";
    return `<button class="map-card ${map.kind === selectedMap.kind ? "selected" : ""}" data-action="select-map" data-map="${escapeHtml(map.kind)}">${mapPreviewSvg(map)}<span>${map.isCustom ? "CUSTOM" : `MAP ${map.index.toString().padStart(2, "0")}`} // ${map.difficulty.toUpperCase()}</span><strong>${escapeHtml(map.name)}</strong><p>${escapeHtml(map.description)}</p><small>${rewardCopy} <b>${cleared}</b></small></button>`;
  }).join("");
};

const updateSelectedModeCopy = (): void => {
  query<HTMLElement>("#selected-mode-copy").textContent = `${selectedMode.name} // ${selectedMode.waves.length} finite ${selectedMode.waves.length === 1 ? "wave" : "waves"}.${selectedMode.isCustom ? " Created modes provide no profile rewards." : " Official map-adjusted profile rewards are enabled."}`;
  const compactName = selectedMode.name.length > 24 ? `${selectedMode.name.slice(0, 23)}…` : selectedMode.name;
  query<HTMLButtonElement>("#start-mode-button").innerHTML = `START ${escapeHtml(compactName.toUpperCase())} <span>→</span>`;
  renderPlayMapGrid();
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
      `<option value="${enemy.kind}" ${enemy.kind === block.enemy ? "selected" : ""}>${escapeHtml(enemy.name)} // ${enemyStatLine(enemy).replaceAll(" · ", " // ")}${enemy.kind.startsWith("custom-enemy:") ? " // CREATED" : ""}</option>`,
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

const mapCanvasPoint = (event: PointerEvent | MouseEvent): Point => {
  const bounds = mapEditorCanvas.getBoundingClientRect();
  const screenPoint = {
    x: (event.clientX - bounds.left) * (WORLD_WIDTH / bounds.width),
    y: (event.clientY - bounds.top) * (WORLD_HEIGHT / bounds.height),
  };
  const mapScale = normalizedMapScale(mapDraft?.mapScale ?? DEFAULT_MAP_SCALE);
  const zoom = 1 / mapScale;
  const viewport = {
    x: (WORLD_WIDTH - WORLD_WIDTH * zoom) / 2,
    y: (WORLD_HEIGHT - WORLD_HEIGHT * zoom) / 2,
  };
  const runtimePoint = {
    x: (screenPoint.x - viewport.x) / zoom,
    y: (screenPoint.y - viewport.y) / zoom,
  };
  return {
    x: (runtimePoint.x - WORLD_WIDTH / 2) / mapScale + WORLD_WIDTH / 2,
    y: (runtimePoint.y - WORLD_HEIGHT / 2) / mapScale + WORLD_HEIGHT / 2,
  };
};

const mapPointForEditor = (point: Point): Point => ({
  x: clamp(point.x, 0, WORLD_WIDTH),
  y: clamp(point.y, 0, WORLD_HEIGHT),
});

const checkpointMapDraft = (): void => {
  if (!mapDraft) return;
  mapHistory.push(cloneCustomMap(mapDraft));
  if (mapHistory.length > 50) mapHistory.shift();
  mapFuture = [];
};

const mutateMapDraft = (mutation: (draft: CustomMapDraft) => void): void => {
  if (!mapDraft) return;
  checkpointMapDraft();
  mutation(mapDraft);
  renderMapEditor();
};

const drawMapEditor = (): void => {
  if (!mapDraft) return;
  const context = mapEditorCanvas.getContext("2d");
  if (!context) return;
  const definition = scaleMapDefinition(customMapToDefinition(mapDraft));
  const shape = createMapPathShape(definition);
  const mapScale = normalizedMapScale(mapDraft.mapScale);
  const zoom = 1 / mapScale;
  const viewport = {
    x: (WORLD_WIDTH - WORLD_WIDTH * zoom) / 2,
    y: (WORLD_HEIGHT - WORLD_HEIGHT * zoom) / 2,
    scale: zoom,
  };
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  drawMapBackdrop(context, definition, viewport, WORLD_WIDTH, WORLD_HEIGHT);
  context.save();
  context.setTransform(zoom, 0, 0, zoom, viewport.x, viewport.y);
  drawMapField(context, definition);
  drawMapPath(context, definition, shape);
  drawMapCore(context, definition);
  if (mapSelectionState?.type === "zone") {
    const selectedZoneId = mapSelectionState.id;
    const zone = definition.blockedZones.find((candidate) => candidate.id === selectedZoneId);
    if (zone) {
      drawBlockedZone(context, zone, definition.palette.accent, true);
      context.fillStyle = definition.palette.accent;
      context.fillRect(zone.x + zone.width - 12, zone.y + zone.height - 12, 24, 24);
      context.strokeStyle = "#090c0d";
      context.lineWidth = 3;
      context.strokeRect(zone.x + zone.width - 12, zone.y + zone.height - 12, 24, 24);
    }
  }
  mapDraft.path.forEach((rawPoint, index) => {
    const point = scaleMapPoint(mapPointForEditor(rawPoint), mapScale);
    const terminal = index === 0 || index === mapDraft!.path.length - 1;
    const selected = mapSelectionState?.type === "point" && mapSelectionState.index === index;
    context.beginPath();
    context.arc(point.x, point.y, selected ? 18 : 14, 0, Math.PI * 2);
    context.fillStyle = selected ? definition.palette.accent : terminal ? "#f1d07a" : "#d9dfdb";
    context.fill();
    context.strokeStyle = "#080b0c";
    context.lineWidth = 4;
    context.stroke();
    context.fillStyle = "#080b0c";
    context.font = "700 10px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText(terminal ? (index === 0 ? "IN" : "OUT") : `${index}`, point.x, point.y + 4);
  });
  context.restore();
};

function renderMapEditor(): void {
  if (!mapDraft) return;
  const field = <T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(name: string): T => query<T>(`[data-map-field='${name}']`);
  field("name").value = mapDraft.name;
  field("description").value = mapDraft.description;
  field("difficulty").value = mapDraft.difficulty;
  field("entryEdge").value = mapDraft.entryEdge;
  field("exitEdge").value = mapDraft.exitEdge;
  field("mapScale").value = mapDraft.mapScale.toString();
  field("field").value = mapDraft.palette.field;
  field("path").value = mapDraft.palette.path;
  field("accent").value = mapDraft.palette.accent;
  const validation = validateCustomMap(mapDraft);
  const playablePathLength = validation.pathLength * normalizedMapScale(mapDraft.mapScale);
  query<HTMLElement>("#map-path-length").textContent = `${Math.round(playablePathLength).toLocaleString()} ROUTE UNITS // ${normalizedMapScale(mapDraft.mapScale).toFixed(1)}X`;
  const validationState = query<HTMLElement>("#map-validation-state");
  validationState.textContent = validation.valid ? "ROUTE VALID" : `${validation.errors.length} ISSUES`;
  validationState.classList.toggle("valid", validation.valid);
  query<HTMLElement>("#map-validation-errors").innerHTML = validation.valid
    ? "<li>Route, terminals, core clearance, and blocked zones are valid.</li>"
    : validation.errors.slice(0, 8).map((error) => `<li>${escapeHtml(error)}</li>`).join("");
  query<HTMLButtonElement>("#map-save-button").disabled = !validation.valid;
  query<HTMLButtonElement>("#map-test-button").disabled = !validation.valid;
  query<HTMLButtonElement>("#map-undo-button").disabled = mapHistory.length === 0;
  query<HTMLButtonElement>("#map-redo-button").disabled = mapFuture.length === 0;
  const selectionCopy = query<HTMLElement>("#map-editor-selection");
  if (mapSelectionState?.type === "point") {
    const point = mapDraft.path[mapSelectionState.index];
    selectionCopy.textContent = point
      ? `ROUTE POINT ${mapSelectionState.index.toString().padStart(2, "0")} // ${Math.round(point.x)}, ${Math.round(point.y)}`
      : "SELECT A ROUTE POINT OR BLOCKED ZONE";
  } else if (mapSelectionState?.type === "zone") {
    const selectedZoneId = mapSelectionState.id;
    const zone = mapDraft.blockedZones.find((candidate) => candidate.id === selectedZoneId);
    selectionCopy.textContent = zone
      ? `BLOCK ZONE // ${Math.round(zone.width)} × ${Math.round(zone.height)} AT ${Math.round(zone.x)}, ${Math.round(zone.y)}`
      : "SELECT A ROUTE POINT OR BLOCKED ZONE";
  } else selectionCopy.textContent = "SELECT A ROUTE POINT OR BLOCKED ZONE";
  drawMapEditor();
}

const findMapPoint = (point: Point): number => {
  if (!mapDraft) return -1;
  let best = -1;
  let bestDistance = 28;
  mapDraft.path.forEach((candidate, index) => {
    const separation = distance(point, mapPointForEditor(candidate));
    if (separation < bestDistance) {
      best = index;
      bestDistance = separation;
    }
  });
  return best;
};

const findMapZone = (point: Point): BlockedZone | null => {
  if (!mapDraft) return null;
  return [...mapDraft.blockedZones].reverse().find((zone) =>
    point.x >= zone.x && point.x <= zone.x + zone.width && point.y >= zone.y && point.y <= zone.y + zone.height,
  ) ?? null;
};

const insertMapPointAt = (point: Point): void => {
  if (!mapDraft || mapDraft.path.length >= 32) return;
  let bestIndex = -1;
  let bestDistance = 42;
  for (let index = 0; index < mapDraft.path.length - 1; index += 1) {
    const a = mapDraft.path[index];
    const b = mapDraft.path[index + 1];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) continue;
    const amount = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1);
    const projected = { x: a.x + dx * amount, y: a.y + dy * amount };
    const separation = distance(point, projected);
    if (separation < bestDistance) {
      bestDistance = separation;
      bestIndex = index + 1;
    }
  }
  if (bestIndex < 1) return;
  mutateMapDraft((draft) => {
    draft.path.splice(bestIndex, 0, {
      x: clamp(snapMapCoordinate(point.x), 80, WORLD_WIDTH - 80),
      y: clamp(snapMapCoordinate(point.y), 80, WORLD_HEIGHT - 80),
    });
    mapSelectionState = { type: "point", index: bestIndex };
  });
};

const addMapZone = (): void => {
  if (!mapDraft || mapDraft.blockedZones.length >= 24) return;
  let chosen = createBlockedZone(120, 100);
  outer: for (let y = 60; y <= WORLD_HEIGHT - 140; y += 80) {
    for (let x = 60; x <= WORLD_WIDTH - 180; x += 100) {
      const candidate = createBlockedZone(x, y);
      const test = cloneCustomMap(mapDraft);
      test.blockedZones.push(candidate);
      if (validateCustomMap(test).valid) {
        chosen = candidate;
        break outer;
      }
    }
  }
  mutateMapDraft((draft) => {
    draft.blockedZones.push(chosen);
    mapSelectionState = { type: "zone", id: chosen.id };
  });
};

mapEditorCanvas.addEventListener("pointerdown", (event) => {
  if (!mapDraft || event.button !== 0) return;
  const point = mapCanvasPoint(event);
  const pointIndex = findMapPoint(point);
  if (pointIndex >= 0) {
    mapSelectionState = { type: "point", index: pointIndex };
    mapDragState = { type: "point", start: point, original: cloneCustomMap(mapDraft) };
  } else {
    const zone = findMapZone(point);
    if (zone) {
      mapSelectionState = { type: "zone", id: zone.id };
      const resizing = distance(point, { x: zone.x + zone.width, y: zone.y + zone.height }) <= 34;
      mapDragState = { type: resizing ? "resize" : "zone", start: point, original: cloneCustomMap(mapDraft) };
    } else {
      mapSelectionState = null;
      mapDragState = null;
    }
  }
  mapEditorCanvas.setPointerCapture(event.pointerId);
  renderMapEditor();
});

mapEditorCanvas.addEventListener("pointermove", (event) => {
  if (!mapDraft || !mapDragState || !mapSelectionState) return;
  const point = mapCanvasPoint(event);
  const delta = { x: point.x - mapDragState.start.x, y: point.y - mapDragState.start.y };
  if (mapSelectionState.type === "point" && mapDragState.type === "point") {
    const originalPoint = mapDragState.original.path[mapSelectionState.index];
    if (!originalPoint) return;
    if (mapSelectionState.index === 0) {
      const position = terminalPosition(mapDraft.entryEdge, { x: originalPoint.x + delta.x, y: originalPoint.y + delta.y });
      mapDraft.path[0] = terminalPoint(mapDraft.entryEdge, position);
    } else if (mapSelectionState.index === mapDraft.path.length - 1) {
      const position = terminalPosition(mapDraft.exitEdge, { x: originalPoint.x + delta.x, y: originalPoint.y + delta.y });
      mapDraft.path[mapDraft.path.length - 1] = terminalPoint(mapDraft.exitEdge, position);
    } else {
      mapDraft.path[mapSelectionState.index] = {
        x: clamp(snapMapCoordinate(originalPoint.x + delta.x), 80, WORLD_WIDTH - 80),
        y: clamp(snapMapCoordinate(originalPoint.y + delta.y), 80, WORLD_HEIGHT - 80),
      };
    }
  } else if (mapSelectionState.type === "zone") {
    const selectedZoneId = mapSelectionState.id;
    const zoneIndex = mapDraft.blockedZones.findIndex((candidate) => candidate.id === selectedZoneId);
    const zone = mapDraft.blockedZones[zoneIndex];
    const original = mapDragState.original.blockedZones.find((candidate) => candidate.id === selectedZoneId);
    if (!zone || !original) return;
    if (mapDragState.type === "resize") {
      mapDraft.blockedZones[zoneIndex] = {
        ...zone,
        width: clamp(snapMapCoordinate(original.width + delta.x), 80, WORLD_WIDTH - zone.x),
        height: clamp(snapMapCoordinate(original.height + delta.y), 80, WORLD_HEIGHT - zone.y),
      };
    } else {
      mapDraft.blockedZones[zoneIndex] = {
        ...zone,
        x: clamp(snapMapCoordinate(original.x + delta.x), 0, WORLD_WIDTH - zone.width),
        y: clamp(snapMapCoordinate(original.y + delta.y), 0, WORLD_HEIGHT - zone.height),
      };
    }
  }
  renderMapEditor();
});

const finishMapDrag = (event: PointerEvent): void => {
  if (!mapDraft || !mapDragState) return;
  const changed = JSON.stringify(mapDraft) !== JSON.stringify(mapDragState.original);
  if (changed) {
    mapHistory.push(mapDragState.original);
    if (mapHistory.length > 50) mapHistory.shift();
    mapFuture = [];
  }
  mapDragState = null;
  if (mapEditorCanvas.hasPointerCapture(event.pointerId)) mapEditorCanvas.releasePointerCapture(event.pointerId);
  renderMapEditor();
};

mapEditorCanvas.addEventListener("pointerup", finishMapDrag);
mapEditorCanvas.addEventListener("pointercancel", finishMapDrag);
mapEditorCanvas.addEventListener("dblclick", (event) => insertMapPointAt(mapCanvasPoint(event)));

const showFrontScreen = (screen: "main" | "creators" | "enemies" | "enemy-creator" | "modes" | "maps" | "creator" | "map-library" | "map-creator" | "shop"): void => {
  shell.classList.remove("run-active");
  mainMenu.hidden = screen !== "main";
  creatorHub.hidden = screen !== "creators";
  enemySelection.hidden = screen !== "enemies";
  enemyCreator.hidden = screen !== "enemy-creator";
  modeSelection.hidden = screen !== "modes";
  mapSelection.hidden = screen !== "maps";
  mapLibrary.hidden = screen !== "map-library";
  mapCreator.hidden = screen !== "map-creator";
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
  if (screen === "map-library") renderMapLibrary();
  if (screen === "map-creator") renderMapEditor();
  if (screen === "creator") renderCreator();
};

const selectMapCard = (kind: MapKind): void => {
  const map = getMapDefinition(kind);
  if (!map) return;
  selectedMap = map;
  document.querySelectorAll<HTMLButtonElement>(".map-card").forEach((card) => {
    card.classList.toggle("selected", card.dataset["map"] === kind);
  });
};

const settleRun = (victory: boolean, wave: number, mode: ModeDefinition): { coins: number; tokens: number } => {
  if (runSettled) return { coins: 0, tokens: 0 };
  runSettled = true;
  if (mode.isCustom || activeMap.isCustom || mapTestActive) return { coins: 0, tokens: 0 };
  const progressRatio = Math.min(1, wave / mode.waves.length);
  const coins = victory
    ? Math.round(mode.reward.coins * activeMap.rewardMultiplier)
    : Math.round((15 + 75 * progressRatio) * activeMap.rewardMultiplier);
  const tokens = victory ? mode.reward.tokens : wave >= 20 ? 1 : 0;
  progress.coins += coins;
  progress.tokens += tokens;
  progress.runs += 1;
  if (victory) {
    progress.victories += 1;
    if (!progress.clearedMaps.some((kind) => kind === activeMap.kind)) progress.clearedMaps.push(activeMap.kind as keyof typeof MAP_DEFINITIONS);
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

const renderBattleLoadout = (state: GameUiState): void => {
  const signature = state.availableTowers.join("|");
  if (signature === battleLoadoutSignature) return;
  battleLoadoutSignature = signature;
  const towerList = query<HTMLElement>("#tower-list");
  towerList.innerHTML = state.availableTowers.map((kind, index) => {
    const tower = TOWER_DEFINITIONS[kind];
    const displaySlot = LOADOUT_VISUAL_ORDER.indexOf(index as (typeof LOADOUT_VISUAL_ORDER)[number]) + 1;
    return `<button class="tower-card" data-kind="${tower.kind}" data-loadout-slot="${index}" data-testid="tower-${tower.kind}" style="--accent:${tower.accent};--dim:${tower.dimAccent}" aria-label="Slot ${displaySlot}: ${tower.name}, $${tower.cost}">
      <span class="hotkey">${displaySlot}</span>
      <span class="tower-glyph">${tower.glyph}</span>
      <strong class="tower-name">${tower.name}</strong>
      <span class="tower-cost">$${tower.cost}</span>
      <small class="stock-count" id="stock-${tower.kind}">x${tower.copyLimit}</small>
    </button>`;
  }).join("") + Array.from({ length: Math.max(0, 5 - state.availableTowers.length) }, (_, index) =>
    (() => {
      const loadoutIndex = state.availableTowers.length + index;
      const displaySlot = LOADOUT_VISUAL_ORDER.indexOf(loadoutIndex as (typeof LOADOUT_VISUAL_ORDER)[number]) + 1;
      return `<div class="tower-card empty" data-loadout-slot="${loadoutIndex}" aria-label="Empty loadout slot ${displaySlot}"><span class="hotkey">${displaySlot}</span><span class="tower-glyph">+</span><strong class="tower-name">EMPTY</strong></div>`;
    })(),
  ).join("");
  query<HTMLElement>(".dock-label span").textContent = "LOADOUT";
  query<HTMLElement>(".dock-label small").textContent = "1—5";
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
    const inspectorOnLeft = state.selectedTower.tower.position.x >= WORLD_WIDTH / 2;
    towerInspector.classList.toggle("inspector-left", inspectorOnLeft);
    towerInspector.classList.toggle("inspector-right", !inspectorOnLeft);
  }
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
  renderBattleLoadout(state);
  document.querySelectorAll<HTMLButtonElement>(".tower-card[data-kind]").forEach((card) => {
    const kind = card.dataset["kind"] as TowerKind;
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
  counter.title = `${counterStatus.textContent} // ${counterHint.textContent}`;
  abilityButton.title = `${abilityStatus.textContent} // ${abilityHint.textContent}`;
};

const game = new Game(canvas, {
  onUi: render,
  onLog: addLog,
  onGameOver: (wave) => {
    const reward = settleRun(false, wave, activeMode);
    query<HTMLElement>("#game-over-copy").textContent = mapTestActive
      ? `Map test ended on wave ${wave.toString().padStart(2, "0")}. Return to the editor to adjust the route.`
      : activeMode.isCustom || activeMap.isCustom
      ? `Your sandbox simulation held through wave ${wave.toString().padStart(2, "0")}. Custom content does not provide profile rewards.`
      : `Your defense held through wave ${wave.toString().padStart(2, "0")}. Recovery paid ${reward.coins} Coins${reward.tokens > 0 ? ` and ${reward.tokens} Token` : ""}.`;
    query<HTMLElement>("#game-over-exit").textContent = mapTestActive ? "RETURN TO EDITOR" : "MAIN MENU";
    query<HTMLElement>("#game-over-restart").innerHTML = mapTestActive ? "TEST AGAIN <span>↻</span>" : "TRY AGAIN <span>↻</span>";
    gameOverPanel.hidden = false;
  },
  onVictory: (mode) => {
    const reward = settleRun(true, mode.waves.length, mode);
    query<HTMLElement>("#victory-copy").textContent = mapTestActive
      ? `${activeMap.name} passed a complete Normal Mode test. No profile rewards were granted.`
      : mode.isCustom || activeMap.isCustom
      ? `${mode.name} cleared on ${activeMap.name}. Custom content does not provide profile rewards.`
      : `${activeMap.name} secured. Reward: ${reward.coins} Coins and ${reward.tokens} Tokens.`;
    query<HTMLElement>("#victory h2").innerHTML = `${escapeHtml(mode.name.toUpperCase())}<br>SECURED`;
    query<HTMLElement>("#victory-exit").textContent = mapTestActive ? "RETURN TO EDITOR" : "MAIN MENU";
    query<HTMLElement>("#victory-restart").innerHTML = mapTestActive ? "TEST AGAIN <span>↻</span>" : "RUN AGAIN <span>↻</span>";
    victoryPanel.hidden = false;
  },
});

game.setAvailableTowers(progress.loadout);
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
    if (Array.isArray(disk.data.customMaps)) customMaps = sanitizeCustomMaps(disk.data.customMaps);
    creatorFolders = sanitizeCreatorFolders(disk.data.creatorFolders);
    cacheProgressLocally(progress);
    cacheCustomEnemiesLocally(customEnemies);
    cacheCustomModesLocally(customModes);
    cacheCustomMapsLocally(customMaps);
    cacheCreatorFoldersLocally(creatorFolders);
    await replaceDiskSave(currentSaveBundle());
    game.setAvailableTowers(progress.loadout);
    renderMeta();
    renderModeList();
    renderMapLibrary();
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
void hydrateDevelopmentTools();

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
    const parsed = JSON.parse(await file.text()) as { type?: unknown; mode?: unknown; modes?: unknown };
    const rawModes = parsed?.type === "monochromium-custom-modes" && Array.isArray(parsed.modes)
      ? parsed.modes
      : parsed?.type === "monochromium-custom-mode" && parsed.mode
        ? [parsed.mode]
        : null;
    if (!rawModes) throw new Error("This is not a Monochromium mode export.");
    const imported = sanitizeCustomModes(rawModes);
    if (imported.length === 0) throw new Error("The export did not contain any valid modes.");
    const conflicts = imported.filter((mode) => customModes.some((current) => current.id === mode.id));
    if (conflicts.length > 0 && !window.confirm(`Replace ${conflicts.length} existing custom ${conflicts.length === 1 ? "mode" : "modes"}?`)) return;
    customModes = sanitizeCustomModes([
      ...customModes.filter((current) => !imported.some((mode) => mode.id === current.id)),
      ...imported,
    ]);
    saveCustomModes(customModes);
    renderModeList();
    const lockedModes = imported.filter((mode) => getMissingCustomEnemyIds(mode).length > 0);
    const suffix = lockedModes.length > 0 ? ` ${lockedModes.length} locked // missing custom enemies.` : "";
    addLog(`${imported.length} custom ${imported.length === 1 ? "mode" : "modes"} imported.${suffix}`, lockedModes.length > 0 ? "danger" : "good");
    setSaveStatus(`${imported.length} ${imported.length === 1 ? "mode" : "modes"} imported.${suffix}`, lockedModes.length > 0 ? "danger" : "good");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid mode export.";
    addLog(`Mode import failed // ${message}`, "danger");
    setSaveStatus(`Mode import failed // ${message}`, "danger");
  }
};

const importMapFromFile = async (file: File): Promise<void> => {
  try {
    const parsed = JSON.parse(await file.text()) as { type?: unknown; map?: unknown; maps?: unknown };
    const rawMaps = parsed?.type === "monochromium-custom-maps" && Array.isArray(parsed.maps)
      ? parsed.maps
      : parsed?.type === "monochromium-custom-map" && parsed.map
        ? [parsed.map]
        : null;
    if (!rawMaps) throw new Error("This is not a Monochromium map export.");
    const imported = sanitizeCustomMaps(rawMaps);
    if (imported.length === 0) throw new Error("The export did not contain any valid maps.");
    const conflicts = imported.filter((map) => customMaps.some((current) => current.id === map.id));
    if (conflicts.length > 0 && !window.confirm(`Replace ${conflicts.length} existing custom ${conflicts.length === 1 ? "map" : "maps"}?`)) return;
    customMaps = sanitizeCustomMaps([
      ...customMaps.filter((current) => !imported.some((map) => map.id === current.id)),
      ...imported,
    ]);
    saveCustomMaps(customMaps);
    renderMapLibrary();
    renderPlayMapGrid();
    renderMeta();
    addLog(`${imported.length} custom ${imported.length === 1 ? "map" : "maps"} imported // sandbox rewards disabled.`, "good");
    setSaveStatus(`${imported.length} ${imported.length === 1 ? "map" : "maps"} imported.`, "good");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid map export.";
    addLog(`Map import failed // ${message}`, "danger");
    setSaveStatus(`Map import failed // ${message}`, "danger");
  }
};

const enterRun = (map: MapDefinition, mode: ModeDefinition, test: boolean): void => {
  activeMap = map;
  activeMode = mode;
  mapTestActive = test;
  runSettled = false;
  [mainMenu, creatorHub, enemySelection, enemyCreator, modeSelection, mapSelection, mapLibrary, mapCreator, modeCreator, towerShop, gameOverPanel, victoryPanel]
    .forEach((screen) => { screen.hidden = true; });
  shell.classList.add("run-active");
  game.startRun(activeMap, progress.loadout, activeMode);
};

const runAction = (action: string, value?: string, source?: HTMLElement): void => {
  switch (action) {
    case "open-modes":
      libraryReturnScreen = "main";
      showFrontScreen("modes");
      break;
    case "open-creators":
      showFrontScreen("creators");
      break;
    case "creator-hub-modes":
      libraryReturnScreen = "creators";
      showFrontScreen("modes");
      break;
    case "creator-hub-enemies":
      libraryReturnScreen = "creators";
      showFrontScreen("enemies");
      break;
    case "creator-hub-maps":
      libraryReturnScreen = "creators";
      showFrontScreen("map-library");
      break;
    case "open-shop":
      showFrontScreen("shop");
      break;
    case "open-enemies":
      libraryReturnScreen = "main";
      showFrontScreen("enemies");
      break;
    case "new-enemy":
      enemyDraft = createCustomEnemy();
      showFrontScreen("enemy-creator");
      break;
    case "import-enemies":
      query<HTMLInputElement>("#enemy-import-input").click();
      break;
    case "folder-select": {
      const kind = source?.dataset["folderKind"];
      if (!isCreatorFolderKind(kind)) break;
      const folderId = source?.dataset["folderId"] || null;
      if (folderId && folderId !== UNFILED_FOLDER_ID && !foldersFor(creatorFolders, kind).some((folder) => folder.id === folderId)) break;
      closeFolderEditor(kind);
      setActiveFolderId(kind, folderId);
      if (kind === "modes") renderModeList();
      else if (kind === "enemies") renderEnemyList();
      else renderMapLibrary();
      break;
    }
    case "folder-create": {
      const kind = source?.dataset["folderKind"];
      if (!isCreatorFolderKind(kind)) break;
      openFolderEditor(kind, "create");
      break;
    }
    case "folder-rename": {
      const kind = source?.dataset["folderKind"];
      if (!isCreatorFolderKind(kind)) break;
      openFolderEditor(kind, "rename");
      break;
    }
    case "folder-editor-cancel": {
      const kind = source?.dataset["folderKind"];
      if (isCreatorFolderKind(kind)) closeFolderEditor(kind);
      break;
    }
    case "folder-editor-save": {
      const kind = source?.dataset["folderKind"];
      if (!isCreatorFolderKind(kind) || !(source instanceof HTMLFormElement)) break;
      const input = source.querySelector<HTMLInputElement>("[data-folder-name]");
      const name = input?.value.trim() ?? "";
      if (!name) {
        source.classList.add("invalid");
        input?.focus();
        setSaveStatus("Folder name cannot be empty.", "danger");
        break;
      }
      const mode = source.dataset["folderEditorMode"];
      if (mode === "rename") {
        const folderId = source.dataset["folderId"];
        if (!folderId) break;
        persistCreatorFolderState(renameCreatorFolder(creatorFolders, kind, folderId, name));
        setSaveStatus(`Folder renamed to ${name}.`, "good");
      } else {
        const next = createCreatorFolder(creatorFolders, kind, name);
        const created = foldersFor(next, kind)[foldersFor(next, kind).length - 1];
        persistCreatorFolderState(next);
        setActiveFolderId(kind, created?.id ?? null);
        setSaveStatus(`${name} folder created.`, "good");
      }
      closeFolderEditor(kind);
      if (kind === "modes") renderModeList();
      else if (kind === "enemies") renderEnemyList();
      else renderMapLibrary();
      break;
    }
    case "folder-delete": {
      const kind = source?.dataset["folderKind"];
      if (!isCreatorFolderKind(kind)) break;
      const folderId = activeFolderIdFor(kind);
      const folder = folderId ? foldersFor(creatorFolders, kind).find((candidate) => candidate.id === folderId) : null;
      if (!folder || !window.confirm(`Delete folder "${folder.name}"? Its children will remain in the library.`)) break;
      closeFolderEditor(kind);
      persistCreatorFolderState(deleteCreatorFolder(creatorFolders, kind, folder.id));
      setActiveFolderId(kind, null);
      if (kind === "modes") renderModeList();
      else if (kind === "enemies") renderEnemyList();
      else renderMapLibrary();
      break;
    }
    case "folder-select-all": {
      const kind = source?.dataset["folderKind"];
      if (!isCreatorFolderKind(kind)) break;
      const folderId = activeFolderIdFor(kind);
      const selected = selectedIdsFor(kind);
      selected.clear();
      folderAssets(kind).forEach((asset) => {
        if (assetMatchesFolder(kind, asset.id, folderId)) selected.add(asset.id);
      });
      if (kind === "modes") { updateSelectedModeCount(); renderModeList(); }
      else if (kind === "enemies") { updateSelectedEnemyCount(); renderEnemyList(); }
      else { updateSelectedMapCount(); renderMapLibrary(); }
      setSaveStatus(`${selected.size} ${folderTitle(kind).toLowerCase()} selected.`, "good");
      break;
    }
    case "folder-move-selected": {
      const kind = source?.dataset["folderKind"];
      if (!isCreatorFolderKind(kind)) break;
      const folderId = activeFolderIdFor(kind);
      if (!folderId) break;
      const selected = selectedIdsFor(kind);
      if (selected.size === 0) break;
      const destinationFolderId = folderId === UNFILED_FOLDER_ID ? null : folderId;
      persistCreatorFolderState(assignCreatorAssets(creatorFolders, kind, [...selected], destinationFolderId));
      if (kind === "modes") renderModeList();
      else if (kind === "enemies") renderEnemyList();
      else renderMapLibrary();
      const destinationName = destinationFolderId
        ? foldersFor(creatorFolders, kind).find((folder) => folder.id === destinationFolderId)?.name ?? "folder"
        : "Unfiled";
      setSaveStatus(`${selected.size} ${folderTitle(kind).toLowerCase()} moved to ${destinationName}.`, "good");
      break;
    }
    case "export-selected-enemies": {
      const selected = customEnemies.filter((enemy) => selectedEnemyIds.has(enemy.id));
      if (selected.length > 0) exportEnemyBundle(selected, `monochromium-enemies-${selected.length}.json`);
      break;
    }
    case "export-selected-modes": {
      const selected = customModes.filter((mode) => selectedModeIds.has(mode.id));
      if (selected.length > 0) exportModeBundle(selected, `monochromium-modes-${selected.length}.json`);
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
      persistCreatorFolderState(assignCreatorAssets(creatorFolders, "enemies", [enemy.id], null));
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
    case "import-map":
      query<HTMLInputElement>("#map-import-input").click();
      break;
    case "check-update":
      void checkForUpdate();
      break;
    case "download-update":
      void downloadUpdate();
      break;
    case "install-update":
      void installUpdate();
      break;
    case "back-main":
      showFrontScreen("main");
      break;
    case "library-back":
      showFrontScreen(libraryReturnScreen);
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
      selectedModeIds.delete(custom.id);
      persistCreatorFolderState(assignCreatorAssets(creatorFolders, "modes", [custom.id], null));
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
    case "new-map":
      mapDraft = createCustomMap();
      mapHistory = [];
      mapFuture = [];
      mapSelectionState = null;
      showFrontScreen("map-creator");
      break;
    case "edit-map": {
      const map = customMaps.find((candidate) => candidate.id === source?.dataset["mapId"]);
      if (!map) break;
      mapDraft = cloneCustomMap(map);
      mapHistory = [];
      mapFuture = [];
      mapSelectionState = null;
      showFrontScreen("map-creator");
      break;
    }
    case "export-map": {
      const map = customMaps.find((candidate) => candidate.id === source?.dataset["mapId"]);
      if (map) exportMapFile(map);
      break;
    }
    case "export-selected-maps": {
      const selected = customMaps.filter((map) => selectedMapIds.has(map.id));
      if (selected.length > 0) exportMapBundle(selected, `monochromium-maps-${selected.length}.json`);
      break;
    }
    case "delete-map": {
      const map = customMaps.find((candidate) => candidate.id === source?.dataset["mapId"]);
      if (!map || !window.confirm(`Delete "${map.name}" from this installation?`)) break;
      customMaps = deleteCustomMap(customMaps, map.id);
      selectedMapIds.delete(map.id);
      persistCreatorFolderState(assignCreatorAssets(creatorFolders, "maps", [map.id], null));
      if (selectedMap.kind === map.id) selectedMap = MAP_DEFINITIONS.sector07;
      renderMapLibrary();
      renderPlayMapGrid();
      renderMeta();
      break;
    }
    case "map-editor-back":
      mapDraft = null;
      mapHistory = [];
      mapFuture = [];
      mapSelectionState = null;
      showFrontScreen("map-library");
      break;
    case "map-save":
      if (!mapDraft || !validateCustomMap(mapDraft).valid) break;
      customMaps = upsertCustomMap(customMaps, mapDraft);
      const savedMap = customMaps.find((map) => map.id === mapDraft?.id) ?? mapDraft;
      selectedMap = customMapToDefinition(savedMap);
      addLog(`Map "${savedMap.name}" saved // sandbox rewards disabled.`, "good");
      mapDraft = null;
      mapHistory = [];
      mapFuture = [];
      renderMeta();
      showFrontScreen("map-library");
      break;
    case "map-test":
      if (!mapDraft || !validateCustomMap(mapDraft).valid) break;
      enterRun(customMapToDefinition(mapDraft), NORMAL_MODE, true);
      break;
    case "map-tool-select":
      break;
    case "map-add-point": {
      if (!mapDraft || mapDraft.path.length >= 32) break;
      let index = mapDraft.path.length - 1;
      if (mapSelectionState?.type === "point") index = Math.min(mapDraft.path.length - 1, mapSelectionState.index + 1);
      const previous = mapDraft.path[Math.max(0, index - 1)];
      const next = mapDraft.path[index];
      if (!previous || !next) break;
      mutateMapDraft((draft) => {
        draft.path.splice(index, 0, {
          x: clamp(snapMapCoordinate((previous.x + next.x) / 2), 80, WORLD_WIDTH - 80),
          y: clamp(snapMapCoordinate((previous.y + next.y) / 2), 80, WORLD_HEIGHT - 80),
        });
        mapSelectionState = { type: "point", index };
      });
      break;
    }
    case "map-add-zone":
      addMapZone();
      break;
    case "map-delete-selection":
      if (!mapDraft || !mapSelectionState) break;
      if (mapSelectionState.type === "point") {
        const index = mapSelectionState.index;
        if (index <= 0 || index >= mapDraft.path.length - 1) break;
        mutateMapDraft((draft) => { draft.path.splice(index, 1); });
      } else {
        const id = mapSelectionState.id;
        mutateMapDraft((draft) => { draft.blockedZones = draft.blockedZones.filter((zone) => zone.id !== id); });
      }
      mapSelectionState = null;
      renderMapEditor();
      break;
    case "map-undo": {
      const previous = mapHistory.pop();
      if (!mapDraft || !previous) break;
      mapFuture.push(cloneCustomMap(mapDraft));
      mapDraft = previous;
      mapSelectionState = null;
      renderMapEditor();
      break;
    }
    case "map-redo": {
      const next = mapFuture.pop();
      if (!mapDraft || !next) break;
      mapHistory.push(cloneCustomMap(mapDraft));
      mapDraft = next;
      mapSelectionState = null;
      renderMapEditor();
      break;
    }
    case "map-reset": {
      if (!mapDraft || !window.confirm("Reset the route and blocked zones to the starter layout?")) break;
      const fresh = createCustomMap();
      mutateMapDraft((draft) => {
        draft.entryEdge = fresh.entryEdge;
        draft.exitEdge = fresh.exitEdge;
        draft.mapScale = fresh.mapScale;
        draft.path = fresh.path.map((point) => ({ ...point }));
        draft.blockedZones = [];
      });
      mapSelectionState = null;
      renderMapEditor();
      break;
    }
    case "map-theme": {
      const theme = MAP_THEME_PRESETS.find((candidate) => candidate.id === source?.dataset["theme"]);
      if (!mapDraft || !theme) break;
      mutateMapDraft((draft) => { draft.palette = { field: theme.field, path: theme.path, accent: theme.accent }; });
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
      enterRun(selectedMap, selectedMode, false);
      break;
      }
    case "main-menu":
      game.leaveRun();
      if (mapTestActive && mapDraft) {
        mapTestActive = false;
        showFrontScreen("map-creator");
      } else {
        mapTestActive = false;
        showFrontScreen("main");
      }
      break;
    case "buy-tower":
      if (value) {
        const kind = value as TowerKind;
        if (unlockTower(progress, kind)) {
          game.setAvailableTowers(progress.loadout);
          addLog(`${TOWER_DEFINITIONS[kind].name} permanently unlocked${progress.loadout.includes(kind) ? " and equipped" : ""}.`, "good");
        }
        renderMeta();
      }
      break;
    case "toggle-loadout":
      if (value) {
        const kind = value as TowerKind;
        const result = toggleTowerLoadout(progress, kind);
        if (result === "equipped" || result === "unequipped") {
          game.setAvailableTowers(progress.loadout);
          addLog(`${TOWER_DEFINITIONS[kind].name} ${result === "equipped" ? "equipped to" : "removed from"} the active loadout.`, "good");
        } else if (result === "full") {
          addLog("Loadout full // remove an equipped tower before adding another.", "danger");
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
    case "debug-balance":
      openBalanceLab();
      break;
    case "debug-balance-close":
      balanceLab.hidden = true;
      debugPanel.hidden = false;
      break;
    case "debug-balance-reset":
      balanceDraft = cloneTowerDefinition(balanceKind);
      renderBalanceLab();
      applyBalanceDraft();
      balanceLabStatus.textContent = "FORM RESET // LIVE VALUES RESTORED";
      break;
    case "debug-balance-save":
      void saveBalanceToConfig();
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
      game.setAvailableTowers(progress.loadout);
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

app.addEventListener("submit", (event) => {
  const form = event.target as HTMLFormElement;
  if (!form.matches(".creator-folder-editor")) return;
  event.preventDefault();
  runAction("folder-editor-save", undefined, form);
});

app.addEventListener("input", (event) => {
  const field = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const balancePath = field.dataset["balancePath"];
  if (balanceDraft && balancePath) {
    const value = Number(field.value);
    if (Number.isFinite(value)) {
      setBalanceValueAtPath(balancePath, value);
      applyBalanceDraft();
    }
    return;
  }
  const mapField = field.dataset["mapField"];
  if (mapDraft && mapField) {
    if (mapField === "name") {
      mapDraft.name = field.value.slice(0, 48);
      return;
    } else if (mapField === "description") {
      mapDraft.description = field.value.slice(0, 220);
      return;
    } else if (mapField === "difficulty" && (field.value === "Easy" || field.value === "Medium" || field.value === "Hard")) {
      mapDraft.difficulty = field.value;
      return;
    }
    else if (mapField === "mapScale") {
      const value = Number(field.value);
      if (!Number.isFinite(value)) return;
      mapDraft.mapScale = clamp(value, MAP_SCALE_MIN, MAP_SCALE_MAX);
    }
    else if (mapField === "field" || mapField === "path" || mapField === "accent") mapDraft.palette[mapField] = field.value;
    else if (mapField === "entryEdge" || mapField === "exitEdge") {
      const edge = field.value as MapEdge;
      if (edge !== "left" && edge !== "right" && edge !== "top" && edge !== "bottom") return;
      checkpointMapDraft();
      if (mapField === "entryEdge") {
        const current = mapDraft.path[0];
        if (current) {
          const position = terminalPosition(mapDraft.entryEdge, current);
          mapDraft.entryEdge = edge;
          mapDraft.path[0] = terminalPoint(edge, position);
        }
      } else {
        const current = mapDraft.path[mapDraft.path.length - 1];
        if (current) {
          const position = terminalPosition(mapDraft.exitEdge, current);
          mapDraft.exitEdge = edge;
          mapDraft.path[mapDraft.path.length - 1] = terminalPoint(edge, position);
        }
      }
    }
    renderMapEditor();
    return;
  }
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
    else if (enemyField === "shieldHp") enemyDraft.shieldHp = Math.max(0, Math.min(10_000_000, Math.round(number || 0)));
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
    query<HTMLElement>("#enemy-preview-stats").textContent = enemyStatLine(enemyDraft).replaceAll(" · ", " // ");
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
  const modeId = field.dataset["modeSelect"];
  if (field instanceof HTMLInputElement && modeId) {
    if (field.checked) selectedModeIds.add(modeId);
    else selectedModeIds.delete(modeId);
    updateSelectedModeCount();
    return;
  }
  const mapId = field.dataset["mapSelect"];
  if (field instanceof HTMLInputElement && mapId) {
    if (field.checked) selectedMapIds.add(mapId);
    else selectedMapIds.delete(mapId);
    updateSelectedMapCount();
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
    customMaps = sanitizeCustomMaps(parsed.customMaps);
    creatorFolders = sanitizeCreatorFolders(parsed.creatorFolders);
    cacheProgressLocally(progress);
    cacheCustomEnemiesLocally(customEnemies);
    cacheCustomModesLocally(customModes);
    cacheCustomMapsLocally(customMaps);
    cacheCreatorFoldersLocally(creatorFolders);
    const written = await replaceDiskSave(currentSaveBundle());
    game.setAvailableTowers(progress.loadout);
    selectedMode = NORMAL_MODE;
    selectedMap = MAP_DEFINITIONS.sector07;
    renderMeta();
    renderModeList();
    renderMapLibrary();
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

query<HTMLInputElement>("#map-import-input").addEventListener("change", async (event) => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) await importMapFromFile(file);
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
  else if (["1", "2", "3", "4", "5"].includes(event.key)) {
    const kind = progress.loadout[loadoutIndexForDisplaySlot(Number(event.key))];
    if (kind) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      game.selectKind(kind);
    }
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
