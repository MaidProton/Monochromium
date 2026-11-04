import "./style.css";
import { dismissBossHudEntry, visibleBossHudEntries } from "./ui/bossHud.ts";
import { mechaAbilityState, mechaWeaponStatus, renderMechaControls, renderTankCooldowns, tankCooldownState } from "./ui/mechaControls.ts";
import { CONTROL_REFERENCE, icon } from "./ui/icons.ts";
import { captureDraftBaseline, getPauseMenuPolicy, hasDraftChanged } from "./ui/interactionPolicy.ts";
import { frontScreenBackTarget, resolveEscapeAction, type FrontScreen, type OverlayState } from "./ui/navigation.ts";
import {
  createInGameChatStore,
  renderChatEntryHtml,
  renderToastHtml,
  sanitizeChatInput,
  type InGameChatState,
} from "./ui/overlays/ingameChat.ts";
import {
  EnemyCreatorV4Editor,
  drawPreviewPolygon,
  drawingCursorSvg,
  findClosestDrawingZoom,
  floodFillImageData,
  paintPixelDrawingStroke,
  paintSmoothDrawingStroke,
} from "./ui/enemyCreator/index.ts";
import { handleShopAction, renderTowerShopHtml, updateShopAndLoadoutUi } from "./ui/screens/towerShop.ts";
import {
  cloneTowerDefinition,
  renderBalanceFieldsHtml,
  setBalanceValueAtPath,
  updateDebugDashboardUi,
} from "./ui/overlays/debugPanel.ts";
import {
  formatMultiplayerRoomCode,
  isMultiplayerRoomCodeValid,
  renderMultiplayerLoadoutGridHtml,
  resolveMultiplayerStatusLabel,
} from "./ui/screens/multiplayerLobby.ts";
import {
  type MapSelectionState,
  getMapSelectionLabel,
  isPathBlockerSelection,
  renderCreatorBlockListHtml,
  renderCreatorWaveListHtml,
  renderMapBlockerListHtml,
  renderMapPathListHtml,
} from "./ui/screens/creatorScreens.ts";
import {
  DEFAULT_UI_PREFERENCES,
  GRAPHICS_PRESET_VALUES,
  applyGraphicsPreset,
  loadUiPreferences,
  markGraphicsPresetPromptSeen,
  prefersReducedMotion,
  saveUiPreferences,
  sanitizeUiPreferences,
  shouldPromptForGraphicsPreset,
  type UiPreferences,
} from "./ui/preferences.ts";
import {
  COMBAT_RULES,
  DEFAULT_MAP_SCALE,
  ECONOMY_RULES,
  getTankHeatCap,
  MAP_DEFINITIONS,
  MAP_SCALE_MAX,
  MAP_SCALE_MIN,
  MODE_DEFINITIONS,
  HARD_MODE,
  NORMAL_MODE,
  TOWER_DEFINITIONS,
  TOWER_ORDER,
  TOWER_PERK_DEFINITIONS,
  TOWER_PERK_ORDER,
  WORLD_WIDTH,
  WORLD_HEIGHT,
} from "./game/config.ts";
import { Game, type GameUiState } from "./game/Game.ts";
import { calculateOfficialRunReward } from "./game/runRewards.ts";
import { AudioSystem, type AudioBus, type AudioSettings } from "./game/audio.ts";
import { DAMAGE_TYPES, DEFAULT_ENEMY_RESISTANCES, type EnemyResistances } from "./game/damageTypes.ts";
import { isValidCustomEnemyDrawing } from "./game/customEnemyAppearance.ts";
import { calculateFitZoom, calculateOutputTransform, clampSides, createCropPath, type CropShape } from "./ui/enemyCreator/cropMath.ts";
import {
  cacheCustomEnemiesLocally,
  cloneCustomEnemy,
  createCustomEnemy,
  createCustomEnemyAttack,
  createCustomEnemyBehaviorAction,
  createCustomEnemyBehaviorRule,
  loadCustomEnemies,
  sanitizeCustomEnemies,
  sanitizeCustomEnemiesDetailed,
  saveCustomEnemies,
  upsertCustomEnemy,
  validateCustomEnemyDraft,
  type CustomEnemyDraft,
  type EnemyBehaviorActionType,
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
  MAX_MAP_PATHS,
  MAX_PATH_BLOCKERS,
  MAP_PATH_WIDTH_MAX,
  MAP_PATH_WIDTH_MIN,
  PATH_BLOCKER_LENGTH_MAX,
  PATH_BLOCKER_LENGTH_MIN,
  cacheCustomMapsLocally,
  cloneCustomMap,
  createBlockedZone,
  createCustomMap,
  createCustomMapPath,
  createPathPlacementBlocker,
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
  createMapPathShapes,
  drawBlockedZone,
  drawMapBackdrop,
  drawMapCore,
  drawMapField,
  drawMapPath,
  drawPathPlacementBlocker,
  mapWorldBounds,
  normalizedMapScale,
  scaleMapDefinition,
  scaleMapPoint,
} from "./game/mapRendering.ts";
import { clamp, distance, Polyline } from "./game/math.ts";
import {
  GAME_VERSION,
  MULTIPLAYER_PROTOCOL_VERSION,
  MultiplayerSession,
  sanitizeMultiplayerPlayer,
  type MultiplayerConnectionStatus,
  type MultiplayerControlMessage,
  type MultiplayerLobbyState,
  type MultiplayerPlayer,
  type MultiplayerRealtimeMessage,
  type MultiplayerResult,
  type MultiplayerSessionStart,
} from "./game/multiplayer.ts";
import { isReplicationKeyframe, ReplicationDecoder } from "./game/replication.ts";
import { isValidMultiplayerLobbyState, isValidMultiplayerResult, isValidMultiplayerSessionStart } from "./game/multiplayerValidation.ts";
import { createSimulationReplay, serializeSimulationReplay, type SimulationReplayBundle, type SimulationReplayCommand } from "./game/replay.ts";
import type {
  CommandResult,
  HostServerOutboundMessage,
  SimulationCommandEnvelope,
  SimulationSessionConfig,
  SimulationServerDiagnostics,
} from "./game/simulationProtocol.ts";
import { cacheProgressLocally, loadProgress, resetProgress, sanitizeProgress, saveProgress, toggleTowerLoadout, unlockEveryTower } from "./game/meta.ts";
import { getDesktopEnvironment, hasDiskSaveApi, loadDiskSave, replaceDiskSave, sanitizeSaveBundle, type SaveBundle } from "./game/persistence.ts";
import { getTowerAbilitySlotsWithPerks, getTowerAbilityWithPerks } from "./game/towerPerks.ts";
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
import type { BlockedZone, EnemyAttackEffectDefinition, EnemyAttackVisualDefinition, EnemyAttackVisualType, MapDefinition, MapKind, ModeDefinition, PathPlacementBlocker, Point, TargetingMode, TowerAbilitySlot, TowerDefinition, TowerKind } from "./game/types.ts";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing app root");

const DESKTOP_MIN_WIDTH = 960;
const DESKTOP_MIN_HEIGHT = 600;
const desktopBridge = window.monochromiumDesktop;
if (!desktopBridge || window.innerWidth < DESKTOP_MIN_WIDTH || window.innerHeight < DESKTOP_MIN_HEIGHT) {
  document.documentElement.classList.add("desktop-only-blocked");
  app.innerHTML = `
    <main class="desktop-required-screen" role="alert">
      <span class="onboarding-kicker">MONOCHROMIUM // DESKTOP BUILD</span>
      <h1>DESKTOP APP REQUIRED</h1>
      <p>Monochromium is distributed as a Windows desktop application. Launch the installed app in a window at least ${DESKTOP_MIN_WIDTH} × ${DESKTOP_MIN_HEIGHT}.</p>
    </main>
  `;
  throw new Error("Monochromium requires the Electron desktop app and a desktop-sized window.");
}

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="stage-topline">
        <span id="mode-label">MODE 01 // NORMAL</span>
        <span id="threat-label">THREAT: DORMANT</span>
        <span id="multiplayer-hud" hidden>ALLY // OFFLINE</span>
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
        <button class="hud-control" id="hud-chat-toggle" data-action="toggle-ingame-chat" data-testid="hud-chat-toggle" aria-label="Toggle team chat" title="Chat (Enter)" hidden>
          ${icon("chat")}<span>Chat</span>
          <span class="hud-chat-badge" id="hud-chat-badge" hidden>0</span>
        </button>
        <button class="hud-control" data-action="multiplayer-link" aria-label="Open multiplayer room" title="Multiplayer room" hidden>
          ${icon("users")}<span>Room</span>
        </button>
        <button class="hud-control" data-action="speed" aria-label="Change game speed" title="Change speed">
          ${icon("speed")}<span id="speed-label">1×</span>
        </button>
        <button class="hud-control" data-action="pause" aria-label="Pause game" title="Pause (P)">
          ${icon("pause")}<span id="pause-icon">Pause</span>
        </button>
        <button class="hud-control menu-control" data-action="main-menu" aria-label="Open game menu" title="Game menu (Esc)">
          ${icon("menu")}<span>Menu</span>
        </button>
      </div>
    </header>

    <section class="settings-screen" id="audio-settings" aria-label="Settings" role="dialog" aria-modal="true" hidden>
      <div class="settings-card">
      <div class="settings-head">
        <div><span>SETTINGS</span><small>DISPLAY, COMFORT, AUDIO, AND SYSTEM</small></div>
        <button data-action="audio-settings-close" aria-label="Close settings">×</button>
      </div>
      <div class="settings-body">
        <section class="settings-section">
          <header><span>DISPLAY</span><small>WINDOW AND INTERFACE</small></header>
          <label class="setting-row"><span><strong>Display mode</strong><small>Switch without leaving your current screen.</small></span><select id="ui-display-mode" data-ui-preference="displayMode"><option value="windowed">Windowed</option><option value="fullscreen">Fullscreen</option></select></label>
          <label class="setting-row"><span><strong>Interface scale</strong><small>Scale menus and battle controls, not the battlefield.</small></span><select id="ui-scale" data-ui-preference="uiScale"><option value="0.9">90%</option><option value="1">100%</option><option value="1.1">110%</option><option value="1.25">125%</option></select></label>
          <label class="setting-row"><span><strong>Graphics preset</strong><small>Presets fill the manual controls below. Any manual change selects Custom.</small></span><select id="ui-effects-quality" data-ui-preference="effectsQuality"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="extra-low">Extra Low</option><option value="custom">Custom</option></select></label>
          <label class="setting-slider"><span><strong>Canvas resolution</strong><output id="ui-canvas-resolution-value">200%</output></span><input id="ui-canvas-resolution" data-ui-preference="canvasResolution" type="range" min="0.5" max="2" step="0.05" value="2"></label>
          <label class="setting-slider"><span><strong>Particle density</strong><output id="ui-particle-density-value">100%</output></span><input id="ui-particle-density" data-ui-preference="particleDensity" type="range" min="0.2" max="1" step="0.01" value="1"></label>
          <label class="setting-slider"><span><strong>Projectile density</strong><output id="ui-projectile-density-value">100%</output></span><input id="ui-projectile-density" data-ui-preference="projectileDensity" type="range" min="0.25" max="1" step="0.01" value="1"></label>
          <label class="graphics-toggle-row"><input id="ui-interface-blur" data-ui-preference="interfaceBlur" type="checkbox"><span><strong>Interface blur</strong><small>Backdrop blur on menus, HUD panels, and inspectors.</small></span><b id="ui-interface-blur-value">ON</b></label>
          <label class="graphics-toggle-row"><input id="ui-ambient-effects" data-ui-preference="ambientEffects" type="checkbox"><span><strong>Ambient effects</strong><small>Battlefield atmosphere and moving scanline accents.</small></span><b id="ui-ambient-effects-value">ON</b></label>
          <label class="graphics-toggle-row"><input id="ui-menu-atmosphere" data-ui-preference="menuAtmosphere" type="checkbox"><span><strong>Menu atmosphere</strong><small>Decorative menu, victory, and game-over lighting.</small></span><b id="ui-menu-atmosphere-value">ON</b></label>
          <label class="graphics-toggle-row"><input id="ui-interface-shadows" data-ui-preference="interfaceShadows" type="checkbox"><span><strong>Interface shadows</strong><small>Panel and control drop shadows.</small></span><b id="ui-interface-shadows-value">ON</b></label>
          <label class="graphics-toggle-row"><input id="ui-interface-animations" data-ui-preference="interfaceAnimations" type="checkbox"><span><strong>Interface animations</strong><small>Menu transitions and decorative UI motion.</small></span><b id="ui-interface-animations-value">ON</b></label>
          <label class="graphics-toggle-row"><input id="ui-canvas-glow" data-ui-preference="canvasGlow" type="checkbox"><span><strong>Canvas glow</strong><small>Particle, projectile, and tower shadow glow.</small></span><b id="ui-canvas-glow-value">ON</b></label>
          <small class="graphics-status" id="ui-gpu-status" aria-live="polite">Renderer status: checking…</small>
        </section>
        <section class="settings-section">
          <header><span>COMFORT</span><small>MOTION AND SCREEN EFFECTS</small></header>
          <label class="setting-row"><span><strong>Motion</strong><small>Reduced motion removes nonessential animation and shake.</small></span><select id="ui-motion" data-ui-preference="motion"><option value="system">Use system setting</option><option value="reduced">Reduced</option><option value="full">Full</option></select></label>
          <label class="setting-slider"><span><strong>Screen shake</strong><output id="ui-screen-shake-value">100%</output></span><input id="ui-screen-shake" data-ui-preference="screenShake" type="range" min="0" max="1" step="0.05" value="1"></label>
          <label class="setting-slider"><span><strong>Scanline intensity</strong><output id="ui-scanline-value">30%</output></span><input id="ui-scanline" data-ui-preference="scanlineIntensity" type="range" min="0" max="1" step="0.05" value="0.3"></label>
        </section>
        <section class="settings-section audio-section">
          <header><span>AUDIO</span><small>PROCEDURAL MIXER</small></header>
          <label class="audio-enabled-row"><input id="audio-enabled" data-audio-enabled type="checkbox"><span><strong>Sound enabled</strong><small>Mute all audio without changing the mix.</small></span><b id="audio-enabled-value">ON</b></label>
          <div class="audio-slider-list">
            <label><span><b>MASTER</b><output id="audio-value-master">100%</output></span><input type="range" min="0" max="1" step="0.01" value="1" data-audio-volume="master" aria-label="Master volume"></label>
            <label><span><b>TOWERS</b><output id="audio-value-towers">100%</output></span><input type="range" min="0" max="1" step="0.01" value="1" data-audio-volume="towers" aria-label="Tower volume"></label>
            <label><span><b>ENEMIES</b><output id="audio-value-enemies">100%</output></span><input type="range" min="0" max="1" step="0.01" value="1" data-audio-volume="enemies" aria-label="Enemy volume"></label>
            <label><span><b>UI</b><output id="audio-value-ui">100%</output></span><input type="range" min="0" max="1" step="0.01" value="1" data-audio-volume="ui" aria-label="UI volume"></label>
          </div>
        </section>
        <section class="settings-section controls-section">
          <header><span>CONTROLS</span><small>KEYBOARD AND MOUSE REFERENCE</small></header>
          <div class="controls-reference">${CONTROL_REFERENCE.map((control) => `<div><kbd>${control.keys}</kbd><span><strong>${control.label}</strong><small>${control.description}</small></span></div>`).join("")}</div>
        </section>
        <section class="settings-section system-section">
          <header><span>SYSTEM</span><small>SAVES, UPDATES, AND TOOLS</small></header>
          <div class="system-actions"><button class="secondary-button" data-action="export-save">EXPORT SAVE</button><button class="secondary-button" data-action="import-save">IMPORT SAVE</button><button class="secondary-button" data-action="debug">DEVELOPER TOOLS</button></div>
          <input id="save-import-input" type="file" accept="application/json,.json" hidden>
          <small class="save-notice" id="save-status">Checking disk save service…</small>
          <section class="update-panel" id="update-panel" hidden aria-live="polite">
            <div><span>SYSTEM UPDATE</span><strong id="update-status">Updater unavailable</strong></div>
            <div class="update-progress-wrap" id="update-progress-wrap" hidden><div class="update-progress" role="progressbar" aria-label="Update progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="update-progress-bar"></span></div><small id="update-progress-value">0%</small></div>
            <div class="update-actions"><button class="secondary-button" data-action="check-update" id="check-update-button">CHECK</button><button class="secondary-button" data-action="download-update" id="download-update-button" hidden>DOWNLOAD UPDATE</button><button class="primary-button" data-action="install-update" id="install-update-button" hidden>RESTART &amp; INSTALL</button></div>
          </section>
        </section>
      </div>
      <div class="settings-foot"><span id="audio-settings-status">Settings save automatically on this device.</span><div><button class="secondary-button" data-action="audio-reset">RESET AUDIO</button><button class="secondary-button" data-action="ui-reset">RESET DISPLAY</button><button class="secondary-button" data-action="settings-reset-all">RESET ALL</button><button class="primary-button" data-action="audio-settings-close">DONE</button></div></div>
      </div>
    </section>

    <section class="game-menu-overlay" id="game-menu-overlay" role="dialog" aria-modal="true" aria-labelledby="game-menu-title" hidden>
      <div class="game-menu-card">
        <div class="overlay-kicker" id="game-menu-kicker">GAME PAUSED</div>
        <h2 id="game-menu-title">Take a breath.</h2>
        <p id="game-menu-copy">The battlefield is paused while this menu is open.</p>
        <div class="game-menu-summary"><span id="game-menu-map">MAP</span><strong id="game-menu-mode">MODE</strong></div>
        <div class="game-menu-actions">
          <button class="primary-button" data-action="resume-run">${icon("resume")}<span>Resume</span><kbd>Esc</kbd></button>
          <button class="secondary-button" data-action="sound-settings">${icon("settings")}<span>Settings</span></button>
          <button class="secondary-button" id="game-menu-pause-request" data-action="pause" hidden>${icon("pause")}<span>Request pause</span></button>
          <button class="secondary-button" id="game-menu-restart" data-action="restart-run">Restart run</button>
          <button class="danger-button" id="game-menu-leave" data-action="leave-run">${icon("exit")}<span>Leave run</span></button>
        </div>
      </div>
    </section>

    <section class="confirm-overlay" id="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-copy" hidden>
      <div class="confirm-card">
        <div class="overlay-kicker danger" id="confirm-kicker">PLEASE CONFIRM</div>
        <h2 id="confirm-title">Leave this run?</h2>
        <p id="confirm-copy">Current progress will be lost.</p>
        <div class="confirm-actions"><button class="secondary-button" data-action="confirm-cancel">Cancel</button><button class="danger-button" id="confirm-accept" data-action="confirm-accept">Leave run</button></div>
      </div>
    </section>

    <section class="graphics-setup-overlay" id="graphics-setup-overlay" role="dialog" aria-modal="true" aria-labelledby="graphics-setup-title" aria-describedby="graphics-setup-copy" hidden>
      <div class="graphics-setup-card">
        <div class="overlay-kicker">FIRST LAUNCH // DISPLAY CHECK</div>
        <h2 id="graphics-setup-title">Choose your graphics preset.</h2>
        <p id="graphics-setup-copy">These settings affect cosmetic effects and interface compositing. You can change them later in Settings.</p>
        <p class="graphics-setup-status" id="graphics-setup-status" aria-live="polite">Checking the renderer…</p>
        <div class="graphics-preset-grid">
          <button class="graphics-preset-option" data-action="choose-graphics-preset" data-preset="high"><strong>HIGH</strong><small>Full effects and interface finish.</small></button>
          <button class="graphics-preset-option" data-action="choose-graphics-preset" data-preset="medium"><strong>MEDIUM</strong><small>Balanced effects with lighter compositing.</small></button>
          <button class="graphics-preset-option" data-action="choose-graphics-preset" data-preset="low"><strong>LOW</strong><small>Reduced particles, ambient effects, and blur.</small></button>
          <button class="graphics-preset-option" data-action="choose-graphics-preset" data-preset="extra-low"><strong>EXTRA LOW</strong><small>Smallest canvas load, minimal effects, and reduced motion.</small></button>
        </div>
      </div>
    </section>

    <section class="drawing-modal" id="enemy-drawing-overlay" role="dialog" aria-modal="true" aria-labelledby="enemy-drawing-title" aria-describedby="enemy-drawing-copy" hidden>
      <div class="drawing-modal-card">
        <header class="drawing-modal-head"><div><span class="overlay-kicker">ENEMY CREATOR // ARTWORK LAB</span><h2 id="enemy-drawing-title">Draw the enemy.</h2><p id="enemy-drawing-copy">The editor is isolated here so the canvas stays clear and responsive.</p></div><button class="drawing-modal-close" type="button" data-action="enemy-close-drawing-editor" aria-label="Close drawing editor">×</button></header>
        <div class="drawing-editor" id="enemy-drawing-editor">
          <div class="drawing-toolbar">
            <label><span>TOOL</span><select id="enemy-drawing-tool"><option value="brush">BRUSH</option><option value="eraser">ERASER</option><option value="fill">FLOOD FILL</option><option value="pan">PAN</option></select></label>
            <label><span>BRUSH COLOR</span><input id="enemy-drawing-color" type="color" value="#d46cff"></label>
            <label><span>BRUSH SIZE <output id="enemy-drawing-size-value">12 PX</output></span><input id="enemy-drawing-size" type="range" min="1" max="48" step="1" value="12"></label>
            <label><span>OPACITY <output id="enemy-drawing-opacity-value">100%</output></span><input id="enemy-drawing-opacity" type="range" min="1" max="100" step="1" value="100"></label>
            <label><span>HARDNESS <output id="enemy-drawing-hardness-value">80%</output></span><input id="enemy-drawing-hardness" type="range" min="0" max="100" step="1" value="80"></label>
            <label><span>RENDER MODE</span><select id="enemy-drawing-render-mode"><option value="smooth">SMOOTH</option><option value="pixel">PIXEL</option></select></label>
            <label><span>CANVAS SIZE</span><select id="enemy-drawing-resolution"><option value="128">128×128</option><option value="256">256×256</option></select></label>
            <button type="button" class="secondary-button" data-action="enemy-drawing-undo">UNDO</button>
            <button type="button" class="secondary-button" data-action="enemy-drawing-redo">REDO</button>
            <button type="button" class="secondary-button" data-action="enemy-drawing-clear">CLEAR</button>
            <span class="drawing-toolbar-divider" aria-hidden="true"></span>
            <button type="button" class="secondary-button" data-action="enemy-drawing-zoom-out" aria-label="Zoom out">−</button>
            <output id="enemy-drawing-zoom-value" class="drawing-zoom-value">100%</output>
            <button type="button" class="secondary-button" data-action="enemy-drawing-zoom-in" aria-label="Zoom in">+</button>
            <button type="button" class="secondary-button" data-action="enemy-drawing-grid">GRID</button>
            <span class="drawing-toolbar-divider" aria-hidden="true"></span>
            <button type="button" class="secondary-button" data-action="enemy-drawing-upload" data-testid="enemy-drawing-upload-button">UPLOAD IMAGE</button>
          </div>
          <div class="drawing-canvas-stage" id="enemy-drawing-canvas-stage">
            <div class="drawing-canvas-wrap" id="enemy-drawing-canvas-wrap">
              <canvas id="enemy-drawing-canvas" width="128" height="128" data-testid="enemy-drawing-canvas" aria-label="Draw custom enemy appearance"></canvas>
              <div id="enemy-drawing-grid" aria-hidden="true"></div>
              <div id="enemy-drawing-brush-preview" aria-hidden="true"></div>
            </div>
          </div>
        </div>
        <footer class="drawing-modal-foot"><span>BRUSH: draw // FLOOD FILL: click a region // PAN: drag the zoomed canvas // ESC: close</span><button class="primary-button" type="button" data-action="enemy-close-drawing-editor">DONE</button></footer>
      </div>
    </section>

    <input id="enemy-image-upload-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" hidden>

    <section class="drawing-modal enemy-crop-modal" id="enemy-crop-modal" role="dialog" aria-modal="true" aria-labelledby="enemy-crop-title" aria-describedby="enemy-crop-copy" hidden>
      <div class="drawing-modal-card enemy-crop-card">
        <header class="drawing-modal-head">
          <div>
            <span class="overlay-kicker">ENEMY CREATOR // SPRITE CROPPER</span>
            <h2 id="enemy-crop-title">Crop &amp; convert image.</h2>
            <p id="enemy-crop-copy">Drag to pan, wheel or slider to zoom. Auto-formats to a 1:1 shape and converts to a 128×128 or 256×256 sprite.</p>
          </div>
          <button class="drawing-modal-close" type="button" data-action="enemy-close-crop-modal" aria-label="Close image cropper">×</button>
        </header>
        <div class="crop-modal-body">
          <div class="crop-toolbar">
            <label><span>SHAPE</span><select id="enemy-crop-shape"><option value="circle">CIRCLE</option><option value="square">SQUARE</option><option value="polygon">POLYGON</option></select></label>
            <label id="enemy-crop-sides-group" hidden><span>SIDES <output id="enemy-crop-sides-value">5</output></span><input id="enemy-crop-sides" type="range" min="3" max="12" step="1" value="5"></label>
            <label><span>CANVAS SIZE</span><select id="enemy-crop-resolution"><option value="128">128×128</option><option value="256">256×256</option></select></label>
            <span class="drawing-toolbar-divider" aria-hidden="true"></span>
            <button type="button" class="secondary-button" data-action="enemy-crop-zoom-out" aria-label="Zoom out">−</button>
            <label class="crop-zoom-label"><span>ZOOM <output id="enemy-crop-zoom-value">100%</output></span><input id="enemy-crop-zoom-slider" type="range" min="10" max="500" step="2" value="100"></label>
            <button type="button" class="secondary-button" data-action="enemy-crop-zoom-in" aria-label="Zoom in">+</button>
            <span class="drawing-toolbar-divider" aria-hidden="true"></span>
            <button type="button" class="secondary-button" data-action="enemy-crop-fit">FIT</button>
            <button type="button" class="secondary-button" data-action="enemy-crop-center">CENTER</button>
          </div>
          <div class="crop-stage-layout">
            <div class="crop-canvas-stage" id="enemy-crop-canvas-stage">
              <canvas id="enemy-crop-canvas" width="340" height="340" data-testid="enemy-crop-canvas" aria-label="Interactive image cropper"></canvas>
            </div>
            <aside class="crop-preview-panel">
              <div class="crop-preview-header">
                <span>PREVIEW</span>
                <small id="enemy-crop-preview-size">128×128 SPRITE</small>
              </div>
              <div class="crop-preview-box">
                <canvas id="enemy-crop-preview-canvas" width="128" height="128" data-testid="enemy-crop-preview-canvas" aria-label="Cropped sprite preview"></canvas>
              </div>
              <p class="crop-preview-hint">Sprite is auto-scaled and masked to the 1:1 shape.</p>
            </aside>
          </div>
        </div>
        <footer class="drawing-modal-foot">
          <span>DRAG: pan // WHEEL: zoom // 1:1 CROP MASK // ESC: cancel</span>
          <div class="crop-foot-actions">
            <button class="secondary-button" type="button" data-action="enemy-close-crop-modal">CANCEL</button>
            <button class="primary-button" type="button" data-action="enemy-apply-crop" data-testid="enemy-apply-crop-button">APPLY &amp; CONVERT</button>
          </div>
        </footer>
      </div>
    </section>

    <div class="playfield-layout">
    <main class="game-stage" aria-label="Battlefield">
      <canvas id="game-canvas" aria-label="Monochromium game battlefield"></canvas>
      <button class="aim-cancel" id="aim-cancel" data-action="cancel-aim" hidden>CANCEL AIM <kbd>RMB</kbd></button>
      <button class="aim-cancel" id="move-cancel" data-action="cancel-move" hidden>CANCEL MOVE <kbd>RMB</kbd></button>
      <div class="scanline" aria-hidden="true"></div>
      <div class="stage-left-overlay" id="stage-left-overlay">
        <section class="ingame-chat-panel" id="ingame-chat" aria-label="Team chat" data-testid="ingame-chat" hidden>
          <header class="ingame-chat-header" id="ingame-chat-header" data-action="minimize-ingame-chat" title="Click to collapse or expand">
            <div class="ingame-chat-title">
              <span class="ingame-chat-status-dot" aria-hidden="true"></span>
              <strong>TEAM CHAT</strong>
              <span class="ingame-chat-min-badge" id="ingame-chat-min-badge" hidden>0</span>
            </div>
            <div class="ingame-chat-header-actions">
              <button type="button" class="ingame-chat-btn" id="ingame-chat-minimize" data-action="minimize-ingame-chat" title="Minimize chat" aria-label="Minimize chat">−</button>
              <button type="button" class="ingame-chat-btn" id="ingame-chat-close" data-action="close-ingame-chat" title="Close chat (Esc)" aria-label="Close chat">×</button>
            </div>
          </header>
          <div class="ingame-chat-body" id="ingame-chat-body">
            <div class="ingame-chat-log" id="ingame-chat-log" aria-live="polite"></div>
            <form class="ingame-chat-form" id="battle-chat-form">
              <input type="text" id="battle-chat-input" maxlength="160" autocomplete="off" spellcheck="false" placeholder="Press Enter or type to chat..." />
              <button type="submit" class="ingame-chat-send" id="battle-chat-send" aria-label="Send message">SEND</button>
            </form>
          </div>
        </section>
        <div class="ingame-chat-toast" id="ingame-chat-toast" aria-live="polite" hidden></div>
        <div class="event-console" id="battle-log" aria-label="Event log">
          <div class="console-head"><span>FIELD LOG</span><time id="clock">00:00:00</time></div>
          <div id="log-entries" class="log-entries" aria-live="polite">
            <p><time>SYS</time><span>Awaiting operator authorization.</span></p>
          </div>
        </div>
      </div>
      <div class="boss-hud" id="boss-hud" aria-live="polite" hidden></div>
      <div class="pause-banner" id="pause-banner" hidden>SIMULATION SUSPENDED</div>

      <aside class="debug-panel" id="debug-panel" aria-label="Debug tools" hidden>
        <div class="debug-header">
          <div class="debug-heading-copy"><div class="debug-title-line"><span>OPERATOR CONSOLE</span><kbd>F1</kbd></div><small>DEVELOPMENT SANDBOX // LOCAL RUNS ONLY</small></div>
          <div class="debug-header-actions"><span class="debug-live-dot" aria-hidden="true"></span><button data-action="debug-close" aria-label="Close debug tools">×</button></div>
        </div>
        <div class="debug-scroll">
          <section class="debug-overview" aria-label="Live debug overview">
            <div class="debug-overview-copy"><span class="debug-eyebrow">LIVE SESSION</span><strong id="debug-run-status">NO RUN ACTIVE</strong><small id="debug-run-context">Start a run to inspect the sandbox.</small></div>
            <div class="debug-overview-mode" id="debug-run-mode">STANDBY</div>
            <div class="debug-metrics" aria-label="Runtime metrics">
              <div><span>WAVE</span><b id="debug-wave-value">—</b></div>
              <div><span>HOSTILES</span><b id="debug-enemy-value">—</b></div>
              <div><span>TOWERS</span><b id="debug-tower-value">—</b></div>
              <div><span>CORE</span><b id="debug-core-value">—</b></div>
              <div><span>RUN TIME</span><b id="debug-time-value">—</b></div>
              <div><span>CASH</span><b id="debug-cash-value">—</b></div>
            </div>
          </section>

          <section class="debug-section debug-wallet-section" aria-labelledby="debug-wallet-title">
            <div class="debug-section-heading"><div><span id="debug-wallet-title">PROFILE WALLET</span><small>Persistent shop currencies // writes to the local save</small></div><span class="debug-save-badge" id="debug-save-badge">SYNCED</span></div>
            <div class="debug-wallet-grid">
              <div class="debug-wallet-card coins"><div class="debug-wallet-card-head"><span class="debug-currency-icon">¢</span><div><span>COINS</span><small id="debug-coins-note">SHOP + TOWER UNLOCKS</small></div></div><strong id="debug-coins-value">0</strong><div class="debug-wallet-actions"><button class="debug-mutation" data-debug-mutation data-action="debug-add-coins" data-debug-amount="500" data-testid="debug-add-coins-500">+500</button><button class="debug-mutation" data-debug-mutation data-action="debug-add-coins" data-debug-amount="5000">+5K</button></div></div>
              <div class="debug-wallet-card tokens"><div class="debug-wallet-card-head"><span class="debug-currency-icon">◆</span><div><span>TOKENS</span><small>ADVANCED CONTENT</small></div></div><strong id="debug-tokens-value">0</strong><div class="debug-wallet-actions"><button class="debug-mutation" data-debug-mutation data-action="debug-add-tokens" data-debug-amount="1" data-testid="debug-add-token">+1</button><button class="debug-mutation" data-debug-mutation data-action="debug-add-tokens" data-debug-amount="10">+10</button></div></div>
            </div>
            <div class="debug-wallet-footer"><span id="debug-wallet-status">Wallet changes are permanent.</span><div><button class="debug-text-button debug-mutation" data-debug-mutation data-action="debug-max-wallet">MAX WALLET</button><button class="debug-text-button danger debug-mutation" data-debug-mutation data-action="debug-reset-wallet">RESET WALLET</button></div></div>
          </section>

          <section class="debug-section" aria-labelledby="debug-profile-title">
            <div class="debug-section-heading"><div><span id="debug-profile-title">PROFILE OVERRIDES</span><small>Unlock and equip content for shop/loadout testing</small></div><span class="debug-count" id="debug-profile-count">0 / 0</span></div>
            <div class="debug-action-grid profile-actions">
              <button class="debug-action debug-mutation" data-debug-mutation data-action="debug-unlock"><span class="debug-action-icon">▦</span><span><b>UNLOCK ALL TOWERS</b><small>Unlock + fill five tower slots</small></span></button>
              <button class="debug-action debug-mutation" data-debug-mutation data-action="debug-unlock-perks"><span class="debug-action-icon">✦</span><span><b>UNLOCK ALL PERKS</b><small>Mark every perk as owned</small></span></button>
              <button class="debug-action debug-mutation" data-debug-mutation data-action="debug-equip-perks"><span class="debug-action-icon">◆</span><span><b>EQUIP ALL PERKS</b><small>Fill the three perk slots</small></span></button>
              <button class="debug-action debug-mutation" data-debug-mutation data-action="debug-reload-profile"><span class="debug-action-icon">↻</span><span><b>RELOAD PROFILE</b><small>Reapply saved towers + perks</small></span></button>
            </div>
          </section>

          <section class="debug-section" aria-labelledby="debug-run-title">
            <div class="debug-section-heading"><div><span id="debug-run-title">RUN SANDBOX</span><small>Live-only controls // disabled in multiplayer</small></div><span class="debug-count" id="debug-selected-value">NO SELECTION</span></div>
            <div class="debug-action-grid run-actions">
              <button class="debug-action debug-mutation" data-debug-mutation data-action="debug-cash-toggle"><span class="debug-action-icon">∞</span><span><b>INFINITE CASH</b><small id="debug-cash-state">OFF // deploy and upgrade free</small></span></button>
              <button class="debug-action debug-mutation" data-debug-mutation data-action="debug-cash"><span class="debug-action-icon">$</span><span><b>ADD RUN CASH</b><small>+ $1,000 battlefield shards</small></span></button>
              <button class="debug-action debug-mutation" data-debug-mutation data-action="debug-heal"><span class="debug-action-icon">+</span><span><b>RESTORE CORE</b><small>Refill integrity to maximum</small></span></button>
              <button class="debug-action debug-mutation" data-debug-mutation data-action="debug-clear"><span class="debug-action-icon">×</span><span><b>CLEAR WAVE</b><small>Despawn hostiles and resolve wave</small></span></button>
              <button class="debug-action debug-mutation" data-debug-mutation data-action="debug-stock"><span class="debug-action-icon">▤</span><span><b>RESTORE STOCK</b><small>Refresh every tower copy limit</small></span></button>
              <button class="debug-action debug-mutation" data-debug-mutation data-action="debug-max"><span class="debug-action-icon">↑</span><span><b>MAX SELECTED</b><small id="debug-max-note">Select a tower first</small></span></button>
              <button class="debug-action debug-mutation" data-debug-mutation data-action="debug-speed"><span class="debug-action-icon">»</span><span><b>CYCLE SPEED</b><small id="debug-speed-note">Simulation speed</small></span></button>
              <button class="debug-action debug-mutation" data-debug-mutation data-action="restart"><span class="debug-action-icon">↺</span><span><b>RESTART RUN</b><small>Return to wave one</small></span></button>
            </div>
            <div class="debug-jump-row"><label><span>JUMP TO WAVE</span><input id="debug-wave-input" type="number" min="1" max="99" value="1" inputmode="numeric"></label><button class="debug-primary-button debug-mutation" data-debug-mutation data-action="debug-jump-wave">APPLY WAVE</button></div>
          </section>

          <section class="debug-section debug-repro-section" aria-labelledby="debug-repro-title">
            <div class="debug-section-heading"><div><span id="debug-repro-title">DIAGNOSTICS + REPRO</span><small id="debug-repro-status">HOST MULTIPLAYER RUNS ONLY // CAPTURES SEED, COMMANDS, AND RECENT EVENTS</small></div><span class="debug-count" id="debug-repro-count">NO CAPTURE</span></div>
            <div class="debug-repro-actions"><button class="debug-secondary-button" data-action="debug-copy-state" data-testid="debug-copy-state">COPY STATE</button><button class="debug-secondary-button" data-action="debug-copy-repro" id="debug-copy-repro" disabled>COPY REPRO</button><button class="debug-secondary-button" data-action="debug-export-repro" id="debug-export-repro" disabled>EXPORT REPRO</button></div>
          </section>

          <section class="debug-section debug-dev-section" aria-label="Developer tools">
            <div class="debug-section-heading"><div><span>DEVELOPER TOOLS</span><small>Source-backed balance experiments</small></div><span class="debug-count">DEV BUILD</span></div>
            <button class="debug-action debug-dev-action" data-action="debug-balance" id="debug-balance-button" hidden><span class="debug-action-icon">⌘</span><span><b>TOWER BALANCE LAB</b><small>Edit live definitions and optionally save to config</small></span></button>
          </section>

          <section class="debug-danger-section">
            <div><span>DANGER ZONE</span><small>Keep creator content; remove progression and wallet state.</small></div>
            <button class="debug-danger-button debug-mutation" data-debug-mutation data-action="debug-reset-progress"><span>RESET PROGRESSION</span><b>COINS // TOKENS // UNLOCKS</b></button>
          </section>
          <p class="debug-footnote">Debug actions bypass normal rewards and are never available during multiplayer. Balance data remains editable in <code>src/game/config.ts</code>.</p>
        </div>
      </aside>

      <aside class="mode-test-panel" id="mode-test-panel" aria-label="Mode test controls" hidden>
        <div class="debug-header">
          <div><span>MODE TESTER</span><small>JUMP TO A CLEAN WAVE // NO REWARDS</small></div>
        </div>
        <div class="mode-test-controls">
          <button data-action="mode-test-wave-previous"><span>← BACK</span><b>PREVIOUS WAVE</b></button>
          <label><span>JUMP TO WAVE</span><select id="mode-test-wave-select" data-mode-test-wave></select></label>
          <button data-action="mode-test-wave-next"><span>SKIP →</span><b>NEXT WAVE</b></button>
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
        <div class="main-menu-shell">
          <section class="main-menu-hero">
            <div class="onboarding-kicker">MONOCHROMIUM // PATHBOUND DEFENSE</div>
            <h1>Hold the line.<br><em>Build your way.</em></h1>
            <p>A tactical tower defense game about positioning, timing, and knowing when to counter.</p>
            <div class="meta-wallet" aria-label="Persistent currencies"><div><span>COINS</span><strong id="meta-coins">0</strong></div><div><span>TOKENS</span><strong id="meta-tokens">0</strong></div></div>
          </section>
          <nav class="main-menu-grid" aria-label="Main menu">
            <button class="menu-tile primary" data-action="open-play">${icon("play")}<span><strong>Play</strong><small>Choose a mode, map, and loadout.</small></span><b>→</b></button>
            <button class="menu-tile" data-action="open-multiplayer">${icon("users")}<span><strong>Multiplayer</strong><small>Defend together over a direct connection.</small></span><b>→</b></button>
            <button class="menu-tile" data-action="open-shop">${icon("tower")}<span><strong>Armory</strong><small>Unlock towers and prepare your loadout.</small></span><b>→</b></button>
            <button class="menu-tile" data-action="open-creators">${icon("tools")}<span><strong>Creators</strong><small>Build modes, enemies, and maps.</small></span><b>→</b></button>
            <button class="menu-tile" id="main-settings-button" data-action="sound-settings" aria-controls="audio-settings" aria-expanded="false">${icon("settings")}<span><strong>Settings</strong><small>Display, comfort, audio, and system.</small></span><b>→</b></button>
          </nav>
        </div>
      </div>

      <div class="menu-screen multiplayer-screen" id="multiplayer-screen" hidden>
        <div class="multiplayer-heading">
          <div><div class="onboarding-kicker">SECURE ROOM // WSS RELAY</div><h2>MULTIPLAYER</h2></div>
         <div class="multiplayer-status" id="multiplayer-status" data-status="idle" aria-live="polite"><span>CONNECTION</span><strong>IDLE</strong><small>No peer connection active.</small></div>
        </div>
        <p class="multiplayer-intro">Create a room or enter your friend's code. Both players connect through the secure relay automatically—no firewall or router setup.</p>
        <div class="multiplayer-flow" aria-label="Multiplayer connection steps">
          <div id="multiplayer-step-room" class="active"><b>1</b><span>PROFILE</span><small>Name and color</small></div><i aria-hidden="true">→</i>
          <div id="multiplayer-step-link"><b>2</b><span>CONNECT</span><small>Host or join</small></div><i aria-hidden="true">→</i>
          <div id="multiplayer-step-ready"><b>3</b><span>ROOM LOBBY</span><small>Prepare the battle</small></div>
        </div>
        <div class="multiplayer-profile">
          <label><span>USERNAME</span><input id="multiplayer-username" maxlength="20" autocomplete="nickname" value="PLAYER"></label>
          <label><span>DISPLAY COLOR</span><input id="multiplayer-color" type="color" value="#66d9ff"></label>
        </div>
        <div class="multiplayer-profile-actions" id="multiplayer-profile-actions"><small>Your profile stays on this device and is shown to the other player.</small><button class="primary-button" data-action="multiplayer-profile-continue">CONTINUE <span>→</span></button></div>
        <div class="multiplayer-connect-actions" id="multiplayer-connect-actions" hidden><button class="page-back" data-action="multiplayer-profile-back">${icon("back")}<span>Profile</span></button><span>Choose how you want to enter the room.</span></div>
        <div class="multiplayer-columns">
          <section>
            <span class="multiplayer-step">HOST // 01</span><h3>HOST A ROOM</h3>
            <p>Start the room, then send your friend the room code shown below.</p>
            <button class="primary-button" id="multiplayer-create-room" data-action="multiplayer-create-room">CREATE NEW ROOM</button>
            <div class="multiplayer-room-code"><span>ROOM CODE</span><strong id="multiplayer-room-code-display" tabindex="0">--------</strong></div>
            <div class="multiplayer-code-actions">
              <button class="secondary-button" id="multiplayer-copy-room-code" data-action="multiplayer-copy-room-code" disabled>COPY INVITE</button>
            </div>
            <small class="multiplayer-room-status" id="multiplayer-room-status">Send this code to your friend, then wait for them to join.</small>
            <button class="primary-button" id="multiplayer-choose-mode" data-action="multiplayer-choose-mode" disabled>CHOOSE MODE &amp; MAP <span>→</span></button>
          </section>
          <section>
            <span class="multiplayer-step">GUEST // 01</span><h3>JOIN A FRIEND</h3>
            <p>Open their invite link, or enter the 8-character room code below.</p>
            <label><span>ROOM CODE</span><input id="multiplayer-room-code" maxlength="8" autocomplete="off" spellcheck="false" placeholder="AB12CD34" inputmode="text" aria-describedby="multiplayer-room-code-help"></label>
            <small id="multiplayer-room-code-help" class="multiplayer-code-help">Enter 8 letters/numbers to continue.</small>
            <button class="primary-button" id="multiplayer-join-room" data-action="multiplayer-join-room" disabled>JOIN ROOM</button>
            <small>Connection uses an outbound secure WebSocket. Wrong or expired codes fail immediately.</small>
          </section>
        </div>
        <div class="multiplayer-connection-actions" id="multiplayer-connection-actions" hidden>
          <button class="secondary-button" id="multiplayer-retry-connection" data-action="multiplayer-retry-connection">RETRY NOW</button>
          <button class="secondary-button" id="multiplayer-cancel-connection" data-action="multiplayer-cancel-connection">CANCEL CONNECTION</button>
        </div>
        <section class="multiplayer-room-panel" id="multiplayer-room-panel" hidden aria-live="polite">
          <div class="multiplayer-room-panel-head">
            <div><span class="multiplayer-step">ROOM // INTERMISSION</span><h3 id="multiplayer-lobby-title">ROUND LOBBY</h3><p id="multiplayer-lobby-copy">Choose the next battlefield, tune your loadout, then wait for your teammate.</p></div>
            <strong id="multiplayer-round-label">ROUND --</strong>
          </div>
          <div class="multiplayer-room-grid">
            <section class="multiplayer-selection-card">
              <div class="multiplayer-selection-preview" id="multiplayer-selection-preview"></div>
              <div class="multiplayer-selection-copy"><span>SELECTED BATTLE</span><strong id="multiplayer-selection-map">WAITING FOR HOST</strong><small id="multiplayer-selection-mode">The host is choosing a mode and map.</small></div>
              <button class="secondary-button" id="multiplayer-lobby-choose" data-action="multiplayer-choose-mode" hidden>CHANGE MODE &amp; MAP <span>↗</span></button>
            </section>
            <section class="multiplayer-loadout-card">
              <div class="multiplayer-selection-copy"><span>YOUR LOADOUT</span><small>Equip up to five owned towers from the host-authorized tower pool. Changing it clears Ready.</small></div>
              <div class="multiplayer-loadout-grid" id="multiplayer-loadout-grid"></div>
            </section>
          </div>
          <div class="multiplayer-ready-grid">
            <div class="multiplayer-ready-card"><span>HOST</span><strong id="multiplayer-host-ready">SELECTING</strong><small id="multiplayer-host-ready-copy">The host controls the next battle.</small></div>
            <div class="multiplayer-ready-card"><span>GUEST</span><strong id="multiplayer-guest-ready-state">NOT READY</strong><small id="multiplayer-guest-ready-copy">Set your loadout, then press Ready.</small></div>
          </div>
          <section class="multiplayer-chat-card" id="multiplayer-lobby-chat">
            <div class="multiplayer-chat-head"><span>TEAM COMMUNICATIONS</span><small>Live room chat</small></div>
            <div class="multiplayer-chat-log" id="multiplayer-chat-log" aria-live="polite"></div>
            <form class="multiplayer-chat-form" id="lobby-chat-form">
              <input type="text" id="lobby-chat-input" maxlength="160" autocomplete="off" spellcheck="false" placeholder="Type a message to your ally and press Enter..." />
              <button type="submit" class="secondary-button" id="lobby-chat-send">SEND</button>
            </form>
          </section>
          <div class="multiplayer-room-actions">
            <button class="secondary-button" id="multiplayer-retry-round" data-action="multiplayer-retry-round" hidden>START NEXT ROUND <span>↻</span></button>
            <button class="primary-button" id="multiplayer-guest-ready" data-action="multiplayer-guest-ready" disabled>READY FOR NEXT ROUND <span>→</span></button>
          </div>
        </section>
        <div class="multiplayer-foot"><span id="multiplayer-peer">PEER // NOT LINKED</span><span id="multiplayer-diagnostics">SERVER // OFFLINE</span><span>HIT CASH // MODE DEFINED (DEFAULT 75%) // WAVE CASH 100% EACH</span></div>
        <div class="multiplayer-screen-actions"><button class="secondary-button" data-action="multiplayer-back">BACK TO COMMAND</button><button class="primary-button" id="multiplayer-return-run" data-action="multiplayer-return-run" hidden>RETURN TO BATTLE</button></div>
      </div>

      <div class="menu-screen creator-hub" id="creator-hub" hidden>
        <button class="page-back" data-action="back-main">${icon("back")}<span>Back</span></button>
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
      </div>

      <div class="menu-screen enemy-selection" id="enemy-selection" hidden>
        <div class="mode-browser-heading">
          <button class="page-back" data-action="library-back">${icon("back")}<span>Back</span></button>
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
      </div>

      <div class="menu-screen enemy-creator" id="enemy-creator" hidden>
        <div class="creator-topbar enemy-creator-topbar">
          <div><div class="onboarding-kicker">HOSTILE ASSEMBLY</div><h2>ENEMY CREATOR</h2></div>
          <div class="enemy-creator-tab-nav" role="tablist" aria-label="Enemy Creator Tabs">
            <button type="button" class="enemy-tab-btn active" data-action="enemy-switch-tab" data-enemy-tab="stats" role="tab" aria-selected="true"><span class="tab-index">01</span><span>IDENTITY &amp; STATS</span></button>
            <button type="button" class="enemy-tab-btn" data-action="enemy-switch-tab" data-enemy-tab="appearance" role="tab" aria-selected="false"><span class="tab-index">02</span><span>APPEARANCE &amp; ART</span></button>
            <button type="button" class="enemy-tab-btn" data-action="enemy-switch-tab" data-enemy-tab="abilities" role="tab" aria-selected="false"><span class="tab-index">03</span><span>ABILITIES &amp; ATTACKS</span></button>
          </div>
          <div class="creator-actions"><button class="secondary-button" data-action="enemy-back">CANCEL</button><button class="primary-button" data-action="enemy-save">SAVE ENEMY</button></div>
        </div>
        <div class="enemy-editor-shell">
          <aside class="enemy-preview-panel">
            <div class="enemy-preview-ring"><canvas id="enemy-shape-preview" width="128" height="128" aria-label="Enemy appearance preview"></canvas></div>
            <strong id="enemy-name-preview">CUSTOM ENEMY</strong>
            <small id="enemy-preview-stats">100 HP // 36 SPEED</small>
            <div class="enemy-preview-quick-tabs">
              <button type="button" class="enemy-quick-tab active" data-action="enemy-switch-tab" data-enemy-tab="stats">01 STATS</button>
              <button type="button" class="enemy-quick-tab" data-action="enemy-switch-tab" data-enemy-tab="appearance">02 ART</button>
              <button type="button" class="enemy-quick-tab" data-action="enemy-switch-tab" data-enemy-tab="abilities">03 ABILITIES</button>
            </div>
          </aside>
          <section class="enemy-form">
            <div class="enemy-tab-panel active" id="enemy-tab-stats" data-tab-panel="stats" role="tabpanel">
              <div class="enemy-v4-base-sections">
                <section><header><span>01 // IDENTITY</span><strong>WHO THIS HOSTILE IS</strong></header><div class="enemy-field-grid"><label><span>NAME</span><input data-enemy-field="name" maxlength="40"></label><div class="enemy-v4-toggle"><label><input data-enemy-field="hidden" type="checkbox"><span>HIDDEN</span></label><label><input data-enemy-field="boss" type="checkbox"><span>BOSS</span></label></div></div></section>
                <section><header><span>02 // BASE STATS</span><strong>HEALTH AND CORE PRESSURE</strong></header><div class="enemy-field-grid"><label><span>HP</span><input data-enemy-field="hp" type="number" min="1" step="1"></label><label><span>SHIELD HP</span><input data-enemy-field="shieldHp" type="number" min="0" step="1"></label><label><span>CORE DAMAGE</span><input data-enemy-field="coreDamage" type="number" min="0" step="1"></label></div></section>
                <section><header><span>03 // MOVEMENT</span><strong>BASE PATH SPEED</strong></header><div class="enemy-field-grid"><label><span>SPEED</span><input data-enemy-field="speed" type="number" min="0" step="0.1"></label></div></section>
                <section><header><span>04 // OFFENSE</span><strong>BASE CONTACT ATTACK</strong></header><div class="enemy-field-grid"><label><span>BASE CONTACT DAMAGE</span><input data-enemy-field="damage" type="number" min="0" step="1"></label><label><span>BASE CONTACT COOLDOWN</span><input data-enemy-field="attackInterval" type="number" min="0.1" step="0.05"></label><label><span>BASE CONTACT TELEGRAPH</span><input data-enemy-field="telegraphDuration" type="number" min="0.05" step="0.05"></label></div></section>
                <section><header><span>05 // DEFENSE</span><strong>DAMAGE MITIGATION</strong></header><div class="enemy-field-grid"><label><span>DEFENSE</span><input data-enemy-field="defense" type="number" min="0" step="1"></label><label><span>PROTECTION</span><input data-enemy-field="protection" type="number" min="0" step="1"></label><label><span>ARMOR</span><input data-enemy-field="armor" type="number" min="0" max="100" step="1"></label><label><span>SUPERARMOR</span><input data-enemy-field="superarmor" type="number" min="0" max="100" step="1"></label></div></section>
                <section><header><span>06 // RESISTANCES</span><strong>DAMAGE TYPE RESISTANCE (%)</strong></header><div class="enemy-field-grid"><label><span>BULLET</span><input data-enemy-field="resistance_bullet" type="number" max="100" step="1"></label><label><span>ENERGY</span><input data-enemy-field="resistance_energy" type="number" max="100" step="1"></label><label><span>EXPLOSIVE</span><input data-enemy-field="resistance_explosive" type="number" max="100" step="1"></label><label><span>FIRE</span><input data-enemy-field="resistance_fire" type="number" max="100" step="1"></label><label><span>MELEE</span><input data-enemy-field="resistance_melee" type="number" max="100" step="1"></label></div></section>
              </div>
            </div>

            <div class="enemy-tab-panel" id="enemy-tab-appearance" data-tab-panel="appearance" role="tabpanel" hidden>
              <div class="enemy-v4-base-sections">
                <section><header><span>01 // PROCEDURAL SILHOUETTE</span><strong>GEOMETRY &amp; PALETTE</strong></header><div class="enemy-field-grid"><label><span>COLOR</span><input data-enemy-field="color" type="color"></label><label class="sides-field"><span>SHAPE SIDES <b id="enemy-sides-value">5</b></span><input data-enemy-field="sides" type="range" min="3" max="12" step="1"></label><label><span>BODY RADIUS</span><input data-enemy-field="radius" type="number" min="6" max="60" step="1"></label></div></section>
              </div>
              <section class="enemy-appearance-editor" data-testid="enemy-appearance-editor">
                <header><div><span>APPEARANCE SYSTEM</span><strong>PROCEDURAL OR FREEFORM</strong></div><small>Drawings are stored as a bounded 128×128 or 256×256 PNG.</small></header>
                <div class="appearance-mode-actions"><button type="button" class="secondary-button" data-action="enemy-use-procedural" data-testid="enemy-procedural-button">PROCEDURAL SHAPE</button><button type="button" class="secondary-button" data-action="enemy-use-drawing" data-testid="enemy-drawing-button">FREEFORM DRAWING</button></div>
                <label class="appearance-opacity"><span>BODY OPACITY <output id="enemy-opacity-value">100%</output></span><input data-enemy-field="opacity" data-testid="enemy-opacity" type="range" min="0" max="100" step="1" value="100"></label>
                <div class="drawing-launch" id="enemy-drawing-launch" hidden><span>FREEFORM ARTWORK</span><small>Edit the transparent 128×128 or 256×256 enemy sprite or upload an image to crop.</small><div class="drawing-launch-actions"><button type="button" class="secondary-button" data-action="enemy-open-drawing-editor">OPEN DRAWING EDITOR</button><button type="button" class="secondary-button" data-action="enemy-upload-image" data-testid="enemy-upload-image-button">UPLOAD IMAGE</button></div></div>
              </section>
            </div>

            <div class="enemy-tab-panel" id="enemy-tab-abilities" data-tab-panel="abilities" role="tabpanel" hidden>
              <section id="enemy-ability-v4-root" aria-label="Enemy abilities"></section>
            </div>

            <div class="legacy-enemy-compat" hidden>
              <div class="enemy-toggle-row">
                <label><input data-enemy-field="hidden" type="checkbox"><span>HIDDEN</span><small>Requires tower detection</small></label>
                <label><input data-enemy-field="boss" type="checkbox"><span>BOSS</span><small>Shows a global healthbar</small></label>
                <label><input data-enemy-field="summoningEnabled" type="checkbox"><span>SUMMONING</span><small>Periodically creates enemies</small></label>
                <label><input data-enemy-field="stunningEnabled" type="checkbox"><span>STUN SHOCKWAVE</span><small>Disables nearby towers</small></label>
                <label><input data-enemy-field="regenerationEnabled" type="checkbox"><span>REGENERATION</span><small>Continuously restores HP</small></label>
                <label><input data-enemy-field="hasteEnabled" type="checkbox"><span>HASTE PULSE</span><small>Accelerates nearby enemies</small></label>
                <label><input data-enemy-field="drainEnabled" type="checkbox"><span>SIPHON</span><small>Drains towers to heal itself</small></label>
                <label><input data-enemy-field="phaseEnabled" type="checkbox"><span>PHASE SHIFT</span><small>Becomes untargetable and slips through blockers</small></label>
                <label><input data-enemy-field="blinkEnabled" type="checkbox"><span>BLINK</span><small>Jumps forward along its path</small></label>
                <label><input data-enemy-field="timeLockEnabled" type="checkbox"><span>TIME LOCK</span><small>Stops after the configured path distance</small></label>
                <label><input data-enemy-field="waveLockEnabled" type="checkbox"><span>WAVE LOCK</span><small>Stops until future waves pass</small></label>
              </div>
              <section class="special-editor" id="summoning-editor" hidden>
                <header><div><span>SPECIAL ABILITY</span><strong>SUMMONING</strong></div><small>Summons appear slightly behind this enemy.</small></header>
                <div class="special-fields"><label><span>COOLDOWN</span><input data-enemy-field="summonInterval" type="number" min="0.2" step="0.1"></label><label><span>AMOUNT</span><input data-enemy-field="summonCount" type="number" min="1" max="100" step="1"></label><label><span>HITCASH MULTIPLIER</span><input data-enemy-field="summonHitCashMultiplier" type="number" min="0" max="10" step="0.05"></label></div>
                <div class="special-fields quad"><label><span>HP MULTIPLIER</span><input data-enemy-field="summonHpMultiplier" type="number" min="0" max="10" step="0.05"></label><label><span>SHIELD MULTIPLIER</span><input data-enemy-field="summonShieldMultiplier" type="number" min="0" max="10" step="0.05"></label><label><span>SPEED MULTIPLIER</span><input data-enemy-field="summonSpeedMultiplier" type="number" min="0" max="10" step="0.05"></label><label><span>DAMAGE MULTIPLIER</span><input data-enemy-field="summonDamageMultiplier" type="number" min="0" max="10" step="0.05"></label><label><span>ATTACK RATE MULTIPLIER</span><input data-enemy-field="summonAttackIntervalMultiplier" type="number" min="0.1" max="10" step="0.05"></label><label><span>CORE MULTIPLIER</span><input data-enemy-field="summonCoreDamageMultiplier" type="number" min="0" max="10" step="0.05"></label><label><span>DEFENSE BONUS</span><input data-enemy-field="summonDefenseBonus" type="number" min="-1000000" step="1"></label><label><span>PROTECTION BONUS</span><input data-enemy-field="summonProtectionBonus" type="number" min="-999" max="999" step="1"></label><label><span>ARMOR BONUS</span><input data-enemy-field="summonArmorBonus" type="number" min="-100" max="100" step="1"></label><label><span>SUPERARMOR BONUS</span><input data-enemy-field="summonSuperarmorBonus" type="number" min="-100" max="100" step="1"></label></div>
                <div class="summon-targets"><span>SUMMON POOL // OFFICIAL + CREATED</span><input id="summon-enemy-search" type="search" placeholder="Search hostiles to summon..." autocomplete="off"><div id="summon-enemy-options"></div></div>
              </section>
              <section class="special-editor" id="time-lock-editor" hidden>
                <header><div><span>MOVEMENT LOCK</span><strong>TIME LOCK</strong></div><small>The enemy moves this far before idling for the configured seconds.</small></header>
                <div class="special-fields"><label><span>MOVE DISTANCE</span><input data-enemy-field="timeLockDistance" type="number" min="0" max="2000" step="1"></label><label><span>IDLE SECONDS</span><input data-enemy-field="timeLockDuration" type="number" min="0.1" max="600" step="0.1"></label></div>
              </section>
              <section class="special-editor" id="wave-lock-editor" hidden>
                <header><div><span>MOVEMENT LOCK</span><strong>WAVE LOCK</strong></div><small>The enemy moves this far before idling until the configured wave count expires.</small></header>
                <div class="special-fields"><label><span>MOVE DISTANCE</span><input data-enemy-field="waveLockDistance" type="number" min="0" max="2000" step="1"></label><label><span>IDLE WAVES</span><input data-enemy-field="waveLockWaves" type="number" min="1" max="999" step="1"></label></div>
              </section>
              <section class="special-editor" id="stunning-editor" hidden>
                <header><div><span>SPECIAL ABILITY</span><strong>STUN SHOCKWAVE</strong></div><small>Uses the same tower-stun system as Big Dummy.</small></header>
                <div class="special-fields triple"><label><span>COOLDOWN</span><input data-enemy-field="stunInterval" type="number" min="0.2" step="0.1"></label><label><span>RADIUS</span><input data-enemy-field="stunRadius" type="number" min="20" step="1"></label><label><span>STUN DURATION</span><input data-enemy-field="stunDuration" type="number" min="0.1" step="0.1"></label></div>
              </section>
              <section class="special-editor" id="regeneration-editor" hidden>
                <header><div><span>PASSIVE POWER</span><strong>REGENERATION</strong></div><small>Restores HP continuously, including while stunned or fighting a blocker.</small></header>
                <div class="special-fields"><label><span>HP PER SECOND</span><input data-enemy-field="regenerationRate" type="number" min="0.1" max="1000000" step="0.1"></label></div>
              </section>
              <section class="special-editor" id="haste-editor" hidden>
                <header><div><span>SPECIAL POWER</span><strong>HASTE PULSE</strong></div><small>Applies the strongest active speed boost to enemies inside the radius.</small></header>
                <div class="special-fields quad"><label><span>COOLDOWN</span><input data-enemy-field="hasteInterval" type="number" min="0.2" max="600" step="0.1"></label><label><span>RADIUS</span><input data-enemy-field="hasteRadius" type="number" min="20" max="1000" step="1"></label><label><span>DURATION</span><input data-enemy-field="hasteDuration" type="number" min="0.1" max="60" step="0.1"></label><label><span>SPEED MULTIPLIER</span><input data-enemy-field="hasteMultiplier" type="number" min="1" max="5" step="0.05"></label></div>
              </section>
              <section class="special-editor" id="drain-editor" hidden>
                <header><div><span>SPECIAL POWER</span><strong>SIPHON</strong></div><small>Damages every tower in range and heals once for each tower struck.</small></header>
                <div class="special-fields quad"><label><span>COOLDOWN</span><input data-enemy-field="drainInterval" type="number" min="0.2" max="600" step="0.1"></label><label><span>RADIUS</span><input data-enemy-field="drainRadius" type="number" min="20" max="1000" step="1"></label><label><span>TOWER DAMAGE</span><input data-enemy-field="drainDamage" type="number" min="0" max="1000000" step="1"></label><label><span>HEAL PER TOWER</span><input data-enemy-field="drainHealing" type="number" min="0" max="1000000" step="1"></label></div>
              </section>
              <section class="special-editor" id="phase-editor" hidden>
                <header><div><span>SPECIAL POWER</span><strong>PHASE SHIFT</strong></div><small>While phased, damage cannot affect this enemy and pathbound towers cannot stop it.</small></header>
                <div class="special-fields"><label><span>COOLDOWN</span><input data-enemy-field="phaseInterval" type="number" min="0.2" max="600" step="0.1"></label><label><span>DURATION</span><input data-enemy-field="phaseDuration" type="number" min="0.1" max="60" step="0.1"></label></div>
              </section>
              <section class="special-editor" id="blink-editor" hidden>
                <header><div><span>SPECIAL POWER</span><strong>BLINK</strong></div><small>Instantly advances on the enemy's own route; it never switches paths.</small></header>
                <div class="special-fields"><label><span>COOLDOWN</span><input data-enemy-field="blinkInterval" type="number" min="0.2" max="600" step="0.1"></label><label><span>PATH DISTANCE</span><input data-enemy-field="blinkDistance" type="number" min="5" max="1000" step="1"></label></div>
              </section>
              <section class="behavior-engine">
                <header><div><span>BEHAVIOR ENGINE</span><strong>RULES + ACTION BLOCKS</strong></div><button class="primary-button" data-action="enemy-add-behavior-rule">ADD RULE +</button></header>
                <p>All filled conditions must match. MAX HP waits until health falls to that value; MIN HP stops activation below it. Leave bounds blank for no limit, and use 0 max uses for unlimited. Action delays run from activation.</p>
                <div id="enemy-behavior-rules"></div>
              </section>
              <section class="behavior-engine attack-engine">
                <header><div><span>ATTACK ENGINE</span><strong>SAVED ATTACK RECIPES</strong></div><button class="primary-button" data-action="enemy-add-attack">ADD ATTACK +</button></header>
                <p>Attacks can target towers with ranged, path-wave, or forward-cone delivery. Conditions use HP and age; visuals are procedural and reusable.</p>
                <div id="enemy-attacks"></div>
              </section>
            </div>
          </section>
        </div>
      </div>

      <div class="menu-screen mode-selection" id="mode-selection" hidden>
        <div class="mode-browser-heading">
          <button class="page-back" data-action="library-back">${icon("back")}<span>Back</span></button>
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
              <article class="mode-entry official">
                <div><small>OFFICIAL // ${HARD_MODE.waves.length} WAVES</small><strong>${HARD_MODE.name}</strong><p>${HARD_MODE.description}</p></div>
                <div class="mode-entry-actions"><button class="primary-button" data-action="select-mode" data-mode-id="hard">SELECT</button></div>
              </article>
            </div>
          </section>
          <section>
            <div class="library-label"><span>CREATED MODES</span><small>LOCAL // NO PROFILE REWARDS</small></div>
            <div class="mode-list" id="custom-mode-list"></div>
          </section>
        </div>
      </div>

      <div class="menu-screen battle-setup" id="battle-setup" hidden>
        <header class="page-header setup-header">
          <button class="page-back" data-action="back-main" aria-label="Go back">${icon("back")}<span id="setup-back-label">Back</span></button>
          <div><div class="onboarding-kicker" id="setup-context">SINGLE PLAYER</div><h2>Battle Setup</h2><p id="setup-intro">Choose the challenge and battlefield, then review your active loadout.</p></div>
          <div class="meta-wallet compact"><div><span>COINS</span><strong id="setup-coins">0</strong></div><div><span>TOKENS</span><strong id="setup-tokens">0</strong></div></div>
        </header>
        <div class="setup-workspace">
          <section class="setup-section mode-choice-section"><div class="section-heading"><span>1</span><div><strong>Choose a mode</strong><small>Official modes grant profile rewards. Created modes are sandbox runs.</small></div></div><div class="battle-mode-grid" id="battle-mode-grid"></div></section>
          <section class="setup-section map-choice-section"><div class="section-heading"><span>2</span><div><strong>Choose a map</strong><small>Map difficulty and reward multipliers apply to official runs.</small></div></div><div class="map-grid" id="play-map-grid"></div></section>
          <aside class="setup-summary">
            <div class="section-heading"><span>3</span><div><strong>Ready to deploy</strong><small id="selected-mode-copy">Normal Mode // 25 finite waves.</small></div></div>
            <div class="setup-selection-card"><span>MODE</span><strong id="setup-mode-name">NORMAL MODE</strong><small id="setup-mode-detail">25 waves // profile rewards enabled</small></div>
            <div class="setup-selection-card"><span>MAP</span><strong id="setup-map-name">SECTOR 07</strong><small id="setup-map-detail">Standard route</small></div>
            <div class="setup-loadout"><span>ACTIVE LOADOUT</span><div id="setup-loadout-icons"></div><small>Change towers in the Armory before deploying.</small></div>
            <div class="setup-perks"><span>EQUIPPED PERKS</span><div id="setup-perk-icons" data-testid="setup-perks"></div><small>Global effects apply to matching towers.</small></div>
            <button class="primary-button setup-start" id="start-mode-button" data-action="start-map" data-testid="begin-button">START RUN <span>→</span></button>
          </aside>
        </div>
      </div>

      <div class="menu-screen map-library-screen" id="map-library" hidden>
        <div class="mode-browser-heading">
          <button class="page-back" data-action="library-back">${icon("back")}<span>Back</span></button>
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
            <div class="library-label"><span>OFFICIAL MAPS</span><small>PROFILE REWARDS ENABLED</small></div>
            <div class="map-list" id="official-map-list"></div>
          </section>
          <section>
            <div class="library-label"><span>CREATED MAPS</span><small>LOCAL // NO PROFILE REWARDS</small></div>
            <div class="map-list" id="custom-map-list"></div>
          </section>
        </div>
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
            <label class="wide"><span>ENEMY ROUTING</span><select data-map-field="enemyRouting"><option value="split">SPLIT MODE ENEMIES // SHARED POOL (DEFAULT)</option><option value="multiply">MULTIPLY MODE ENEMIES // SPAWN ON EVERY PATH</option></select></label>
            <label><span>MAP SCALE</span><input data-map-field="mapScale" type="number" min="${MAP_SCALE_MIN}" max="${MAP_SCALE_MAX}" step="0.1" inputmode="decimal"></label>
          </section>
          <div class="map-editor-main">
            <div class="map-canvas-column">
              <div class="map-editor-toolbar">
                <div class="map-tool-group">
                  <button data-action="map-tool-select" class="active" id="map-select-tool">SELECT</button>
                  <button data-action="map-add-point">+ ROUTE POINT</button>
                  <button data-action="map-add-zone">+ BLOCK ZONE</button>
                  <button data-action="map-add-path-blocker">+ PATH BLOCKER</button>
                  <button data-action="map-delete-selection" class="danger">DELETE</button>
                </div>
                <div class="map-tool-group">
                  <button data-action="map-undo" id="map-undo-button">UNDO</button>
                  <button data-action="map-redo" id="map-redo-button">REDO</button>
                  <button data-action="map-reset">RESET</button>
                </div>
              </div>
              <div class="map-editor-canvas-wrap"><canvas id="map-editor-canvas" width="1600" height="700" aria-label="Custom map route editor"></canvas></div>
              <div class="map-editor-status"><span id="map-editor-selection">SELECT A ROUTE POINT, BLOCKED ZONE, OR PATH BLOCKER</span><b id="map-path-length">0 UNITS</b></div>
            </div>
            <aside class="map-editor-side">
              <section class="map-path-editor">
                <div class="library-label"><span>PATHS <b id="map-path-count">1 / ${MAX_MAP_PATHS}</b></span><button class="map-inline-button" data-action="map-add-path">+ ADD PATH</button></div>
                <div id="map-path-list"></div>
              </section>
              <section class="map-blocker-editor">
                <div class="library-label"><span>PATH BLOCKERS <b id="map-blocker-count">0 / ${MAX_PATH_BLOCKERS}</b></span><small>PATH ONLY</small></div>
                <div id="map-blocker-list"></div>
              </section>
              <section>
                <div class="library-label"><span>PALETTE</span><small>LIVE PREVIEW</small></div>
                <div class="map-theme-grid">
                  ${MAP_THEME_PRESETS.map((theme) => `<button data-action="map-theme" data-theme="${theme.id}" style="--theme-field:${theme.field};--theme-path:${theme.path};--theme-accent:${theme.accent}"><i></i><span>${theme.name.toUpperCase()}</span></button>`).join("")}
                </div>
                <div class="map-color-grid">
                  <label><span>FIELD</span><input data-map-field="field" type="color"></label>
                  <label><span>PATH</span><input data-map-field="path" type="color"></label>
                  <label><span>ACCENT</span><input data-map-field="accent" type="color"></label>
                   <label><span>BLOCKER ALPHA <output id="map-blocker-opacity-value">72%</output></span><input data-map-field="blockerOpacity" type="range" min="0.15" max="1" step="0.05"></label>
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
            <button class="secondary-button" data-action="mode-test">TEST MODE</button>
            <button class="primary-button" data-action="creator-save">SAVE MODE</button>
          </div>
        </div>
        <div class="creator-shell">
          <section class="creator-settings">
            <label><span>MODE NAME</span><input data-mode-field="name" maxlength="48"></label>
            <label class="wide"><span>DESCRIPTION</span><textarea data-mode-field="description" maxlength="220" rows="2"></textarea></label>
            <label><span>STARTING CASH</span><input data-mode-field="startingCash" type="number" min="0" step="1"></label>
            <label><span>CORE INTEGRITY</span><input data-mode-field="coreIntegrity" type="number" min="1" step="1"></label>
            <label class="mode-test-map-field"><span>TEST MAP</span><select id="mode-test-map" data-mode-test-map></select><small>Remembered for the next mode test.</small></label>
            <label class="multiplayer-cash-field"><span>MULTIPLAYER HIT CASH <output id="multiplayer-hitcash-value">75% // $0.75 PER 1 DAMAGE</output></span><input data-mode-field="multiplayerHitCashMultiplier" type="range" min="0" max="100" step="1" value="75"><small>Only affects cash earned from damage during multiplayer. Solo hit cash remains $1 per damage.</small></label>
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

      ${renderTowerShopHtml()}

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

      <button class="selected-pill" id="selected-pill" data-testid="selected-tower-pill" data-action="reopen-inspector" hidden>
        <span id="selected-pill-label">CONSTRUCT SELECTED</span>
        <b id="selected-pill-state">OPEN PANEL</b>
      </button>
      <section id="tank-pilot-cooldowns" class="tank-pilot-cooldowns" data-testid="tank-pilot-cooldowns" aria-label="Tank weapon cooldowns" hidden>${renderTankCooldowns()}</section>
    </main>

      <aside class="tower-inspector" id="tower-inspector" aria-label="Selected tower controls" hidden>
        <section class="selection-panel" id="selection-panel"></section>
        <div class="combat-dock">
          <span class="combat-dock-label">LIVE COMMANDS</span>
          <div class="action-module counter-module">
            <button class="combat-button counter-button" data-action="counter" data-testid="counter-button" disabled>
              <kbd>SPACE</kbd><span>COUNTER</span>
            </button>
            <div class="action-readout"><span>STATE</span><strong id="counter-status">NO LINK</strong></div>
            <div class="cooldown-track"><i id="counter-cooldown-fill"></i></div>
            <small id="counter-hint">Requires a pathbound construct</small>
          </div>
          <div id="ability-modules" class="ability-modules"></div>
        </div>
      </aside>
    </div>

    <div class="bottom-hud">
      <div class="build-dock">
        <div class="tower-list" id="tower-list"></div>
      </div>
      <div class="wave-controls">
        <span id="enemy-count">NO HOSTILES</span>
        <div class="wave-skip" id="wave-skip" hidden>
          <div class="wave-skip-copy"><strong>SKIP AVAILABLE</strong><small id="wave-skip-note">NEXT WAVE // EXISTING HOSTILES STAY</small></div>
          <div class="wave-skip-actions">
            <button class="wave-skip-button" data-action="skip-wave" id="skip-wave-button">SKIP WAVE</button>
            <button class="wave-skip-dismiss" data-action="dismiss-skip-wave" id="dismiss-skip-wave" aria-label="Vote no and hide skip prompt">NO</button>
          </div>
        </div>
        <div class="wave-button automatic" id="wave-button" data-testid="wave-button">NEXT WAVE <b>3</b></div>
      </div>
    </div>

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
const multiplayerScreen = query<HTMLDivElement>("#multiplayer-screen");
const multiplayerStatus = query<HTMLElement>("#multiplayer-status");
const multiplayerPeer = query<HTMLElement>("#multiplayer-peer");
const multiplayerDiagnostics = query<HTMLElement>("#multiplayer-diagnostics");
const multiplayerUsername = query<HTMLInputElement>("#multiplayer-username");
const multiplayerColor = query<HTMLInputElement>("#multiplayer-color");
const multiplayerProfile = query<HTMLElement>(".multiplayer-profile");
const multiplayerProfileActions = query<HTMLElement>("#multiplayer-profile-actions");
const multiplayerConnectActions = query<HTMLElement>("#multiplayer-connect-actions");
const multiplayerConnectionActions = query<HTMLElement>("#multiplayer-connection-actions");
const multiplayerRetryConnection = query<HTMLButtonElement>("#multiplayer-retry-connection");
const multiplayerCancelConnection = query<HTMLButtonElement>("#multiplayer-cancel-connection");
const multiplayerRoomCodeInput = query<HTMLInputElement>("#multiplayer-room-code");
const multiplayerRoomCodeHelp = query<HTMLElement>("#multiplayer-room-code-help");
const multiplayerCreateRoomButton = query<HTMLButtonElement>("#multiplayer-create-room");
const multiplayerJoinRoomButton = query<HTMLButtonElement>("#multiplayer-join-room");
const multiplayerRoomCodeDisplay = query<HTMLElement>("#multiplayer-room-code-display");
const multiplayerCopyRoomCodeButton = query<HTMLButtonElement>("#multiplayer-copy-room-code");
const multiplayerRoomStatus = query<HTMLElement>("#multiplayer-room-status");
const multiplayerChooseMode = query<HTMLButtonElement>("#multiplayer-choose-mode");
const multiplayerReturnRun = query<HTMLButtonElement>("#multiplayer-return-run");
const multiplayerColumns = query<HTMLElement>(".multiplayer-columns");
const multiplayerRoomPanel = query<HTMLElement>("#multiplayer-room-panel");
const multiplayerLobbyTitle = query<HTMLElement>("#multiplayer-lobby-title");
const multiplayerLobbyCopy = query<HTMLElement>("#multiplayer-lobby-copy");
const multiplayerRoundLabel = query<HTMLElement>("#multiplayer-round-label");
const multiplayerSelectionPreview = query<HTMLElement>("#multiplayer-selection-preview");
const multiplayerSelectionMap = query<HTMLElement>("#multiplayer-selection-map");
const multiplayerSelectionMode = query<HTMLElement>("#multiplayer-selection-mode");
const multiplayerLobbyChoose = query<HTMLButtonElement>("#multiplayer-lobby-choose");
const multiplayerLoadoutGrid = query<HTMLElement>("#multiplayer-loadout-grid");
const multiplayerHostReady = query<HTMLElement>("#multiplayer-host-ready");
const multiplayerHostReadyCopy = query<HTMLElement>("#multiplayer-host-ready-copy");
const multiplayerGuestReadyState = query<HTMLElement>("#multiplayer-guest-ready-state");
const multiplayerGuestReadyCopy = query<HTMLElement>("#multiplayer-guest-ready-copy");
const multiplayerRetryRound = query<HTMLButtonElement>("#multiplayer-retry-round");
const multiplayerGuestReadyButton = query<HTMLButtonElement>("#multiplayer-guest-ready");
const multiplayerChatLog = query<HTMLElement>("#multiplayer-chat-log");
const lobbyChatForm = query<HTMLFormElement>("#lobby-chat-form");
const lobbyChatInput = query<HTMLInputElement>("#lobby-chat-input");
const battleChatForm = query<HTMLFormElement>("#battle-chat-form");
const battleChatInput = query<HTMLInputElement>("#battle-chat-input");
const inGameChatStore = createInGameChatStore("closed");
const ingameChatPanel = query<HTMLElement>("#ingame-chat");
const ingameChatLog = query<HTMLElement>("#ingame-chat-log");
const ingameChatToast = query<HTMLElement>("#ingame-chat-toast");
const ingameChatMinBadge = query<HTMLElement>("#ingame-chat-min-badge");
const ingameChatMinimizeBtn = query<HTMLButtonElement>("#ingame-chat-minimize");
const hudChatToggle = query<HTMLButtonElement>("#hud-chat-toggle");
const hudChatBadge = query<HTMLElement>("#hud-chat-badge");
let toastDismissTimer: number | null = null;
const multiplayerStepRoom = query<HTMLElement>("#multiplayer-step-room");
const multiplayerStepLink = query<HTMLElement>("#multiplayer-step-link");
const multiplayerStepReady = query<HTMLElement>("#multiplayer-step-ready");
const creatorHub = query<HTMLDivElement>("#creator-hub");
const enemySelection = query<HTMLDivElement>("#enemy-selection");
const enemyCreator = query<HTMLDivElement>("#enemy-creator");
const modeSelection = query<HTMLDivElement>("#mode-selection");
const battleSetup = query<HTMLDivElement>("#battle-setup");
const mapLibrary = query<HTMLDivElement>("#map-library");
const mapCreator = query<HTMLDivElement>("#map-creator");
const mapEditorCanvas = query<HTMLCanvasElement>("#map-editor-canvas");
const enemyDrawingCanvas = query<HTMLCanvasElement>("#enemy-drawing-canvas");
const enemyDrawingContext = enemyDrawingCanvas.getContext("2d");
if (!enemyDrawingContext) throw new Error("Unable to create the enemy drawing canvas context.");
const enemyDrawingStage = query<HTMLDivElement>("#enemy-drawing-canvas-stage");
const enemyDrawingCanvasWrap = query<HTMLDivElement>("#enemy-drawing-canvas-wrap");
const enemyDrawingGrid = query<HTMLDivElement>("#enemy-drawing-grid");
const enemyDrawingBrushPreview = query<HTMLDivElement>("#enemy-drawing-brush-preview");
const enemyDrawingResolution = query<HTMLSelectElement>("#enemy-drawing-resolution");
const enemyDrawingOverlay = query<HTMLElement>("#enemy-drawing-overlay");
const enemyDrawingLaunch = query<HTMLElement>("#enemy-drawing-launch");
const enemyShapePreview = query<HTMLCanvasElement>("#enemy-shape-preview");
const enemyShapePreviewContext = enemyShapePreview.getContext("2d");
if (!enemyShapePreviewContext) throw new Error("Unable to create the enemy preview canvas context.");
const enemyImageUploadInput = query<HTMLInputElement>("#enemy-image-upload-input");
const enemyCropModal = query<HTMLElement>("#enemy-crop-modal");
const enemyCropCanvas = query<HTMLCanvasElement>("#enemy-crop-canvas");
const enemyCropContext = enemyCropCanvas.getContext("2d");
if (!enemyCropContext) throw new Error("Unable to create the enemy crop canvas context.");
const enemyCropPreviewCanvas = query<HTMLCanvasElement>("#enemy-crop-preview-canvas");
const enemyCropPreviewContext = enemyCropPreviewCanvas.getContext("2d");
if (!enemyCropPreviewContext) throw new Error("Unable to create the enemy crop preview canvas context.");
const enemyCropShapeSelect = query<HTMLSelectElement>("#enemy-crop-shape");
const enemyCropSidesGroup = query<HTMLElement>("#enemy-crop-sides-group");
const enemyCropSidesInput = query<HTMLInputElement>("#enemy-crop-sides");
const enemyCropSidesValue = query<HTMLOutputElement>("#enemy-crop-sides-value");
const enemyCropResolution = query<HTMLSelectElement>("#enemy-crop-resolution");
const enemyCropPreviewSize = query<HTMLElement>("#enemy-crop-preview-size");
const enemyCropZoomSlider = query<HTMLInputElement>("#enemy-crop-zoom-slider");
const enemyCropZoomValue = query<HTMLOutputElement>("#enemy-crop-zoom-value");
const modeCreator = query<HTMLDivElement>("#mode-creator");
const towerShop = query<HTMLDivElement>("#tower-shop");
const gameOverPanel = query<HTMLDivElement>("#game-over");
const victoryPanel = query<HTMLDivElement>("#victory");
const logs = query<HTMLDivElement>("#log-entries");
const battleLog = query<HTMLElement>("#battle-log");
const bossHud = query<HTMLDivElement>("#boss-hud");
const towerInspector = query<HTMLElement>("#tower-inspector");
const selectedPill = query<HTMLButtonElement>("#selected-pill");
const aimCancel = query<HTMLButtonElement>("#aim-cancel");
const moveCancel = query<HTMLButtonElement>("#move-cancel");
const debugPanel = query<HTMLElement>("#debug-panel");
const soundButton = query<HTMLButtonElement>("#main-settings-button");
const audioSettingsPanel = query<HTMLElement>("#audio-settings");
const audioEnabledInput = query<HTMLInputElement>("#audio-enabled");
const gameMenuOverlay = query<HTMLElement>("#game-menu-overlay");
const confirmOverlay = query<HTMLElement>("#confirm-overlay");
const graphicsSetupOverlay = query<HTMLElement>("#graphics-setup-overlay");
const graphicsSetupStatus = query<HTMLElement>("#graphics-setup-status");
const uiGpuStatus = query<HTMLElement>("#ui-gpu-status");
const confirmTitle = query<HTMLElement>("#confirm-title");
const confirmCopy = query<HTMLElement>("#confirm-copy");
const confirmAccept = query<HTMLButtonElement>("#confirm-accept");
const debugBalanceButton = query<HTMLButtonElement>("#debug-balance-button");
const debugReproStatus = query<HTMLElement>("#debug-repro-status");
const debugCopyReproButton = query<HTMLButtonElement>("#debug-copy-repro");
const debugExportReproButton = query<HTMLButtonElement>("#debug-export-repro");
const balanceLab = query<HTMLElement>("#balance-lab");
const modeTestPanel = query<HTMLElement>("#mode-test-panel");
const modeTestWaveSelect = query<HTMLSelectElement>("#mode-test-wave-select");
const balanceTowerKind = query<HTMLSelectElement>("#balance-tower-kind");
const balanceFields = query<HTMLDivElement>("#balance-fields");
const balanceLabStatus = query<HTMLElement>("#balance-lab-status");
const updatePanel = query<HTMLElement>("#update-panel");
const updateStatus = query<HTMLElement>("#update-status");
const updateProgressWrap = query<HTMLElement>("#update-progress-wrap");
const updateProgress = query<HTMLElement>(".update-progress");
const updateProgressBar = query<HTMLElement>("#update-progress-bar");
const updateProgressValue = query<HTMLElement>("#update-progress-value");
const checkUpdateButton = query<HTMLButtonElement>("#check-update-button");
const downloadUpdateButton = query<HTMLButtonElement>("#download-update-button");
const installUpdateButton = query<HTMLButtonElement>("#install-update-button");
let stopUpdateStateSubscription: (() => void) | null = null;
let developmentBuild = false;
let balanceKind: TowerKind = TOWER_ORDER[0] ?? "bandit";
let balanceDraft: TowerDefinition | null = null;
let selectionSignature = "";
let inspectorDetailsOpen = false;
let inspectorSuppressed = false;
let lastSelectedTowerId: number | null = null;
let lastRelocating = false;
let gameForRender: Game | null = null;
let dismissedBossIds = new Set<number>();
let battleLoadoutSignature = "";
let abilityModulesSignature = "";
let drawingCanvasKey = "";
let drawingHistory: ImageData[] = [];
let drawingRedoHistory: ImageData[] = [];
let drawingPointerActive = false;
let drawingLastPoint: Point | null = null;
let drawingTool: "brush" | "eraser" | "fill" | "pan" = "brush";
let drawingPanPointerId: number | null = null;
let drawingPanLastClientPoint: Point | null = null;
let drawingGridVisible = false;
let drawingZoom = 1;
let drawingResolution: 128 | 256 = 128;
let drawingBrushColor = "#d46cff";
let drawingCursorScale = 1;
let drawingModalFocusBefore: HTMLElement | null = null;
let drawingModalOpen = false;
let activeFrontScreen: FrontScreen = "main";
let overlayState: OverlayState = "none";
let multiplayerSetupStage: "profile" | "connection" | "lobby" = "profile";
let settingsReturnOverlay: OverlayState = "none";
let latestUiState: GameUiState | null = null;

const positionInspectorTelemetryPopover = (card: HTMLElement): void => {
  if (card.dataset["inspectorPopoverCard"] !== "telemetry") return;
  const popover = card.querySelector<HTMLElement>("[data-inspector-popover]");
  if (!popover || card.dataset["popoverOpen"] !== "true") return;
  const trigger = card.getBoundingClientRect();
  const inspector = towerInspector.getBoundingClientRect();
  const shellStyles = getComputedStyle(shell);
  const safeTop = Number.parseFloat(shellStyles.getPropertyValue("--tower-inspector-safe-top")) || 68;
  const safeBottom = Number.parseFloat(shellStyles.getPropertyValue("--tower-inspector-safe-bottom")) || 108;
  const gap = 3;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(370, Math.max(240, viewportWidth - 24));
  const left = inspector.left < viewportWidth / 2
    ? Math.min(Math.max(12, trigger.left), Math.max(12, viewportWidth - width - 12))
    : Math.min(Math.max(12, trigger.right - width), Math.max(12, viewportWidth - width - 12));
  const spaceAbove = Math.max(0, trigger.top - safeTop - gap);
  const spaceBelow = Math.max(0, viewportHeight - trigger.bottom - safeBottom - gap);
  const opensAbove = spaceAbove >= 260 || spaceAbove >= spaceBelow;
  const availableSpace = opensAbove ? spaceAbove : spaceBelow;
  card.dataset["popoverPlacement"] = opensAbove ? "above" : "below";
  popover.style.position = "fixed";
  popover.style.left = `${left}px`;
  popover.style.right = "auto";
  popover.style.width = `${width}px`;
  popover.style.maxHeight = `${Math.min(560, Math.max(120, availableSpace))}px`;
  if (opensAbove) {
    popover.style.top = "auto";
    popover.style.bottom = `${Math.max(12, viewportHeight - trigger.top + gap)}px`;
  } else {
    popover.style.bottom = "auto";
    popover.style.top = `${Math.min(viewportHeight - 12, trigger.bottom + gap)}px`;
  }
};

const setInspectorPopoverState = (card: HTMLElement, open: boolean): void => {
  card.dataset["popoverOpen"] = open ? "true" : "false";
  if (card.getAttribute("role") === "button") card.setAttribute("aria-expanded", `${open}`);
  const popover = card.querySelector<HTMLElement>("[data-inspector-popover]");
  popover?.setAttribute("aria-hidden", `${!open}`);
  if (open) {
    // Apply placement before the browser can paint the hover-only popover;
    // the frame refresh accounts for any layout changes after the first pass.
    positionInspectorTelemetryPopover(card);
    window.requestAnimationFrame(() => positionInspectorTelemetryPopover(card));
  }
  else if (popover && card.dataset["inspectorPopoverCard"] === "telemetry") {
    delete card.dataset["popoverPlacement"];
    popover.style.position = "";
    popover.style.left = "";
    popover.style.right = "";
    popover.style.top = "";
    popover.style.bottom = "";
    popover.style.width = "";
    popover.style.maxHeight = "";
  }
};

const inspectorPopoverCard = (target: EventTarget | null): HTMLElement | null =>
  target instanceof HTMLElement ? target.closest<HTMLElement>("[data-inspector-popover-card]") : null;

towerInspector.addEventListener("pointerover", (event) => {
  const card = inspectorPopoverCard(event.target);
  if (!card || card.dataset["inspectorPopoverCard"] === "telemetry") return;
  towerInspector.querySelectorAll<HTMLElement>("[data-inspector-popover-card][data-popover-open='true']").forEach((other) => {
    if (other !== card && other.dataset["inspectorPopoverCard"] !== "telemetry") setInspectorPopoverState(other, false);
  });
  setInspectorPopoverState(card, true);
});
towerInspector.addEventListener("pointerout", (event) => {
  const card = inspectorPopoverCard(event.target);
  if (!card || card.dataset["inspectorPopoverCard"] === "telemetry") return;
  const related = event.relatedTarget;
  if (card && card.dataset["popoverPinned"] !== "true" && (!(related instanceof Node) || !card.contains(related))) setInspectorPopoverState(card, false);
});
towerInspector.addEventListener("focusin", (event) => {
  const card = inspectorPopoverCard(event.target);
  if (!card || card.dataset["inspectorPopoverCard"] === "telemetry") return;
  towerInspector.querySelectorAll<HTMLElement>("[data-inspector-popover-card][data-popover-open='true']").forEach((other) => {
    if (other !== card && other.dataset["popoverPinned"] !== "true" && other.dataset["inspectorPopoverCard"] !== "telemetry") setInspectorPopoverState(other, false);
  });
  setInspectorPopoverState(card, true);
});
towerInspector.addEventListener("focusout", (event) => {
  const card = inspectorPopoverCard(event.target);
  if (!card || card.dataset["inspectorPopoverCard"] === "telemetry") return;
  const related = event.relatedTarget;
  if (card && card.dataset["popoverPinned"] !== "true" && (!(related instanceof Node) || !card.contains(related))) setInspectorPopoverState(card, false);
});
window.addEventListener("resize", () => {
  const telemetry = towerInspector.querySelector<HTMLElement>("[data-inspector-popover-card='telemetry'][data-popover-open='true']");
  if (telemetry) positionInspectorTelemetryPopover(telemetry);
});
let focusBeforeOverlay: HTMLElement | null = null;
let uiPreferences: UiPreferences = loadUiPreferences();
let desktopEnvironment: Awaited<ReturnType<typeof getDesktopEnvironment>> = null;
let latestGpuStatus: MonochromiumGpuStatus | null = null;
let stopFullscreenSubscription: (() => void) | null = null;
let stopGpuStatusSubscription: (() => void) | null = null;
let creatorDraftBaseline = "";
let enemyDraftBaseline = "";
let mapDraftBaseline = "";
let pendingConfirmation: { readonly accept: () => void | Promise<void>; readonly cancel?: () => void; readonly returnOverlay: OverlayState } | null = null;
const LOADOUT_VISUAL_ORDER = [3, 1, 0, 2, 4] as const;

document.documentElement.dataset["effectsQuality"] = uiPreferences.effectsQuality;

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
const enemyCreatorV4 = new EnemyCreatorV4Editor(query<HTMLElement>("#enemy-ability-v4-root"), {
  getDraft: () => enemyDraft,
  getEnemyDefinitions: () => getAllEnemyDefinitions(),
  isDirty: () => hasDraftChanged(enemyDraft, enemyDraftBaseline),
  onChange: () => {
    if (!enemyDraft) return;
    drawEnemyCreatorPreview();
    query<HTMLElement>("#enemy-name-preview").textContent = enemyDraft.name.toUpperCase() || "CUSTOM ENEMY";
    query<HTMLElement>("#enemy-preview-stats").textContent = enemyStatLine(enemyDraft).replaceAll(" · ", " // ");
  },
});
let mapDraft: CustomMapDraft | null = null;
let mapHistory: CustomMapDraft[] = [];
let mapFuture: CustomMapDraft[] = [];
let activeMapPathIndex = 0;
let mapSelectionState: MapSelectionState | null = null;
let mapDragState: { type: "point" | "zone" | "resize" | "pathBlocker"; start: Point; original: CustomMapDraft; lastPathPoint?: Point; lastPathDistance?: number } | null = null;
let libraryReturnScreen: "main" | "multiplayer" | "creators" = "main";
let mapTestActive = false;
let modeTestActive = false;
let modeTestMapKind: MapKind | null = null;
let modeTestWaveSignature = "";
const MODE_TEST_MAP_KEY = "monochromium.mode-test-map.v1";
const selectedEnemyIds = new Set<string>();
const selectedModeIds = new Set<string>();
const selectedMapIds = new Set<string>();
let activeModeFolderId: string | null = null;
let activeEnemyFolderId: string | null = null;
let activeMapFolderId: string | null = null;
let runSettled = false;
const audio = new AudioSystem();
const MULTIPLAYER_PROFILE_KEY = "monochromium.multiplayer-profile.v1";
const MULTIPLAYER_REWARD_KEY = "monochromium.multiplayer-results.v1";

const loadMultiplayerPlayer = (): MultiplayerPlayer => {
  try {
    const stored = window.localStorage.getItem(MULTIPLAYER_PROFILE_KEY);
    const parsed = stored ? JSON.parse(stored) as Partial<MultiplayerPlayer> : {};
    return sanitizeMultiplayerPlayer({ ...parsed, loadout: progress.loadout, perkLoadout: progress.perkLoadout });
  } catch {
    return sanitizeMultiplayerPlayer({ username: "PLAYER", color: "#66d9ff", loadout: progress.loadout, perkLoadout: progress.perkLoadout });
  }
};

let localMultiplayerPlayer = loadMultiplayerPlayer();
let remoteMultiplayerPlayer: MultiplayerPlayer | null = null;
let activeMultiplayerStart: MultiplayerSessionStart | null = null;
let activeSimulationConfig: SimulationSessionConfig | null = null;
let capturedReplayCommands: SimulationReplayCommand[] = [];
const pendingReplayCommands = new Map<string, SimulationCommandEnvelope>();
let capturedReplayEvents: import("./game/simulationProtocol.ts").SimulationEvent[] = [];
let latestSimulationReplay: SimulationReplayBundle | null = null;
let multiplayerHostSelecting = false;
let multiplayerPhase: "lobby" | "playing" = "lobby";
let multiplayerRound = 0;
let lastGuestStartedRound = 0;
let multiplayerGuestReady = false;
let multiplayerHelloSent = false;
let guestSessionContentActive = false;
let pendingMultiplayerResult: MultiplayerResult | null = null;
let multiplayerCommandSequence = 0;
let lastReplicationFrameAt = 0;
let multiplayerBytesSent = 0;
let multiplayerBytesReceived = 0;
let multiplayerTxRate = 0;
let multiplayerRxRate = 0;
let multiplayerRtt: number | null = null;
let lastReplicationErrorAt = 0;
let lastResyncRequestAt = 0;
let previousDiagnosticBytesSent = 0;
let previousDiagnosticBytesReceived = 0;
let latestServerDiagnostics: SimulationServerDiagnostics | null = null;
let authoritativeResultHandled = false;
const hostReplicationDecoder = new ReplicationDecoder();
const guestReplicationDecoder = new ReplicationDecoder();
const pendingCommandOwners = new Map<string, "host" | "guest">();
const pendingLocalCommands = new Set<string>();
const pendingLocalCommandTimers = new Map<string, number>();
const MULTIPLAYER_COMMAND_TIMEOUT_MS = 10_000;
const appliedEventIds = new Set<number>();
let latestEventAckSent = 0;
const cursorIntervalMs = 1_000 / 8;
const guestPulseIntervalMs = 500;
const guestEventAckIntervalMs = 250;
let pendingCursor: Point | null | undefined;
let localCursorPoint: Point | null = null;
let guestPulsePending = false;
let guestPulseSequence = 0;
const guestPulseSentAt = new Map<number, number>();
let stalePresentationEvents = 0;
let replacedReplicationFrames = 0;
let resumeAwaitingKeyframe = false;
let lastCursorSentAt = 0;
let lastGuestPulseSentAt = 0;
let guestPulseUrgent = false;
let guestEventAckPending = false;
let lastGuestEventAckAt = 0;
let lastGuestAckEventId = 0;
let guestEventAckPulses = 0;
let previousGuestEventAckPulses = 0;
let guestEventAckRate = 0;
let cursorSendTimer: number | null = null;

const validSessionStart = (session: unknown): session is MultiplayerSessionStart =>
  isValidMultiplayerSessionStart(session, multiplayerSession.sessionId);

const validMultiplayerLobbyState = (state: unknown): state is MultiplayerLobbyState =>
  isValidMultiplayerLobbyState(state, multiplayerSession.sessionId);

const validMultiplayerResult = (result: unknown): result is MultiplayerResult => {
  if (!activeMultiplayerStart) return false;
  return isValidMultiplayerResult(result, {
    session: activeMultiplayerStart,
    activeModeWaves: activeMode.waves.length,
    activeMapKind: activeMap.kind,
    activeModeKind: activeMode.kind,
    activeModeIsCustom: activeMode.isCustom,
    activeMapIsCustom: activeMap.isCustom,
    mapTestActive,
    rewardCoins: activeMode.reward.coins,
    rewardTokens: activeMode.reward.tokens,
    mapRewardMultiplier: activeMap.rewardMultiplier,
  });
};

const resetReplayCapture = (): void => {
  activeSimulationConfig = null;
  capturedReplayCommands = [];
  pendingReplayCommands.clear();
  capturedReplayEvents = [];
};

const captureReplayCommand = (envelope: SimulationCommandEnvelope): void => {
  if (!activeSimulationConfig) return;
  pendingReplayCommands.set(envelope.commandId, envelope);
};

const captureReplayResult = (result: CommandResult): void => {
  const envelope = pendingReplayCommands.get(result.commandId);
  if (!envelope) return;
  pendingReplayCommands.delete(result.commandId);
  capturedReplayCommands.push({ tick: Math.max(0, result.serverTick), envelope });
  if (capturedReplayCommands.length > 2_048) capturedReplayCommands.splice(0, capturedReplayCommands.length - 2_048);
};

const buildActiveSimulationReplay = (): SimulationReplayBundle | null => {
  if (!activeSimulationConfig) return latestSimulationReplay;
  const fallbackTick = latestServerDiagnostics?.tick ?? 0;
  const pending = [...pendingReplayCommands.values()].map((envelope) => ({ tick: fallbackTick, envelope }));
  return createSimulationReplay(activeSimulationConfig, [...capturedReplayCommands, ...pending], capturedReplayEvents);
};

const flushRemoteCursor = (): void => {
  cursorSendTimer = null;
  if (!activeMultiplayerStart || !multiplayerSession.connected || (pendingCursor === undefined && !guestPulsePending)) return;
  const now = performance.now();
  const interval = multiplayerSession.role === "guest"
    ? (guestPulseUrgent ? 0 : guestEventAckPending ? guestEventAckIntervalMs : guestPulseIntervalMs)
    : cursorIntervalMs;
  const lastSentAt = multiplayerSession.role === "guest" ? lastGuestPulseSentAt : lastCursorSentAt;
  const wait = interval - (now - lastSentAt);
  if (wait > 0) {
    cursorSendTimer = window.setTimeout(flushRemoteCursor, wait);
    return;
  }
  let sent = false;
  if (multiplayerSession.role === "guest") {
    const sequence = ++guestPulseSequence;
    sent = multiplayerSession.sendRealtime({
      type: "pulse",
      sequence,
      sentAt: now,
      point: localCursorPoint,
      stateSequence: guestReplicationDecoder.currentSequence,
      eventId: latestEventAckSent,
    });
    if (sent) {
      guestPulseSentAt.set(sequence, now);
      while (guestPulseSentAt.size > 64) guestPulseSentAt.delete(guestPulseSentAt.keys().next().value as number);
      guestPulsePending = false;
      guestPulseUrgent = false;
      guestEventAckPending = false;
      if (latestEventAckSent > lastGuestAckEventId) {
        lastGuestAckEventId = latestEventAckSent;
        lastGuestEventAckAt = now;
        guestEventAckPulses += 1;
      }
      lastGuestPulseSentAt = now;
      pendingCursor = undefined;
    }
  } else if (pendingCursor !== undefined) {
    sent = multiplayerSession.sendRealtime({ type: "cursor", point: pendingCursor });
    if (sent) pendingCursor = undefined;
  }
  if (sent && multiplayerSession.role !== "guest") lastCursorSentAt = now;
  if (pendingCursor !== undefined || guestPulsePending) cursorSendTimer = window.setTimeout(flushRemoteCursor, multiplayerSession.role === "guest" ? guestPulseIntervalMs : cursorIntervalMs);
};

const queueRemoteCursor = (point: Point | null): void => {
  localCursorPoint = point ? { ...point } : null;
  pendingCursor = point ? { ...point } : null;
  if (multiplayerSession.role === "guest") guestPulsePending = true;
  if (cursorSendTimer === null) cursorSendTimer = window.setTimeout(flushRemoteCursor, 0);
};

const queueGuestPulse = (urgent = false): void => {
  if (multiplayerSession.role !== "guest") return;
  guestPulsePending = true;
  if (urgent) {
    guestEventAckPending = true;
    guestPulseUrgent ||= performance.now() - lastGuestEventAckAt >= guestEventAckIntervalMs;
  }
  if (cursorSendTimer === null) {
    cursorSendTimer = window.setTimeout(flushRemoteCursor, 0);
  } else if (guestEventAckPending) {
    window.clearTimeout(cursorSendTimer);
    const dueIn = Math.max(0, guestEventAckIntervalMs - (performance.now() - lastGuestEventAckAt));
    cursorSendTimer = window.setTimeout(flushRemoteCursor, dueIn);
  }
};

multiplayerUsername.value = localMultiplayerPlayer.username;
multiplayerColor.value = localMultiplayerPlayer.color;

const persistMultiplayerPlayer = (preserveUsernameInput = false): void => {
  localMultiplayerPlayer = sanitizeMultiplayerPlayer({
    ...localMultiplayerPlayer,
    username: multiplayerUsername.value,
    color: multiplayerColor.value,
    loadout: progress.loadout,
    perkLoadout: progress.perkLoadout,
  }, localMultiplayerPlayer.id);
  if (!preserveUsernameInput) multiplayerUsername.value = localMultiplayerPlayer.username;
  multiplayerColor.value = localMultiplayerPlayer.color;
  try {
    window.localStorage.setItem(MULTIPLAYER_PROFILE_KEY, JSON.stringify(localMultiplayerPlayer));
  } catch {
    // The current pairing still works if preferences cannot be persisted.
  }
};

const restrictMultiplayerLoadout = (player: MultiplayerPlayer, allowedTowers: readonly TowerKind[]): MultiplayerPlayer => {
  const allowed = new Set(allowedTowers);
  return { ...player, loadout: player.loadout.filter((kind) => allowed.has(kind)) };
};

const multiplayerSession = new MultiplayerSession({
  onStatus: (status, detail) => handleMultiplayerStatus(status, detail),
  onControl: (message, peerId) => handleMultiplayerControl(message, peerId),
  onRealtime: (message, peerId) => handleMultiplayerRealtime(message, peerId),
  onBinary: (frame, peerId, receivedAt) => handleMultiplayerBinary(frame, peerId, receivedAt),
});

window.monochromiumDesktop?.onMultiplayerNetworkMessage((message) => {
  if (message.type === "rtt") {
    multiplayerRtt = message.rtt;
    return;
  }
  multiplayerSession.handleDesktopMessage(message);
});

const renderMultiplayerSetupStage = (): void => {
  const roomReady = multiplayerSession.status === "connected" && Boolean(remoteMultiplayerPlayer) && multiplayerSession.role !== null;
  if (roomReady) multiplayerSetupStage = "lobby";
  else if (multiplayerSetupStage === "lobby") multiplayerSetupStage = "connection";
  const profileOpen = multiplayerSetupStage === "profile";
  const connectionOpen = multiplayerSetupStage === "connection";
  const lobbyOpen = multiplayerSetupStage === "lobby";
  multiplayerProfile.hidden = !profileOpen;
  multiplayerProfileActions.hidden = !profileOpen;
  multiplayerConnectActions.hidden = !connectionOpen;
  multiplayerColumns.hidden = !connectionOpen;
  multiplayerConnectionActions.hidden = !connectionOpen || ["idle", "closed"].includes(multiplayerSession.status);
  multiplayerRoomPanel.hidden = !lobbyOpen;
  const profileBack = multiplayerConnectActions.querySelector<HTMLButtonElement>("[data-action='multiplayer-profile-back']");
  if (profileBack) profileBack.disabled = !["idle", "closed", "failed"].includes(multiplayerSession.status);
  multiplayerStepRoom.classList.toggle("active", profileOpen);
  multiplayerStepRoom.classList.toggle("complete", !profileOpen);
  multiplayerStepLink.classList.toggle("active", connectionOpen);
  multiplayerStepLink.classList.toggle("complete", lobbyOpen);
  multiplayerStepReady.classList.toggle("active", lobbyOpen);
  multiplayerStepReady.classList.toggle("complete", lobbyOpen && roomReady);
};

function renderMultiplayerStatus(status: MultiplayerConnectionStatus, detail = ""): void {
  multiplayerStatus.dataset["status"] = status;
  const label = multiplayerStatus.querySelector<HTMLElement>("strong");
  const copy = multiplayerStatus.querySelector<HTMLElement>("small");
  if (label) label.textContent = resolveMultiplayerStatusLabel(status, detail);
  if (copy) copy.textContent = detail || "No peer connection active.";
  const sessionBusy = !["idle", "closed", "failed"].includes(status);
  multiplayerCreateRoomButton.disabled = sessionBusy;
  multiplayerJoinRoomButton.disabled = sessionBusy || !isMultiplayerRoomCodeValid(multiplayerRoomCodeInput.value);
  multiplayerPeer.textContent = remoteMultiplayerPlayer
    ? `PEER // ${remoteMultiplayerPlayer.username.toUpperCase()} // ${remoteMultiplayerPlayer.id.slice(0, 8)}`
    : "PEER // NOT LINKED";
  multiplayerChooseMode.disabled = !(multiplayerSession.role === "host" && multiplayerSession.connected && remoteMultiplayerPlayer);
  multiplayerCopyRoomCodeButton.disabled = multiplayerSession.role !== "host" || !multiplayerSession.sessionId;
  if (multiplayerSession.role === "host" && multiplayerSession.sessionId) multiplayerRoomCodeDisplay.textContent = multiplayerSession.sessionId;
  multiplayerConnectionActions.hidden = multiplayerSetupStage !== "connection" || ["idle", "closed"].includes(status);
  multiplayerRetryConnection.hidden = status !== "failed" && !(status === "connecting" && /reconnect|retry/i.test(detail));
  multiplayerCancelConnection.hidden = ["idle", "closed"].includes(status);
  renderMultiplayerLobby();
}

const renderMultiplayerRoomCode = (): void => {
  const normalized = formatMultiplayerRoomCode(multiplayerRoomCodeInput.value);
  if (multiplayerRoomCodeInput.value !== normalized) multiplayerRoomCodeInput.value = normalized;
  const valid = isMultiplayerRoomCodeValid(normalized);
  multiplayerRoomCodeInput.setAttribute("aria-invalid", normalized.length > 0 && !valid ? "true" : "false");
  multiplayerRoomCodeHelp.textContent = valid ? "Ready // press Join to connect to the host." : `${normalized.length}/8 characters // use the letters and numbers from the invite.`;
  multiplayerRoomCodeHelp.classList.toggle("valid", valid);
  multiplayerRoomCodeHelp.classList.toggle("invalid", normalized.length > 0 && !valid);
  multiplayerJoinRoomButton.disabled = !valid || !["idle", "closed", "failed"].includes(multiplayerSession.status);
};

function handleMultiplayerStatus(status: MultiplayerConnectionStatus, detail?: string): void {
  if (status !== "connected") multiplayerHelloSent = false;
  renderMultiplayerStatus(status, detail);
  if (status === "connected" && !multiplayerHelloSent) {
    multiplayerHelloSent = true;
    persistMultiplayerPlayer();
    multiplayerSession.sendControl({ type: "hello", player: localMultiplayerPlayer, gameVersion: GAME_VERSION });
  }
  if (status === "disconnected" && multiplayerSession.role === "host" && activeMultiplayerStart) {
    addLog("Guest link lost // their towers and wallet remain active. Re-pair to restore control.", "danger");
  }
}

const sendMultiplayerLobbyState = (): void => {
  if (multiplayerSession.role !== "host" || !multiplayerSession.connected) return;
  multiplayerSession.sendControl({
    type: "lobby-state",
    state: {
      id: multiplayerSession.sessionId,
      round: activeMultiplayerStart?.round ?? multiplayerRound,
      phase: multiplayerPhase,
      session: activeMultiplayerStart,
      guestReady: multiplayerGuestReady,
    },
  });
};

function renderMultiplayerLobby(): void {
  const connected = multiplayerSession.status === "connected" && Boolean(remoteMultiplayerPlayer);
  const showLobby = connected && (multiplayerSession.role === "host" || multiplayerSession.role === "guest");
  if (showLobby) multiplayerSetupStage = "lobby";
  renderMultiplayerSetupStage();

  const session = activeMultiplayerStart;
  const hostSelecting = multiplayerSession.role === "host" && session === null;
  const inLobby = showLobby && multiplayerPhase === "lobby";
  const inBattle = showLobby && multiplayerPhase === "playing";
  multiplayerLobbyTitle.textContent = inBattle ? "ROUND IN PROGRESS" : hostSelecting ? "CHOOSE THE NEXT BATTLE" : "ROUND LOBBY";
  multiplayerLobbyCopy.textContent = inBattle
    ? "Your room stays open between battles. Return to the battlefield whenever you are ready."
    : hostSelecting
      ? "Choose a mode and map. Your guest will confirm their loadout before the round begins."
      : multiplayerGuestReady
        ? "Ready signal sent. The host will launch the round when the room is set."
        : "Tune your loadout, then press Ready. The room remains open while the host picks a battle.";
  multiplayerRoundLabel.textContent = session ? `ROUND ${session.round.toString().padStart(2, "0")}` : "ROUND --";
  multiplayerSelectionMap.textContent = session ? session.map.name.toUpperCase() : "WAITING FOR HOST";
  multiplayerSelectionMode.textContent = session
    ? `${session.mode.name} // ${session.mode.waves.length} ${session.mode.waves.length === 1 ? "WAVE" : "WAVES"} // ${session.map.difficulty.toUpperCase()}`
    : "The host is choosing a mode and map.";
  multiplayerSelectionPreview.innerHTML = session ? mapPreviewSvg(session.map) : "<span>◇</span>";
  multiplayerLobbyChoose.hidden = !multiplayerSession.role || multiplayerSession.role !== "host" || inBattle;
  multiplayerLobbyChoose.disabled = !connected || inBattle;
  multiplayerRetryRound.hidden = !multiplayerSession.role || multiplayerSession.role !== "host" || !session || inBattle;
  multiplayerRetryRound.disabled = !connected || !session;

  multiplayerHostReady.textContent = inBattle ? "IN BATTLE" : hostSelecting ? "SELECTING" : "READY";
  multiplayerHostReadyCopy.textContent = inBattle
    ? "The authoritative room is running this round."
    : hostSelecting
      ? "Choose a mode and map to open the intermission lobby."
      : "The host chooses the next mode and map.";
  multiplayerGuestReadyState.textContent = inBattle ? "IN BATTLE" : multiplayerGuestReady ? "READY" : "NOT READY";
  multiplayerGuestReadyState.classList.toggle("good", multiplayerGuestReady || inBattle);
  multiplayerGuestReadyCopy.textContent = inBattle
    ? "Your loadout is locked until the next intermission."
    : multiplayerGuestReady
      ? "Ready signal sent. Change your loadout to choose again."
      : "Set your loadout, then press Ready for the next round.";
  multiplayerGuestReadyButton.hidden = multiplayerSession.role !== "guest" || inBattle;
  multiplayerGuestReadyButton.disabled = !connected || !session || !inLobby;
  multiplayerGuestReadyButton.innerHTML = multiplayerGuestReady ? "CANCEL READY <span>×</span>" : "READY FOR NEXT ROUND <span>→</span>";

  multiplayerLoadoutGrid.innerHTML = renderMultiplayerLoadoutGridHtml(
    progress.unlockedTowers,
    progress.loadout,
    session?.allowedTowers,
    inLobby,
  );
  multiplayerReturnRun.hidden = !inBattle;
}

const setGuestMultiplayerReady = (ready: boolean): void => {
  if (multiplayerSession.role !== "guest" || multiplayerPhase !== "lobby" || !multiplayerSession.connected) return;
  persistMultiplayerPlayer();
  multiplayerGuestReady = Boolean(activeMultiplayerStart && ready);
  multiplayerSession.sendControl({
    type: "lobby-ready",
    round: activeMultiplayerStart?.round ?? multiplayerRound,
    player: localMultiplayerPlayer,
    ready,
  });
  renderMultiplayerLobby();
};

const prepareMultiplayerRound = (map: MapDefinition, mode: ModeDefinition): void => {
  if (multiplayerSession.role !== "host" || !multiplayerSession.connected || !remoteMultiplayerPlayer) return;
  persistMultiplayerPlayer();
  const nextRound = Math.max(multiplayerRound, activeMultiplayerStart?.round ?? 0) + 1;
  multiplayerRound = nextRound;
  activeMap = map;
  activeMode = mode;
  const requiredEnemyIds = new Set(getRequiredCustomEnemyIds(mode));
  const allowedTowers = [...progress.unlockedTowers];
  activeMultiplayerStart = {
    id: multiplayerSession.sessionId,
    round: nextRound,
    map,
    mode,
    customEnemies: customEnemies.filter((enemy) => requiredEnemyIds.has(enemy.id)),
    allowedTowers,
    players: [restrictMultiplayerLoadout(localMultiplayerPlayer, allowedTowers), restrictMultiplayerLoadout(remoteMultiplayerPlayer, allowedTowers)],
  };
  multiplayerPhase = "lobby";
  multiplayerGuestReady = false;
  inspectorDetailsOpen = false;
  selectionSignature = "";
  game.leaveRun();
  multiplayerHostSelecting = false;
  showFrontScreen("multiplayer");
  sendMultiplayerLobbyState();
  renderMultiplayerLobby();
};

const startPreparedMultiplayerRun = (): void => {
  if (multiplayerSession.role !== "host" || !multiplayerSession.connected || !remoteMultiplayerPlayer || !activeMultiplayerStart || !multiplayerGuestReady || multiplayerPhase !== "lobby") return;
  persistMultiplayerPlayer();
  const players = [localMultiplayerPlayer, remoteMultiplayerPlayer].map((player) => restrictMultiplayerLoadout(player, activeMultiplayerStart!.allowedTowers));
  activeMultiplayerStart = { ...activeMultiplayerStart, players };
  remoteMultiplayerPlayer = players[1] ?? remoteMultiplayerPlayer;
  activeMap = activeMultiplayerStart.map;
  activeMode = activeMultiplayerStart.mode;
  multiplayerRound = activeMultiplayerStart.round;
  multiplayerPhase = "playing";
  runSettled = false;
  multiplayerHostSelecting = false;
  hostReplicationDecoder.reset();
  guestReplicationDecoder.reset();
  lastReplicationErrorAt = 0;
  lastReplicationFrameAt = 0;
  lastResyncRequestAt = 0;
  multiplayerBytesSent = 0;
  multiplayerBytesReceived = 0;
  previousDiagnosticBytesSent = 0;
  previousDiagnosticBytesReceived = 0;
  multiplayerTxRate = 0;
  multiplayerRxRate = 0;
  appliedEventIds.clear();
  latestEventAckSent = 0;
  guestPulsePending = false;
  guestPulseSequence = 0;
  guestPulseSentAt.clear();
  lastGuestPulseSentAt = 0;
  guestPulseUrgent = false;
  guestEventAckPending = false;
  lastGuestEventAckAt = 0;
  lastGuestAckEventId = 0;
  guestEventAckPulses = 0;
  previousGuestEventAckPulses = 0;
  guestEventAckRate = 0;
  localCursorPoint = null;
  pendingCursor = undefined;
  resumeAwaitingKeyframe = false;
  authoritativeResultHandled = false;
  pendingMultiplayerResult = null;
  [mainMenu, multiplayerScreen, creatorHub, enemySelection, enemyCreator, modeSelection, battleSetup, mapLibrary, mapCreator, modeCreator, towerShop, gameOverPanel, victoryPanel]
    .forEach((screen) => { screen.hidden = true; });
  shell.classList.add("run-active");
  const localPlayer = players[0]!;
  game.configureMultiplayer("guest", localPlayer, players);
  game.startRun(activeMap, localPlayer.loadout, activeMode);
  const seedBytes = new Uint32Array(1);
  crypto.getRandomValues(seedBytes);
  const simulationConfig: SimulationSessionConfig = {
    protocol: MULTIPLAYER_PROTOCOL_VERSION,
    sessionId: multiplayerSession.sessionId,
    seed: seedBytes[0] ?? Date.now(),
    map: activeMap,
    mode: activeMode,
    customEnemies: activeMultiplayerStart.customEnemies,
    allowedTowers: activeMultiplayerStart.allowedTowers,
    players,
  };
  resetReplayCapture();
  activeSimulationConfig = simulationConfig;
  latestSimulationReplay = null;
  void window.monochromiumDesktop?.startHostServer(simulationConfig).catch((error) => {
    multiplayerFailure(error);
    closeMultiplayerSession("Could not start authoritative server.");
    showFrontScreen("main");
  });
  multiplayerSession.sendControl({ type: "lobby-state", state: { id: multiplayerSession.sessionId, round: activeMultiplayerStart.round, phase: "playing", session: activeMultiplayerStart, guestReady: true } });
  multiplayerSession.sendControl({ type: "session-start", session: activeMultiplayerStart });
  renderMultiplayerLobby();
};

function sessionEnemyReferencesAvailable(mode: ModeDefinition, enemies: readonly CustomEnemyDraft[]): boolean {
  const available = new Map(enemies.map((enemy) => [enemy.id, enemy]));
  const pending: string[] = [];
  mode.waves.forEach((wave) => {
    wave.groups?.forEach((group) => pending.push(group.kind));
    wave.blocks?.forEach((block) => pending.push(block.enemy));
  });
  const visited = new Set<string>();
  while (pending.length > 0) {
    const kind = pending.pop();
    if (!kind?.startsWith("custom-enemy:") || visited.has(kind)) continue;
    visited.add(kind);
    const enemy = available.get(kind as CustomEnemyDraft["id"]);
    if (!enemy) return false;
    enemy.abilities.forEach((ability) => ability.actions.forEach((action) => {
      if (action.type === "summon") action.kinds.forEach((summonKind) => pending.push(summonKind));
    }));
  }
  return true;
}

function beginGuestMultiplayerRun(session: MultiplayerSessionStart): void {
  const officialMap = !session.map.isCustom
    ? Object.values(MAP_DEFINITIONS).find((candidate) => candidate.kind === session.map.kind)
    : undefined;
  const officialMode = !session.mode.isCustom
    ? MODE_DEFINITIONS.find((candidate) => candidate.kind === session.mode.kind)
    : undefined;
  const safeSession = officialMap || officialMode
    ? { ...session, map: officialMap ?? session.map, mode: officialMode ?? session.mode }
    : session;
  const reconnectingSameSession = activeMultiplayerStart?.id === safeSession.id && activeMultiplayerStart.round === safeSession.round && lastGuestStartedRound === safeSession.round;
  const players = safeSession.players.map((player) => restrictMultiplayerLoadout(sanitizeMultiplayerPlayer(player, player.id), safeSession.allowedTowers));
  const local = players.find((player) => player.id === localMultiplayerPlayer.id);
  const remote = players.find((player) => player.id !== localMultiplayerPlayer.id);
  if (!local || !remote) {
    multiplayerSession.sendControl({ type: "error", message: "The host session does not contain this guest slot." });
    addLog("Multiplayer start rejected // guest identity does not match the reserved slot.", "danger");
    return;
  }
  const sessionEnemies = sanitizeCustomEnemies(safeSession.customEnemies);
  if (!sessionEnemyReferencesAvailable(safeSession.mode, sessionEnemies)) {
    multiplayerSession.sendControl({ type: "error", message: "Host content is missing a required custom enemy." });
    addLog("Multiplayer start rejected // incomplete custom enemy snapshot.", "danger");
    return;
  }
  setCustomEnemyRegistry(sessionEnemies);
  guestSessionContentActive = true;
  remoteMultiplayerPlayer = remote;
  activeMultiplayerStart = { ...safeSession, players };
  multiplayerPhase = "playing";
  multiplayerRound = safeSession.round;
  lastGuestStartedRound = safeSession.round;
  multiplayerGuestReady = false;
  guestReplicationDecoder.reset();
  if (!reconnectingSameSession) appliedEventIds.clear();
  latestEventAckSent = 0;
  guestPulsePending = false;
  if (!reconnectingSameSession) guestPulseSequence = 0;
  guestPulseSentAt.clear();
  lastGuestPulseSentAt = 0;
  guestPulseUrgent = false;
  guestEventAckPending = false;
  lastGuestEventAckAt = 0;
  lastGuestAckEventId = 0;
  guestEventAckPulses = 0;
  previousGuestEventAckPulses = 0;
  guestEventAckRate = 0;
  localCursorPoint = null;
  pendingCursor = undefined;
  resumeAwaitingKeyframe = false;
  lastReplicationErrorAt = 0;
  lastReplicationFrameAt = 0;
  lastResyncRequestAt = 0;
  activeMap = safeSession.map;
  activeMode = safeSession.mode;
  mapTestActive = false;
  modeTestActive = false;
  runSettled = false;
  [mainMenu, multiplayerScreen, creatorHub, enemySelection, enemyCreator, modeSelection, battleSetup, mapLibrary, mapCreator, modeCreator, towerShop, gameOverPanel, victoryPanel]
    .forEach((screen) => { screen.hidden = true; });
  shell.classList.add("run-active");
  game.configureMultiplayer("guest", local, players);
  game.startRun(activeMap, local.loadout, activeMode);
  addLog(`Linked to ${remote.username} // host-authoritative mirror online.`, "good");
}

function handleMultiplayerControl(message: MultiplayerControlMessage, peerId: string): void {
  if (!multiplayerSession.isExpectedPeer(peerId)) return;
  if (message.type === "hello") {
    if (message.gameVersion !== GAME_VERSION) {
      const detail = `Game version mismatch // you have ${GAME_VERSION}; your friend has ${message.gameVersion ?? "an older build"}. Update both players to ${GAME_VERSION}.`;
      multiplayerSession.sendControl({ type: "error", message: detail });
      closeMultiplayerSession(detail);
      return;
    }
    const sanitizedPeer = sanitizeMultiplayerPlayer(message.player, message.player.id);
    const peer = multiplayerSession.role === "host" && activeMultiplayerStart
      ? restrictMultiplayerLoadout(sanitizedPeer, activeMultiplayerStart.allowedTowers)
      : sanitizedPeer;
    if (peer.id === localMultiplayerPlayer.id) return;
    if (multiplayerSession.role === "host" && activeMultiplayerStart) {
      const reservedGuest = activeMultiplayerStart.players.find((player) => player.id !== localMultiplayerPlayer.id);
      if (reservedGuest && reservedGuest.id !== peer.id) {
        multiplayerSession.sendControl({ type: "error", message: "This active session is reserved for its original guest." });
        return;
      }
    }
    remoteMultiplayerPlayer = peer;
    renderMultiplayerStatus(multiplayerSession.status, "Peer identity verified. Secure relay ready.");
    if (activeMultiplayerStart && multiplayerPhase === "playing") game.updateMultiplayerPlayers([localMultiplayerPlayer, peer]);
    if (multiplayerSession.role === "host") {
      if (activeMultiplayerStart && multiplayerPhase === "lobby") {
        activeMultiplayerStart = { ...activeMultiplayerStart, players: [restrictMultiplayerLoadout(localMultiplayerPlayer, activeMultiplayerStart.allowedTowers), peer] };
        sendMultiplayerLobbyState();
        if (pendingMultiplayerResult) multiplayerSession.sendControl({ type: "result", result: pendingMultiplayerResult });
      } else if (activeMultiplayerStart && multiplayerPhase === "playing") {
        multiplayerSession.sendControl({ type: "session-start", session: activeMultiplayerStart });
        void window.monochromiumDesktop?.requestHostKeyframe();
        if (pendingMultiplayerResult) multiplayerSession.sendControl({ type: "result", result: pendingMultiplayerResult });
        addLog(`${peer.username} reconnected // wallet, towers, and controls restored.`, "good");
      } else {
        sendMultiplayerLobbyState();
      }
    }
    return;
  }
  if (message.type === "lobby-ready") {
    if (multiplayerSession.role !== "host" || multiplayerPhase !== "lobby" || !remoteMultiplayerPlayer || message.player.id !== remoteMultiplayerPlayer.id) return;
    const sanitizedPeer = sanitizeMultiplayerPlayer(message.player, message.player.id);
    const peer = activeMultiplayerStart ? restrictMultiplayerLoadout(sanitizedPeer, activeMultiplayerStart.allowedTowers) : sanitizedPeer;
    remoteMultiplayerPlayer = peer;
    if (!activeMultiplayerStart) {
      if (message.round !== multiplayerRound || message.ready) return;
      sendMultiplayerLobbyState();
      renderMultiplayerLobby();
      return;
    }
    if (message.round !== activeMultiplayerStart.round) return;
    activeMultiplayerStart = { ...activeMultiplayerStart, players: [restrictMultiplayerLoadout(localMultiplayerPlayer, activeMultiplayerStart.allowedTowers), peer] };
    multiplayerGuestReady = message.ready;
    sendMultiplayerLobbyState();
    renderMultiplayerLobby();
    if (message.ready) startPreparedMultiplayerRun();
    return;
  }
  if (message.type === "lobby-state") {
    if (multiplayerSession.role !== "guest" || !validMultiplayerLobbyState(message.state)) {
      multiplayerSession.sendControl({ type: "error", message: "Invalid multiplayer room state." });
      return;
    }
    multiplayerPhase = message.state.phase;
    multiplayerRound = message.state.round;
    multiplayerGuestReady = message.state.guestReady;
    if (message.state.session) {
      const players = message.state.session.players.map((player) => restrictMultiplayerLoadout(sanitizeMultiplayerPlayer(player, player.id), message.state.session!.allowedTowers));
      const local = players.find((player) => player.id === localMultiplayerPlayer.id);
      const remote = players.find((player) => player.id !== localMultiplayerPlayer.id);
      if (!local || !remote) return;
      remoteMultiplayerPlayer = remote;
      activeMultiplayerStart = { ...message.state.session, players };
      activeMap = activeMultiplayerStart.map;
      activeMode = activeMultiplayerStart.mode;
    } else {
      activeMultiplayerStart = null;
    }
    renderMultiplayerStatus(multiplayerSession.status, multiplayerPhase === "playing" ? "Round is live. Return to the battlefield." : "Intermission lobby synchronized.");
    if (multiplayerPhase === "lobby") showFrontScreen("multiplayer");
    return;
  }
  if (message.type === "command") {
    if (multiplayerSession.role === "host" && multiplayerPhase === "playing" && activeMultiplayerStart && remoteMultiplayerPlayer) {
      if (message.envelope.playerId !== remoteMultiplayerPlayer.id) return;
      captureReplayCommand(message.envelope);
      pendingCommandOwners.set(message.envelope.commandId, "guest");
      void window.monochromiumDesktop?.submitHostCommand(message.envelope);
    }
    return;
  }
  if (message.type === "command-result" && multiplayerSession.role === "guest") {
    handleCommandResult(message.result);
    return;
  }
  if (message.type === "server-diagnostics" && multiplayerSession.role === "guest") {
    latestServerDiagnostics = message.diagnostics;
    renderServerDiagnostics();
    return;
  }
  if (message.type === "session-start") {
    if (multiplayerSession.role !== "guest" || !validSessionStart(message.session)) {
      multiplayerSession.sendControl({ type: "error", message: "Invalid or incompatible session content snapshot." });
      return;
    }
    beginGuestMultiplayerRun(message.session);
    return;
  }
  if (message.type === "log" && multiplayerSession.role === "guest" && multiplayerPhase === "playing" && activeMultiplayerStart) {
    addLog(message.message, message.tone);
    return;
  }
  if (message.type === "chat") {
    appendChatMessage(message.senderName, message.senderColor, message.text, message.sentAt);
    return;
  }
  if (message.type === "result" && multiplayerSession.role === "guest" && (multiplayerPhase === "playing" || multiplayerPhase === "lobby") && activeMultiplayerStart && validMultiplayerResult(message.result)) {
    receiveMultiplayerResult(message.result);
    return;
  }
  if (message.type === "end") {
    if (multiplayerSession.role === "guest" && activeMultiplayerStart) {
      inspectorDetailsOpen = false;
      selectionSignature = "";
      game.leaveRun();
      game.clearMultiplayer();
      if (guestSessionContentActive) setCustomEnemyRegistry(customEnemies);
      guestSessionContentActive = false;
      activeMultiplayerStart = null;
      void requestNotice("Session ended", `The host ended the session: ${message.reason}`);
      showFrontScreen("main");
      multiplayerSession.close("Host ended the session.");
    } else {
      addLog("Guest left the secure room // host simulation continues.", "danger");
    }
    return;
  }
  if (message.type === "error") addLog(`Multiplayer // ${message.message}`, "danger");
}

function handleMultiplayerRealtime(message: MultiplayerRealtimeMessage, peerId: string): void {
  if (!multiplayerSession.isExpectedPeer(peerId)) return;
  if ((message.type === "cursor" || message.type === "pulse") && remoteMultiplayerPlayer) {
    const point = message.point;
    if (point === null || (Number.isFinite(point?.x) && Number.isFinite(point?.y))) game.setRemoteCursor(remoteMultiplayerPlayer, point);
  }
  if (message.type === "pilot-input" && remoteMultiplayerPlayer) game.setRemoteCursor(remoteMultiplayerPlayer, message.aim);
}

function handleCommandResult(result: CommandResult): void {
  captureReplayResult(result);
  pendingCommandOwners.delete(result.commandId);
  const timer = pendingLocalCommandTimers.get(result.commandId);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    pendingLocalCommandTimers.delete(result.commandId);
  }
  const wasPending = pendingLocalCommands.delete(result.commandId);
  game.resolveMultiplayerCommandFeedback(result.commandId, result.accepted);
  if (!wasPending) return;
  if (!result.accepted) addLog(`SERVER REJECTED ACTION // ${result.message ?? result.rejectionCode ?? "invalid request"}`, "danger");
}

function applyDecodedEvents(events: readonly import("./game/simulationProtocol.ts").SimulationEvent[], serverTick: number, receivedAt = performance.now()): void {
  let latestEventId = 0;
  const freshEvents: import("./game/simulationProtocol.ts").SimulationEvent[] = [];
  events.forEach((event) => {
    latestEventId = Math.max(latestEventId, event.id);
    if (appliedEventIds.has(event.id)) return;
    appliedEventIds.add(event.id);
    freshEvents.push(event);
    if (event.kind === "log" && event.label) addLog(event.label, event.tone);
  });
  capturedReplayEvents.push(...freshEvents);
  if (capturedReplayEvents.length > 128) capturedReplayEvents.splice(0, capturedReplayEvents.length - 128);
  while (appliedEventIds.size > 1_024) appliedEventIds.delete(appliedEventIds.values().next().value as number);
  const allowTransient = !document.hidden;
  if (!allowTransient) stalePresentationEvents += freshEvents.filter((event) => event.kind !== "log" && !(event.kind === "ability" && (event.label === "tempest-field-start" || event.label === "tempest-field-end"))).length;
  game.scheduleMultiplayerEvents(freshEvents, serverTick, receivedAt, allowTransient);
  if (latestEventId > latestEventAckSent && multiplayerSession.role === "guest") {
    latestEventAckSent = latestEventId;
    queueGuestPulse(true);
  }
}

function handleMultiplayerBinary(frame: ArrayBuffer, peerId: string, receivedAt = Date.now()): void {
  if (!multiplayerSession.isExpectedPeer(peerId) || multiplayerSession.role !== "guest" || multiplayerPhase !== "playing" || !activeMultiplayerStart) return;
  multiplayerBytesReceived += frame.byteLength;
  if (Date.now() - receivedAt > 250) {
    replacedReplicationFrames += 1;
    resumeAwaitingKeyframe = true;
    guestReplicationDecoder.reset();
    const now = performance.now();
    if (now - lastResyncRequestAt > 250) {
      lastResyncRequestAt = now;
      multiplayerSession.sendControl({ type: "resync-request", lastSequence: 0 });
    }
    return;
  }
  if (resumeAwaitingKeyframe && !isReplicationKeyframe(frame)) {
    replacedReplicationFrames += 1;
    return;
  }
  try {
    const decoded = guestReplicationDecoder.decode(multiplayerSession.sessionId, frame);
    lastReplicationFrameAt = performance.now();
    const presentationReceivedAt = performance.now();
    if (decoded.keyframe) game.clearMultiplayerPresentationQueue();
    if (!game.applyMultiplayerSnapshot(decoded.snapshot, !document.hidden, decoded.pilotInputAcks, { serverTick: decoded.serverTick, receivedAt: presentationReceivedAt })) throw new Error("Replica rejected authoritative state.");
    applyDecodedEvents(decoded.events, decoded.serverTick, presentationReceivedAt);
    if (decoded.hostCursor !== undefined && remoteMultiplayerPlayer) game.setRemoteCursor(remoteMultiplayerPlayer, decoded.hostCursor);
    if (decoded.keyframe) {
      resumeAwaitingKeyframe = false;
      game.restorePersistentPresentation();
    }
    if (decoded.guestPulseSequence > 0) {
      const sentAt = guestPulseSentAt.get(decoded.guestPulseSequence);
      if (sentAt !== undefined) multiplayerRtt = Math.max(0, performance.now() - sentAt);
      [...guestPulseSentAt.keys()].forEach((sequence) => { if (sequence <= decoded.guestPulseSequence) guestPulseSentAt.delete(sequence); });
    }
    queueGuestPulse();
  } catch (error) {
    if (error instanceof Error && /incompatible multiplayer protocol/i.test(error.message)) {
      renderMultiplayerStatus("failed", error.message);
      return;
    }
    // Keep the room alive while requesting a keyframe, but expose the actual
    // reason instead of leaving the guest stuck on the map with no replica.
    const now = performance.now();
    if (now - lastReplicationErrorAt > 1_500) {
      lastReplicationErrorAt = now;
      addLog(`REPLICATION RESYNC // ${error instanceof Error ? error.message : "invalid state frame"}`, "danger");
    }
    multiplayerSession.sendControl({ type: "resync-request", lastSequence: 0 });
  }
}

function receiveMultiplayerResult(result: MultiplayerResult): void {
  if (runSettled || !validMultiplayerResult(result)) return;
  let claimed: string[] = [];
  try {
    const stored = JSON.parse(window.localStorage.getItem(MULTIPLAYER_REWARD_KEY) ?? "[]") as unknown;
    if (Array.isArray(stored)) claimed = stored.filter((value): value is string => typeof value === "string");
  } catch {
    claimed = [];
  }
  const alreadyClaimed = claimed.includes(result.id);
  if (result.official && !alreadyClaimed) {
    progress.coins += Math.max(0, Math.round(result.coins));
    progress.tokens += Math.max(0, Math.round(result.tokens));
    progress.runs += 1;
    if (result.victory) {
      progress.victories += 1;
      const mapKind = result.mapKind as MapKind;
      if (!progress.clearedMaps.some((kind) => kind === mapKind)) progress.clearedMaps.push(mapKind);
    }
    saveProgress(progress);
    renderMeta();
    try {
      window.localStorage.setItem(MULTIPLAYER_REWARD_KEY, JSON.stringify([...claimed, result.id].slice(-50)));
    } catch {
      // The profile save still contains the applied reward.
    }
  }
  runSettled = true;
  addLog(
    result.victory
      ? `Round ${result.round.toString().padStart(2, "0")} secured // ${alreadyClaimed ? "reward already claimed" : "reward applied"}.`
      : `Round ${result.round.toString().padStart(2, "0")} ended at wave ${result.wave.toString().padStart(2, "0")} // room remains open.`,
    result.victory ? "good" : "danger",
  );
  openMultiplayerIntermission();
}
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
    // The toggle still works for this session when local preference storage is unavailable.
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
    enemy?.abilities.forEach((ability) => ability.actions.forEach((action) => {
      if (action.type === "summon") action.kinds.forEach((summonKind) => visit(summonKind));
    }));
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
    version: 2,
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

const getAllMapDefinitions = (): MapDefinition[] => {
  let nextOfficialIndex = Object.keys(MAP_DEFINITIONS).length + 1;
  return [
    ...Object.values(MAP_DEFINITIONS),
    ...customMaps.map(customMapToDefinition),
  ].map((map) => {
    if (map.isCustom) return map;
    const indexed = { ...map, index: map.index > 0 ? map.index : nextOfficialIndex };
    if (map.index === 0) nextOfficialIndex += 1;
    return indexed;
  });
};

const getOfficialMapDefinitions = (): MapDefinition[] => getAllMapDefinitions().filter((map) => !map.isCustom);

const getMapDefinition = (kind: string): MapDefinition | null =>
  getAllMapDefinitions().find((map) => map.kind === kind) ?? null;

const loadModeTestMapKind = (): MapKind | null => {
  try {
    const saved = window.localStorage.getItem(MODE_TEST_MAP_KEY);
    return saved && getMapDefinition(saved) ? saved as MapKind : null;
  } catch {
    return null;
  }
};

const saveModeTestMapKind = (kind: MapKind): void => {
  modeTestMapKind = kind;
  try {
    window.localStorage.setItem(MODE_TEST_MAP_KEY, kind);
  } catch {
    // The current selection still applies for this session when storage is unavailable.
  }
};

const renderUpdateState = (state: MonochromiumUpdateState): void => {
  updateStatus.textContent = state.message;
  updateStatus.dataset["status"] = state.status;
  checkUpdateButton.disabled = ["checking", "downloading", "installing"].includes(state.status);
  downloadUpdateButton.hidden = state.status !== "available";
  installUpdateButton.hidden = state.status !== "downloaded";
  const hasProgress = ["downloading", "installing"].includes(state.status) && typeof state.progress === "number";
  updateProgressWrap.hidden = !hasProgress;
  if (hasProgress) {
    const progress = Math.max(0, Math.min(100, state.progress ?? 0));
    updateProgressBar.style.width = `${progress}%`;
    updateProgress.setAttribute("aria-valuenow", String(progress));
    updateProgressValue.textContent = `${progress}%`;
  }
  if (state.status === "downloaded") updateStatus.classList.add("ready");
  else updateStatus.classList.remove("ready");
};

const renderBalanceLab = (): void => {
  if (!balanceDraft) balanceDraft = cloneTowerDefinition(balanceKind);
  balanceTowerKind.value = balanceKind;
  balanceFields.innerHTML = renderBalanceFieldsHtml(balanceDraft);
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
  if (!window.monochromiumDesktop || !await requestConfirmation({ title: "Download update?", copy: "The update will download in the background and will not install until you confirm again.", acceptLabel: "Download update" })) return;
  renderUpdateState(await window.monochromiumDesktop.downloadUpdate());
};

const installUpdate = async (): Promise<void> => {
  if (!window.monochromiumDesktop || !await requestConfirmation({ title: "Restart and install?", copy: "Monochromium will close, install the downloaded update, and restart.", acceptLabel: "Restart and install" })) return;
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
  query<HTMLElement>("#setup-coins").textContent = progress.coins.toLocaleString();
  query<HTMLElement>("#setup-tokens").textContent = progress.tokens.toLocaleString();
  query<HTMLElement>("#shop-coins").textContent = progress.coins.toLocaleString();
  query<HTMLElement>("#shop-tokens").textContent = progress.tokens.toLocaleString();
  updateShopAndLoadoutUi(document, progress);
  query<HTMLElement>("#creator-mode-count").textContent = customModes.length.toString();
  query<HTMLElement>("#creator-enemy-count").textContent = customEnemies.length.toString();
  query<HTMLElement>("#creator-map-count").textContent = customMaps.length.toString();
};

const saveDebugProfile = (message: string): void => {
  saveProgress(progress);
  game.setAvailableTowers(progress.loadout);
  game.setAvailablePerks(progress.perkLoadout);
  localMultiplayerPlayer = sanitizeMultiplayerPlayer({ ...localMultiplayerPlayer, loadout: progress.loadout, perkLoadout: progress.perkLoadout });
  cacheProgressLocally(progress);
  renderMeta();
  query<HTMLElement>("#debug-save-badge").textContent = "SAVED";
  query<HTMLElement>("#debug-wallet-status").textContent = message;
};

const changeDebugCurrency = (currency: "coins" | "tokens", amount: number): void => {
  if (activeMultiplayerStart || !Number.isFinite(amount)) return;
  progress[currency] = Math.max(0, progress[currency] + Math.floor(amount));
  saveDebugProfile(`${currency === "coins" ? "Coins" : "Tokens"} updated // permanent profile change.`);
  addLog(`Debug // +${Math.floor(amount).toLocaleString()} ${currency}.`, "good");
  audio.uiConfirm();
};

const maxDebugWallet = (): void => {
  if (activeMultiplayerStart) return;
  progress.coins = 999_999;
  progress.tokens = 999_999;
  saveDebugProfile("Wallet capped at 999,999 // permanent profile change.");
  addLog("Debug // shop wallet capped at 999,999 Coins and Tokens.", "good");
  audio.uiConfirm();
};

const unlockAllDebugPerks = (equip: boolean): void => {
  if (activeMultiplayerStart) return;
  progress.unlockedPerks = [...TOWER_PERK_ORDER];
  if (equip) progress.perkLoadout = [...TOWER_PERK_ORDER].slice(0, 3);
  saveDebugProfile(equip ? "All perks unlocked and equipped." : "All perks marked as owned.");
  addLog(equip ? "Debug // all perks unlocked and equipped." : "Debug // all perks permanently unlocked.", "good");
  audio.uiConfirm();
};

const copyDebugSnapshot = async (): Promise<void> => {
  const state = latestUiState;
  const snapshot = {
    capturedAt: new Date().toISOString(),
    profile: {
      coins: progress.coins,
      tokens: progress.tokens,
      unlockedTowers: progress.unlockedTowers,
      loadout: progress.loadout,
      unlockedPerks: progress.unlockedPerks,
      perkLoadout: progress.perkLoadout,
    },
    run: state ? {
      map: state.mapName,
      mode: state.modeName,
      wave: state.wave,
      totalWaves: state.totalWaves,
      waveActive: state.waveActive,
      waveElapsed: Number(state.waveElapsed.toFixed(3)),
      elapsed: Number(state.elapsed.toFixed(3)),
      enemiesRemaining: state.enemiesRemaining,
      towerCount: state.towerCount,
      integrity: state.integrity,
      maxIntegrity: state.maxIntegrity,
      shards: state.shards,
      speed: state.speed,
      paused: state.paused,
      multiplayer: state.multiplayer,
    } : null,
    selectedTower: state?.selectedTower ? {
      id: state.selectedTower.tower.id,
      kind: state.selectedTower.tower.kind,
      level: state.selectedTower.tower.level,
      ownerId: state.selectedTower.tower.ownerId,
      perks: state.selectedTower.tower.perks,
      abilityTimer: state.selectedTower.tower.abilityTimer,
      abilityCooldown: state.selectedTower.tower.abilityCooldown,
      perkPrepTimer: state.selectedTower.tower.perkPrepTimer ?? 0,
    } : null,
  };
  const serialized = JSON.stringify(snapshot, null, 2);
  try {
    await navigator.clipboard.writeText(serialized);
    addLog("Debug snapshot copied to clipboard.", "good");
    query<HTMLElement>("#debug-repro-count").textContent = "STATE COPIED";
  } catch {
    addLog("Debug snapshot could not reach the clipboard.", "danger");
    setSaveStatus("Clipboard unavailable // use the browser permission prompt and try again.", "danger");
  }
};

const renderDebugDashboard = (state: GameUiState | null): void => {
  updateDebugDashboardUi(debugPanel, state, progress, {
    activeSimulationConfig,
    capturedReplayCommandsCount: capturedReplayCommands.length + pendingReplayCommands.size,
    latestSimulationReplay,
  });
};

const renderAudioSettings = (): void => {
  const settings = audio.getSettings();
  audioEnabledInput.checked = settings.enabled;
  query<HTMLElement>("#audio-enabled-value").textContent = settings.enabled ? "ON" : "OFF";
  query<HTMLElement>("#audio-enabled-value").classList.toggle("active", settings.enabled);
  (Object.keys(settings) as Array<keyof AudioSettings>).forEach((key) => {
    if (key === "enabled" || key === "ambience") return;
    const input = query<HTMLInputElement>(`[data-audio-volume='${key}']`);
    const output = query<HTMLOutputElement>(`#audio-value-${key}`);
    input.value = settings[key].toString();
    output.value = `${Math.round(settings[key] * 100)}%`;
    output.textContent = output.value;
  });
  soundButton.title = settings.enabled ? "Open settings" : "Open settings // audio muted";
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

const enemyShapeCard = (name: string, color: string, sides: number, pngDataUrl?: string | null): string => {
  if (pngDataUrl && isValidCustomEnemyDrawing(pngDataUrl)) {
    return `<span class="enemy-card-shape enemy-card-drawing" style="--enemy-card-drawing-image:url('${pngDataUrl}')" aria-hidden="true"></span>`;
  }
  const glyph = name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "E";
  return `<span class="enemy-card-shape" style="background:${color};clip-path:${polygonClipPath(sides)}">${glyph}</span>`;
};

const enemyStatLine = (enemy: {
  hp: number;
  shieldHp: number;
  speed: number;
  damage: number;
  defense?: number;
  protection?: number;
  armor?: number;
  superarmor?: number;
  resistances?: EnemyResistances;
  attacks?: readonly unknown[];
  abilities?: readonly { readonly enabled: boolean }[];
}): string => {
  const shield = enemy.shieldHp > 0 ? ` // ${enemy.shieldHp.toLocaleString()} SHIELD` : "";
  const resistanceList = enemy.resistances
    ? DAMAGE_TYPES.flatMap((type) => {
        const val = enemy.resistances?.[type];
        if (typeof val !== "number" || Math.round(val * 100) === 0) return [];
        const pct = Math.round(val * 100);
        return [`${pct > 0 ? `+${pct}` : pct}% ${type.toUpperCase()}`];
      })
    : [];
  const defenses = [
    enemy.defense && enemy.defense > 0 ? `${enemy.defense} DEF` : "",
    enemy.protection && enemy.protection > 0 ? `${enemy.protection} PROT` : "",
    enemy.armor && enemy.armor > 0 ? `${Math.round(enemy.armor * 100)}% ARM` : "",
    enemy.superarmor && enemy.superarmor > 0 ? `${Math.round(enemy.superarmor * 100)}% SUPER` : "",
    ...resistanceList,
    enemy.abilities && enemy.abilities.length > 0 ? `${enemy.abilities.filter((ability) => ability.enabled).length} ABILIT${enemy.abilities.filter((ability) => ability.enabled).length === 1 ? "Y" : "IES"}` : enemy.attacks && enemy.attacks.length > 0 ? `${enemy.attacks.length} ATTACK${enemy.attacks.length === 1 ? "" : "S"}` : "",
  ].filter(Boolean);
  return `${enemy.hp.toLocaleString()} HP${shield} · ${enemy.speed} SPEED · ${enemy.damage} DMG${defenses.length > 0 ? ` · ${defenses.join(" · ")}` : ""}`;
};

const renderEnemyList = (): void => {
  renderCreatorFolderBar("enemies");
  query<HTMLElement>("#official-enemy-list").innerHTML = getOfficialEnemyDefinitions().map((enemy) => {
    const sides = enemy.sprite.shape === "circle" ? 12 : enemy.sprite.shape === "hexagon" ? 6 : 4;
    const specials = [enemy.hidden ? "HIDDEN" : "", enemy.summon ? "SUMMONER" : "", enemy.shockwave ? "STUN" : "", enemy.regeneration ? "REGEN" : "", enemy.hastePulse ? "HASTE" : "", enemy.drain ? "SIPHON" : "", enemy.phase ? "PHASE" : "", enemy.blink ? "BLINK" : "", enemy.timeLock || enemy.waveLock ? "LOCK" : "", enemy.boss ? "BOSS" : ""].filter(Boolean).join(" // ");
    return `<article class="enemy-library-card official">${enemyShapeCard(enemy.name, enemy.sprite.fill.startsWith("#") ? enemy.sprite.fill : enemy.sprite.accent, sides)}<div><small>OFFICIAL // READ ONLY</small><strong>${escapeHtml(enemy.name)}</strong><p>${enemyStatLine(enemy)}</p>${specials ? `<b>${escapeHtml(specials)}</b>` : ""}</div></article>`;
  }).join("");
  const list = query<HTMLElement>("#custom-enemy-list");
  const visibleEnemies = customEnemies.filter((enemy) => assetMatchesFolder("enemies", enemy.id, activeEnemyFolderId));
  if (visibleEnemies.length === 0) {
    list.innerHTML = `<div class="empty-mode-list"><strong>${customEnemies.length === 0 ? "NO CREATED ENEMIES" : "FOLDER IS EMPTY"}</strong><span>${customEnemies.length === 0 ? "Create a polygon hostile for custom modes." : "Select another folder or move an enemy here."}</span></div>`;
    updateSelectedEnemyCount();
    return;
  }
  list.innerHTML = visibleEnemies.map((enemy) => {
    const specials = [enemy.hidden ? "HIDDEN" : "", enemy.abilities.length > 0 ? `ABILITIES x${enemy.abilities.length}` : "", ...enemy.abilities.filter((ability) => ability.enabled).slice(0, 3).map((ability) => ability.name.toUpperCase()), enemy.boss ? "BOSS" : ""].filter(Boolean).join(" // ");
    return `<article class="enemy-library-card" data-enemy-version="4">${enemyShapeCard(enemy.name, enemy.color, enemy.sides, enemy.appearance.mode === "drawing" ? enemy.appearance.pngDataUrl : null)}<div><small>CREATED V4 // ${enemy.appearance.mode === "drawing" ? "FREEFORM" : `${enemy.sides} SIDES`}</small><strong>${escapeHtml(enemy.name)}</strong><p>${enemyStatLine(enemy)}</p>${specials ? `<b>${escapeHtml(specials)}</b>` : ""}</div><div class="enemy-card-actions"><label class="enemy-select"><input type="checkbox" data-enemy-select="${escapeHtml(enemy.id)}" ${selectedEnemyIds.has(enemy.id) ? "checked" : ""}><span>SELECT</span></label><button data-action="export-enemy" data-enemy-id="${escapeHtml(enemy.id)}">EXPORT</button><button data-action="edit-enemy" data-enemy-id="${escapeHtml(enemy.id)}">EDIT</button><button class="danger" data-action="delete-enemy" data-enemy-id="${escapeHtml(enemy.id)}">DELETE</button></div></article>`;
  }).join("");
  updateSelectedEnemyCount();
};

const behaviorActionEditor = (ruleIndex: number, actionIndex: number, actionCount: number, action: CustomEnemyDraft["behaviorRules"][number]["actions"][number]): string => {
  const attribute = `data-behavior-rule-index="${ruleIndex}" data-behavior-action-index="${actionIndex}"`;
  const numeric = (field: string, label: string, value: number, min: number, max: number, step = 0.1): string =>
    `<label><span>${label}</span><input type="number" ${attribute} data-behavior-action-field="${field}" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
  let specifics = "";
  if (action.type === "stop" || action.type === "invulnerable") specifics = numeric("duration", "DURATION", action.duration, 0.1, 600);
  else if (action.type === "regenerate") specifics = `${numeric("amount", "TOTAL HP", action.amount, 0, 10_000_000, 1)}${numeric("duration", "OVER SECONDS", action.duration, 0.1, 600)}`;
  else if (action.type === "stomp") specifics = `${numeric("radius", "RADIUS", action.radius, 20, 1000, 1)}${numeric("damage", "DAMAGE", action.damage, 0, 1_000_000, 1)}${numeric("stunDuration", "STUN", action.stunDuration, 0, 60)}`;
  else if (action.type === "stat-change") specifics = `${numeric("duration", "DURATION", action.duration, 0.1, 600)}${numeric("speedMultiplier", "SPEED x", action.speedMultiplier, 0, 10, 0.05)}${numeric("damageMultiplier", "DAMAGE x", action.damageMultiplier, 0, 10, 0.05)}`;
  else specifics = numeric("distance", "PATH DISTANCE", action.distance, 5, 1000, 1);
  return `<article class="behavior-action"><div class="behavior-action-head"><label><span>ACTION</span><select ${attribute} data-behavior-action-field="type"><option value="stop" ${action.type === "stop" ? "selected" : ""}>STOP MOVEMENT</option><option value="invulnerable" ${action.type === "invulnerable" ? "selected" : ""}>INVULNERABLE</option><option value="regenerate" ${action.type === "regenerate" ? "selected" : ""}>REGENERATE</option><option value="stomp" ${action.type === "stomp" ? "selected" : ""}>STOMP</option><option value="stat-change" ${action.type === "stat-change" ? "selected" : ""}>STAT CHANGE</option><option value="blink" ${action.type === "blink" ? "selected" : ""}>BLINK</option></select></label><button class="danger" data-action="enemy-delete-behavior-action" ${attribute} ${actionCount <= 1 ? "disabled title=\"A rule needs at least one action block.\"" : ""}>REMOVE</button></div><div class="behavior-action-fields">${numeric("delay", "DELAY", action.delay, 0, 600)}${specifics}</div></article>`;
};

const renderBehaviorRules = (): void => {
  if (!enemyDraft) return;
  const container = query<HTMLElement>("#enemy-behavior-rules");
  if (enemyDraft.behaviorRules.length === 0) {
    container.innerHTML = `<div class="behavior-empty"><strong>NO BEHAVIOR RULES</strong><span>Add a rule to combine HP/time triggers with one or more actions.</span></div>`;
    return;
  }
  container.innerHTML = enemyDraft.behaviorRules.map((rule, ruleIndex) => {
    const condition = (field: string, label: string, value: number | null, max: number): string => `<label><span>${label}</span><input type="number" data-behavior-rule-index="${ruleIndex}" data-behavior-rule-field="${field}" value="${value ?? ""}" min="0" max="${max}" step="0.1" placeholder="ANY"></label>`;
    return `<article class="behavior-rule"><header><label><span>RULE NAME</span><input data-behavior-rule-index="${ruleIndex}" data-behavior-rule-field="name" maxlength="40" value="${escapeHtml(rule.name)}"></label><button class="danger" data-action="enemy-delete-behavior-rule" data-behavior-rule-index="${ruleIndex}">DELETE RULE</button></header><div class="behavior-conditions">${condition("minHp", "MIN HP", rule.minHp, 10_000_000)}${condition("maxHp", "MAX HP", rule.maxHp, 10_000_000)}${condition("minAliveTime", "MIN AGE (S)", rule.minAliveTime, 86_400)}${condition("maxAliveTime", "MAX AGE (S)", rule.maxAliveTime, 86_400)}<label><span>COOLDOWN</span><input type="number" data-behavior-rule-index="${ruleIndex}" data-behavior-rule-field="cooldown" value="${rule.cooldown}" min="0.1" max="600" step="0.1"></label><label><span>MAX USES</span><input type="number" data-behavior-rule-index="${ruleIndex}" data-behavior-rule-field="maxUses" value="${rule.maxUses}" min="0" max="999" step="1"></label></div><div class="behavior-actions">${rule.actions.map((action, actionIndex) => behaviorActionEditor(ruleIndex, actionIndex, rule.actions.length, action)).join("")}</div><button class="behavior-add-action" data-action="enemy-add-behavior-action" data-behavior-rule-index="${ruleIndex}">ADD ACTION BLOCK +</button></article>`;
  }).join("");
};

const attackSelect = (value: string, options: readonly string[]): string => options
  .map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${option.toUpperCase()}</option>`)
  .join("");

const renderEnemyAttacks = (): void => {
  if (!enemyDraft) return;
  const container = query<HTMLElement>("#enemy-attacks");
  if (enemyDraft.attacks.length === 0) {
    container.innerHTML = `<div class="behavior-empty"><strong>NO CUSTOM ATTACKS</strong><span>Add a saved recipe to give this enemy ranged, wave, or forward attacks.</span></div>`;
    return;
  }
  container.innerHTML = enemyDraft.attacks.map((attack, attackIndex) => {
    const nullable = (field: string, label: string, value: number | null, max: number): string => `<label><span>${label}</span><input type="number" data-enemy-attack-field="${field}" data-attack-index="${attackIndex}" value="${value ?? ""}" min="0" max="${max}" step="0.1" placeholder="ANY"></label>`;
    const effects = attack.effects.map((effect, effectIndex) => effect.type === "damage"
      ? `<div class="attack-part"><select data-enemy-attack-effect="type" data-attack-index="${attackIndex}" data-effect-index="${effectIndex}">${attackSelect(effect.type, ["damage", "stun"])}</select><label><span>DAMAGE</span><input type="number" data-enemy-attack-effect="amount" data-attack-index="${attackIndex}" data-effect-index="${effectIndex}" value="${effect.amount}" min="0" max="1000000" step="1"></label><button class="danger" data-action="enemy-delete-attack-effect" data-attack-index="${attackIndex}" data-effect-index="${effectIndex}">×</button></div>`
      : `<div class="attack-part"><select data-enemy-attack-effect="type" data-attack-index="${attackIndex}" data-effect-index="${effectIndex}">${attackSelect(effect.type, ["damage", "stun"])}</select><label><span>STUN SECONDS</span><input type="number" data-enemy-attack-effect="duration" data-attack-index="${attackIndex}" data-effect-index="${effectIndex}" value="${effect.duration}" min="0" max="60" step="0.1"></label><button class="danger" data-action="enemy-delete-attack-effect" data-attack-index="${attackIndex}" data-effect-index="${effectIndex}">×</button></div>`).join("");
    const visuals = attack.visuals.map((visual, visualIndex) => `<div class="attack-part"><select data-enemy-attack-visual="type" data-attack-index="${attackIndex}" data-visual-index="${visualIndex}">${attackSelect(visual.type, ["projectile", "beam", "explosion", "lightning", "wave", "slash"])}</select><label><span>COLOR</span><input type="color" data-enemy-attack-visual="color" data-attack-index="${attackIndex}" data-visual-index="${visualIndex}" value="${visual.color}"></label><label><span>SIZE</span><input type="number" data-enemy-attack-visual="size" data-attack-index="${attackIndex}" data-visual-index="${visualIndex}" value="${visual.size}" min="0.1" max="10" step="0.05"></label><label><span>WIDTH</span><input type="number" data-enemy-attack-visual="width" data-attack-index="${attackIndex}" data-visual-index="${visualIndex}" value="${visual.width}" min="0.5" max="100" step="0.5"></label><label><span>LIFE</span><input type="number" data-enemy-attack-visual="duration" data-attack-index="${attackIndex}" data-visual-index="${visualIndex}" value="${visual.duration}" min="0.05" max="10" step="0.05"></label><label><span>SPEED</span><input type="number" data-enemy-attack-visual="speed" data-attack-index="${attackIndex}" data-visual-index="${visualIndex}" value="${visual.speed}" min="40" max="2000" step="10"></label><button class="danger" data-action="enemy-delete-attack-visual" data-attack-index="${attackIndex}" data-visual-index="${visualIndex}">×</button></div>`).join("");
    return `<article class="behavior-rule attack-card"><header><label><span>ATTACK NAME</span><input data-enemy-attack-field="name" data-attack-index="${attackIndex}" maxlength="40" value="${escapeHtml(attack.name)}"></label><button class="danger" data-action="enemy-delete-attack" data-attack-index="${attackIndex}">DELETE ATTACK</button></header><div class="behavior-conditions"><label><span>COOLDOWN</span><input type="number" data-enemy-attack-field="cooldown" data-attack-index="${attackIndex}" value="${attack.cooldown}" min="0.1" max="600" step="0.1"></label><label><span>MAX USES</span><input type="number" data-enemy-attack-field="maxUses" data-attack-index="${attackIndex}" value="${attack.maxUses}" min="0" max="999" step="1"></label>${nullable("minHp", "MIN HP", attack.minHp, 10000000)}${nullable("maxHp", "MAX HP", attack.maxHp, 10000000)}${nullable("minAliveTime", "MIN AGE", attack.minAliveTime, 86400)}${nullable("maxAliveTime", "MAX AGE", attack.maxAliveTime, 86400)}</div><div class="behavior-conditions"><label><span>TARGETING</span><select data-enemy-attack-field="targeting" data-attack-index="${attackIndex}">${attackSelect(attack.targeting, ["first", "last", "strongest", "weakest", "closest"])}</select></label><label><span>DELIVERY</span><select data-enemy-attack-field="delivery" data-attack-index="${attackIndex}">${attackSelect(attack.delivery, ["ranged", "wave", "forward"])}</select></label><label><span>RANGE</span><input type="number" data-enemy-attack-field="range" data-attack-index="${attackIndex}" value="${attack.range}" min="20" max="2000" step="1"></label><label><span>MAX TARGETS</span><input type="number" data-enemy-attack-field="maxTargets" data-attack-index="${attackIndex}" value="${attack.maxTargets}" min="1" max="64" step="1"></label><label><span>WIDTH</span><input type="number" data-enemy-attack-field="width" data-attack-index="${attackIndex}" value="${attack.width}" min="4" max="1000" step="1"></label><label><span>DEPTH</span><input type="number" data-enemy-attack-field="depth" data-attack-index="${attackIndex}" value="${attack.depth}" min="4" max="2000" step="1"></label><label><span>ANGLE</span><input type="number" data-enemy-attack-field="angle" data-attack-index="${attackIndex}" value="${attack.angle}" min="5" max="180" step="1"></label><label><span>PROJECTILE SPEED</span><input type="number" data-enemy-attack-field="projectileSpeed" data-attack-index="${attackIndex}" value="${attack.projectileSpeed}" min="40" max="2000" step="10"></label></div><div class="attack-parts"><header><span>EFFECTS</span><button class="secondary-button" data-action="enemy-add-attack-effect" data-attack-index="${attackIndex}">ADD EFFECT +</button></header>${effects}</div><div class="attack-parts"><header><span>VISUAL LAYERS</span><button class="secondary-button" data-action="enemy-add-attack-visual" data-attack-index="${attackIndex}">ADD VISUAL +</button></header>${visuals}</div></article>`;
  }).join("");
};

const drawingPoint = (event: PointerEvent): Point => {
  const bounds = enemyDrawingCanvas.getBoundingClientRect();
  return {
    x: clamp((event.clientX - bounds.left) * (drawingResolution / Math.max(1, bounds.width)), 0, drawingResolution),
    y: clamp((event.clientY - bounds.top) * (drawingResolution / Math.max(1, bounds.height)), 0, drawingResolution),
  };
};

const drawingBrushStampCache = new Map<string, HTMLCanvasElement>();

const drawingBrushSize = (): number => clamp(Number(query<HTMLInputElement>("#enemy-drawing-size").value) || 12, 1, 48);
const drawingBrushOpacity = (): number => clamp((Number(query<HTMLInputElement>("#enemy-drawing-opacity").value) || 100) / 100, 0.01, 1);
const drawingBrushHardness = (): number => clamp((Number(query<HTMLInputElement>("#enemy-drawing-hardness").value) || 80) / 100, 0, 1);
const drawingRenderMode = (): "smooth" | "pixel" => query<HTMLSelectElement>("#enemy-drawing-render-mode").value === "pixel" ? "pixel" : "smooth";
const drawingColor = (): string => /^#[0-9a-f]{6}$/i.test(drawingBrushColor) ? drawingBrushColor : "#d46cff";

const updateDrawingHistoryControls = (): void => {
  query<HTMLButtonElement>("[data-action='enemy-drawing-undo']").disabled = drawingHistory.length === 0;
  query<HTMLButtonElement>("[data-action='enemy-drawing-redo']").disabled = drawingRedoHistory.length === 0;
};

let drawingLastClientPos: Point | null = null;

const updateDrawingCursor = (clientPos?: Point | null): void => {
  if (clientPos !== undefined) drawingLastClientPos = clientPos;
  if (!drawingModalOpen || !enemyDraft || enemyDraft.appearance.mode !== "drawing") {
    enemyDrawingCanvas.style.cursor = "default";
    enemyDrawingBrushPreview.style.display = "none";
    return;
  }
  if (drawingTool === "pan") {
    enemyDrawingCanvas.style.cursor = "grab";
    enemyDrawingBrushPreview.style.display = "none";
    return;
  }
  if (drawingTool === "fill") {
    enemyDrawingCanvas.style.cursor = "crosshair";
    enemyDrawingBrushPreview.style.display = "none";
    return;
  }
  const diameter = drawingBrushSize() * drawingCursorScale;
  enemyDrawingCanvas.style.cursor = drawingCursorSvg(diameter, drawingColor(), drawingTool === "eraser", drawingRenderMode() === "pixel");
  if (diameter > 124 && drawingLastClientPos) {
    const wrapRect = enemyDrawingCanvasWrap.getBoundingClientRect();
    const x = drawingLastClientPos.x - wrapRect.left;
    const y = drawingLastClientPos.y - wrapRect.top;
    const roundedDiameter = Math.round(diameter);
    enemyDrawingBrushPreview.style.width = `${roundedDiameter}px`;
    enemyDrawingBrushPreview.style.height = `${roundedDiameter}px`;
    enemyDrawingBrushPreview.style.left = `${x}px`;
    enemyDrawingBrushPreview.style.top = `${y}px`;
    enemyDrawingBrushPreview.style.borderColor = drawingTool === "eraser" ? "#ff8c86" : drawingColor();
    enemyDrawingBrushPreview.classList.toggle("pixel", drawingRenderMode() === "pixel");
    enemyDrawingBrushPreview.style.display = "block";
  } else {
    enemyDrawingBrushPreview.style.display = "none";
  }
};

const renderDrawingToolState = (): void => {
  query<HTMLSelectElement>("#enemy-drawing-tool").value = drawingTool;
  enemyDrawingResolution.value = drawingResolution.toString();
  const grid = query<HTMLButtonElement>("[data-action='enemy-drawing-grid']");
  grid.classList.toggle("active", drawingGridVisible);
  grid.textContent = drawingGridVisible ? "GRID ON" : "GRID";
  enemyDrawingStage.classList.toggle("pan-active", drawingTool === "pan");
  enemyDrawingGrid.hidden = !drawingGridVisible;
  updateDrawingCursor();
  updateDrawingHistoryControls();
};

const updateDrawingSurfaceLayout = (): void => {
  const stageWidth = enemyDrawingStage.clientWidth || 620;
  const stageHeight = enemyDrawingStage.clientHeight || stageWidth;
  const baseSize = Math.max(128, Math.min(620, stageWidth, stageHeight));
  const displaySize = Math.round(baseSize * drawingZoom);
  enemyDrawingCanvasWrap.style.width = `${displaySize}px`;
  enemyDrawingCanvasWrap.style.height = `${displaySize}px`;
  enemyDrawingCanvas.style.width = `${displaySize}px`;
  enemyDrawingCanvas.style.height = `${displaySize}px`;
  enemyDrawingGrid.style.setProperty("--drawing-grid-size", `${displaySize / drawingResolution}px`);
  drawingCursorScale = displaySize / drawingResolution;
  query<HTMLOutputElement>("#enemy-drawing-zoom-value").textContent = `${Math.round(drawingZoom * 100)}%`;

  if (drawingZoom <= 1) {
    enemyDrawingStage.style.overflow = "hidden";
    enemyDrawingStage.scrollLeft = 0;
    enemyDrawingStage.scrollTop = 0;
    enemyDrawingCanvasWrap.style.margin = "auto";
  } else {
    enemyDrawingStage.style.overflow = "auto";
    enemyDrawingCanvasWrap.style.margin = "0 auto";
  }
  updateDrawingCursor();
};

const setDrawingZoom = (nextZoom: number): void => {
  const closest = findClosestDrawingZoom(nextZoom);
  if (closest === drawingZoom) return;
  const centerX = enemyDrawingStage.scrollLeft + enemyDrawingStage.clientWidth / 2;
  const centerY = enemyDrawingStage.scrollTop + enemyDrawingStage.clientHeight / 2;
  const ratio = closest / drawingZoom;
  drawingZoom = closest;
  updateDrawingSurfaceLayout();
  if (drawingZoom > 1) {
    enemyDrawingStage.scrollLeft = Math.max(0, centerX * ratio - enemyDrawingStage.clientWidth / 2);
    enemyDrawingStage.scrollTop = Math.max(0, centerY * ratio - enemyDrawingStage.clientHeight / 2);
  }
};

const setDrawingResolution = (resolution: 128 | 256, rescaleCurrent = true): void => {
  const nextResolution: 128 | 256 = resolution === 256 ? 256 : 128;
  if (drawingResolution === nextResolution && enemyDrawingCanvas.width === nextResolution) {
    enemyDrawingResolution.value = nextResolution.toString();
    enemyCropResolution.value = nextResolution.toString();
    enemyCropPreviewSize.textContent = `${nextResolution}×${nextResolution} SPRITE`;
    return;
  }
  const oldWidth = enemyDrawingCanvas.width || drawingResolution;
  const oldHeight = enemyDrawingCanvas.height || drawingResolution;
  const temp = document.createElement("canvas");
  temp.width = oldWidth;
  temp.height = oldHeight;
  const tempCtx = temp.getContext("2d");
  if (tempCtx) tempCtx.drawImage(enemyDrawingCanvas, 0, 0);

  drawingResolution = nextResolution;
  enemyDrawingCanvas.width = nextResolution;
  enemyDrawingCanvas.height = nextResolution;
  enemyDrawingResolution.value = nextResolution.toString();
  enemyCropResolution.value = nextResolution.toString();
  enemyCropPreviewSize.textContent = `${nextResolution}×${nextResolution} SPRITE`;

  if (rescaleCurrent && tempCtx) {
    enemyDrawingContext.clearRect(0, 0, nextResolution, nextResolution);
    enemyDrawingContext.imageSmoothingEnabled = false;
    enemyDrawingContext.drawImage(temp, 0, 0, nextResolution, nextResolution);
    commitEnemyDrawing();
  }

  drawingHistory = [];
  drawingRedoHistory = [];
  drawingBrushStampCache.clear();
  updateDrawingHistoryControls();
  updateDrawingSurfaceLayout();
  drawEnemyCreatorPreview();
};

const openEnemyDrawingEditor = (): void => {
  if (!enemyDraft) return;
  drawingModalFocusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  drawingModalOpen = true;
  enemyDrawingOverlay.hidden = false;
  updateDrawingSurfaceLayout();
  renderDrawingToolState();
  focusFirstControl(enemyDrawingOverlay);
};

const closeEnemyDrawingEditor = (): void => {
  if (drawingPointerActive) commitEnemyDrawing();
  drawingPointerActive = false;
  drawingLastPoint = null;
  drawingPanPointerId = null;
  drawingPanLastClientPoint = null;
  drawingModalOpen = false;
  enemyDrawingOverlay.hidden = true;
  updateDrawingCursor();
  drawingModalFocusBefore?.focus();
  drawingModalFocusBefore = null;
};

enemyDrawingOverlay.addEventListener("click", (event) => {
  if (event.target === enemyDrawingOverlay) closeEnemyDrawingEditor();
});



const drawEnemyCreatorPreview = (): void => {
  if (!enemyDraft) return;
  const context = enemyShapePreviewContext;
  context.clearRect(0, 0, enemyShapePreview.width, enemyShapePreview.height);
  context.save();
  context.globalAlpha = enemyDraft.opacity;
  if (enemyDraft.appearance.mode === "drawing") {
    context.drawImage(enemyDrawingCanvas, 0, 0, enemyShapePreview.width, enemyShapePreview.height);
  } else {
    drawPreviewPolygon(context, enemyDraft.sides);
    context.fillStyle = enemyDraft.color;
    context.fill();
    context.fillStyle = "rgba(255,255,255,.9)";
    context.font = "700 28px ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(enemyDraft.name.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "CE", 64, 65);
  }
  context.restore();
};

const syncEnemyDrawingCanvas = (): void => {
  if (!enemyDraft) return;
  const appearance = enemyDraft.appearance;
  const key = `${enemyDraft.id}:${appearance.mode}:${appearance.pngDataUrl ?? ""}`;
  if (key === drawingCanvasKey) {
    drawEnemyCreatorPreview();
    return;
  }
  drawingCanvasKey = key;
  drawingHistory = [];
  drawingRedoHistory = [];
  enemyDrawingContext.clearRect(0, 0, drawingResolution, drawingResolution);
  if (appearance.pngDataUrl && isValidCustomEnemyDrawing(appearance.pngDataUrl)) {
    const image = new Image();
    image.onload = () => {
      if (drawingCanvasKey !== key) return;
      const detectedResolution: 128 | 256 = image.naturalWidth >= 200 || image.naturalHeight >= 200 ? 256 : 128;
      setDrawingResolution(detectedResolution, false);
      enemyDrawingContext.clearRect(0, 0, drawingResolution, drawingResolution);
      enemyDrawingContext.drawImage(image, 0, 0, drawingResolution, drawingResolution);
      drawEnemyCreatorPreview();
    };
    image.src = appearance.pngDataUrl;
  }
  drawEnemyCreatorPreview();
};

const commitEnemyDrawing = (): void => {
  if (!enemyDraft) return;
  const pngDataUrl = enemyDrawingCanvas.toDataURL("image/png");
  enemyDraft.appearance = { mode: "drawing", pngDataUrl };
  drawingCanvasKey = `${enemyDraft.id}:drawing:${pngDataUrl}`;
  drawEnemyCreatorPreview();
};

const rememberDrawingState = (): void => {
  drawingHistory.push(enemyDrawingContext.getImageData(0, 0, drawingResolution, drawingResolution));
  if (drawingHistory.length > 32) drawingHistory.shift();
  drawingRedoHistory = [];
  updateDrawingHistoryControls();
};

const restoreDrawingState = (state: ImageData): void => {
  if (state.width !== drawingResolution || state.height !== drawingResolution) {
    const temp = document.createElement("canvas");
    temp.width = state.width;
    temp.height = state.height;
    temp.getContext("2d")?.putImageData(state, 0, 0);
    enemyDrawingContext.clearRect(0, 0, drawingResolution, drawingResolution);
    enemyDrawingContext.drawImage(temp, 0, 0, drawingResolution, drawingResolution);
  } else {
    enemyDrawingContext.putImageData(state, 0, 0);
  }
  commitEnemyDrawing();
};

const undoEnemyDrawing = (): void => {
  if (!enemyDraft || drawingHistory.length === 0) return;
  drawingRedoHistory.push(enemyDrawingContext.getImageData(0, 0, drawingResolution, drawingResolution));
  const previous = drawingHistory.pop();
  if (previous) restoreDrawingState(previous);
  updateDrawingHistoryControls();
};

const redoEnemyDrawing = (): void => {
  if (!enemyDraft || drawingRedoHistory.length === 0) return;
  drawingHistory.push(enemyDrawingContext.getImageData(0, 0, drawingResolution, drawingResolution));
  const next = drawingRedoHistory.pop();
  if (next) restoreDrawingState(next);
  updateDrawingHistoryControls();
};

const clearEnemyDrawing = (): void => {
  if (!enemyDraft) return;
  rememberDrawingState();
  enemyDrawingContext.clearRect(0, 0, drawingResolution, drawingResolution);
  commitEnemyDrawing();
};

const floodFillEnemyDrawing = (point: Point): boolean => {
  const image = enemyDrawingContext.getImageData(0, 0, drawingResolution, drawingResolution);
  const fillAlpha = drawingTool === "eraser" ? 0 : Math.round(drawingBrushOpacity() * 255);
  const fillRgba: [number, number, number, number] = drawingTool === "eraser"
    ? [0, 0, 0, 0]
    : [
      Number.parseInt(drawingColor().slice(1, 3), 16),
      Number.parseInt(drawingColor().slice(3, 5), 16),
      Number.parseInt(drawingColor().slice(5, 7), 16),
      fillAlpha,
    ];
  const filled = floodFillImageData(image.data, drawingResolution, drawingResolution, point, fillRgba);
  if (filled) {
    enemyDrawingContext.putImageData(image, 0, 0);
  }
  return filled;
};

const paintEnemyDrawing = (from: Point, to: Point): void => {
  const color = drawingColor();
  enemyDrawingContext.save();
  enemyDrawingContext.globalCompositeOperation = drawingTool === "eraser" ? "destination-out" : "source-over";
  enemyDrawingContext.globalAlpha = drawingBrushOpacity();
  if (drawingRenderMode() === "pixel") paintPixelDrawingStroke(enemyDrawingContext, from, to, drawingBrushSize(), color);
  else paintSmoothDrawingStroke(enemyDrawingContext, from, to, drawingBrushSize(), drawingBrushHardness(), color, drawingBrushStampCache);
  enemyDrawingContext.restore();
};

enemyDrawingCanvas.addEventListener("pointerdown", (event) => {
  if (!enemyDraft || enemyDraft.appearance.mode !== "drawing") return;
  if (!event.isPrimary || (event.button !== 0 && event.button !== 1)) return;
  if (drawingTool === "pan" || event.button === 1) {
    drawingPanPointerId = event.pointerId;
    drawingPanLastClientPoint = { x: event.clientX, y: event.clientY };
    enemyDrawingCanvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  if (drawingTool === "fill") {
    const before = enemyDrawingContext.getImageData(0, 0, drawingResolution, drawingResolution);
    if (floodFillEnemyDrawing(drawingPoint(event))) {
      drawingHistory.push(before);
      if (drawingHistory.length > 32) drawingHistory.shift();
      drawingRedoHistory = [];
      updateDrawingHistoryControls();
      commitEnemyDrawing();
    }
    event.preventDefault();
    return;
  }
  drawingPointerActive = true;
  drawingLastPoint = drawingPoint(event);
  rememberDrawingState();
  enemyDrawingCanvas.setPointerCapture(event.pointerId);
  paintEnemyDrawing(drawingLastPoint, drawingLastPoint);
  drawEnemyCreatorPreview();
  event.preventDefault();
});

enemyDrawingCanvas.addEventListener("pointermove", (event) => {
  if (!enemyDraft || enemyDraft.appearance.mode !== "drawing") return;
  if (drawingTool === "brush" || drawingTool === "eraser") {
    updateDrawingCursor({ x: event.clientX, y: event.clientY });
  }
  if (drawingPanPointerId === event.pointerId && drawingPanLastClientPoint) {
    enemyDrawingStage.scrollLeft -= event.clientX - drawingPanLastClientPoint.x;
    enemyDrawingStage.scrollTop -= event.clientY - drawingPanLastClientPoint.y;
    drawingPanLastClientPoint = { x: event.clientX, y: event.clientY };
    event.preventDefault();
    return;
  }
  if (!drawingPointerActive || !drawingLastPoint) return;
  const point = drawingPoint(event);
  paintEnemyDrawing(drawingLastPoint, point);
  drawingLastPoint = point;
  event.preventDefault();
});

const finishEnemyDrawingPointer = (event: PointerEvent): void => {
  if (drawingPanPointerId === event.pointerId) {
    drawingPanPointerId = null;
    drawingPanLastClientPoint = null;
    if (enemyDrawingCanvas.hasPointerCapture(event.pointerId)) enemyDrawingCanvas.releasePointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  if (!drawingPointerActive) return;
  drawingPointerActive = false;
  drawingLastPoint = null;
  if (enemyDrawingCanvas.hasPointerCapture(event.pointerId)) enemyDrawingCanvas.releasePointerCapture(event.pointerId);
  commitEnemyDrawing();
  event.preventDefault();
};

enemyDrawingCanvas.addEventListener("pointerup", finishEnemyDrawingPointer);
enemyDrawingCanvas.addEventListener("pointercancel", finishEnemyDrawingPointer);
enemyDrawingCanvas.addEventListener("pointerleave", () => {
  enemyDrawingBrushPreview.style.display = "none";
});
enemyDrawingStage.addEventListener("wheel", (event) => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  setDrawingZoom(drawingZoom + (event.deltaY < 0 ? 1 : -1));
}, { passive: false });
window.addEventListener("resize", updateDrawingSurfaceLayout);

const CROP_VIEWPORT_SIZE = 340;
const CROP_MASK_RADIUS = 140;

let cropModalOpen = false;
let cropImage: HTMLImageElement | null = null;
let cropShape: CropShape = "circle";
let cropPolygonSides = 5;
let cropZoom = 1.0;
let cropPan: Point = { x: 0, y: 0 };
let cropPointerActive = false;
let cropLastClientPoint: Point | null = null;
let cropModalFocusBefore: HTMLElement | null = null;

const drawCropCanvas = (): void => {
  if (!cropImage) return;
  enemyCropContext.clearRect(0, 0, CROP_VIEWPORT_SIZE, CROP_VIEWPORT_SIZE);

  // Background checkerboard
  const tileSize = 10;
  for (let y = 0; y < CROP_VIEWPORT_SIZE; y += tileSize) {
    for (let x = 0; x < CROP_VIEWPORT_SIZE; x += tileSize) {
      enemyCropContext.fillStyle = ((x / tileSize + y / tileSize) % 2 === 0) ? "#121919" : "#1a2223";
      enemyCropContext.fillRect(x, y, tileSize, tileSize);
    }
  }

  // Draw source image transformed by pan and zoom
  const imgW = cropImage.naturalWidth * cropZoom;
  const imgH = cropImage.naturalHeight * cropZoom;
  const imgX = CROP_VIEWPORT_SIZE / 2 + cropPan.x - imgW / 2;
  const imgY = CROP_VIEWPORT_SIZE / 2 + cropPan.y - imgH / 2;
  enemyCropContext.drawImage(cropImage, imgX, imgY, imgW, imgH);

  // Dark scrim outside the shape mask
  enemyCropContext.save();
  enemyCropContext.fillStyle = "rgba(4, 7, 8, 0.78)";
  enemyCropContext.beginPath();
  enemyCropContext.rect(0, 0, CROP_VIEWPORT_SIZE, CROP_VIEWPORT_SIZE);
  createCropPath(enemyCropContext, cropShape, cropPolygonSides, CROP_VIEWPORT_SIZE / 2, CROP_VIEWPORT_SIZE / 2, CROP_MASK_RADIUS);
  enemyCropContext.fill("evenodd");
  enemyCropContext.restore();

  // Highlight border of the shape
  enemyCropContext.save();
  enemyCropContext.beginPath();
  createCropPath(enemyCropContext, cropShape, cropPolygonSides, CROP_VIEWPORT_SIZE / 2, CROP_VIEWPORT_SIZE / 2, CROP_MASK_RADIUS);
  enemyCropContext.strokeStyle = "#52e596";
  enemyCropContext.lineWidth = 2.5;
  enemyCropContext.shadowColor = "rgba(82, 229, 150, 0.4)";
  enemyCropContext.shadowBlur = 8;
  enemyCropContext.stroke();
  enemyCropContext.restore();

  // Update preview
  const targetSize = drawingResolution;
  const targetRadius = Math.round(targetSize * (60 / 128));
  const targetCenter = targetSize / 2;

  enemyCropPreviewCanvas.width = targetSize;
  enemyCropPreviewCanvas.height = targetSize;
  enemyCropPreviewContext.clearRect(0, 0, targetSize, targetSize);
  enemyCropPreviewContext.save();
  enemyCropPreviewContext.beginPath();
  createCropPath(enemyCropPreviewContext, cropShape, cropPolygonSides, targetCenter, targetCenter, targetRadius);
  enemyCropPreviewContext.clip();

  const outRect = calculateOutputTransform({
    imageWidth: cropImage.naturalWidth,
    imageHeight: cropImage.naturalHeight,
    panX: cropPan.x,
    panY: cropPan.y,
    zoom: cropZoom,
    cropRadius: CROP_MASK_RADIUS,
    targetSize,
    targetRadius,
  });
  enemyCropPreviewContext.drawImage(cropImage, outRect.x, outRect.y, outRect.width, outRect.height);
  enemyCropPreviewContext.restore();
};

const setCropZoom = (zoom: number): void => {
  cropZoom = clamp(zoom, 0.05, 10.0);
  enemyCropZoomSlider.value = `${Math.round(cropZoom * 100)}`;
  enemyCropZoomValue.textContent = `${Math.round(cropZoom * 100)}%`;
  drawCropCanvas();
};

const openEnemyImageCropper = (image: HTMLImageElement): void => {
  cropImage = image;
  cropModalFocusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  cropModalOpen = true;
  cropShape = "circle";
  cropPolygonSides = enemyDraft ? clampSides(enemyDraft.sides) : 5;
  enemyCropShapeSelect.value = cropShape;
  enemyCropSidesGroup.hidden = true;
  enemyCropSidesInput.value = `${cropPolygonSides}`;
  enemyCropSidesValue.textContent = `${cropPolygonSides}`;
  enemyCropResolution.value = drawingResolution.toString();
  enemyCropPreviewSize.textContent = `${drawingResolution}×${drawingResolution} SPRITE`;

  const fitZoom = calculateFitZoom(image.naturalWidth, image.naturalHeight, CROP_MASK_RADIUS, "cover");
  cropPan = { x: 0, y: 0 };
  cropZoom = fitZoom;
  enemyCropZoomSlider.min = `${Math.max(1, Math.round(fitZoom * 20))}`;
  enemyCropZoomSlider.max = `${Math.round(Math.max(fitZoom * 400, 500))}`;
  enemyCropZoomSlider.value = `${Math.round(cropZoom * 100)}`;
  enemyCropZoomValue.textContent = `${Math.round(cropZoom * 100)}%`;

  enemyCropModal.hidden = false;
  drawCropCanvas();
  focusFirstControl(enemyCropModal);
};

const closeEnemyImageCropper = (): void => {
  cropModalOpen = false;
  enemyCropModal.hidden = true;
  cropPointerActive = false;
  cropImage = null;
  cropModalFocusBefore?.focus();
  cropModalFocusBefore = null;
};

const applyEnemyImageCrop = (): void => {
  if (!cropImage || !enemyDraft) return;

  const targetSize = drawingResolution;
  const targetRadius = Math.round(targetSize * (60 / 128));
  const targetCenter = targetSize / 2;

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = targetSize;
  tempCanvas.height = targetSize;
  const tempContext = tempCanvas.getContext("2d");
  if (!tempContext) return;

  tempContext.clearRect(0, 0, targetSize, targetSize);
  tempContext.save();
  tempContext.beginPath();
  createCropPath(tempContext, cropShape, cropPolygonSides, targetCenter, targetCenter, targetRadius);
  tempContext.clip();

  const outRect = calculateOutputTransform({
    imageWidth: cropImage.naturalWidth,
    imageHeight: cropImage.naturalHeight,
    panX: cropPan.x,
    panY: cropPan.y,
    zoom: cropZoom,
    cropRadius: CROP_MASK_RADIUS,
    targetSize,
    targetRadius,
  });
  tempContext.drawImage(cropImage, outRect.x, outRect.y, outRect.width, outRect.height);
  tempContext.restore();

  const dataUrl = tempCanvas.toDataURL("image/png");
  if (!isValidCustomEnemyDrawing(dataUrl)) {
    addLog("Uploaded image could not be encoded as a valid bounded enemy sprite.", "danger");
    audio.uiError();
    return;
  }

  rememberDrawingState();
  setDrawingResolution(targetSize, false);
  enemyDrawingContext.clearRect(0, 0, targetSize, targetSize);
  enemyDrawingContext.drawImage(tempCanvas, 0, 0, targetSize, targetSize);
  enemyDraft.appearance = { mode: "drawing", pngDataUrl: dataUrl };
  drawingCanvasKey = `${enemyDraft.id}:drawing:${dataUrl}`;

  drawEnemyCreatorPreview();
  renderEnemyCreator();
  addLog(`Enemy image cropped and converted to ${targetSize}×${targetSize} sprite.`, "good");
  audio.uiConfirm();

  closeEnemyImageCropper();
};

enemyCropCanvas.addEventListener("pointerdown", (event) => {
  if (!cropModalOpen || !cropImage) return;
  if (!event.isPrimary || event.button !== 0) return;
  cropPointerActive = true;
  cropLastClientPoint = { x: event.clientX, y: event.clientY };
  enemyCropCanvas.setPointerCapture(event.pointerId);
  event.preventDefault();
});

enemyCropCanvas.addEventListener("pointermove", (event) => {
  if (!cropPointerActive || !cropLastClientPoint) return;
  cropPan = {
    x: cropPan.x + (event.clientX - cropLastClientPoint.x),
    y: cropPan.y + (event.clientY - cropLastClientPoint.y),
  };
  cropLastClientPoint = { x: event.clientX, y: event.clientY };
  drawCropCanvas();
  event.preventDefault();
});

const finishCropPointer = (event: PointerEvent): void => {
  if (!cropPointerActive) return;
  cropPointerActive = false;
  cropLastClientPoint = null;
  if (enemyCropCanvas.hasPointerCapture(event.pointerId)) {
    enemyCropCanvas.releasePointerCapture(event.pointerId);
  }
  event.preventDefault();
};

enemyCropCanvas.addEventListener("pointerup", finishCropPointer);
enemyCropCanvas.addEventListener("pointercancel", finishCropPointer);

enemyCropCanvas.addEventListener("wheel", (event) => {
  if (!cropModalOpen || !cropImage) return;
  event.preventDefault();
  const delta = event.deltaY < 0 ? 1.08 : 0.92;
  setCropZoom(cropZoom * delta);
}, { passive: false });

enemyCropShapeSelect.addEventListener("change", () => {
  cropShape = enemyCropShapeSelect.value as CropShape;
  enemyCropSidesGroup.hidden = cropShape !== "polygon";
  drawCropCanvas();
});

enemyCropSidesInput.addEventListener("input", () => {
  cropPolygonSides = clampSides(Number(enemyCropSidesInput.value));
  enemyCropSidesValue.textContent = `${cropPolygonSides}`;
  drawCropCanvas();
});

enemyCropZoomSlider.addEventListener("input", () => {
  setCropZoom((Number(enemyCropZoomSlider.value) || 100) / 100);
});

enemyImageUploadInput.addEventListener("change", () => {
  const file = enemyImageUploadInput.files?.[0];
  enemyImageUploadInput.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result !== "string") return;
    const img = new Image();
    img.onload = () => {
      openEnemyImageCropper(img);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

enemyCropModal.addEventListener("click", (event) => {
  if (event.target === enemyCropModal) closeEnemyImageCropper();
});

let activeEnemyCreatorTab: "stats" | "appearance" | "abilities" = "stats";

const setEnemyCreatorTab = (tab: "stats" | "appearance" | "abilities"): void => {
  activeEnemyCreatorTab = tab;
  const tabButtons = document.querySelectorAll<HTMLElement>("[data-action='enemy-switch-tab']");
  tabButtons.forEach((btn) => {
    const isTarget = btn.dataset["enemyTab"] === tab;
    btn.classList.toggle("active", isTarget);
    btn.setAttribute("aria-selected", isTarget ? "true" : "false");
  });
  const panels = document.querySelectorAll<HTMLElement>(".enemy-tab-panel");
  panels.forEach((panel) => {
    const isTarget = panel.dataset["tabPanel"] === tab;
    panel.classList.toggle("active", isTarget);
    panel.hidden = !isTarget;
  });
  if (tab === "abilities") {
    enemyCreatorV4.render();
  }
};

const renderEnemyCreator = (): void => {
  if (!enemyDraft) return;
  const field = <T extends HTMLInputElement>(name: string): T => query<T>(`[data-enemy-field='${name}']`);
  field("name").value = enemyDraft.name;
  field("color").value = enemyDraft.color;
  field("opacity").value = Math.round(enemyDraft.opacity * 100).toString();
  field("sides").value = enemyDraft.sides.toString();
  field("hp").value = enemyDraft.hp.toString();
  field("shieldHp").value = enemyDraft.shieldHp.toString();
  field("speed").value = enemyDraft.speed.toString();
  field("damage").value = enemyDraft.damage.toString();
  field("attackInterval").value = enemyDraft.attackInterval.toString();
  field("telegraphDuration").value = enemyDraft.telegraphDuration.toString();
  field("coreDamage").value = enemyDraft.coreDamage.toString();
  field("radius").value = enemyDraft.radius.toString();
  field("defense").value = enemyDraft.defense.toString();
  field("protection").value = enemyDraft.protection.toString();
  field("armor").value = Math.round(enemyDraft.armor * 100).toString();
  field("superarmor").value = Math.round(enemyDraft.superarmor * 100).toString();
  for (const type of DAMAGE_TYPES) {
    const el = document.querySelector<HTMLInputElement>(`[data-enemy-field='resistance_${type}']`);
    if (el) el.value = Math.round((enemyDraft.resistances?.[type] ?? 0) * 100).toString();
  }
  field("hidden").checked = enemyDraft.hidden;
  field("boss").checked = enemyDraft.boss;
  field("timeLockEnabled").checked = enemyDraft.timeLockEnabled;
  field("waveLockEnabled").checked = enemyDraft.waveLockEnabled;
  field("summoningEnabled").checked = enemyDraft.summoningEnabled;
  field("stunningEnabled").checked = enemyDraft.stunningEnabled;
  field("regenerationEnabled").checked = enemyDraft.regenerationEnabled;
  field("hasteEnabled").checked = enemyDraft.hasteEnabled;
  field("drainEnabled").checked = enemyDraft.drainEnabled;
  field("phaseEnabled").checked = enemyDraft.phaseEnabled;
  field("blinkEnabled").checked = enemyDraft.blinkEnabled;
  field("summonInterval").value = enemyDraft.summonInterval.toString();
  field("summonCount").value = enemyDraft.summonCount.toString();
  field("summonHitCashMultiplier").value = enemyDraft.summonHitCashMultiplier.toString();
  field("summonHpMultiplier").value = enemyDraft.summonHpMultiplier.toString();
  field("summonShieldMultiplier").value = enemyDraft.summonShieldMultiplier.toString();
  field("summonSpeedMultiplier").value = enemyDraft.summonSpeedMultiplier.toString();
  field("summonDamageMultiplier").value = enemyDraft.summonDamageMultiplier.toString();
  field("summonAttackIntervalMultiplier").value = enemyDraft.summonAttackIntervalMultiplier.toString();
  field("summonCoreDamageMultiplier").value = enemyDraft.summonCoreDamageMultiplier.toString();
  field("summonDefenseBonus").value = enemyDraft.summonDefenseBonus.toString();
  field("summonProtectionBonus").value = enemyDraft.summonProtectionBonus.toString();
  field("summonArmorBonus").value = Math.round(enemyDraft.summonArmorBonus * 100).toString();
  field("summonSuperarmorBonus").value = Math.round(enemyDraft.summonSuperarmorBonus * 100).toString();
  field("timeLockDistance").value = enemyDraft.timeLockDistance.toString();
  field("timeLockDuration").value = enemyDraft.timeLockDuration.toString();
  field("waveLockDistance").value = enemyDraft.waveLockDistance.toString();
  field("waveLockWaves").value = enemyDraft.waveLockWaves.toString();
  field("stunInterval").value = enemyDraft.stunInterval.toString();
  field("stunRadius").value = enemyDraft.stunRadius.toString();
  field("stunDuration").value = enemyDraft.stunDuration.toString();
  field("regenerationRate").value = enemyDraft.regenerationRate.toString();
  field("hasteInterval").value = enemyDraft.hasteInterval.toString();
  field("hasteRadius").value = enemyDraft.hasteRadius.toString();
  field("hasteDuration").value = enemyDraft.hasteDuration.toString();
  field("hasteMultiplier").value = enemyDraft.hasteMultiplier.toString();
  field("drainInterval").value = enemyDraft.drainInterval.toString();
  field("drainRadius").value = enemyDraft.drainRadius.toString();
  field("drainDamage").value = enemyDraft.drainDamage.toString();
  field("drainHealing").value = enemyDraft.drainHealing.toString();
  field("phaseInterval").value = enemyDraft.phaseInterval.toString();
  field("phaseDuration").value = enemyDraft.phaseDuration.toString();
  field("blinkInterval").value = enemyDraft.blinkInterval.toString();
  field("blinkDistance").value = enemyDraft.blinkDistance.toString();
  query<HTMLElement>("#summoning-editor").hidden = !enemyDraft.summoningEnabled;
  query<HTMLElement>("#stunning-editor").hidden = !enemyDraft.stunningEnabled;
  query<HTMLElement>("#regeneration-editor").hidden = !enemyDraft.regenerationEnabled;
  query<HTMLElement>("#haste-editor").hidden = !enemyDraft.hasteEnabled;
  query<HTMLElement>("#drain-editor").hidden = !enemyDraft.drainEnabled;
  query<HTMLElement>("#phase-editor").hidden = !enemyDraft.phaseEnabled;
  query<HTMLElement>("#blink-editor").hidden = !enemyDraft.blinkEnabled;
  query<HTMLElement>("#time-lock-editor").hidden = !enemyDraft.timeLockEnabled;
  query<HTMLElement>("#wave-lock-editor").hidden = !enemyDraft.waveLockEnabled;
  query<HTMLElement>("#enemy-sides-value").textContent = enemyDraft.sides.toString();
  query<HTMLElement>("#enemy-opacity-value").textContent = `${Math.round(enemyDraft.opacity * 100)}%`;
  query<HTMLInputElement>("#enemy-drawing-color").value = drawingBrushColor;
  query<HTMLOutputElement>("#enemy-drawing-size-value").textContent = `${query<HTMLInputElement>("#enemy-drawing-size").value} PX`;
  query<HTMLOutputElement>("#enemy-drawing-opacity-value").textContent = `${query<HTMLInputElement>("#enemy-drawing-opacity").value}%`;
  query<HTMLOutputElement>("#enemy-drawing-hardness-value").textContent = `${query<HTMLInputElement>("#enemy-drawing-hardness").value}%`;
  enemyDrawingLaunch.hidden = enemyDraft.appearance.mode !== "drawing";
  query<HTMLButtonElement>("[data-action='enemy-use-procedural']").classList.toggle("active", enemyDraft.appearance.mode === "procedural");
  query<HTMLButtonElement>("[data-action='enemy-use-drawing']").classList.toggle("active", enemyDraft.appearance.mode === "drawing");
  enemyShapePreview.classList.toggle("drawing-preview", enemyDraft.appearance.mode === "drawing");
  query<HTMLElement>("#enemy-name-preview").textContent = enemyDraft.name.toUpperCase();
  query<HTMLElement>("#enemy-preview-stats").textContent = enemyStatLine(enemyDraft).replaceAll(" · ", " // ");
  syncEnemyDrawingCanvas();
  updateDrawingSurfaceLayout();
  renderDrawingToolState();
  const summonFilter = document.querySelector<HTMLInputElement>("#summon-enemy-search")?.value.trim().toLowerCase() ?? "";
  query<HTMLElement>("#summon-enemy-options").innerHTML = getAllEnemyDefinitions()
    .filter((enemy) => enemy.kind !== enemyDraft!.id)
    .map((enemy) => {
      const isSelected = enemyDraft!.summonKinds.includes(enemy.kind);
      const matches = !summonFilter || enemy.name.toLowerCase().includes(summonFilter) || enemy.kind.toLowerCase().includes(summonFilter);
      return `<label style="${matches ? "" : "display:none"}"><input type="checkbox" data-summon-kind="${escapeHtml(enemy.kind)}" ${isSelected ? "checked" : ""}><span>${escapeHtml(enemy.name)}</span><small>${enemy.kind.startsWith("custom-enemy:") ? "CREATED" : "OFFICIAL"} // ${enemyStatLine(enemy).replaceAll(" · ", " // ")}</small></label>`;
    })
    .join("");
  renderBehaviorRules();
  renderEnemyAttacks();
  setEnemyCreatorTab(activeEnemyCreatorTab);
  enemyCreatorV4.render();
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
        <small>CREATED // ${mode.waves.length} ${mode.waves.length === 1 ? "WAVE" : "WAVES"} // ${Math.round(mode.multiplayerHitCashMultiplier * 100)}% MP HIT CASH // NO REWARDS</small>
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
  const pathLines = previewMap.paths.map((route) => `<path d="${route.path.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(0)} ${point.y.toFixed(0)}`).join(" ")}" fill="none" stroke="#000" stroke-width="${route.width + 18}"/><path d="${route.path.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(0)} ${point.y.toFixed(0)}`).join(" ")}" fill="none" stroke="${previewMap.palette.path}" stroke-width="${route.width}"/>`).join("");
  const blockerLines = previewMap.pathBlockers.map((blocker) => {
    const route = previewMap.paths[blocker.pathIndex];
    if (!route) return "";
    const polyline = new Polyline(route.path);
    const steps = Math.max(2, Math.ceil(blocker.length / 24));
    const points = Array.from({ length: steps + 1 }, (_, index) => polyline.sample(blocker.startDistance + (blocker.length * index) / steps).point);
    const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(0)} ${point.y.toFixed(0)}`).join(" ");
    return `<path d="${path}" fill="none" stroke="#000" stroke-width="${route.width + 20}"/><path d="${path}" fill="none" stroke="${previewMap.palette.accent}" stroke-width="${Math.max(12, route.width - 8)}" stroke-dasharray="14 10"/>`;
  }).join("");
  const zones = previewMap.blockedZones.map((zone) => `<rect x="${zone.x}" y="${zone.y}" width="${zone.width}" height="${zone.height}" fill="${previewMap.palette.accent}" opacity=".18"/>`).join("");
  return `<svg class="map-preview" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" aria-hidden="true"><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${previewMap.palette.field}"/>${zones}${pathLines}${blockerLines}${previewMap.paths.map((route) => `<circle cx="${route.core.x}" cy="${route.core.y}" r="34" fill="none" stroke="${previewMap.palette.accent}" stroke-width="8"/>`).join("")}</svg>`;
};

const mapLibraryCard = (map: MapDefinition, custom: CustomMapDraft | null): string => `
  <article class="map-library-card">
    ${mapPreviewSvg(map)}
    <div><small>${map.isCustom ? "CREATED // SANDBOX" : `OFFICIAL // MAP ${map.index.toString().padStart(2, "0")}`}</small><strong>${escapeHtml(map.name)}</strong><p>${escapeHtml(map.description)}</p><b>${map.difficulty.toUpperCase()} // ${Math.round(map.paths.reduce((total, route) => total + new Polyline(route.path).totalLength, 0) * normalizedMapScale(map.mapScale)).toLocaleString()} ROUTE UNITS // ${map.paths.length} PATH${map.paths.length === 1 ? "" : "S"} // SCALE ${normalizedMapScale(map.mapScale).toFixed(1)}X // ${map.blockedZones.length} BLOCK ZONES // ${map.pathBlockers.length} PATH BLOCKERS</b></div>
    ${custom ? `<div class="map-card-actions"><label class="library-select"><input type="checkbox" data-map-select="${escapeHtml(custom.id)}" ${selectedMapIds.has(custom.id) ? "checked" : ""}><span>SELECT</span></label><button data-action="export-map" data-map-id="${escapeHtml(custom.id)}">EXPORT</button><button data-action="edit-map" data-map-id="${escapeHtml(custom.id)}">EDIT</button><button class="danger" data-action="delete-map" data-map-id="${escapeHtml(custom.id)}">DELETE</button></div>` : ""}
  </article>`;

const renderMapLibrary = (): void => {
  renderCreatorFolderBar("maps");
  query<HTMLElement>("#official-map-list").innerHTML = getOfficialMapDefinitions()
    .map((map) => mapLibraryCard(map, customMaps.find((draft) => draft.id === map.kind) ?? null)).join("");
  const list = query<HTMLElement>("#custom-map-list");
  const visibleMaps = customMaps.filter((draft) => assetMatchesFolder("maps", draft.id, activeMapFolderId));
  list.innerHTML = visibleMaps.length === 0
    ? `<div class="empty-mode-list"><strong>${customMaps.length > 0 ? "FOLDER IS EMPTY" : "NO CREATED MAPS"}</strong><span>${customMaps.length > 0 ? "Select another folder or move a map here." : "Create a route, palette, and restricted build layout."}</span></div>`
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
    return `<button class="map-card ${map.kind === selectedMap.kind ? "selected" : ""}" data-action="select-map" data-map="${escapeHtml(map.kind)}">${mapPreviewSvg(map)}<span>${map.isCustom ? "CUSTOM" : `MAP ${map.index.toString().padStart(2, "0")}`} // ${map.difficulty.toUpperCase()}</span><strong>${escapeHtml(map.name)}</strong><p>${escapeHtml(map.description)}</p><small>${rewardCopy}</small></button>`;
  }).join("");
};

const renderBattleModeGrid = (): void => {
  const modes = [...MODE_DEFINITIONS, ...customModes.map(customModeToDefinition)];
  query<HTMLElement>("#battle-mode-grid").innerHTML = modes.map((mode) => {
    const source = mode.isCustom ? customModes.find((candidate) => candidate.id === mode.kind) : null;
    const missing = source ? getMissingCustomEnemyIds(source) : [];
    const selected = selectedMode.kind === mode.kind;
    return `<button class="battle-mode-card${selected ? " selected" : ""}${missing.length > 0 ? " locked" : ""}" data-action="select-battle-mode" data-mode-id="${escapeHtml(mode.kind)}" ${missing.length > 0 ? "disabled" : ""}>
      <span>${mode.isCustom ? "CREATED // SANDBOX" : "OFFICIAL // REWARDS"}</span>
      <strong>${escapeHtml(mode.name)}</strong>
      <p>${escapeHtml(mode.description)}</p>
      <small>${mode.waves.length} ${mode.waves.length === 1 ? "WAVE" : "WAVES"}${missing.length > 0 ? ` // MISSING ${missing.length} ENEMY FILE${missing.length === 1 ? "" : "S"}` : ""}</small>
    </button>`;
  }).join("");
};

const renderSetupLoadout = (): void => {
  query<HTMLElement>("#setup-loadout-icons").innerHTML = Array.from({ length: 5 }, (_, index) => {
    const kind = progress.loadout[index];
    if (!kind) return `<span class="setup-loadout-empty" title="Empty loadout slot">+</span>`;
    const tower = TOWER_DEFINITIONS[kind];
    return `<span class="setup-loadout-tower" style="--accent:${tower.accent};--dim:${tower.dimAccent}" title="${escapeHtml(tower.name)}"><b>${tower.glyph}</b><small>${index + 1}</small></span>`;
  }).join("");
  const perkLoadout = multiplayerHostSelecting ? localMultiplayerPlayer.perkLoadout : progress.perkLoadout;
  query<HTMLElement>("#setup-perk-icons").innerHTML = perkLoadout.length > 0
    ? perkLoadout.map((kind) => {
      const perk = TOWER_PERK_DEFINITIONS[kind];
      const target = TOWER_DEFINITIONS[perk.target];
      return `<span class="setup-perk" style="--accent:${perk.accent};--dim:${target.dimAccent}" title="${escapeHtml(perk.description)}"><b>✦</b><small>${escapeHtml(perk.name)}</small></span>`;
    }).join("")
    : `<span class="setup-perk-empty">NO PERKS EQUIPPED</span>`;
};

const updateSelectedModeCopy = (): void => {
  query<HTMLElement>("#setup-context").textContent = multiplayerHostSelecting ? "MULTIPLAYER // HOST SETUP" : "SINGLE PLAYER";
  query<HTMLElement>("#setup-intro").textContent = multiplayerHostSelecting ? "Choose the next shared battle. Your teammate will ready their loadout in the room." : "Choose the challenge and battlefield, then review your active loadout.";
  query<HTMLElement>("#setup-back-label").textContent = multiplayerHostSelecting ? "Back to room" : "Back";
  query<HTMLElement>("#selected-mode-copy").textContent = `${selectedMode.name} // ${selectedMode.waves.length} finite ${selectedMode.waves.length === 1 ? "wave" : "waves"}.${selectedMode.isCustom ? " Created modes provide no profile rewards." : " Official map-adjusted profile rewards are enabled."}`;
  query<HTMLElement>("#setup-mode-name").textContent = selectedMode.name.toUpperCase();
  query<HTMLElement>("#setup-mode-detail").textContent = `${selectedMode.waves.length} ${selectedMode.waves.length === 1 ? "wave" : "waves"} // ${selectedMode.isCustom ? "sandbox rewards" : "profile rewards enabled"}`;
  query<HTMLElement>("#setup-map-name").textContent = selectedMap.name.toUpperCase();
  query<HTMLElement>("#setup-map-detail").textContent = `${selectedMap.difficulty} // ${selectedMap.paths.length} ${selectedMap.paths.length === 1 ? "route" : "routes"} // ${selectedMap.isCustom || selectedMode.isCustom ? "sandbox" : `${Math.round(selectedMap.rewardMultiplier * 100)}% rewards`}`;
  query<HTMLButtonElement>("#start-mode-button").innerHTML = `START RUN <span>→</span>`;
  renderBattleModeGrid();
  renderPlayMapGrid();
  renderSetupLoadout();
};

const renderCreator = (): void => {
  if (!creatorDraft) return;
  creatorWaveIndex = Math.min(Math.max(0, creatorWaveIndex), creatorDraft.waves.length - 1);
  const wave = creatorDraft.waves[creatorWaveIndex];
  if (!wave) return;
  const maps = getAllMapDefinitions();
  const preferredMap = modeTestMapKind && maps.some((map) => map.kind === modeTestMapKind)
    ? modeTestMapKind
    : loadModeTestMapKind() ?? (maps.some((map) => map.kind === selectedMap.kind) ? selectedMap.kind : MAP_DEFINITIONS.sector07.kind);
  if (preferredMap) modeTestMapKind = preferredMap;
  const modeTestMap = query<HTMLSelectElement>("#mode-test-map");
  modeTestMap.innerHTML = maps.map((map) => `<option value="${escapeHtml(map.kind)}">${escapeHtml(map.name)}${map.isCustom ? " // CREATED" : ""}</option>`).join("");
  modeTestMap.value = modeTestMapKind ?? MAP_DEFINITIONS.sector07.kind;
  query<HTMLInputElement>("[data-mode-field='name']").value = creatorDraft.name;
  query<HTMLTextAreaElement>("[data-mode-field='description']").value = creatorDraft.description;
  query<HTMLInputElement>("[data-mode-field='startingCash']").value = creatorDraft.startingCash.toString();
  query<HTMLInputElement>("[data-mode-field='coreIntegrity']").value = creatorDraft.coreIntegrity.toString();
  const multiplayerHitCashPercent = Math.round(creatorDraft.multiplayerHitCashMultiplier * 100);
  query<HTMLInputElement>("[data-mode-field='multiplayerHitCashMultiplier']").value = multiplayerHitCashPercent.toString();
  query<HTMLOutputElement>("#multiplayer-hitcash-value").textContent = `${multiplayerHitCashPercent}% // $${(creatorDraft.multiplayerHitCashMultiplier * ECONOMY_RULES.damageCashPerHp).toFixed(2)} PER 1 DAMAGE`;
  query<HTMLInputElement>("[data-wave-field='cashReward']").value = wave.cashReward.toString();
  query<HTMLElement>("#creator-wave-list").innerHTML = renderCreatorWaveListHtml(creatorDraft.waves, creatorWaveIndex);

  query<HTMLElement>("#creator-block-list").innerHTML = renderCreatorBlockListHtml(wave.blocks, (currentEnemyKind) =>
    getAllEnemyDefinitions().map((enemy) =>
      `<option value="${escapeHtml(enemy.kind)}" ${enemy.kind === currentEnemyKind ? "selected" : ""}>${escapeHtml(enemy.name)} // ${enemyStatLine(enemy).replaceAll(" · ", " // ")}${enemy.kind.startsWith("custom-enemy:") ? " // CREATED" : ""}</option>`,
    ).join("")
  );
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
  const shapes = createMapPathShapes(definition);
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
  drawMapPath(context, definition, shapes);
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
  } else if (isPathBlockerSelection(mapSelectionState)) {
    const selection = mapSelectionState as Extract<MapSelectionState, { type: "pathBlocker" }>;
    const blocker = definition.pathBlockers.find((candidate) => candidate.id === selection.id);
    const route = blocker ? definition.paths[blocker.pathIndex] : null;
    if (blocker && route) drawPathPlacementBlocker(context, route, blocker, definition.palette.accent, true, definition.palette.blockerOpacity ?? 0.72);
  }
  mapDraft.paths.forEach((route, pathIndex) => route.path.forEach((rawPoint, index) => {
    const point = scaleMapPoint(mapPointForEditor(rawPoint), mapScale);
    const terminal = index === 0 || index === route.path.length - 1;
    const selected = mapSelectionState?.type === "point" && mapSelectionState.pathIndex === pathIndex && mapSelectionState.index === index;
    context.beginPath();
    context.arc(point.x, point.y, selected ? 18 : 14, 0, Math.PI * 2);
    context.fillStyle = selected ? definition.palette.accent : terminal ? "#f1d07a" : pathIndex === activeMapPathIndex ? "#d9dfdb" : "#7c8983";
    context.fill();
    context.strokeStyle = "#080b0c";
    context.lineWidth = 4;
    context.stroke();
    context.fillStyle = "#080b0c";
    context.font = "700 10px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText(terminal ? (index === 0 ? `E${pathIndex + 1}` : `B${pathIndex + 1}`) : `${pathIndex + 1}.${index}`, point.x, point.y + 4);
  }));
  context.restore();
};

function renderMapEditor(): void {
  if (!mapDraft) return;
  const field = <T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(name: string): T => query<T>(`[data-map-field='${name}']`);
  field("name").value = mapDraft.name;
  field("description").value = mapDraft.description;
  field("difficulty").value = mapDraft.difficulty;
  field("enemyRouting").value = mapDraft.enemyRouting;
  field("mapScale").value = mapDraft.mapScale.toString();
  field("field").value = mapDraft.palette.field;
  field("path").value = mapDraft.palette.path;
  field("accent").value = mapDraft.palette.accent;
  field("blockerOpacity").value = mapDraft.palette.blockerOpacity.toString();
  query<HTMLOutputElement>("#map-blocker-opacity-value").textContent = `${Math.round(mapDraft.palette.blockerOpacity * 100)}%`;
  query<HTMLElement>("#map-path-count").textContent = `${mapDraft.paths.length} / ${MAX_MAP_PATHS}`;
  query<HTMLButtonElement>("[data-action='map-add-path']").disabled = mapDraft.paths.length >= MAX_MAP_PATHS;
  query<HTMLElement>("#map-blocker-count").textContent = `${mapDraft.pathBlockers.length} / ${MAX_PATH_BLOCKERS}`;
  query<HTMLButtonElement>("[data-action='map-add-path-blocker']").disabled = mapDraft.pathBlockers.length >= MAX_PATH_BLOCKERS;
  query<HTMLElement>("#map-path-list").innerHTML = renderMapPathListHtml(mapDraft.paths, activeMapPathIndex);
  query<HTMLElement>("#map-blocker-list").innerHTML = renderMapBlockerListHtml(mapDraft.pathBlockers, mapDraft.paths.length, mapSelectionState);
  const validation = validateCustomMap(mapDraft);
  const playablePathLength = validation.pathLength * normalizedMapScale(mapDraft.mapScale);
  query<HTMLElement>("#map-path-length").textContent = `${Math.round(playablePathLength).toLocaleString()} ROUTE UNITS // ${normalizedMapScale(mapDraft.mapScale).toFixed(1)}X`;
  const validationState = query<HTMLElement>("#map-validation-state");
  validationState.textContent = validation.valid ? "ROUTE VALID" : `${validation.errors.length} ISSUES`;
  validationState.classList.toggle("valid", validation.valid);
  query<HTMLElement>("#map-validation-errors").innerHTML = validation.valid
    ? "<li>Routes, terminals, core clearance, blocked zones, and path blockers are valid.</li>"
    : validation.errors.slice(0, 8).map((error) => `<li>${escapeHtml(error)}</li>`).join("");
  query<HTMLButtonElement>("#map-save-button").disabled = !validation.valid;
  query<HTMLButtonElement>("#map-test-button").disabled = !validation.valid;
  query<HTMLButtonElement>("#map-undo-button").disabled = mapHistory.length === 0;
  query<HTMLButtonElement>("#map-redo-button").disabled = mapFuture.length === 0;
  query<HTMLElement>("#map-editor-selection").textContent = getMapSelectionLabel(mapDraft, mapSelectionState);
  drawMapEditor();
}

const findMapPoint = (point: Point): { pathIndex: number; index: number } | null => {
  if (!mapDraft) return null;
  let best: { pathIndex: number; index: number } | null = null;
  let bestDistance = 28;
  mapDraft.paths.forEach((route, pathIndex) => route.path.forEach((candidate, index) => {
    const separation = distance(point, mapPointForEditor(candidate));
    if (separation < bestDistance) {
      best = { pathIndex, index };
      bestDistance = separation;
    }
  }));
  return best;
};

const findMapZone = (point: Point): BlockedZone | null => {
  if (!mapDraft) return null;
  return [...mapDraft.blockedZones].reverse().find((zone) =>
    point.x >= zone.x && point.x <= zone.x + zone.width && point.y >= zone.y && point.y <= zone.y + zone.height,
  ) ?? null;
};

const findMapPathBlocker = (point: Point): PathPlacementBlocker | null => {
  if (!mapDraft) return null;
  return [...mapDraft.pathBlockers].reverse().find((blocker) => {
    const route = mapDraft?.paths[blocker.pathIndex];
    if (!route) return false;
    const projected = new Polyline(route.path).closest(point);
    return projected.offset <= route.width / 2 + 24 && projected.distance >= blocker.startDistance - 24 && projected.distance <= blocker.startDistance + blocker.length + 24;
  }) ?? null;
};

const insertMapPointAt = (point: Point): void => {
  const route = mapDraft?.paths[activeMapPathIndex];
  if (!route || route.path.length >= 32) return;
  let bestIndex = -1;
  let bestDistance = 42;
  for (let index = 0; index < route.path.length - 1; index += 1) {
    const a = route.path[index];
    const b = route.path[index + 1];
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
    draft.paths[activeMapPathIndex]?.path.splice(bestIndex, 0, {
      x: clamp(snapMapCoordinate(point.x), 80, WORLD_WIDTH - 80),
      y: clamp(snapMapCoordinate(point.y), 80, WORLD_HEIGHT - 80),
    });
    draft.path = draft.paths[0]?.path.map((candidate) => ({ ...candidate })) ?? draft.path;
    mapSelectionState = { type: "point", pathIndex: activeMapPathIndex, index: bestIndex };
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

const renderModeTestControls = (state: GameUiState): void => {
  const active = modeTestActive && !state.multiplayer;
  modeTestPanel.hidden = !active;
  if (!active) {
    modeTestWaveSignature = "";
    return;
  }
  const signature = `${state.totalWaves}:${state.wave}`;
  if (signature !== modeTestWaveSignature) {
    modeTestWaveSignature = signature;
    modeTestWaveSelect.innerHTML = Array.from({ length: state.totalWaves }, (_, index) => `<option value="${index + 1}">WAVE ${(index + 1).toString().padStart(2, "0")}</option>`).join("");
  }
  modeTestWaveSelect.value = String(Math.max(1, Math.min(state.totalWaves, state.wave || 1)));
  const previous = modeTestPanel.querySelector<HTMLButtonElement>("[data-action='mode-test-wave-previous']");
  const next = modeTestPanel.querySelector<HTMLButtonElement>("[data-action='mode-test-wave-next']");
  const current = state.wave || 1;
  if (previous) {
    previous.disabled = current <= 1;
    previous.dataset["testWaveTarget"] = String(Math.max(1, current - 1));
  }
  if (next) {
    next.disabled = current >= state.totalWaves;
    next.dataset["testWaveTarget"] = String(Math.min(state.totalWaves, current + 1));
  }
};

const addMapPathBlocker = (): void => {
  if (!mapDraft || mapDraft.pathBlockers.length >= MAX_PATH_BLOCKERS) return;
  const route = mapDraft.paths[activeMapPathIndex];
  if (!route) return;
  const totalLength = new Polyline(route.path).totalLength;
  const length = clamp(180, PATH_BLOCKER_LENGTH_MIN, Math.min(PATH_BLOCKER_LENGTH_MAX, totalLength));
  const startDistance = clamp(Math.round(totalLength * 0.35), 0, Math.max(0, totalLength - length));
  const blocker = createPathPlacementBlocker(activeMapPathIndex, startDistance, length);
  mutateMapDraft((draft) => {
    draft.pathBlockers.push(blocker);
    mapSelectionState = { type: "pathBlocker", id: blocker.id };
  });
};

mapEditorCanvas.addEventListener("pointerdown", (event) => {
  if (!mapDraft || event.button !== 0) return;
  const point = mapCanvasPoint(event);
  const pathBlocker = findMapPathBlocker(point);
  const pointIndex = pathBlocker ? null : findMapPoint(point);
  if (pathBlocker) {
    activeMapPathIndex = pathBlocker.pathIndex;
    mapSelectionState = { type: "pathBlocker", id: pathBlocker.id };
    const route = mapDraft.paths[pathBlocker.pathIndex];
    const projected = route ? new Polyline(route.path).closest(point) : null;
    mapDragState = {
      type: "pathBlocker",
      start: point,
      original: cloneCustomMap(mapDraft),
      lastPathPoint: point,
      lastPathDistance: projected?.distance,
    };
  } else if (pointIndex) {
    activeMapPathIndex = pointIndex.pathIndex;
    mapSelectionState = { type: "point", pathIndex: pointIndex.pathIndex, index: pointIndex.index };
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
    const originalRoute = mapDragState.original.paths[mapSelectionState.pathIndex];
    const route = mapDraft.paths[mapSelectionState.pathIndex];
    const originalPoint = originalRoute?.path[mapSelectionState.index];
    if (!route) return;
    if (!originalPoint) return;
    if (mapSelectionState.index === 0) {
      const position = terminalPosition(route.entryEdge, { x: originalPoint.x + delta.x, y: originalPoint.y + delta.y });
      route.path[0] = terminalPoint(route.entryEdge, position);
    } else if (mapSelectionState.index === route.path.length - 1) {
      const position = terminalPosition(route.exitEdge, { x: originalPoint.x + delta.x, y: originalPoint.y + delta.y });
      route.path[route.path.length - 1] = terminalPoint(route.exitEdge, position);
    } else {
      route.path[mapSelectionState.index] = {
        x: clamp(snapMapCoordinate(originalPoint.x + delta.x), 80, WORLD_WIDTH - 80),
        y: clamp(snapMapCoordinate(originalPoint.y + delta.y), 80, WORLD_HEIGHT - 80),
      };
    }
    mapDraft.path = mapDraft.paths[0]?.path.map((candidate) => ({ ...candidate })) ?? mapDraft.path;
  } else if (isPathBlockerSelection(mapSelectionState) && mapDragState.type === "pathBlocker") {
    const selection = mapSelectionState as Extract<MapSelectionState, { type: "pathBlocker" }>;
    const blockerIndex = mapDraft.pathBlockers.findIndex((candidate) => candidate.id === selection.id);
    const blocker = mapDraft.pathBlockers[blockerIndex];
    const original = mapDragState.original.pathBlockers.find((candidate) => candidate.id === selection.id);
    const route = blocker ? mapDraft.paths[blocker.pathIndex] : null;
    if (!blocker || !original || !route || blockerIndex < 0) return;
    const projected = new Polyline(route.path).closest(point);
    const routeLength = new Polyline(route.path).totalLength;
    const length = clamp(original.length, PATH_BLOCKER_LENGTH_MIN, Math.min(PATH_BLOCKER_LENGTH_MAX, routeLength));
    const lastPathDistance = mapDragState.lastPathDistance ?? projected.distance;
    const lastPathPoint = mapDragState.lastPathPoint ?? point;
    const pointerStep = distance(point, lastPathPoint);
    // At a sharp corner, closest() can select the neighboring segment and
    // produce a large distance jump for a tiny pointer movement. Advance in
    // bounded increments so the blocker follows the drag instead of snapping.
    const maxPathStep = Math.max(3, pointerStep * 1.35);
    const boundedDistance = clamp(projected.distance, lastPathDistance - maxPathStep, lastPathDistance + maxPathStep);
    mapDragState.lastPathPoint = point;
    mapDragState.lastPathDistance = boundedDistance;
    mapDraft.pathBlockers[blockerIndex] = { ...blocker, length, startDistance: clamp(boundedDistance - length / 2, 0, Math.max(0, routeLength - length)) };
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

const showFrontScreen = (screen: FrontScreen): void => {
  activeFrontScreen = screen;
  shell.classList.remove("run-active");
  overlayState = "none";
  setOverlayVisibility(overlayState);
  mainMenu.hidden = screen !== "main";
  multiplayerScreen.hidden = screen !== "multiplayer";
  creatorHub.hidden = screen !== "creators";
  enemySelection.hidden = screen !== "enemies";
  enemyCreator.hidden = screen !== "enemy-creator";
  modeSelection.hidden = screen !== "modes";
  battleSetup.hidden = screen !== "setup";
  mapLibrary.hidden = screen !== "map-library";
  mapCreator.hidden = screen !== "map-creator";
  modeCreator.hidden = screen !== "creator";
  towerShop.hidden = screen !== "shop";
  gameOverPanel.hidden = true;
  victoryPanel.hidden = true;
  debugPanel.hidden = true;
  modeTestPanel.hidden = true;
  renderMeta();
  if (screen === "modes") renderModeList();
  if (screen === "multiplayer") renderMultiplayerStatus(multiplayerSession.status);
  if (screen === "multiplayer") {
    multiplayerReturnRun.hidden = !(activeMultiplayerStart && multiplayerPhase === "playing");
    const backButton = multiplayerScreen.querySelector<HTMLButtonElement>("[data-action='multiplayer-back']");
    if (backButton) backButton.hidden = Boolean(activeMultiplayerStart && multiplayerPhase === "playing");
  }
  if (screen === "enemies") renderEnemyList();
  if (screen === "enemy-creator") renderEnemyCreator();
  if (screen === "setup") updateSelectedModeCopy();
  if (screen === "map-library") renderMapLibrary();
  if (screen === "map-creator") renderMapEditor();
  if (screen === "creator") renderCreator();
};

const selectMapCard = (kind: MapKind): void => {
  const map = getMapDefinition(kind);
  if (!map) return;
  selectedMap = map;
  updateSelectedModeCopy();
};

const settleRun = (victory: boolean, wave: number, mode: ModeDefinition): { coins: number; tokens: number } => {
  if (runSettled) return { coins: 0, tokens: 0 };
  runSettled = true;
  if (mode.isCustom || activeMap.isCustom || mapTestActive || modeTestActive) return { coins: 0, tokens: 0 };
  const { coins, tokens } = calculateOfficialRunReward(victory, wave, mode, activeMap.rewardMultiplier);
  progress.coins += coins;
  progress.tokens += tokens;
  progress.runs += 1;
  if (victory) {
    progress.victories += 1;
    if (!progress.clearedMaps.some((kind) => kind === activeMap.kind)) progress.clearedMaps.push(activeMap.kind);
  }
  saveProgress(progress);
  renderMeta();
  return { coins, tokens };
};

const sendMultiplayerResult = (
  victory: boolean,
  wave: number,
  reward: { coins: number; tokens: number },
): void => {
  if (multiplayerSession.role !== "host" || !activeMultiplayerStart) return;
  const official = !activeMode.isCustom && !activeMap.isCustom && !mapTestActive;
  pendingMultiplayerResult = {
      id: `${multiplayerSession.sessionId}:${activeMultiplayerStart.round}:${victory ? "victory" : "defeat"}:${wave}`,
      round: activeMultiplayerStart.round,
      victory,
      wave,
      coins: official ? reward.coins : 0,
      tokens: official ? reward.tokens : 0,
      official,
      mapKind: activeMap.kind,
      modeKind: activeMode.kind,
  };
  if (multiplayerSession.connected) multiplayerSession.sendControl({ type: "result", result: pendingMultiplayerResult });
};

const openMultiplayerIntermission = (): void => {
  if (!activeMultiplayerStart || multiplayerSession.role === null) return;
  multiplayerPhase = "lobby";
  multiplayerGuestReady = false;
  inspectorDetailsOpen = false;
  selectionSignature = "";
  game.leaveRun();
  showFrontScreen("multiplayer");
  sendMultiplayerLobbyState();
  renderMultiplayerLobby();
};

const addLog = (message: string, tone: "neutral" | "good" | "danger" = "neutral"): void => {
  const entry = document.createElement("p");
  entry.className = tone;
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const timeElement = document.createElement("time");
  timeElement.textContent = time;
  const messageElement = document.createElement("span");
  messageElement.textContent = message;
  entry.append(timeElement, messageElement);
  logs.prepend(entry);
  while (logs.children.length > 4) logs.lastElementChild?.remove();
};

const updateInGameChatUi = (): void => {
  const state = inGameChatStore.getState();
  const unread = inGameChatStore.getUnreadCount();

  if (state === "closed") {
    ingameChatPanel.hidden = true;
    ingameChatPanel.classList.remove("is-minimized");
  } else if (state === "minimized") {
    ingameChatPanel.hidden = false;
    ingameChatPanel.classList.add("is-minimized");
    ingameChatMinimizeBtn.textContent = "+";
    ingameChatMinimizeBtn.title = "Expand chat";
    ingameChatMinBadge.hidden = unread === 0;
    ingameChatMinBadge.textContent = String(unread);
  } else {
    ingameChatPanel.hidden = false;
    ingameChatPanel.classList.remove("is-minimized");
    ingameChatMinimizeBtn.textContent = "−";
    ingameChatMinimizeBtn.title = "Minimize chat";
    ingameChatMinBadge.hidden = true;
    dismissChatToast();
  }

  hudChatBadge.hidden = unread === 0 || state === "expanded";
  hudChatBadge.textContent = String(unread);
};

const setInGameChatState = (nextState: InGameChatState): void => {
  inGameChatStore.setState(nextState);
  updateInGameChatUi();
};

const toggleInGameChat = (): void => {
  const current = inGameChatStore.getState();
  if (current === "closed") {
    setInGameChatState("expanded");
    battleChatInput.focus();
  } else {
    setInGameChatState("closed");
    battleChatInput.blur();
  }
};

const minimizeInGameChat = (): void => {
  inGameChatStore.toggleMinimize();
  updateInGameChatUi();
  if (inGameChatStore.getState() === "expanded") {
    battleChatInput.focus();
  } else {
    battleChatInput.blur();
  }
};

const closeInGameChat = (): void => {
  setInGameChatState("closed");
  battleChatInput.value = "";
  battleChatInput.blur();
};

const dismissChatToast = (): void => {
  if (toastDismissTimer !== null) {
    window.clearTimeout(toastDismissTimer);
    toastDismissTimer = null;
  }
  ingameChatToast.hidden = true;
  ingameChatToast.innerHTML = "";
};

const showChatToast = (entry: { senderName: string; senderColor: string; text: string; sentAt: number }): void => {
  dismissChatToast();
  ingameChatToast.innerHTML = renderToastHtml(entry);
  ingameChatToast.hidden = false;
  toastDismissTimer = window.setTimeout(() => {
    dismissChatToast();
  }, 4500);
};

const appendChatMessage = (senderName: string, senderColor: string, text: string, sentAt = Date.now()): void => {
  const time = new Date(sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const entry = { senderName, senderColor, text, sentAt };

  // 1. Add to dedicated in-game chat log
  const chatEntryElement = document.createElement("div");
  chatEntryElement.innerHTML = renderChatEntryHtml(entry);
  if (chatEntryElement.firstElementChild) {
    ingameChatLog.append(chatEntryElement.firstElementChild);
    while (ingameChatLog.children.length > 100) ingameChatLog.firstElementChild?.remove();
    ingameChatLog.scrollTop = ingameChatLog.scrollHeight;
  }

  // 2. Add to lobby chat log
  const lobbyEntry = document.createElement("div");
  lobbyEntry.className = "multiplayer-chat-entry";
  const lobbyTime = document.createElement("time");
  lobbyTime.textContent = time;
  const lobbySender = document.createElement("b");
  lobbySender.textContent = `${senderName}: `;
  lobbySender.style.color = senderColor;
  const lobbyText = document.createElement("span");
  lobbyText.textContent = text;
  lobbyEntry.append(lobbyTime, lobbySender, lobbyText);
  multiplayerChatLog.append(lobbyEntry);
  while (multiplayerChatLog.children.length > 50) multiplayerChatLog.firstElementChild?.remove();
  multiplayerChatLog.scrollTop = multiplayerChatLog.scrollHeight;

  // 3. Update store and notifications
  inGameChatStore.addMessage(entry);
  const currentState = inGameChatStore.getState();
  if (currentState !== "expanded") {
    showChatToast(entry);
  }
  updateInGameChatUi();
};

const sendChatMessage = (rawText: string): void => {
  const text = sanitizeChatInput(rawText);
  if (!text || !multiplayerSession.connected) return;
  const senderId = localMultiplayerPlayer.id;
  const senderName = localMultiplayerPlayer.username.toUpperCase();
  const senderColor = localMultiplayerPlayer.color;
  const sentAt = Date.now();

  multiplayerSession.sendControl({
    type: "chat",
    text,
    senderId,
    senderName,
    senderColor,
    sentAt,
  });

  appendChatMessage(senderName, senderColor, text, sentAt);
};

type InspectorStatToneKey = "damage" | "fire-rate";
type InspectorStatTone = "buff" | "debuff" | "neutral";

const inspectorStatToneKey = (key: string): InspectorStatToneKey | null =>
  key === "damage" || key === "effective-damage" || key === "dps"
    ? "damage"
    : key === "attack-rate" ? "fire-rate" : null;

const inspectorStatTone = (modifier: number): InspectorStatTone =>
  modifier > 0.005 ? "buff" : modifier < -0.005 ? "debuff" : "neutral";

const updateInspectorStatTones = (
  panel: HTMLElement,
  tower: NonNullable<GameUiState["selectedTower"]>["tower"],
): void => {
  const modifiers: Record<InspectorStatToneKey, number> = {
    damage: tower.damageBuff - 1,
    "fire-rate": tower.fireRateBuff,
  };
  panel.querySelectorAll<HTMLElement>("[data-inspector-tone]").forEach((element) => {
    const key = element.dataset["inspectorTone"] as InspectorStatToneKey | undefined;
    if (!key || !(key in modifiers)) return;
    const tone = inspectorStatTone(modifiers[key]);
    element.classList.toggle("is-buff", tone === "buff");
    element.classList.toggle("is-debuff", tone === "debuff");
    element.dataset["tone"] = tone;
  });
};

const renderInspectorStatGroup = (
  stats: readonly import("./game/types.ts").TowerInspectorStat[],
  group: import("./game/types.ts").TowerInspectorStat["group"],
  title: string,
  testId: string,
): string => {
  const groupStats = stats.filter((stat) => stat.group === group);
  if (groupStats.length === 0) return "";
  return `<section class="inspector-section inspector-section-${group}" data-testid="${testId}">
    <div class="inspector-section-title"><span>${title}</span><small>${groupStats.length} READOUTS</small></div>
    <div class="inspector-stat-grid">${groupStats.map((stat) => {
      const toneKey = inspectorStatToneKey(stat.key);
      return `<div class="inspector-stat" data-inspector-stat="${stat.key}"${toneKey ? ` data-inspector-tone="${toneKey}"` : ""}><span>${stat.label}</span><b data-inspector-value="${stat.key}">${stat.value}</b></div>`;
    }).join("")}</div>
  </section>`;
};

const renderInspectorPopover = (popover: import("./game/types.ts").TowerInspectorPopover): string => {
  const popoverId = `inspector-popover-${popover.key}`;
  return `<div class="inspector-stat-popover" id="${popoverId}" role="tooltip" aria-hidden="true" data-inspector-popover="${popover.key}" data-testid="${popoverId}">
    <div class="inspector-stat-popover-head"><span>${escapeHtml(popover.title)}</span><small>${escapeHtml(popover.subtitle)}</small></div>
    <div class="inspector-stat-popover-list">${popover.rows.map((row) => `<div class="inspector-stat-popover-row${row.tone === "total" ? " total" : row.tone === "accent" ? " accent" : ""}">
      <span>${escapeHtml(row.label)}</span><b data-popover-value="${popover.key}:${row.key}">${escapeHtml(row.value)}</b>${row.note ? `<small>${escapeHtml(row.note)}</small>` : ""}
    </div>`).join("")}</div>
  </div>`;
};

const renderInspectorQuickStat = (
  popover: import("./game/types.ts").TowerInspectorPopover,
  label: string,
  value: string,
  tone?: InspectorStatToneKey,
): string => {
  return `<div class="inspector-quick-stat" data-inspector-popover-card="${popover.key}"${tone ? ` data-inspector-tone="${tone}"` : ""} data-testid="inspector-stat-card-${popover.key}" tabindex="0" role="button" aria-expanded="false" aria-controls="inspector-popover-${popover.key}">
    <span>${label}</span><b data-summary-stat="${popover.key === "fire-rate" ? "attack-rate" : popover.key}">${escapeHtml(value)}</b>
    ${renderInspectorPopover(popover)}
  </div>`;
};

const updateInspectorLiveValues = (
  panel: HTMLElement,
  view: NonNullable<GameUiState["selectedTower"]>,
): void => {
  const { tower } = view;
  const mechaPanel = panel.querySelector<HTMLElement>("[data-testid=mecha-control-panel]");
  if (mechaPanel) {
    const form = tower.onPath ? view.definition.onPath : view.definition.offPath;
    panel.querySelector<HTMLElement>(".inspector-command-identity > div > span")!.textContent = tower.onPath ? "PATH BLOCKER // EMP" : "MOBILE ARTILLERY";
    panel.querySelector<HTMLElement>(".inspector-command-identity > strong")!.textContent = form.title;
    const heat = Math.round(tower.mechaHeat ?? 0);
    const heatCap = getTankHeatCap(tower.level);
    const heatPercent = Math.round(Math.max(0, Math.min(1, heat / heatCap)) * 100);
    mechaPanel.dataset["x"] = tower.position.x.toFixed(2);
    mechaPanel.dataset["y"] = tower.position.y.toFixed(2);
    mechaPanel.dataset["speed"] = (tower.mechaSpeed ?? 0).toFixed(2);
    mechaPanel.dataset["hullAngle"] = (tower.mechaHullAngle ?? 0).toFixed(4);
    mechaPanel.dataset["turretAngle"] = (tower.mechaTurretAngle ?? 0).toFixed(4);
    mechaPanel.querySelector<HTMLElement>("[data-mecha-weapon]")!.textContent = mechaWeaponStatus(tower);
    mechaPanel.querySelector<HTMLElement>("[data-testid=mecha-heat]")!.textContent = `HEAT ${heat} / ${heatCap}`;
    mechaPanel.querySelector<HTMLElement>(".mecha-control-status b")!.textContent = (tower.mechaOverheatTimer ?? 0) > 0 ? "WEAPONS LOCKED" : tower.mechaActiveAbility ? "CHANNEL GENERATING HEAT" : "RELEASE FIRE TO VENT";
    const meter = mechaPanel.querySelector<HTMLElement>("[role=meter]")!;
    meter.setAttribute("aria-valuemax", `${heatCap}`);
    meter.setAttribute("aria-valuenow", `${heat}`);
    meter.style.setProperty("--heat", `${heatPercent}%`);
    meter.classList.toggle("hot", heatPercent >= 75 || (tower.mechaOverheatTimer ?? 0) > 0);
    const button = mechaPanel.querySelector<HTMLButtonElement>("[data-testid=mecha-control-toggle]")!;
    button.textContent = tower.mechaControlled ? "LEAVE PILOT MODE" : "ENTER PILOT MODE";
    button.setAttribute("aria-pressed", `${tower.mechaControlled === true}`);
    button.classList.toggle("active", tower.mechaControlled === true);
  }
  const stats = new Map(view.inspector.stats.map((stat) => [stat.key, stat.value]));
  const hpPercent = Math.round(Math.max(0, Math.min(1, tower.hp / Math.max(1, tower.maxHp))) * 100);
  panel.querySelector<HTMLElement>("[data-live-hp-current]")!.textContent = `${Math.ceil(tower.hp)}`;
  panel.querySelector<HTMLElement>("[data-live-hp-max]")!.textContent = `${tower.maxHp}`;
  panel.querySelector<HTMLElement>("[data-live-hp-percent]")!.textContent = `${hpPercent}%`;
  const healthTrack = panel.querySelector<HTMLElement>("[data-live-hp-track]")!;
  healthTrack.setAttribute("aria-label", `Tower health ${hpPercent} percent`);
  healthTrack.style.setProperty("--health", `${hpPercent}%`);
  panel.querySelectorAll<HTMLElement>("[data-summary-stat]").forEach((element) => {
    const key = element.dataset["summaryStat"];
    if (key && stats.has(key)) element.textContent = stats.get(key)!;
  });
  panel.querySelectorAll<HTMLElement>("[data-inspector-value]").forEach((element) => {
    const key = element.dataset["inspectorValue"];
    if (key && stats.has(key)) element.textContent = stats.get(key)!;
  });
  const popoverValues = new Map<string, string>(
    view.inspector.popovers.flatMap((popover) => popover.rows.map((row) => [`${popover.key}:${row.key}`, row.value] as const)),
  );
  panel.querySelectorAll<HTMLElement>("[data-popover-value]").forEach((element) => {
    const key = element.dataset["popoverValue"];
    if (key && popoverValues.has(key)) element.textContent = popoverValues.get(key)!;
  });
  updateInspectorStatTones(panel, tower);
  panel.querySelectorAll<HTMLButtonElement>("[data-targeting]").forEach((button) => {
    const active = button.dataset["targeting"] === tower.targeting;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", `${active}`);
  });
  const autoCounter = panel.querySelector<HTMLButtonElement>("[data-testid='auto-counter-toggle']");
  if (autoCounter) {
    autoCounter.disabled = !latestUiState?.selectedOwned || !tower.onPath || (tower.kind === "mecha" && !tower.mechaControlled);
    autoCounter.classList.toggle("active", tower.autoCounter);
    autoCounter.setAttribute("aria-pressed", `${tower.autoCounter}`);
    const stateLabel = autoCounter.querySelector("b");
    if (stateLabel) stateLabel.textContent = tower.autoCounter ? "ON" : "OFF";
    autoCounter.title = `${tower.autoCounter ? "Disable" : "Enable"} AutoCounter`;
  }
};

const renderSelection = (state: GameUiState): void => {
  const panel = query<HTMLElement>("#selection-panel");
  const view = state.selectedTower;
  const nextUpgradeCost = view?.definition.upgrades[view.tower.level]?.cost;
  const upgradeAffordable = nextUpgradeCost !== undefined && (state.infiniteCash || state.shards >= nextUpgradeCost);
  const moveAffordable = state.infiniteCash || state.shards >= ECONOMY_RULES.relocationCost;
  const signature = view
    ? `${view.tower.id}:${view.tower.level}:${view.tower.kind === "mecha" && view.tower.mechaControlled ? "piloting" : view.tower.onPath}:${view.tower.kind === "mecha" ? "live-auto" : view.tower.autoCounter}:${view.tower.perks.join(",")}:${upgradeAffordable}:${moveAffordable}:${state.relocating}:${state.infiniteCash}:${state.selectedOwned}:${inspectorDetailsOpen}:${view.inspector.sellValue}`
    : "none";
  if (signature === selectionSignature && view) {
    updateInspectorLiveValues(panel, view);
    return;
  }
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
  panel.style.setProperty("--accent", definition.accent);
  towerInspector.style.setProperty("--accent", definition.accent);
  const form = tower.onPath ? definition.onPath : definition.offPath;
  const mode = tower.onPath ? "PATHBOUND + ARMED" : "RANGED FIELD";
  const levelStats = definition.levels[tower.level];
  if (!levelStats) return;
  const damage = levelStats.damage;
  const fireInterval = levelStats.fireRate;
  const range = levelStats.range;
  const inspectorStats = new Map(view.inspector.stats.map((stat) => [stat.key, stat.value]));
  const inspectorPopovers = new Map(view.inspector.popovers.map((popover) => [popover.key, popover]));
  const hpPercent = Math.round(Math.max(0, Math.min(1, tower.hp / Math.max(1, tower.maxHp))) * 100);
  const maxLevel = definition.levels.length - 1;
  const nextUpgrade = definition.upgrades[tower.level];
  const upgradeSkill = nextUpgrade ? (tower.onPath ? nextUpgrade.onPathSkill : nextUpgrade.offPathSkill) : "All evolution protocols are active.";
  const nextLevelStats = nextUpgrade ? definition.levels[nextUpgrade.level] : levelStats;
  const nextDamage = nextLevelStats?.damage ?? damage;
  const nextFireInterval = nextLevelStats?.fireRate ?? fireInterval;
  const nextStats = nextUpgrade
    ? tower.onPath
      ? `DMG ${damage}→${nextDamage} · HP ${tower.maxHp}→${Math.round(definition.onPath.hp * (nextLevelStats?.hpMultiplier ?? 1))} · AGGRO ${tower.maxAggro} (ROLE CAP)`
      : `DMG ${damage}→${nextDamage} · RATE ${(1 / fireInterval).toFixed(1)}→${(1 / nextFireInterval).toFixed(1)} · RANGE ${range}→${nextLevelStats?.range ?? range}`
    : "All systems at maximum output";
  const targetingModes: ReadonlyArray<{ value: TargetingMode; label: string }> = [
    { value: "first", label: "First" },
    { value: "last", label: "Last" },
    { value: "strongest", label: "Strongest" },
    { value: "weakest", label: "Weakest" },
    { value: "closest", label: "Closest" },
  ];
  const abilitySlots = getTowerAbilitySlotsWithPerks(definition, tower.perks).filter((slot) => {
    const ability = getTowerAbilityWithPerks(definition, tower.perks, slot);
    return ability !== undefined && tower.level >= ability.unlockLevel;
  });
  const abilityDescriptions = abilitySlots.map((slot) => {
    const ability = getTowerAbilityWithPerks(definition, tower.perks, slot);
    if (!ability) return "";
    return `<div class="ability-copy"><span>${ability.automatic ? "PASSIVE STATUS" : "ACTIVE ABILITY"} // ${slot.toUpperCase()} // ${ability.name.toUpperCase()}</span><p>${ability.description}</p></div>`;
  }).join("");
  const passiveDescriptions = definition.kind === "vanguard"
    ? `<div class="ability-copy ${tower.level >= 1 ? "" : "muted"}"><span>${tower.level >= 1 ? "PASSIVE // CHARGED SMASH" : "PASSIVE UNLOCKS AT LEVEL 1 // CHARGED SMASH"}</span><p>Automatically smashes the enemy it attacks when charged, dealing area damage at the enemy's position.</p></div>`
    : "";
  const mechaControlPanel = definition.kind === "mecha"
    ? renderMechaControls(tower, state.selectedOwned)
    : "";
  const perkDescriptions = tower.perks.map((kind) => {
    const perk = TOWER_PERK_DEFINITIONS[kind];
    const target = TOWER_DEFINITIONS[perk.target];
    return `<div class="inspector-perk-badge" data-inspector-popover-card="perk-${kind}" data-testid="selected-perk-${kind}" tabindex="0" role="button" aria-expanded="false" aria-controls="inspector-perk-popover-${kind}" style="--accent:${perk.accent}">
      <strong>✦ ${escapeHtml(perk.name)}</strong>
      <div class="inspector-perk-popover" id="inspector-perk-popover-${kind}" data-inspector-popover="perk-${kind}" role="tooltip" aria-hidden="true">
        <div class="inspector-popover-heading"><span>${escapeHtml(perk.name)}</span><small>${escapeHtml(target.name)} // EQUIPPED</small></div>
        <p>${escapeHtml(perk.description)}</p>
        <em>TRADEOFF // ${escapeHtml(perk.tradeoff)}</em>
      </div>
    </div>`;
  }).join("");
  panel.innerHTML = `
    <article class="inspector-command-card" data-testid="tower-inspector-header">
      <header class="inspector-command-hero">
        <span class="inspector-command-glyph" aria-hidden="true">${definition.glyph}</span>
        <div class="inspector-command-identity">
          <div><span>${mode}</span><small>${state.selectedOwned ? "YOUR CONSTRUCT" : "TEAMMATE CONSTRUCT"}</small></div>
          <strong>${form.title}</strong>
          <small>${definition.name.toUpperCase()}</small>
        </div>
        <button class="inspector-close" data-action="close-inspector" data-testid="inspector-close" aria-label="Close tower inspector">×</button>
      </header>
      <div class="inspector-level-band">
        <span>LEVEL <b>${tower.level}</b> / ${maxLevel}</span>
        <div class="level-pips" aria-label="Level ${tower.level} of ${maxLevel}">${Array.from({ length: definition.levels.length }, (_, level) => `<i class="${level <= tower.level ? "filled" : ""}"></i>`).join("")}</div>
        <button type="button" class="auto-counter-toggle${tower.autoCounter ? " active" : ""}" data-action="toggle-auto-counter" data-testid="auto-counter-toggle" aria-pressed="${tower.autoCounter}" ${state.selectedOwned && tower.onPath && (tower.kind !== "mecha" || tower.mechaControlled === true) ? "" : "disabled"} title="${tower.autoCounter ? "Disable" : "Enable"} AutoCounter">
          <span>AUTO</span><b>${tower.autoCounter ? "ON" : "OFF"}</b>
        </button>
      </div>
      ${perkDescriptions ? `<section class="inspector-perks" aria-label="Equipped tower perks"><div class="inspector-perks-heading"><span class="inspector-section-label">EQUIPPED PERKS</span><small>HOVER FOR DETAILS</small></div><div class="inspector-perk-list">${perkDescriptions}</div></section>` : ""}
      <section class="inspector-vitals" data-testid="inspector-summary">
        <div class="inspector-health-summary">
          <span>HULL</span>
          <strong data-testid="inspector-hp"><span data-live-hp-current>${Math.ceil(tower.hp)}</span><small> / <span data-live-hp-max>${tower.maxHp}</span></small></strong>
          <b data-live-hp-percent>${hpPercent}%</b>
          <div class="inspector-health-track" data-live-hp-track aria-label="Tower health ${hpPercent} percent" style="--health:${hpPercent}%"></div>
        </div>
          <div class="inspector-quick-grid">
            ${renderInspectorQuickStat(inspectorPopovers.get("damage")!, "DAMAGE", inspectorStats.get("damage") ?? `${damage}`, "damage")}
            ${renderInspectorQuickStat(inspectorPopovers.get("fire-rate")!, "RATE", inspectorStats.get("attack-rate") ?? (1 / Math.max(0.01, fireInterval)).toFixed(2), "fire-rate")}
            ${renderInspectorQuickStat(inspectorPopovers.get("range")!, "RANGE", inspectorStats.get("range") ?? `${range}`)}
            <div class="inspector-quick-stat" data-inspector-popover-card="dps" data-inspector-tone="damage" data-testid="inspector-stat-card-dps" tabindex="0" role="button" aria-expanded="false" aria-controls="inspector-popover-dps">
              <span>DPS</span><b data-testid="inspector-dps" data-summary-stat="dps">${escapeHtml(inspectorStats.get("dps") ?? "—")}</b>
              ${renderInspectorPopover(inspectorPopovers.get("dps")!)}
            </div>
          </div>
      </section>
      ${mechaControlPanel}
      <section class="inspector-command-section targeting-control">
        <div class="inspector-command-label"><span>TARGET ORDER</span><small>CYCLES AUTOMATIC AIM</small></div>
        <div>${targetingModes.map(({ value, label }) => `<button data-action="target" data-targeting="${value}" class="${tower.targeting === value ? "active" : ""}" aria-pressed="${tower.targeting === value}" ${state.selectedOwned && tower.mechaControlled !== true ? "" : "disabled"} title="Target ${value}">${label}</button>`).join("")}</div>
      </section>
      <section class="upgrade-panel ${nextUpgrade ? "" : "maxed"}">
        <div class="upgrade-copy">
          <span>${nextUpgrade ? `NEXT // LEVEL ${nextUpgrade.level}` : `LEVEL ${maxLevel} // COMPLETE`}</span>
          <strong>${nextUpgrade ? nextUpgrade.title : "MAXIMUM EVOLUTION"}</strong>
          <p>${upgradeSkill}</p>
          <small>${nextStats}</small>
        </div>
        ${nextUpgrade
          ? `<button data-action="upgrade" data-testid="upgrade-button" ${!state.selectedOwned || (!state.infiniteCash && state.shards < nextUpgrade.cost) ? "disabled" : ""}><kbd>E</kbd><span>${state.selectedOwned ? "EVOLVE" : "TEAMMATE"}</span><b>${state.infiniteCash ? "FREE" : `$${nextUpgrade.cost}`}</b></button>`
          : `<strong class="max-level">MAX</strong>`}
      </section>
      <div class="inspector-utility-row">
        <button data-action="move" class="move-button" ${!moveAffordable || !state.selectedOwned || tower.mechaControlled ? "disabled" : ""}>
          <kbd>Q</kbd><span>RELOCATE</span><b>${state.infiniteCash ? "FREE" : `$${ECONOMY_RULES.relocationCost}`}</b>
        </button>
        <button data-action="sell" data-testid="sell-button" class="sell-button" ${state.selectedOwned ? "" : "disabled"} title="${state.selectedOwned ? `Sell for $${view.inspector.sellValue}; this copy is not restored // Backspace` : "Teammate-owned tower // read only"}"><kbd aria-label="Backspace">⌫</kbd><span>DISMANTLE</span><b data-testid="sell-value">$${view.inspector.sellValue}</b></button>
      </div>
    </article>
    <div class="inspector-telemetry-trigger" data-inspector-popover-card="telemetry" data-popover-open="${inspectorDetailsOpen}" data-popover-pinned="${inspectorDetailsOpen}" tabindex="0" role="button" aria-expanded="${inspectorDetailsOpen}" aria-controls="inspector-telemetry-popover" data-action="toggle-inspector-details" data-testid="inspector-telemetry-trigger">
      <div class="inspector-telemetry-label"><span>TECH TELEMETRY</span><small>CLICK FOR LIVE SYSTEMS</small></div>
      <b aria-hidden="true">⌁</b>
      <div class="inspector-telemetry-popover" id="inspector-telemetry-popover" data-inspector-popover="telemetry" role="tooltip" aria-hidden="${!inspectorDetailsOpen}" data-testid="inspector-telemetry-popover">
      <div class="inspector-telemetry-head"><span>${escapeHtml(form.title)}</span><small>${escapeHtml(form.description)}</small></div>
      ${renderInspectorStatGroup(view.inspector.stats, "combat", "COMBAT PROFILE", "inspector-combat-stats")}
      ${renderInspectorStatGroup(view.inspector.stats, "targeting", "TARGETING / ROLE", "inspector-targeting-stats")}
      ${renderInspectorStatGroup(view.inspector.stats, "systems", "LIVE SYSTEMS", "inspector-live-systems")}
      ${renderInspectorStatGroup(view.inspector.stats, "advanced", "ADVANCED MECHANICS", "inspector-advanced-stats")}
      ${tower.onPath
        ? `<div class="ability-copy"><span>COUNTER SIGNATURE // SPACE</span><p>${definition.counter}</p></div>`
        : `<div class="ability-copy muted"><span>RANGED FORM</span><p>${tower.kind === "mecha" ? "Drive onto the path to block hostiles and arm the EMP. All weapons require Pilot Mode." : "Cannot be attacked or countered. Automatic attacks and active abilities remain available."}</p></div>`}
      ${passiveDescriptions}
      ${abilityDescriptions}
      </div>
    </div>
  `;
  panel.scrollTop = previousScroll;
  updateInspectorLiveValues(panel, view);
  if (inspectorDetailsOpen) {
    const telemetry = panel.querySelector<HTMLElement>("[data-inspector-popover-card='telemetry']");
    if (telemetry) positionInspectorTelemetryPopover(telemetry);
  }
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
};

const render = (state: GameUiState): void => {
  latestUiState = state;
  renderModeTestControls(state);
  const debugButton = document.querySelector<HTMLButtonElement>("[data-action='debug']");
  const multiplayerLinkButton = document.querySelector<HTMLButtonElement>("[data-action='multiplayer-link']");
  if (debugButton) debugButton.hidden = state.multiplayer;
  if (multiplayerLinkButton) multiplayerLinkButton.hidden = !state.multiplayer;
  hudChatToggle.hidden = !state.multiplayer;
  if (!state.multiplayer && inGameChatStore.getState() !== "closed") {
    closeInGameChat();
  }
  renderDebugDashboard(state);
  const replayAvailable = Boolean(activeSimulationConfig || latestSimulationReplay);
  debugCopyReproButton.disabled = !replayAvailable;
  debugExportReproButton.disabled = !replayAvailable;
  debugReproStatus.textContent = activeSimulationConfig
    ? `READY // ${capturedReplayCommands.length + pendingReplayCommands.size} COMMANDS // ${capturedReplayEvents.length} RECENT EVENTS`
    : latestSimulationReplay
      ? "LAST HOST REPRO AVAILABLE // START A NEW HOST RUN TO CAPTURE MORE"
      : "HOST MULTIPLAYER RUNS ONLY // CAPTURES SEED, COMMANDS, AND RECENT EVENTS";
  const selectedId = state.selectedTower?.tower.id ?? null;
  if (selectedId !== lastSelectedTowerId) {
    inspectorSuppressed = false;
    lastSelectedTowerId = selectedId;
  }
  if (state.relocating) inspectorSuppressed = true;
  else if (lastRelocating) inspectorSuppressed = false;
  lastRelocating = state.relocating;
  const aimingAdmiral = state.selectedTower?.tower.kind === "admiral" && state.selectedTower.tower.aiming === true;
  const mechaSelected = state.selectedTower?.tower.kind === "mecha";
  const piloting = mechaSelected && state.selectedOwned && state.selectedTower?.tower.mechaControlled === true;
  towerInspector.classList.toggle("is-mecha", mechaSelected);
  towerInspector.classList.toggle("is-piloting", piloting);
  selectedPill.classList.toggle("is-piloting", piloting);
  selectedPill.title = piloting ? "Reopen Tank controls // WASD drive · mouse turret aim · hold LMB fire · F/G/H weapons · Esc exits Pilot Mode" : "Reopen tower inspector";
  aimCancel.hidden = !aimingAdmiral;
  moveCancel.hidden = !state.relocating;
  towerInspector.hidden = !state.selectedTower || inspectorSuppressed || aimingAdmiral;
  selectedPill.hidden = !state.selectedTower || !inspectorSuppressed || aimingAdmiral;
  const tankCooldowns = query<HTMLElement>("#tank-pilot-cooldowns");
  tankCooldowns.hidden = !piloting || selectedPill.hidden;
  if (!tankCooldowns.hidden && state.selectedTower) {
    for (const slot of ["f", "g", "h"] as const) {
      const cooldown = tankCooldownState(state.selectedTower.tower, slot);
      const row = tankCooldowns.querySelector<HTMLElement>(`[data-tank-cooldown=${slot}]`)!;
      row.querySelector("strong")!.textContent = cooldown.label;
      row.classList.toggle("locked", cooldown.locked);
      row.classList.toggle("active", cooldown.active);
      row.title = `${cooldown.name}${cooldown.active ? " // CHANNEL ACTIVE" : ""} // ${cooldown.label}`;
      const track = row.querySelector<HTMLElement>("[role=progressbar]")!;
      track.setAttribute("aria-valuenow", `${Math.round(cooldown.progress * 100)}`);
      track.setAttribute("aria-valuetext", cooldown.label);
      track.style.setProperty("--cooldown", `${cooldown.progress * 100}%`);
    }
  }
  gameForRender?.setInspectorOpen(!towerInspector.hidden);
  if (state.selectedTower) {
    const inspectorOnLeft = mechaSelected || state.selectedTower.tower.position.x >= WORLD_WIDTH / 2;
    towerInspector.classList.toggle("inspector-left", inspectorOnLeft);
    towerInspector.classList.toggle("inspector-right", !inspectorOnLeft);
  }
  if (state.selectedTower) {
    const selected = state.selectedTower;
    query<HTMLElement>("#selected-pill-label").textContent = piloting ? "TANK PILOT // OPEN PANEL" : `LVL ${selected.tower.level} ${selected.definition.name.toUpperCase()}`;
    const miniState = query<HTMLElement>("#selected-pill-state");
    selectedPill.classList.remove("live");
    if (selected.tower.stunTimer > 0) miniState.textContent = `STUNNED ${selected.tower.stunTimer.toFixed(1)}s`;
    else if (selected.tower.kind === "mecha" && selected.tower.mechaControlled === true) {
      const heatCap = getTankHeatCap(selected.tower.level);
      const heatPercent = Math.round(Math.max(0, Math.min(1, (selected.tower.mechaHeat ?? 0) / heatCap)) * 100);
      miniState.textContent = `${mechaWeaponStatus(selected.tower)} · HEAT ${heatPercent}% · ESC EXIT`;
      selectedPill.classList.add("live");
    } else if (selected.tower.kind === "mecha") {
      miniState.textContent = "DORMANT // OPEN PILOT CONTROLS";
    } else if (
      selected.tower.onPath &&
      selected.tower.counterCooldown <= 0 &&
      selected.incomingAttack !== null &&
      selected.incomingAttack <= COMBAT_RULES.counterWindow
    ) {
      miniState.textContent = "COUNTER NOW // SPACE";
      selectedPill.classList.add("live");
    } else if (selected.tower.kind === "samurai" && selected.tower.senselessStance) {
      miniState.textContent = "SENSELESS STANCE // G";
      selectedPill.classList.add("live");
    } else if (selected.tower.kind === "samurai" && selected.tower.abilityTimer > 0) {
      miniState.textContent = `STANCE ${selected.tower.abilityTimer.toFixed(1)}s // F`;
      selectedPill.classList.add("live");
    } else {
      const ability = getTowerAbilityWithPerks(selected.definition, selected.tower.perks, "f");
      const cooldown = selected.tower.abilityCooldowns?.f ?? selected.tower.abilityCooldown;
      if (selected.tower.kind === "admiral" && selected.tower.aiming) {
        miniState.textContent = "CLICK IMPACT // F";
        selectedPill.classList.add("live");
      }
      const abilityReady = Boolean(
        ability && selected.tower.level >= ability.unlockLevel && cooldown <= 0,
      );
      if (!selected.tower.aiming && ability?.automatic && selected.tower.kind === "bandit" && (selected.tower.perkPrepTimer ?? 0) > 0) {
        miniState.textContent = `HIGH NOON PREP ${Math.max(0, selected.tower.perkPrepTimer ?? 0).toFixed(1)}s`;
      } else if (!selected.tower.aiming && ability?.automatic && selected.tower.abilityTimer > 0) {
        miniState.textContent = `HIGH NOON ACTIVE ${selected.tower.abilityTimer.toFixed(1)}s`;
        selectedPill.classList.add("live");
      } else if (!selected.tower.aiming && ability?.automatic && cooldown > 0) {
        miniState.textContent = `HIGH NOON ${cooldown.toFixed(1)}s`;
      } else if (!selected.tower.aiming && ability?.automatic && abilityReady) {
        miniState.textContent = "HIGH NOON // AUTO READY";
        selectedPill.classList.add("live");
      } else if (!selected.tower.aiming && selected.tower.kind === "vanguard" && !selected.abilityTargetInRange) {
        miniState.textContent = "CHARGED SMASH // WAITING";
      } else if (!selected.tower.aiming && selected.tower.kind === "vanguard" && abilityReady) {
        miniState.textContent = "CHARGED SMASH // AUTO READY";
        selectedPill.classList.add("live");
      } else if (!selected.tower.aiming && abilityReady) {
        miniState.textContent = `${ability!.name.toUpperCase()} READY // F`;
        selectedPill.classList.add("live");
      } else if (!selected.tower.aiming && ability && selected.tower.level >= ability.unlockLevel && cooldown > 0) {
        miniState.textContent = `${ability.name.toUpperCase()} ${cooldown.toFixed(1)}s`;
      } else if (!selected.tower.aiming && selected.tower.onPath && selected.tower.counterCooldown > 0) {
        miniState.textContent = `COUNTER ${selected.tower.counterCooldown.toFixed(1)}s`;
      } else if (!selected.tower.aiming) miniState.textContent = selected.tower.onPath ? "COUNTER ARMED // SPACE" : "OPEN PANEL";
    }
  }
  query<HTMLElement>("#integrity-value").textContent = `${state.integrity} / ${state.maxIntegrity}`;
  if (!tankCooldowns.hidden) tankCooldowns.style.top = `${selectedPill.offsetTop + selectedPill.offsetHeight + 6}px`;
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
  query<HTMLElement>("#speed-label").textContent = `${state.speed}×`;
  query<HTMLElement>("#pause-icon").textContent = state.paused ? "Resume" : "Pause";
  query<HTMLDivElement>("#pause-banner").hidden = !state.paused;
  if (overlayState === "pause") renderGameMenu();
  const enemyCount = query<HTMLElement>("#enemy-count");
  enemyCount.textContent = state.enemiesRemaining > 0 ? `${state.enemiesRemaining.toString().padStart(2, "0")} HOSTILES` : "NO HOSTILES";
  enemyCount.classList.toggle("danger", state.enemiesRemaining > 0);
  query<HTMLElement>("#threat-label").textContent = state.modeComplete
    ? "MODE: COMPLETE"
    : state.waveActive
      ? "THREAT: ACTIVE"
      : `NEXT WAVE: ${state.intermissionRemaining.toFixed(1)}s`;
  query<HTMLElement>("#threat-label").classList.toggle("danger", state.waveActive);
  const visibleBosses = visibleBossHudEntries(state.bosses, dismissedBossIds);
  bossHud.hidden = visibleBosses.length === 0;
  bossHud.innerHTML = visibleBosses.map((boss) => {
    const health = Math.max(0, Math.min(1, boss.hp / Math.max(1, boss.maxHp))) * 100;
    const shield = Math.max(0, Math.min(1, boss.shieldHp / Math.max(1, boss.maxShieldHp))) * 100;
    return `<div class="boss-hud-card" style="--boss-accent:${boss.accent}">
      <button type="button" class="boss-hud-close" data-action="dismiss-boss" data-boss-id="${boss.id}" data-testid="boss-dismiss-${boss.id}" aria-label="Hide ${escapeHtml(boss.name)} health bar" title="Hide boss health bar">×</button>
      <div class="boss-hud-heading"><span>${escapeHtml(boss.name.toUpperCase())} // BOSS</span><strong>${Math.ceil(boss.hp).toLocaleString()} / ${boss.maxHp.toLocaleString()} HP</strong></div>
      ${boss.maxShieldHp > 0 ? `<div class="boss-hud-track shield"><i style="width:${shield}%"></i></div>` : ""}
      <div class="boss-hud-track"><i style="width:${health}%"></i></div>
    </div>`;
  }).join("");
  const multiplayerHud = query<HTMLElement>("#multiplayer-hud");
  const teammate = state.teammates[0];
  multiplayerHud.hidden = !state.multiplayer || !teammate;
  if (teammate) {
    multiplayerHud.textContent = `ALLY // ${teammate.username.toUpperCase()} // $${Math.floor(teammate.shards)}${pendingLocalCommands.size > 0 ? " // COMMAND PENDING" : ""}`;
    multiplayerHud.style.color = teammate.color;
  }

  const waveButton = query<HTMLElement>("#wave-button");
  waveButton.innerHTML = state.modeComplete
    ? `MODE COMPLETE <b>✓</b>`
    : state.waveActive
      ? `WAVE ACTIVE <b>${state.enemiesRemaining}</b>`
      : `NEXT WAVE <b>${Math.max(0, Math.ceil(state.intermissionRemaining))}</b>`;
  const waveSkip = query<HTMLElement>("#wave-skip");
  const skipWaveButton = query<HTMLButtonElement>("#skip-wave-button");
  const dismissSkipWaveButton = query<HTMLButtonElement>("#dismiss-skip-wave");
  const waveSkipNote = query<HTMLElement>("#wave-skip-note");
  waveSkip.hidden = !state.skipWaveAvailable;
  skipWaveButton.disabled = state.skipWaveVoteCast;
  skipWaveButton.textContent = state.skipWaveVoteCast ? "VOTE SENT" : "SKIP WAVE";
  dismissSkipWaveButton.disabled = false;
  waveSkipNote.textContent = state.multiplayer
    ? state.skipWaveVoteCast ? "WAITING FOR YOUR TEAMMATE" : "BOTH PLAYERS MUST VOTE"
    : "NEXT WAVE // EXISTING HOSTILES STAY";
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

  renderSelection(state);
  const counter = query<HTMLButtonElement>("[data-action='counter']");
  const counterStatus = query<HTMLElement>("#counter-status");
  const counterHint = query<HTMLElement>("#counter-hint");
  const counterFill = query<HTMLElement>("#counter-cooldown-fill");
  const selected = state.selectedTower;
  const counterRecharging = Boolean(selected && selected.tower.counterCooldown > 0);
  counter.disabled = !state.selectedOwned || !selected?.tower.onPath || selected.tower.kind === "mecha" && selected.tower.mechaControlled !== true || counterRecharging || state.paused || Boolean(selected.tower.stunTimer > 0);
  counter.classList.remove("live", "charging");
  const counterProgress = selected?.tower.onPath
    ? selected.tower.counterCooldown <= 0 ? 1 : 1 - selected.tower.counterCooldown / COMBAT_RULES.counterCooldown
    : 0;
  counterFill.style.width = `${Math.max(0, Math.min(1, counterProgress)) * 100}%`;
  if (!selected) {
    counterStatus.textContent = "NO LINK";
    counterHint.textContent = "Select an on-path construct";
  } else if (selected.tower.stunTimer > 0) {
    counterStatus.textContent = `STUNNED ${selected.tower.stunTimer.toFixed(1)}s`;
    counterHint.textContent = "Big Dummy shockwave disabled this tower";
    counter.classList.add("charging");
  } else if (!selected.tower.onPath) {
    counterStatus.textContent = selected.tower.kind === "mecha" ? "OFF PATH" : "RANGED FORM";
    counterHint.textContent = selected.tower.kind === "mecha" ? "Drive onto the path to arm the EMP" : "Counter requires a pathbound form";
  } else if (selected.tower.kind === "mecha" && selected.tower.mechaControlled !== true) {
    counterStatus.textContent = "PILOT REQUIRED";
    counterHint.textContent = "Enter Pilot Mode to arm the EMP core";
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

  counter.title = `${counterStatus.textContent} // ${counterHint.textContent}`;
  const abilityModules = query<HTMLElement>("#ability-modules");
  const slots = selected
    ? getTowerAbilitySlotsWithPerks(selected.definition, selected.tower.perks).filter((slot) => {
      const ability = getTowerAbilityWithPerks(selected.definition, selected.tower.perks, slot);
      return ability !== undefined && (selected.tower.kind === "mecha" || selected.tower.level >= ability.unlockLevel);
    })
    : [];
  const moduleSignature = selected
    ? `${selected.tower.id}:${selected.tower.kind}:${selected.tower.level}:${state.selectedOwned}:${state.paused}:${slots.join("|")}`
    : "none";
  if (moduleSignature !== abilityModulesSignature) {
    abilityModulesSignature = moduleSignature;
    abilityModules.innerHTML = slots.map((slot) => {
      const ability = getTowerAbilityWithPerks(selected!.definition, selected!.tower.perks, slot)!;
      return `<div class="action-module ability-module" data-testid="ability-module-${slot}">${ability.automatic
        ? `<div class="combat-button ability-button passive-ability" data-testid="passive-status-${selected!.tower.kind}"><kbd>◇</kbd><span>${ability.name.toUpperCase()}</span></div>`
        : `<button class="combat-button ability-button" data-action="ability" data-slot="${slot}"><kbd>${slot.toUpperCase()}</kbd><span>${ability.name.toUpperCase()}</span></button>`}<div class="action-readout"><span>STATE</span><strong></strong></div><div class="cooldown-track"><i></i></div><small></small></div>`;
    }).join("");
  }
  slots.forEach((slot) => {
    const ability = getTowerAbilityWithPerks(selected!.definition, selected!.tower.perks, slot)!;
    const cooldown = selected!.tower.abilityCooldowns?.[slot] ?? (slot === "f" ? selected!.tower.abilityCooldown : 0);
    const unlocked = selected!.tower.level >= ability.unlockLevel;
    const mechaChannelActive = selected!.tower.kind === "mecha" && selected!.tower.mechaActiveAbility === slot;
    const mechaState = selected!.tower.kind === "mecha" ? mechaAbilityState(selected!.tower, slot, state.selectedOwned, state.paused) : null;
    const stanceActive = selected!.tower.kind === "samurai" && slot === "f" && selected!.tower.abilityTimer > 0;
    const bladeBlocked = selected!.tower.kind === "samurai" && slot === "f" && Boolean(selected!.tower.senselessStance);
    const senselessActive = selected!.tower.kind === "samurai" && slot === "g" && Boolean(selected!.tower.senselessStance);
    const senselessBlocked = selected!.tower.kind === "samurai" && slot === "g" && selected!.tower.abilityTimer > 0;
    const automaticVanguard = selected!.tower.kind === "vanguard" && slot === "f";
    const automaticPerk = Boolean(ability.automatic);
    const usable = !mechaState?.blocked && !automaticPerk && !automaticVanguard && !mechaChannelActive && !bladeBlocked && !senselessBlocked && !state.paused && state.selectedOwned && unlocked && selected!.tower.stunTimer <= 0 && (cooldown <= 0 || stanceActive);
    const status = mechaState ? mechaState.status : selected!.tower.stunTimer > 0
      ? `STUNNED ${selected!.tower.stunTimer.toFixed(1)}s`
      : automaticPerk && selected!.tower.kind === "bandit" && (selected!.tower.perkPrepTimer ?? 0) > 0
        ? `PREPARING ${Math.max(0, selected!.tower.perkPrepTimer ?? 0).toFixed(1)}s`
      : automaticPerk && selected!.tower.abilityTimer > 0
        ? `ACTIVE ${selected!.tower.abilityTimer.toFixed(1)}s`
      : mechaChannelActive
        ? `ACTIVE ${Math.max(0, selected!.tower.mechaAbilityTimer ?? 0).toFixed(1)}s`
      : automaticPerk && cooldown > 0
        ? `COOLDOWN ${cooldown.toFixed(1)}s`
      : !unlocked
        ? `LEVEL ${ability.unlockLevel}`
        : stanceActive
          ? `STANCE ${selected!.tower.abilityTimer.toFixed(1)}s`
          : bladeBlocked
            ? "SENSELESS ACTIVE"
          : senselessActive
            ? "SENSELESS ACTIVE"
            : senselessBlocked
              ? "BLADE STANCE ACTIVE"
          : automaticVanguard && !selected!.abilityTargetInRange
            ? "WAITING FOR TARGET"
            : automaticVanguard && cooldown <= 0
              ? "AUTO READY"
              : cooldown > 0
                ? `${cooldown.toFixed(1)}s`
            : selected!.tower.kind === "admiral" && selected!.tower.aiming
              ? "CLICK IMPACT"
              : "READY";
    const hint = mechaState ? mechaState.hint : !unlocked
      ? `${ability.name} is still locked`
      : automaticPerk
        ? "Automatic passive ability // never manually activated"
      : stanceActive
        ? "Press F to sheathe early"
        : mechaChannelActive
          ? "Channel active // cannon disabled until the weapon ends"
        : bladeBlocked
          ? "Leave Senseless Stance first"
        : senselessActive
          ? "Press G to leave Senseless Stance"
          : senselessBlocked
            ? "Cannot toggle during Blade Stance"
        : selected!.tower.kind === "admiral" && selected!.tower.aiming
          ? "Click the battlefield to lock aim"
      : automaticVanguard
        ? selected!.abilityTargetInRange
          ? "Fires automatically when an enemy is in range"
          : "Waiting for an enemy to enter range"
        : cooldown > 0
          ? `${ability.name} is recharging`
            : `Press ${slot.toUpperCase()} to activate`;
    const maxCooldown = selected!.tower.kind === "mercenary" && selected!.tower.level >= 6 && slot === "f" ? 30 : Math.max(1, ability.cooldown);
    const stanceProgress = stanceActive ? clamp(selected!.tower.abilityTimer / 15, 0, 1) : null;
    const automaticProgress = automaticPerk
      ? (selected!.tower.kind === "bandit" && (selected!.tower.perkPrepTimer ?? 0) > 0
        ? 1 - Math.max(0, selected!.tower.perkPrepTimer ?? 0) / 2
        : selected!.tower.abilityTimer > 0
          ? Math.min(1, selected!.tower.abilityTimer / Math.max(1, ability.cooldown === 15 ? (selected!.tower.level >= 4 ? 15 : selected!.tower.level >= 3 ? 12 : 10) : 1))
          : cooldown <= 0 ? 1 : 1 - cooldown / maxCooldown)
      : null;
    const mechaChannelProgress = mechaChannelActive
      ? clamp((selected!.tower.mechaAbilityTimer ?? 0) / Math.max(0.1, ability.duration ?? 1), 0, 1)
      : null;
    const progress = unlocked && (!automaticVanguard || selected!.abilityTargetInRange)
      ? mechaState?.progress ?? mechaChannelProgress ?? automaticProgress ?? stanceProgress ?? (cooldown <= 0 ? 1 : 1 - cooldown / maxCooldown)
      : 0;
    const button = abilityModules.querySelector<HTMLButtonElement>(`button[data-slot="${slot}"]`);
    const module = button?.parentElement;
    const readout = module?.querySelector<HTMLElement>(".action-readout strong");
    const track = module?.querySelector<HTMLElement>(".cooldown-track i");
    const note = module?.querySelector<HTMLElement>("small");
    if (!readout || !track || !note) return;
    if (button) {
      button.disabled = !usable;
      button.classList.toggle("live", usable);
      button.classList.toggle("charging", !usable && (cooldown > 0 || !unlocked || mechaChannelActive));
      button.title = `${status} // ${hint}`;
    }
    readout.textContent = status;
    track.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
    note.textContent = hint;
  });
};

const submitMultiplayerCommand = (command: import("./game/multiplayer.ts").MultiplayerCommand): void => {
  if (!activeMultiplayerStart || multiplayerPhase !== "playing") return;
  const envelope: SimulationCommandEnvelope = {
    commandId: `${localMultiplayerPlayer.id}:${++multiplayerCommandSequence}:${Date.now().toString(36)}`,
    playerId: localMultiplayerPlayer.id,
    clientSequence: multiplayerCommandSequence,
    command,
  };
  captureReplayCommand(envelope);
  game.beginMultiplayerCommandFeedback(envelope.commandId, command);
  pendingLocalCommands.add(envelope.commandId);
  pendingLocalCommandTimers.set(envelope.commandId, window.setTimeout(() => {
    handleCommandResult({
      commandId: envelope.commandId,
      accepted: false,
      serverTick: 0,
      rejectionCode: "not-running",
      message: "The authoritative server did not acknowledge that action. Reconnect before retrying; the original command may still apply.",
    });
  }, MULTIPLAYER_COMMAND_TIMEOUT_MS));
  if (multiplayerSession.role === "host") {
    pendingCommandOwners.set(envelope.commandId, "host");
    void window.monochromiumDesktop?.submitHostCommand(envelope).then((submitted) => {
      if (!submitted) handleCommandResult({ commandId: envelope.commandId, accepted: false, serverTick: 0, rejectionCode: "not-running", message: "Authoritative server is not ready." });
    });
  } else if (multiplayerSession.role === "guest" && multiplayerSession.connected) {
    if (!multiplayerSession.sendControl({ type: "command", envelope })) {
      handleCommandResult({ commandId: envelope.commandId, accepted: false, serverTick: 0, rejectionCode: "not-running", message: "The peer link is not ready." });
    }
  } else {
    handleCommandResult({ commandId: envelope.commandId, accepted: false, serverTick: 0, rejectionCode: "not-running", message: "Multiplayer connection is not ready." });
  }
};

const game = new Game(canvas, {
  onUi: render,
  onLog: (message, tone) => {
    addLog(message, tone);
    if (multiplayerSession.role === "host" && multiplayerSession.connected && multiplayerPhase === "playing" && activeMultiplayerStart) {
      multiplayerSession.sendControl({ type: "log", message, tone });
    }
  },
  onCursor: (point) => {
    if (multiplayerSession.connected && multiplayerPhase === "playing" && activeMultiplayerStart) queueRemoteCursor(point);
  },
  onCommand: (command) => {
    submitMultiplayerCommand(command);
  },
  onPilotInput: (input) => {
    if (!activeMultiplayerStart || multiplayerPhase !== "playing") return;
    if (multiplayerSession.role === "host") void window.monochromiumDesktop?.submitHostPilotInput(input);
    else if (multiplayerSession.role === "guest") multiplayerSession.sendRealtime(input);
  },
  onGameOver: (wave) => {
    const reward = settleRun(false, wave, activeMode);
    sendMultiplayerResult(false, wave, reward);
    if (activeMultiplayerStart && multiplayerSession.role === "host") {
      openMultiplayerIntermission();
      return;
    }
    query<HTMLElement>("#game-over-copy").textContent = modeTestActive
      ? `Mode test ended on wave ${wave.toString().padStart(2, "0")}. Return to the editor to adjust the timeline.`
      : mapTestActive
      ? `Map test ended on wave ${wave.toString().padStart(2, "0")}. Return to the editor to adjust the route.`
      : activeMode.isCustom || activeMap.isCustom
      ? `Your sandbox simulation held through wave ${wave.toString().padStart(2, "0")}. Custom content does not provide profile rewards.`
      : `Your defense held through wave ${wave.toString().padStart(2, "0")}. Recovery paid ${reward.coins} Coins${reward.tokens > 0 ? ` and ${reward.tokens} Token` : ""}.`;
    query<HTMLElement>("#game-over-exit").textContent = mapTestActive || modeTestActive ? "RETURN TO EDITOR" : "MAIN MENU";
    query<HTMLElement>("#game-over-restart").innerHTML = mapTestActive || modeTestActive ? "TEST AGAIN <span>↻</span>" : "TRY AGAIN <span>↻</span>";
    query<HTMLElement>("#game-over-exit").textContent = activeMultiplayerStart ? "END SESSION" : query<HTMLElement>("#game-over-exit").textContent;
    query<HTMLButtonElement>("#game-over-restart").hidden = Boolean(activeMultiplayerStart);
    gameOverPanel.hidden = false;
    overlayState = "none";
    setOverlayVisibility(overlayState);
    if (activeMultiplayerStart && multiplayerSession.role === "host" && !multiplayerSession.connected) {
      gameOverPanel.hidden = true;
      showFrontScreen("multiplayer");
      renderMultiplayerStatus("disconnected", "Run complete. Re-pair the reserved guest before ending the session to deliver their result.");
    }
  },
  onVictory: (mode) => {
    const reward = settleRun(true, mode.waves.length, mode);
    sendMultiplayerResult(true, mode.waves.length, reward);
    if (activeMultiplayerStart && multiplayerSession.role === "host") {
      openMultiplayerIntermission();
      return;
    }
    query<HTMLElement>("#victory-copy").textContent = modeTestActive
      ? `${activeMode.name} passed a complete test on ${activeMap.name}. No profile rewards were granted.`
      : mapTestActive
      ? `${activeMap.name} passed a complete Normal Mode test. No profile rewards were granted.`
      : mode.isCustom || activeMap.isCustom
      ? `${mode.name} cleared on ${activeMap.name}. Custom content does not provide profile rewards.`
      : `${activeMap.name} secured. Reward: ${reward.coins} Coins and ${reward.tokens} Tokens.`;
    query<HTMLElement>("#victory h2").innerHTML = `${escapeHtml(mode.name.toUpperCase())}<br>SECURED`;
    query<HTMLElement>("#victory-exit").textContent = mapTestActive || modeTestActive ? "RETURN TO EDITOR" : "MAIN MENU";
    query<HTMLElement>("#victory-restart").innerHTML = mapTestActive || modeTestActive ? "TEST AGAIN <span>↻</span>" : "RUN AGAIN <span>↻</span>";
    query<HTMLElement>("#victory-exit").textContent = activeMultiplayerStart ? "END SESSION" : query<HTMLElement>("#victory-exit").textContent;
    query<HTMLButtonElement>("#victory-restart").hidden = Boolean(activeMultiplayerStart);
    victoryPanel.hidden = false;
    overlayState = "none";
    setOverlayVisibility(overlayState);
    if (activeMultiplayerStart && multiplayerSession.role === "host" && !multiplayerSession.connected) {
      victoryPanel.hidden = true;
      showFrontScreen("multiplayer");
      renderMultiplayerStatus("disconnected", "Run complete. Re-pair the reserved guest before ending the session to deliver their result.");
    }
  },
}, audio);
gameForRender = game;
game.setInspectorOpen(!towerInspector.hidden);
game.setPresentationSuspended(document.hidden);
document.addEventListener("visibilitychange", () => {
  game.setPresentationSuspended(document.hidden);
  if (document.hidden || !activeMultiplayerStart || multiplayerPhase !== "playing") return;
  hostReplicationDecoder.reset();
  guestReplicationDecoder.reset();
  resumeAwaitingKeyframe = true;
  if (multiplayerSession.role === "host") void window.monochromiumDesktop?.requestHostKeyframe();
  else if (multiplayerSession.role === "guest") {
    multiplayerSession.sendControl({ type: "resync-request", lastSequence: 0 });
    queueGuestPulse();
  }
});

game.setAvailableTowers(progress.loadout);
game.setAvailablePerks(progress.perkLoadout);
renderMeta();
renderAudioSettings();

const renderServerDiagnostics = (): void => {
  const diagnostics = latestServerDiagnostics;
  const age = lastReplicationFrameAt > 0 ? Math.max(0, performance.now() - lastReplicationFrameAt) : 0;
  if (!diagnostics) {
    multiplayerDiagnostics.textContent = window.monochromiumDesktop ? "SERVER // OFFLINE" : "SERVER // DESKTOP APP REQUIRED";
    return;
  }
  const prediction = game.getMultiplayerPredictionDiagnostics();
  const presentation = game.getMultiplayerPresentationDiagnostics();
  multiplayerDiagnostics.textContent = `SERVER // ${diagnostics.status.toUpperCase()} // ${diagnostics.tickRate.toFixed(1)} TPS // RTT ${multiplayerRtt === null ? "--" : multiplayerRtt.toFixed(0)}ms // FRAME ${age.toFixed(0)}ms // PKT ${diagnostics.packetRate ?? 0}/s // TX ${(multiplayerTxRate / 1024).toFixed(1)}KB/s // RX ${(multiplayerRxRate / 1024).toFixed(1)}KB/s // EVENTS ${((diagnostics.eventBytes ?? 0) / 1024).toFixed(1)}KB // KF ${diagnostics.keyframes ?? 0} // DROP ${(diagnostics.replacedFrames ?? 0) + replacedReplicationFrames} // STALE ${stalePresentationEvents} // CORR ${game.getMultiplayerInterpolationCorrection().toFixed(1)} // PLAY D${presentation.delayTicks} X${presentation.extrapolationTicks.toFixed(1)} Q${presentation.queuedEvents} L${presentation.lateEvents} // ACK ${guestEventAckRate}/s // PILOT ${prediction.acknowledged}/${prediction.sent} ${prediction.ackDelayMs.toFixed(0)}ms C${prediction.correction.toFixed(1)} S${prediction.snaps} // QUEUE ${multiplayerSession.stateSendBusy ? 1 : 0}`;
};

const handleHostServerMessage = (message: HostServerOutboundMessage): void => {
  if (message.type === "network-bytes") {
    multiplayerBytesSent += message.bytes;
    return;
  }
  if (message.type === "ready" || message.type === "diagnostics") {
    latestServerDiagnostics = message.diagnostics;
    renderServerDiagnostics();
    return;
  }
  if (message.type === "fatal") {
    latestServerDiagnostics = { status: "failed", tick: 0, tickRate: 0, frameSequence: 0, startedAt: Date.now(), message: message.message };
    renderServerDiagnostics();
    if (activeMultiplayerStart) {
      addLog(`AUTHORITATIVE SERVER FAILED // ${message.message}`, "danger");
      closeMultiplayerSession("Authoritative server failed.");
      showFrontScreen("main");
    }
    return;
  }
  if (message.type === "command-result") {
    pendingCommandOwners.delete(message.result.commandId);
    handleCommandResult(message.result);
    return;
  }
  if (message.type === "result") {
    if (!authoritativeResultHandled) {
      authoritativeResultHandled = true;
      game.finishReplicatedRun(message.victory, message.wave);
    }
    return;
  }
  if (message.type !== "state" || multiplayerSession.role !== "host" || multiplayerPhase !== "playing" || !activeMultiplayerStart) return;
  const receivedAt = (message as HostServerOutboundMessage & { readonly receivedAt?: number }).receivedAt ?? Date.now();
  if (Date.now() - receivedAt > 250) {
    replacedReplicationFrames += 1;
    resumeAwaitingKeyframe = true;
    hostReplicationDecoder.reset();
    void window.monochromiumDesktop?.requestHostKeyframe();
    return;
  }
  if (resumeAwaitingKeyframe && !isReplicationKeyframe(message.frame)) {
    replacedReplicationFrames += 1;
    return;
  }
  try {
    lastReplicationFrameAt = performance.now();
    const local = hostReplicationDecoder.decode(multiplayerSession.sessionId, message.frame);
    const presentationReceivedAt = performance.now();
    if (local.keyframe) game.clearMultiplayerPresentationQueue();
    if (!game.applyMultiplayerSnapshot(local.snapshot, !document.hidden, local.pilotInputAcks, { serverTick: local.serverTick, receivedAt: presentationReceivedAt })) throw new Error("Host replica rejected authoritative state.");
    applyDecodedEvents(local.events, local.serverTick, presentationReceivedAt);
    if (local.keyframe) {
      resumeAwaitingKeyframe = false;
      game.restorePersistentPresentation();
    }
  } catch (error) {
    addLog(`REPLICATION ERROR // ${error instanceof Error ? error.message : "unknown frame failure"}`, "danger");
  }
};

const stopHostServerSubscription = window.monochromiumDesktop?.onHostServerMessage(handleHostServerMessage);
window.setInterval(() => {
  multiplayerTxRate = multiplayerBytesSent - previousDiagnosticBytesSent;
  multiplayerRxRate = multiplayerBytesReceived - previousDiagnosticBytesReceived;
  guestEventAckRate = guestEventAckPulses - previousGuestEventAckPulses;
  previousDiagnosticBytesSent = multiplayerBytesSent;
  previousDiagnosticBytesReceived = multiplayerBytesReceived;
  previousGuestEventAckPulses = guestEventAckPulses;
  renderServerDiagnostics();
  if (multiplayerSession.role === "guest" && multiplayerSession.connected && multiplayerPhase === "playing" && activeMultiplayerStart) {
    const now = performance.now();
    if ((lastReplicationFrameAt === 0 || now - lastReplicationFrameAt > 2_000) && now - lastResyncRequestAt > 2_000) {
      lastResyncRequestAt = now;
      multiplayerSession.sendControl({ type: "resync-request", lastSequence: guestReplicationDecoder.currentSequence });
    }
  }
}, 1_000);
window.setInterval(() => {
  if (!multiplayerSession.connected || (multiplayerRtt !== null && performance.now() - lastReplicationFrameAt < 3_000)) return;
  void multiplayerSession.measureRtt().then((rtt) => { multiplayerRtt = rtt; });
}, 10_000);

const hydrateDiskPersistence = async (): Promise<void> => {
  if (!hasDiskSaveApi()) {
    setSaveStatus("Desktop save service unavailable // launch the installed Electron app.", "danger");
    return;
  }
  const [disk, environment] = await Promise.all([loadDiskSave(), getDesktopEnvironment()]);
  if (environment) {
    desktopEnvironment = environment;
    latestGpuStatus = environment.gpu;
    renderGpuStatus();
  }
  if (!disk.available) {
    setSaveStatus("Desktop save service unavailable // changes may not persist.", "danger");
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
    game.setAvailablePerks(progress.perkLoadout);
    renderMeta();
    renderModeList();
    renderMapLibrary();
    setSaveStatus(
      environment
        ? `Desktop save active // ${environment.savePath}`
        : "Desktop save active",
      "good",
    );
    return;
  }
  const migrated = await replaceDiskSave(currentSaveBundle());
  setSaveStatus(
    migrated ? "Desktop save created // existing local progress migrated." : "Could not create desktop save.",
    migrated ? "good" : "danger",
  );
};

void hydrateDiskPersistence();
void hydrateUpdater();
void hydrateDevelopmentTools();

const importEnemiesFromFile = async (file: File): Promise<void> => {
  try {
    const parsed = JSON.parse(await file.text()) as { type?: unknown; version?: unknown; enemies?: unknown };
    if (parsed?.type !== "monochromium-custom-enemies" || !Array.isArray(parsed.enemies) || parsed.version !== undefined && parsed.version !== 1 && parsed.version !== 2) {
      throw new Error("This is not a Monochromium enemy export.");
    }
    const report = sanitizeCustomEnemiesDetailed(parsed.enemies);
    const imported = [...report.enemies];
    if (imported.length === 0) throw new Error("The export did not contain any valid enemies.");
    if (report.issues.length > 0) {
      const errors = report.issues.filter((issue) => issue.severity === "error").length;
      const warnings = report.issues.length - errors;
      const details = report.issues.slice(0, 8).map((issue) => `${issue.code}: ${issue.message}`).join("\n");
      if (!await requestConfirmation({ title: "Enemy import report", copy: `${imported.length} enemies accepted. ${errors} invalid parts skipped; ${warnings} warnings.\n\n${details}`, acceptLabel: "Continue import" })) return;
    }
    const conflicts = imported.filter((enemy) => customEnemies.some((current) => current.id === enemy.id));
    if (conflicts.length > 0 && !await requestConfirmation({ title: "Replace existing enemies?", copy: `${conflicts.length} existing custom ${conflicts.length === 1 ? "enemy has" : "enemies have"} the same identifier.`, acceptLabel: "Replace enemies" })) return;
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
    if (conflicts.length > 0 && !await requestConfirmation({ title: "Replace existing modes?", copy: `${conflicts.length} existing custom ${conflicts.length === 1 ? "mode has" : "modes have"} the same identifier.`, acceptLabel: "Replace modes" })) return;
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
    if (conflicts.length > 0 && !await requestConfirmation({ title: "Replace existing maps?", copy: `${conflicts.length} existing custom ${conflicts.length === 1 ? "map has" : "maps have"} the same identifier.`, acceptLabel: "Replace maps" })) return;
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

const enterRun = (map: MapDefinition, mode: ModeDefinition, test: "map" | "mode" | false): void => {
  inspectorDetailsOpen = false;
  dismissedBossIds = new Set<number>();
  selectionSignature = "";
  activeMap = map;
  activeMode = mode;
  mapTestActive = test === "map";
  modeTestActive = test === "mode";
  modeTestWaveSignature = "";
  runSettled = false;
  query<HTMLButtonElement>("#game-over-restart").hidden = false;
  query<HTMLButtonElement>("#victory-restart").hidden = false;
  [mainMenu, multiplayerScreen, creatorHub, enemySelection, enemyCreator, modeSelection, battleSetup, mapLibrary, mapCreator, modeCreator, towerShop, gameOverPanel, victoryPanel]
    .forEach((screen) => { screen.hidden = true; });
  overlayState = "none";
  gameMenuOverlay.hidden = true;
  audioSettingsPanel.hidden = true;
  confirmOverlay.hidden = true;
  shell.classList.add("run-active");
  if (multiplayerHostSelecting && multiplayerSession.role === "host" && multiplayerSession.connected && remoteMultiplayerPlayer) {
    prepareMultiplayerRound(activeMap, activeMode);
  } else {
    game.clearMultiplayer();
    game.startRun(activeMap, progress.loadout, activeMode);
  }
};

const focusFirstControl = (container: HTMLElement): void => {
  window.requestAnimationFrame(() => container.querySelector<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex='0']")?.focus());
};

const renderGpuStatus = (): void => {
  if (!latestGpuStatus) {
    uiGpuStatus.textContent = "Renderer status: checking Chromium GPU capabilities…";
    uiGpuStatus.classList.remove("danger", "good");
    return;
  }
  if (latestGpuStatus.softwareRendering) {
    uiGpuStatus.textContent = "Renderer: SOFTWARE FALLBACK // Extra Low recommended";
    uiGpuStatus.classList.add("danger");
    uiGpuStatus.classList.remove("good");
    return;
  }
  uiGpuStatus.textContent = "Renderer: HARDWARE ACCELERATION AVAILABLE";
  uiGpuStatus.classList.add("good");
  uiGpuStatus.classList.remove("danger");
};

const renderGraphicsSetupStatus = (): void => {
  const softwareRendering = latestGpuStatus?.softwareRendering === true;
  graphicsSetupStatus.textContent = softwareRendering
    ? "Chromium reports software rendering on this device. Extra Low should keep menus and battles responsive."
    : "Renderer check complete. Start with a balanced preset and adjust it any time in Settings.";
  graphicsSetupOverlay.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((button) => {
    button.classList.toggle("recommended", softwareRendering && button.dataset["preset"] === "extra-low");
  });
};

const maybeShowGraphicsPresetPrompt = (): void => {
  if (!desktopEnvironment?.version || !shouldPromptForGraphicsPreset(desktopEnvironment.version)) return;
  renderGraphicsSetupStatus();
  graphicsSetupOverlay.hidden = false;
  focusFirstControl(graphicsSetupOverlay);
};

const renderUiPreferences = (): void => {
  query<HTMLSelectElement>("#ui-display-mode").value = uiPreferences.displayMode;
  query<HTMLSelectElement>("#ui-scale").value = String(uiPreferences.uiScale);
  query<HTMLSelectElement>("#ui-effects-quality").value = uiPreferences.effectsQuality;
  query<HTMLInputElement>("#ui-canvas-resolution").value = String(uiPreferences.canvasResolution);
  query<HTMLOutputElement>("#ui-canvas-resolution-value").textContent = `${Math.round(uiPreferences.canvasResolution * 100)}%`;
  query<HTMLInputElement>("#ui-particle-density").value = String(uiPreferences.particleDensity);
  query<HTMLOutputElement>("#ui-particle-density-value").textContent = `${Math.round(uiPreferences.particleDensity * 100)}%`;
  query<HTMLInputElement>("#ui-projectile-density").value = String(uiPreferences.projectileDensity);
  query<HTMLOutputElement>("#ui-projectile-density-value").textContent = `${Math.round(uiPreferences.projectileDensity * 100)}%`;
  const toggles: readonly [string, string, boolean][] = [
    ["ui-interface-blur", "ui-interface-blur-value", uiPreferences.interfaceBlur],
    ["ui-ambient-effects", "ui-ambient-effects-value", uiPreferences.ambientEffects],
    ["ui-menu-atmosphere", "ui-menu-atmosphere-value", uiPreferences.menuAtmosphere],
    ["ui-interface-shadows", "ui-interface-shadows-value", uiPreferences.interfaceShadows],
    ["ui-interface-animations", "ui-interface-animations-value", uiPreferences.interfaceAnimations],
    ["ui-canvas-glow", "ui-canvas-glow-value", uiPreferences.canvasGlow],
  ];
  toggles.forEach(([inputId, outputId, enabled]) => {
    query<HTMLInputElement>(`#${inputId}`).checked = enabled;
    const output = query<HTMLElement>(`#${outputId}`);
    output.textContent = enabled ? "ON" : "OFF";
    output.classList.toggle("active", enabled);
  });
  query<HTMLSelectElement>("#ui-motion").value = uiPreferences.motion;
  query<HTMLInputElement>("#ui-screen-shake").value = String(uiPreferences.screenShake);
  query<HTMLOutputElement>("#ui-screen-shake-value").textContent = `${Math.round(uiPreferences.screenShake * 100)}%`;
  query<HTMLInputElement>("#ui-scanline").value = String(uiPreferences.scanlineIntensity);
  query<HTMLOutputElement>("#ui-scanline-value").textContent = `${Math.round(uiPreferences.scanlineIntensity * 100)}%`;
  renderGpuStatus();
};

const applyUiPreferences = (): void => {
  const systemReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reduced = prefersReducedMotion(uiPreferences.motion, systemReduced);
  document.documentElement.style.setProperty("--ui-scale", String(uiPreferences.uiScale));
  document.documentElement.style.setProperty("--scanline-opacity", String(uiPreferences.scanlineIntensity));
  document.documentElement.dataset["effectsQuality"] = uiPreferences.effectsQuality;
  document.documentElement.dataset["interfaceBlur"] = String(uiPreferences.interfaceBlur);
  document.documentElement.dataset["ambientEffects"] = String(uiPreferences.ambientEffects);
  document.documentElement.dataset["menuAtmosphere"] = String(uiPreferences.menuAtmosphere);
  document.documentElement.dataset["interfaceShadows"] = String(uiPreferences.interfaceShadows);
  document.documentElement.dataset["interfaceAnimations"] = String(uiPreferences.interfaceAnimations);
  document.documentElement.dataset["reducedMotion"] = reduced ? "true" : "false";
  game.setVisualPreferences({
    screenShakeStrength: uiPreferences.screenShake,
    canvasResolution: uiPreferences.canvasResolution,
    particleDensity: uiPreferences.particleDensity,
    projectileDensity: uiPreferences.projectileDensity,
    canvasGlow: uiPreferences.canvasGlow,
    reducedMotion: reduced,
  });
  renderUiPreferences();
};

const updateUiPreferences = async (next: Partial<UiPreferences>, syncDisplay = false): Promise<void> => {
  uiPreferences = sanitizeUiPreferences({ ...uiPreferences, ...next });
  saveUiPreferences(uiPreferences);
  applyUiPreferences();
  if (syncDisplay && window.monochromiumDesktop) {
    const fullscreen = await window.monochromiumDesktop.setFullscreen(uiPreferences.displayMode === "fullscreen");
    uiPreferences = { ...uiPreferences, displayMode: fullscreen ? "fullscreen" : "windowed" };
    saveUiPreferences(uiPreferences);
    renderUiPreferences();
  }
};

const setOverlayVisibility = (state: OverlayState): void => {
  if (state !== "none") game.releaseMechaInput();
  gameMenuOverlay.hidden = state !== "pause";
  audioSettingsPanel.hidden = state !== "settings";
  confirmOverlay.hidden = state !== "confirm";
  soundButton.setAttribute("aria-expanded", state === "settings" ? "true" : "false");
};

const setAudioPanelOpen = (open: boolean): void => {
  if (open) {
    focusBeforeOverlay = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    settingsReturnOverlay = overlayState === "pause" ? "pause" : "none";
    overlayState = "settings";
    setOverlayVisibility(overlayState);
    void audio.unlock();
    audio.uiOpen();
    renderAudioSettings();
    renderUiPreferences();
    focusFirstControl(audioSettingsPanel);
  } else {
    overlayState = settingsReturnOverlay;
    settingsReturnOverlay = "none";
    setOverlayVisibility(overlayState);
    audio.uiClick();
    if (overlayState === "pause") focusFirstControl(gameMenuOverlay);
    else focusBeforeOverlay?.focus();
  }
};

const requestConfirmation = (options: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly copy: string;
  readonly acceptLabel: string;
  readonly cancelLabel?: string | null;
  readonly destructive?: boolean;
}): Promise<boolean> => new Promise((resolve) => {
  focusBeforeOverlay = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const returnOverlay = overlayState;
  pendingConfirmation = { accept: () => resolve(true), cancel: () => resolve(false), returnOverlay };
  const destructive = options.destructive ?? options.cancelLabel !== null;
  const kicker = query<HTMLElement>("#confirm-kicker");
  kicker.textContent = options.eyebrow ?? (destructive ? "PLEASE CONFIRM" : "SYSTEM MESSAGE");
  kicker.classList.toggle("danger", destructive);
  confirmTitle.textContent = options.title;
  confirmCopy.textContent = options.copy;
  confirmAccept.textContent = options.acceptLabel;
  confirmAccept.className = destructive ? "danger-button" : "primary-button";
  const cancel = confirmOverlay.querySelector<HTMLButtonElement>("[data-action='confirm-cancel']");
  if (cancel) {
    cancel.hidden = options.cancelLabel === null;
    cancel.textContent = options.cancelLabel ?? "Cancel";
  }
  overlayState = "confirm";
  setOverlayVisibility(overlayState);
  focusFirstControl(confirmOverlay);
});

const finishConfirmation = (accepted: boolean): void => {
  const confirmation = pendingConfirmation;
  if (!confirmation) return;
  pendingConfirmation = null;
  overlayState = confirmation.returnOverlay;
  setOverlayVisibility(overlayState);
  if (accepted) void confirmation.accept();
  else confirmation.cancel?.();
  if (overlayState === "pause") focusFirstControl(gameMenuOverlay);
  else if (overlayState === "settings") focusFirstControl(audioSettingsPanel);
  else focusBeforeOverlay?.focus();
};

const requestNotice = (title: string, copy: string): Promise<void> =>
  requestConfirmation({ title, copy, acceptLabel: "Okay", cancelLabel: null }).then(() => undefined);

const renderGameMenu = (): void => {
  const multiplayer = Boolean(activeMultiplayerStart);
  const paused = latestUiState?.paused ?? false;
  const policy = getPauseMenuPolicy(multiplayer, paused);
  query<HTMLElement>("#game-menu-kicker").textContent = multiplayer ? (paused ? "MATCH PAUSED" : "MATCH CONTINUES") : "GAME PAUSED";
  query<HTMLElement>("#game-menu-title").textContent = multiplayer ? "Room controls" : "Take a breath.";
  query<HTMLElement>("#game-menu-copy").textContent = multiplayer
    ? policy.matchContinues ? "The shared battle keeps running while this menu is open." : "The shared simulation is paused for both players."
    : "The battlefield is paused while this menu is open.";
  query<HTMLElement>("#game-menu-map").textContent = activeMap.name.toUpperCase();
  query<HTMLElement>("#game-menu-mode").textContent = activeMode.name.toUpperCase();
  const pauseRequest = query<HTMLButtonElement>("#game-menu-pause-request");
  pauseRequest.hidden = !multiplayer;
  pauseRequest.querySelector("span")!.textContent = paused ? "Resume match" : "Request pause";
  const restart = query<HTMLButtonElement>("#game-menu-restart");
  restart.hidden = multiplayer;
  restart.textContent = mapTestActive || modeTestActive ? "Restart test" : "Restart run";
  const leave = query<HTMLButtonElement>("#game-menu-leave");
  leave.querySelector("span")!.textContent = activeMultiplayerStart
    ? multiplayerSession.role === "host" ? "End session" : "Leave session"
    : mapTestActive || modeTestActive ? "Return to editor" : "Leave run";
};

const openGameMenu = (): void => {
  if (!shell.classList.contains("run-active") || !latestUiState?.started || !gameOverPanel.hidden || !victoryPanel.hidden) return;
  focusBeforeOverlay = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const policy = getPauseMenuPolicy(Boolean(activeMultiplayerStart), latestUiState.paused);
  if (policy.pausesSimulationOnOpen) game.setPaused(true);
  overlayState = "pause";
  renderGameMenu();
  setOverlayVisibility(overlayState);
  focusFirstControl(gameMenuOverlay);
};

const closeGameMenu = (resume = true): void => {
  if (overlayState !== "pause") return;
  const policy = getPauseMenuPolicy(Boolean(activeMultiplayerStart), latestUiState?.paused ?? false);
  if (resume && policy.resumeSimulationOnClose) game.setPaused(false);
  overlayState = "none";
  setOverlayVisibility(overlayState);
  focusBeforeOverlay?.focus();
};

const hydrateUiPreferences = async (): Promise<void> => {
  applyUiPreferences();
  if (!window.monochromiumDesktop) return;
  const fullscreen = await window.monochromiumDesktop.setFullscreen(uiPreferences.displayMode === "fullscreen");
  uiPreferences = { ...uiPreferences, displayMode: fullscreen ? "fullscreen" : "windowed" };
  saveUiPreferences(uiPreferences);
  renderUiPreferences();
  stopFullscreenSubscription = window.monochromiumDesktop.onFullscreenChanged((nextFullscreen) => {
    uiPreferences = { ...uiPreferences, displayMode: nextFullscreen ? "fullscreen" : "windowed" };
    saveUiPreferences(uiPreferences);
    renderUiPreferences();
  });
};

window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => {
  if (uiPreferences.motion === "system") applyUiPreferences();
});
void hydrateUiPreferences();

const hydrateGraphicsEnvironment = async (): Promise<void> => {
  desktopEnvironment = await getDesktopEnvironment();
  latestGpuStatus = desktopEnvironment?.gpu ?? null;
  renderGpuStatus();
  if (desktopBridge) {
    stopGpuStatusSubscription = desktopBridge.onGpuStatus((status) => {
      latestGpuStatus = status;
      renderGpuStatus();
      if (!graphicsSetupOverlay.hidden) renderGraphicsSetupStatus();
    });
  }
  maybeShowGraphicsPresetPrompt();
};
void hydrateGraphicsEnvironment();

const isAudioBus = (value: string | undefined): value is AudioBus =>
  value === "towers" || value === "enemies" || value === "ui";

const multiplayerFailure = (error: unknown): void => {
  const message = error instanceof Error ? error.message : "Unknown multiplayer error.";
  renderMultiplayerStatus("failed", message);
  addLog(`Multiplayer // ${message}`, "danger");
};

const createMultiplayerRoom = async (): Promise<void> => {
  try {
    if (!window.monochromiumDesktop) throw new Error("Multiplayer requires the Monochromium desktop app.");
    persistMultiplayerPlayer();
    const code = await multiplayerSession.createHostRoom();
    multiplayerRoomCodeDisplay.textContent = code;
    multiplayerCopyRoomCodeButton.disabled = false;
    multiplayerRoomStatus.textContent = "Secure room ready // copy the invite and send it to your friend.";
  } catch (error) {
    multiplayerFailure(error);
  }
};

const updateGraphicsPreset = async (preset: UiPreferences["effectsQuality"]): Promise<void> => {
  uiPreferences = applyGraphicsPreset(uiPreferences, preset);
  saveUiPreferences(uiPreferences);
  applyUiPreferences();
};

const updateManualGraphicsPreferences = async (next: Partial<UiPreferences>): Promise<void> => {
  await updateUiPreferences({ ...next, effectsQuality: "custom" });
};

const joinMultiplayerRoom = async (): Promise<void> => {
  try {
    if (!window.monochromiumDesktop) throw new Error("Multiplayer requires the Monochromium desktop app.");
    persistMultiplayerPlayer();
    const code = await multiplayerSession.joinRoom(multiplayerRoomCodeInput.value);
    multiplayerRoomCodeInput.value = code;
  } catch (error) {
    multiplayerFailure(error);
  }
};

const copyMultiplayerRoomCode = async (): Promise<void> => {
  const code = multiplayerSession.sessionId;
  if (multiplayerSession.role !== "host" || !code) return;
  try {
    await navigator.clipboard.writeText(code);
  } catch (error) {
    multiplayerRoomCodeDisplay.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(multiplayerRoomCodeDisplay);
    selection?.removeAllRanges();
    selection?.addRange(range);
    try { document.execCommand("copy"); } catch { /* Manual copy remains available. */ }
  }
  addLog("Multiplayer invite copied to clipboard.", "good");
};

const closeMultiplayerSession = (reason: string): void => {
  const wasHost = multiplayerSession.role === "host";
  latestSimulationReplay = buildActiveSimulationReplay();
  multiplayerSession.close(reason);
  if (wasHost) void window.monochromiumDesktop?.stopHostServer(reason);
  remoteMultiplayerPlayer = null;
  activeMultiplayerStart = null;
  resetReplayCapture();
  multiplayerHostSelecting = false;
  multiplayerPhase = "lobby";
  multiplayerRound = 0;
  lastGuestStartedRound = 0;
  multiplayerGuestReady = false;
  hostReplicationDecoder.reset();
  guestReplicationDecoder.reset();
  pendingCommandOwners.clear();
  pendingLocalCommands.clear();
  pendingLocalCommandTimers.forEach((timer) => window.clearTimeout(timer));
  pendingLocalCommandTimers.clear();
  appliedEventIds.clear();
  latestEventAckSent = 0;
  guestPulsePending = false;
  guestPulseSequence = 0;
  guestPulseSentAt.clear();
  lastGuestPulseSentAt = 0;
  guestPulseUrgent = false;
  guestEventAckPending = false;
  lastGuestEventAckAt = 0;
  lastGuestAckEventId = 0;
  guestEventAckPulses = 0;
  previousGuestEventAckPulses = 0;
  guestEventAckRate = 0;
  localCursorPoint = null;
  pendingCursor = undefined;
  stalePresentationEvents = 0;
  replacedReplicationFrames = 0;
  resumeAwaitingKeyframe = false;
  latestServerDiagnostics = null;
  lastReplicationFrameAt = 0;
  authoritativeResultHandled = false;
  multiplayerRtt = null;
  multiplayerTxRate = 0;
  multiplayerRxRate = 0;
  pendingMultiplayerResult = null;
  game.clearMultiplayer();
  if (guestSessionContentActive) setCustomEnemyRegistry(customEnemies);
  guestSessionContentActive = false;
  multiplayerRoomCodeDisplay.textContent = "--------";
  multiplayerRoomCodeInput.value = "";
  renderMultiplayerRoomCode();
  multiplayerCopyRoomCodeButton.disabled = true;
  multiplayerRoomStatus.textContent = "Send this code to your friend, then wait for them to join.";
  renderMultiplayerStatus("closed", reason);
};

const leaveCurrentRun = (): void => {
  inspectorDetailsOpen = false;
  selectionSignature = "";
  overlayState = "none";
  setOverlayVisibility(overlayState);
  game.leaveRun();
  if (activeMultiplayerStart) closeMultiplayerSession(multiplayerSession.role === "host" ? "Host ended the session." : "Guest left the session.");
  if (modeTestActive && creatorDraft) {
    modeTestActive = false;
    showFrontScreen("creator");
  } else if (mapTestActive && mapDraft) {
    mapTestActive = false;
    showFrontScreen("map-creator");
  } else {
    mapTestActive = false;
    modeTestActive = false;
    showFrontScreen("main");
  }
};

const copySimulationReplay = async (): Promise<void> => {
  const bundle = buildActiveSimulationReplay();
  if (!bundle) {
    addLog("Repro export unavailable // start a host-authoritative multiplayer run first.", "danger");
    return;
  }
  const serialized = serializeSimulationReplay(bundle);
  try {
    await navigator.clipboard.writeText(serialized);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = serialized;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try { document.execCommand("copy"); } finally { textarea.remove(); }
  }
  addLog("Deterministic repro copied // attach this JSON to a bug report or replay test.", "good");
};

const exportSimulationReplay = (): void => {
  const bundle = buildActiveSimulationReplay();
  if (!bundle) {
    addLog("Repro export unavailable // start a host-authoritative multiplayer run first.", "danger");
    return;
  }
  const url = URL.createObjectURL(new Blob([serializeSimulationReplay(bundle)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `monochromium-repro-${bundle.config.sessionId}-${Date.now().toString(36)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  addLog("Deterministic repro exported as JSON.", "good");
};

const runAction = async (action: string, value?: string, source?: HTMLElement): Promise<void> => {
  switch (action) {
    case "open-play":
      multiplayerHostSelecting = false;
      libraryReturnScreen = "main";
      showFrontScreen("setup");
      break;
    case "open-multiplayer":
      persistMultiplayerPlayer();
      if (["idle", "closed", "failed"].includes(multiplayerSession.status)) multiplayerSetupStage = "profile";
      showFrontScreen("multiplayer");
      if (!window.monochromiumDesktop) renderMultiplayerStatus("failed", "Multiplayer requires the Monochromium desktop app.");
      break;
    case "toggle-ingame-chat":
      toggleInGameChat();
      break;
    case "minimize-ingame-chat":
      minimizeInGameChat();
      break;
    case "close-ingame-chat":
      closeInGameChat();
      break;
    case "multiplayer-link":
      showFrontScreen("multiplayer");
      break;
    case "multiplayer-return-run":
      multiplayerScreen.hidden = true;
      shell.classList.add("run-active");
      break;
    case "multiplayer-guest-ready":
      setGuestMultiplayerReady(!multiplayerGuestReady);
      break;
    case "multiplayer-profile-continue":
      persistMultiplayerPlayer();
      multiplayerSetupStage = "connection";
      renderMultiplayerSetupStage();
      multiplayerCreateRoomButton.focus();
      break;
    case "multiplayer-profile-back":
      if (!["idle", "closed", "failed"].includes(multiplayerSession.status)) break;
      multiplayerSetupStage = "profile";
      renderMultiplayerSetupStage();
      multiplayerUsername.focus();
      break;
    case "multiplayer-toggle-loadout":
      if (value && multiplayerPhase === "lobby" && (activeMultiplayerStart || multiplayerSession.role === "guest" || multiplayerSession.role === "host")) {
        const kind = value as TowerKind;
        if (!TOWER_ORDER.includes(kind)) break;
        if (activeMultiplayerStart && !activeMultiplayerStart.allowedTowers.includes(kind)) {
          addLog("Loadout rejected // the host has not authorized that tower for this room.", "danger");
          break;
        }
        const result = toggleTowerLoadout(progress, kind);
        if (result === "equipped" || result === "unequipped") {
          game.setAvailableTowers(progress.loadout);
          game.setAvailablePerks(progress.perkLoadout);
          persistMultiplayerPlayer();
          if (multiplayerSession.role === "guest") setGuestMultiplayerReady(false);
          renderMeta();
          renderMultiplayerLobby();
          addLog(`${TOWER_DEFINITIONS[kind].name} ${result === "equipped" ? "equipped" : "removed"} for the next round.`, "good");
          audio.uiConfirm();
        } else if (result === "full") {
          addLog("Loadout full // remove an equipped tower before adding another.", "danger");
          audio.uiError();
        }
      }
      break;
    case "multiplayer-retry-round":
      if (multiplayerSession.role === "host" && activeMultiplayerStart && multiplayerPhase === "lobby") {
        prepareMultiplayerRound(activeMultiplayerStart.map, activeMultiplayerStart.mode);
      }
      break;
    case "multiplayer-create-room":
      await createMultiplayerRoom();
      break;
    case "multiplayer-join-room":
      await joinMultiplayerRoom();
      break;
    case "multiplayer-retry-connection":
      try {
        const code = await multiplayerSession.retryConnection();
        if (multiplayerSession.role === "host") multiplayerRoomCodeDisplay.textContent = code;
      } catch (error) {
        multiplayerFailure(error);
      }
      break;
    case "multiplayer-cancel-connection":
      closeMultiplayerSession("Connection cancelled.");
      break;
    case "multiplayer-copy-room-code":
      void copyMultiplayerRoomCode();
      break;
    case "multiplayer-choose-mode":
      if (multiplayerSession.role !== "host" || !multiplayerSession.connected || !remoteMultiplayerPlayer) break;
      multiplayerHostSelecting = true;
      libraryReturnScreen = "multiplayer";
      showFrontScreen("setup");
      break;
    case "multiplayer-back":
      if (["idle", "closed", "failed"].includes(multiplayerSession.status) && multiplayerSetupStage === "connection") {
        multiplayerSetupStage = "profile";
        renderMultiplayerSetupStage();
        multiplayerUsername.focus();
        break;
      }
      if (!["idle", "closed", "failed"].includes(multiplayerSession.status)) {
        const isHost = multiplayerSession.role === "host";
        const confirmed = await requestConfirmation({
          eyebrow: "MULTIPLAYER SESSION",
          title: isHost ? "End this session?" : "Leave this session?",
          copy: isHost
            ? "The room will close for every connected player. This cannot be undone."
            : "You will disconnect from the room and return to the command screen.",
          acceptLabel: isHost ? "End Session" : "Leave Session",
          destructive: true,
        });
        if (!confirmed) break;
        closeMultiplayerSession(isHost ? "Session ended by host." : "Left multiplayer session.");
      }
      showFrontScreen("main");
      break;
    case "open-modes":
      libraryReturnScreen = "main";
      showFrontScreen("setup");
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
    case "enemy-switch-tab": {
      const targetTab = source?.dataset["enemyTab"] as "stats" | "appearance" | "abilities" | undefined;
      if (targetTab === "stats" || targetTab === "appearance" || targetTab === "abilities") {
        setEnemyCreatorTab(targetTab);
      }
      break;
    }
    case "new-enemy":
      enemyDraft = createCustomEnemy();
      enemyDraftBaseline = captureDraftBaseline(enemyDraft);
      activeEnemyCreatorTab = "stats";
      drawingCanvasKey = "";
      drawingHistory = [];
      drawingRedoHistory = [];
      drawingBrushColor = enemyDraft.color;
      drawingTool = "brush";
      showFrontScreen("enemy-creator");
      break;
    case "enemy-use-procedural":
      if (!enemyDraft) break;
      closeEnemyDrawingEditor();
      enemyDraft.appearance = { ...enemyDraft.appearance, mode: "procedural" };
      renderEnemyCreator();
      break;
    case "enemy-use-drawing":
      if (!enemyDraft) break;
      enemyDraft.appearance = { ...enemyDraft.appearance, mode: "drawing" };
      renderEnemyCreator();
      openEnemyDrawingEditor();
      break;
    case "enemy-open-drawing-editor":
      if (!enemyDraft) break;
      enemyDraft.appearance = { ...enemyDraft.appearance, mode: "drawing" };
      renderEnemyCreator();
      openEnemyDrawingEditor();
      break;
    case "enemy-close-drawing-editor":
      closeEnemyDrawingEditor();
      renderDrawingToolState();
      break;
    case "enemy-drawing-undo":
      undoEnemyDrawing();
      break;
    case "enemy-drawing-redo":
      redoEnemyDrawing();
      break;
    case "enemy-drawing-clear":
      clearEnemyDrawing();
      break;
    case "enemy-drawing-zoom-out":
      setDrawingZoom(drawingZoom - 1);
      break;
    case "enemy-drawing-zoom-in":
      setDrawingZoom(drawingZoom + 1);
      break;
    case "enemy-drawing-grid":
      drawingGridVisible = !drawingGridVisible;
      renderDrawingToolState();
      break;
    case "enemy-upload-image":
    case "enemy-drawing-upload":
      enemyImageUploadInput.click();
      break;
    case "enemy-close-crop-modal":
      closeEnemyImageCropper();
      break;
    case "enemy-apply-crop":
      applyEnemyImageCrop();
      break;
    case "enemy-crop-zoom-in":
      setCropZoom(cropZoom * 1.15);
      break;
    case "enemy-crop-zoom-out":
      setCropZoom(cropZoom * 0.85);
      break;
    case "enemy-crop-fit":
      if (cropImage) {
        cropPan = { x: 0, y: 0 };
        setCropZoom(calculateFitZoom(cropImage.naturalWidth, cropImage.naturalHeight, CROP_MASK_RADIUS, "cover"));
      }
      break;
    case "enemy-crop-center":
      cropPan = { x: 0, y: 0 };
      drawCropCanvas();
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
      if (!folder || !await requestConfirmation({ title: `Delete ${folder.name}?`, copy: "The folder will be removed, but its contents will remain in the library.", acceptLabel: "Delete folder" })) break;
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
      enemyDraftBaseline = captureDraftBaseline(enemyDraft);
      activeEnemyCreatorTab = "stats";
      drawingCanvasKey = "";
      drawingHistory = [];
      drawingRedoHistory = [];
      drawingBrushColor = enemyDraft.color;
      drawingTool = "brush";
      showFrontScreen("enemy-creator");
      break;
    }
    case "enemy-add-behavior-rule":
      if (!enemyDraft || enemyDraft.behaviorRules.length >= 32) break;
      enemyDraft.behaviorRules.push(createCustomEnemyBehaviorRule());
      renderBehaviorRules();
      break;
    case "enemy-delete-behavior-rule": {
      if (!enemyDraft) break;
      const ruleIndex = Number(source?.dataset["behaviorRuleIndex"]);
      if (Number.isInteger(ruleIndex)) enemyDraft.behaviorRules.splice(ruleIndex, 1);
      renderBehaviorRules();
      break;
    }
    case "enemy-add-behavior-action": {
      if (!enemyDraft) break;
      const ruleIndex = Number(source?.dataset["behaviorRuleIndex"]);
      const rule = enemyDraft.behaviorRules[ruleIndex];
      if (rule && rule.actions.length < 32) rule.actions.push(createCustomEnemyBehaviorAction());
      renderBehaviorRules();
      break;
    }
    case "enemy-delete-behavior-action": {
      if (!enemyDraft) break;
      const ruleIndex = Number(source?.dataset["behaviorRuleIndex"]);
      const actionIndex = Number(source?.dataset["behaviorActionIndex"]);
      const rule = enemyDraft.behaviorRules[ruleIndex];
      if (rule && rule.actions.length > 1 && Number.isInteger(actionIndex)) rule.actions.splice(actionIndex, 1);
      renderBehaviorRules();
      break;
    }
    case "enemy-add-attack":
      if (enemyDraft && enemyDraft.attacks.length < 24) {
        enemyDraft.attacks.push(createCustomEnemyAttack());
        renderEnemyAttacks();
      }
      break;
    case "enemy-delete-attack": {
      if (!enemyDraft) break;
      const attackIndex = Number(source?.dataset["attackIndex"]);
      if (Number.isInteger(attackIndex)) enemyDraft.attacks.splice(attackIndex, 1);
      renderEnemyAttacks();
      break;
    }
    case "enemy-add-attack-effect": {
      if (!enemyDraft) break;
      const attackIndex = Number(source?.dataset["attackIndex"]);
      const attack = enemyDraft.attacks[attackIndex];
      if (attack && attack.effects.length < 16) (attack.effects as EnemyAttackEffectDefinition[]).push({ type: "damage", amount: 20 });
      renderEnemyAttacks();
      break;
    }
    case "enemy-delete-attack-effect": {
      if (!enemyDraft) break;
      const attackIndex = Number(source?.dataset["attackIndex"]);
      const effectIndex = Number(source?.dataset["effectIndex"]);
      const attack = enemyDraft.attacks[attackIndex];
      if (attack && attack.effects.length > 1 && Number.isInteger(effectIndex)) (attack.effects as EnemyAttackEffectDefinition[]).splice(effectIndex, 1);
      renderEnemyAttacks();
      break;
    }
    case "enemy-add-attack-visual": {
      if (!enemyDraft) break;
      const attackIndex = Number(source?.dataset["attackIndex"]);
      const attack = enemyDraft.attacks[attackIndex];
      if (attack && attack.visuals.length < 16) (attack.visuals as EnemyAttackVisualDefinition[]).push({ type: "beam", color: "#ffffff", size: 1, width: 3, duration: 0.3, speed: 360 });
      renderEnemyAttacks();
      break;
    }
    case "enemy-delete-attack-visual": {
      if (!enemyDraft) break;
      const attackIndex = Number(source?.dataset["attackIndex"]);
      const visualIndex = Number(source?.dataset["visualIndex"]);
      const attack = enemyDraft.attacks[attackIndex];
      if (attack && attack.visuals.length > 1 && Number.isInteger(visualIndex)) (attack.visuals as EnemyAttackVisualDefinition[]).splice(visualIndex, 1);
      renderEnemyAttacks();
      break;
    }
    case "delete-enemy": {
      const enemy = customEnemies.find((candidate) => candidate.id === source?.dataset["enemyId"]);
      if (!enemy || !await requestConfirmation({ title: `Delete ${enemy.name}?`, copy: "Custom wave references will be changed to Dummy. This cannot be undone.", acceptLabel: "Delete enemy" })) break;
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
      if (hasDraftChanged(enemyDraft, enemyDraftBaseline) && !await requestConfirmation({ title: "Discard enemy changes?", copy: "Your unsaved enemy edits will be lost.", acceptLabel: "Discard changes" })) break;
      enemyDraft = null;
      enemyDraftBaseline = "";
      showFrontScreen("enemies");
      break;
    case "enemy-save":
      if (!enemyDraft) break;
      if (validateCustomEnemyDraft(enemyDraft, customEnemies).some((issue) => issue.severity === "error")) {
        setSaveStatus("Enemy has blocking ability errors. Open the issue list before saving.", "danger");
        enemyCreatorV4.render();
        break;
      }
      customEnemies = upsertCustomEnemy(customEnemies, enemyDraft);
      setCustomEnemyRegistry(customEnemies);
      enemyDraft = null;
      enemyDraftBaseline = "";
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
      if (activeFrontScreen === "setup" && multiplayerHostSelecting) {
        multiplayerHostSelecting = false;
        showFrontScreen("multiplayer");
      } else showFrontScreen("main");
      break;
    case "library-back":
      showFrontScreen(libraryReturnScreen);
      break;
    case "back-modes":
      showFrontScreen("modes");
      break;
    case "select-battle-mode": {
      const modeId = source?.dataset["modeId"] ?? value;
      if (!modeId) break;
      const official = MODE_DEFINITIONS.find((mode) => mode.kind === modeId);
      if (official) selectedMode = official;
      else {
        const custom = customModes.find((mode) => mode.id === modeId);
        if (!custom || getMissingCustomEnemyIds(custom).length > 0) break;
        selectedMode = customModeToDefinition(custom);
      }
      updateSelectedModeCopy();
      break;
    }
    case "select-mode": {
      const modeId = source?.dataset["modeId"] ?? value;
      if (!modeId) break;
      const official = MODE_DEFINITIONS.find((mode) => mode.kind === modeId);
      if (official) selectedMode = official;
      else {
        const custom = customModes.find((mode) => mode.id === modeId);
        if (!custom) break;
        const missingEnemies = getMissingCustomEnemyIds(custom);
        if (missingEnemies.length > 0) {
          await requestNotice("Mode unavailable", `Import these custom enemies first: ${formatMissingCustomEnemies(missingEnemies)}.`);
          break;
        }
        selectedMode = customModeToDefinition(custom);
      }
      showFrontScreen("setup");
      break;
    }
    case "new-mode":
      creatorDraft = createCustomMode();
      creatorDraftBaseline = captureDraftBaseline(creatorDraft);
      creatorWaveIndex = 0;
      showFrontScreen("creator");
      break;
    case "edit-mode": {
      const modeId = source?.dataset["modeId"];
      const custom = customModes.find((mode) => mode.id === modeId);
      if (!custom) break;
      creatorDraft = cloneCustomMode(custom);
      creatorDraftBaseline = captureDraftBaseline(creatorDraft);
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
      if (!custom || !await requestConfirmation({ title: `Delete ${custom.name}?`, copy: "This created mode will be permanently removed from this device.", acceptLabel: "Delete mode" })) break;
      customModes = deleteCustomMode(customModes, custom.id);
      selectedModeIds.delete(custom.id);
      persistCreatorFolderState(assignCreatorAssets(creatorFolders, "modes", [custom.id], null));
      if (selectedMode.kind === custom.id) selectedMode = NORMAL_MODE;
      renderModeList();
      break;
    }
    case "creator-back":
      if (hasDraftChanged(creatorDraft, creatorDraftBaseline) && !await requestConfirmation({ title: "Discard mode changes?", copy: "Your unsaved timeline edits will be lost.", acceptLabel: "Discard changes" })) break;
      creatorDraft = null;
      creatorDraftBaseline = "";
      showFrontScreen("modes");
      break;
    case "creator-save":
      if (!creatorDraft) break;
      customModes = upsertCustomMode(customModes, creatorDraft);
      creatorDraft = null;
      creatorDraftBaseline = "";
      addLog("Custom mode saved to this desktop.", "good");
      showFrontScreen("modes");
      break;
    case "mode-test": {
      if (!creatorDraft) break;
      const testMap = getMapDefinition(modeTestMapKind ?? selectedMap.kind);
      if (!testMap) {
        setSaveStatus("Choose a valid test map first.", "danger");
        break;
      }
      const missingEnemies = getMissingCustomEnemyIds(creatorDraft);
      if (missingEnemies.length > 0) {
        await requestNotice("Mode unavailable", `Import these custom enemies first: ${formatMissingCustomEnemies(missingEnemies)}.`);
        break;
      }
      saveModeTestMapKind(testMap.kind);
      customModes = upsertCustomMode(customModes, creatorDraft);
      const savedMode = customModes.find((mode) => mode.id === creatorDraft?.id);
      if (!savedMode) break;
      creatorDraft = cloneCustomMode(savedMode);
      creatorDraftBaseline = captureDraftBaseline(creatorDraft);
      addLog(`Mode "${savedMode.name}" auto-saved // launching test on ${testMap.name}.`, "good");
      enterRun(testMap, customModeToDefinition(savedMode), "mode");
      break;
    }
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
      mapDraftBaseline = captureDraftBaseline(mapDraft);
      activeMapPathIndex = 0;
      mapHistory = [];
      mapFuture = [];
      mapSelectionState = null;
      showFrontScreen("map-creator");
      break;
    case "edit-map": {
      const map = customMaps.find((candidate) => candidate.id === source?.dataset["mapId"]);
      if (!map) break;
      mapDraft = cloneCustomMap(map);
      mapDraftBaseline = captureDraftBaseline(mapDraft);
      activeMapPathIndex = 0;
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
      if (!map || !await requestConfirmation({ title: `Delete ${map.name}?`, copy: "This created map will be permanently removed from this device.", acceptLabel: "Delete map" })) break;
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
      if (hasDraftChanged(mapDraft, mapDraftBaseline) && !await requestConfirmation({ title: "Discard map changes?", copy: "Your unsaved route and palette edits will be lost.", acceptLabel: "Discard changes" })) break;
      mapDraft = null;
      mapDraftBaseline = "";
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
      mapDraftBaseline = "";
      mapHistory = [];
      mapFuture = [];
      renderMeta();
      showFrontScreen("map-library");
      break;
    case "map-test":
      if (!mapDraft || !validateCustomMap(mapDraft).valid) break;
      enterRun(customMapToDefinition(mapDraft), NORMAL_MODE, "map");
      break;
    case "map-tool-select":
      break;
    case "map-select-path": {
      const index = Number(source?.dataset["pathIndex"]);
      if (!mapDraft || !Number.isInteger(index) || !mapDraft.paths[index]) break;
      activeMapPathIndex = index;
      mapSelectionState = null;
      renderMapEditor();
      break;
    }
    case "map-add-path": {
      if (!mapDraft || mapDraft.paths.length >= MAX_MAP_PATHS) break;
      mutateMapDraft((draft) => {
        const route = createCustomMapPath(draft.paths.length);
        draft.paths.push(route);
        activeMapPathIndex = draft.paths.length - 1;
        mapSelectionState = { type: "point", pathIndex: activeMapPathIndex, index: 0 };
      });
      break;
    }
    case "map-delete-path": {
      const index = Number(source?.dataset["pathIndex"]);
      if (!mapDraft || mapDraft.paths.length <= 1 || !Number.isInteger(index) || !mapDraft.paths[index]) break;
      mutateMapDraft((draft) => {
        draft.paths.splice(index, 1);
        draft.pathBlockers = draft.pathBlockers.filter((blocker) => blocker.pathIndex !== index).map((blocker) => ({ ...blocker, pathIndex: blocker.pathIndex > index ? blocker.pathIndex - 1 : blocker.pathIndex }));
        draft.path = draft.paths[0]!.path.map((point) => ({ ...point }));
        activeMapPathIndex = Math.min(activeMapPathIndex, draft.paths.length - 1);
      });
      mapSelectionState = null;
      renderMapEditor();
      break;
    }
    case "map-add-point": {
      const route = mapDraft?.paths[activeMapPathIndex];
      if (!route || route.path.length >= 32) break;
      let index = route.path.length - 1;
      if (mapSelectionState?.type === "point" && mapSelectionState.pathIndex === activeMapPathIndex) index = Math.min(route.path.length - 1, mapSelectionState.index + 1);
      const previous = route.path[Math.max(0, index - 1)];
      const next = route.path[index];
      if (!previous || !next) break;
      mutateMapDraft((draft) => {
        draft.paths[activeMapPathIndex]?.path.splice(index, 0, {
          x: clamp(snapMapCoordinate((previous.x + next.x) / 2), 80, WORLD_WIDTH - 80),
          y: clamp(snapMapCoordinate((previous.y + next.y) / 2), 80, WORLD_HEIGHT - 80),
        });
        draft.path = draft.paths[0]?.path.map((point) => ({ ...point })) ?? draft.path;
        mapSelectionState = { type: "point", pathIndex: activeMapPathIndex, index };
      });
      break;
    }
    case "map-add-zone":
      addMapZone();
      break;
    case "map-add-path-blocker":
      addMapPathBlocker();
      break;
    case "map-select-path-blocker": {
      const id = source?.dataset["blockerId"];
      const blocker = mapDraft?.pathBlockers.find((candidate) => candidate.id === id);
      if (!blocker) break;
      activeMapPathIndex = blocker.pathIndex;
      mapSelectionState = { type: "pathBlocker", id: blocker.id };
      renderMapEditor();
      break;
    }
    case "map-delete-selection":
      if (!mapDraft || !mapSelectionState) break;
      if (mapSelectionState.type === "point") {
        const index = mapSelectionState.index;
        const route = mapDraft.paths[mapSelectionState.pathIndex];
        if (!route || index <= 0 || index >= route.path.length - 1) break;
        const pathIndex = mapSelectionState.pathIndex;
        mutateMapDraft((draft) => { draft.paths[pathIndex]?.path.splice(index, 1); draft.path = draft.paths[0]?.path.map((point) => ({ ...point })) ?? draft.path; });
      } else if (mapSelectionState.type === "zone") {
        const id = mapSelectionState.id;
        mutateMapDraft((draft) => { draft.blockedZones = draft.blockedZones.filter((zone) => zone.id !== id); });
      } else {
        const id = mapSelectionState.id;
        mutateMapDraft((draft) => { draft.pathBlockers = draft.pathBlockers.filter((blocker) => blocker.id !== id); });
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
      if (!mapDraft || !await requestConfirmation({ title: "Reset this map?", copy: "Routes, blocked zones, and path blockers will return to the starter layout.", acceptLabel: "Reset map" })) break;
      const fresh = createCustomMap();
      mutateMapDraft((draft) => {
        draft.enemyRouting = fresh.enemyRouting;
        draft.mapScale = fresh.mapScale;
        draft.paths = fresh.paths.map((route) => ({ ...route, path: route.path.map((point) => ({ ...point })) }));
        draft.path = draft.paths[0]!.path.map((point) => ({ ...point }));
        draft.blockedZones = [];
        draft.pathBlockers = [];
      });
      mapSelectionState = null;
      renderMapEditor();
      break;
    }
    case "map-theme": {
      const theme = MAP_THEME_PRESETS.find((candidate) => candidate.id === source?.dataset["theme"]);
      if (!mapDraft || !theme) break;
      mutateMapDraft((draft) => { draft.palette = { field: theme.field, path: theme.path, accent: theme.accent, blockerOpacity: 0.72 }; });
      break;
    }
    case "select-map":
      if (value) selectMapCard(value as MapKind);
      break;
    case "start-map":
      {
      const missingEnemies = getMissingCustomEnemyIds(selectedMode);
      if (missingEnemies.length > 0) {
        await requestNotice("Mode unavailable", `Import these custom enemies first: ${formatMissingCustomEnemies(missingEnemies)}.`);
        showFrontScreen("modes");
        break;
      }
      enterRun(selectedMap, selectedMode, false);
      break;
      }
    case "main-menu":
      if (shell.classList.contains("run-active") && gameOverPanel.hidden && victoryPanel.hidden) openGameMenu();
      else leaveCurrentRun();
      break;
    case "resume-run":
      closeGameMenu(true);
      break;
    case "leave-run": {
      const multiplayer = Boolean(activeMultiplayerStart);
      const title = multiplayer ? multiplayerSession.role === "host" ? "End this session?" : "Leave this session?" : mapTestActive || modeTestActive ? "Return to the editor?" : "Leave this run?";
      const copy = multiplayer
        ? multiplayerSession.role === "host" ? "The match will end for both players and the guest slot cannot reconnect." : "You will disconnect from the shared battle."
        : "Current run progress will be lost.";
      if (await requestConfirmation({ title, copy, acceptLabel: multiplayer ? multiplayerSession.role === "host" ? "End session" : "Leave session" : mapTestActive || modeTestActive ? "Return to editor" : "Leave run" })) leaveCurrentRun();
      break;
    }
    case "restart-run":
      if (await requestConfirmation({ title: mapTestActive || modeTestActive ? "Restart this test?" : "Restart this run?", copy: "Current run progress will be lost and the battle will restart from wave one.", acceptLabel: mapTestActive || modeTestActive ? "Restart test" : "Restart run" })) {
        overlayState = "none";
        setOverlayVisibility(overlayState);
        runSettled = false;
        inspectorDetailsOpen = false;
        selectionSignature = "";
        game.restart();
      }
      break;
    case "buy-tower":
    case "toggle-loadout":
      handleShopAction(action, value, {
        progress,
        onLoadoutChange: () => {
          game.setAvailableTowers(progress.loadout);
          game.setAvailablePerks(progress.perkLoadout);
        },
        onLog: addLog,
        onAudioConfirm: () => audio.uiConfirm(),
        onAudioError: () => audio.uiError(),
        renderMeta,
      });
      break;
    case "restart":
      if (activeMultiplayerStart) {
        addLog("Multiplayer runs can only be restarted by creating a new host session.", "danger");
        break;
      }
      gameOverPanel.hidden = true;
      victoryPanel.hidden = true;
      runSettled = false;
      inspectorDetailsOpen = false;
      selectionSignature = "";
      game.restart();
      break;
    case "mode-test-wave-previous":
    case "mode-test-wave-next":
      if (!modeTestActive || !value) break;
      gameOverPanel.hidden = true;
      victoryPanel.hidden = true;
      runSettled = false;
      game.debugJumpToWave(Number(value));
      break;
    case "pause":
      game.togglePause();
      break;
    case "buy-perk":
    case "toggle-perk-loadout":
      handleShopAction(action, value, {
        progress,
        onLoadoutChange: () => {
          game.setAvailableTowers(progress.loadout);
          game.setAvailablePerks(progress.perkLoadout);
        },
        onPerkChange: () => {
          persistMultiplayerPlayer();
          renderSetupLoadout();
        },
        onLog: addLog,
        onAudioConfirm: () => audio.uiConfirm(),
        onAudioError: () => audio.uiError(),
        renderMeta,
      });
      break;
    case "skip-wave":
      game.skipWave();
      break;
    case "dismiss-skip-wave":
      game.dismissSkipWave();
      break;
    case "speed":
      game.cycleSpeed();
      break;
    case "sound-settings":
      setAudioPanelOpen(overlayState !== "settings");
      break;
    case "choose-graphics-preset":
      if (!value || !GRAPHICS_PRESET_VALUES.includes(value as UiPreferences["effectsQuality"])) break;
      await updateGraphicsPreset(value as UiPreferences["effectsQuality"]);
      if (desktopEnvironment?.version) markGraphicsPresetPromptSeen(desktopEnvironment.version);
      graphicsSetupOverlay.hidden = true;
      audio.uiConfirm();
      break;
    case "confirm-cancel":
      finishConfirmation(false);
      break;
    case "confirm-accept":
      finishConfirmation(true);
      break;
    case "audio-settings-close":
      setAudioPanelOpen(false);
      break;
    case "audio-reset":
      audio.resetSettings();
      renderAudioSettings();
      game.refreshAudioState();
      audio.uiConfirm();
      setSaveStatus("Audio mix reset to defaults.", "good");
      break;
    case "ui-reset":
      await updateUiPreferences({ ...DEFAULT_UI_PREFERENCES, displayMode: uiPreferences.displayMode });
      setSaveStatus("Display and comfort settings reset.", "good");
      break;
    case "settings-reset-all":
      audio.resetSettings();
      await updateUiPreferences({ ...DEFAULT_UI_PREFERENCES }, true);
      renderAudioSettings();
      game.refreshAudioState();
      setSaveStatus("All device settings reset.", "good");
      break;
    case "debug":
      game.releaseMechaInput();
      if (overlayState === "settings") setAudioPanelOpen(false);
      debugPanel.hidden = !debugPanel.hidden;
      break;
    case "debug-close":
      debugPanel.hidden = true;
      break;
    case "debug-copy-repro":
      await copySimulationReplay();
      break;
    case "debug-export-repro":
      exportSimulationReplay();
      break;
    case "debug-copy-state":
      await copyDebugSnapshot();
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
    case "debug-add-coins":
      changeDebugCurrency("coins", Number(source?.dataset["debugAmount"] ?? 0));
      break;
    case "debug-add-tokens":
      changeDebugCurrency("tokens", Number(source?.dataset["debugAmount"] ?? 0));
      break;
    case "debug-max-wallet":
      maxDebugWallet();
      break;
    case "debug-reset-wallet":
      if (await requestConfirmation({ title: "Reset shop wallet?", copy: "Coins and Tokens will be set to zero. Tower and perk unlocks will remain intact.", acceptLabel: "Reset wallet" })) {
        progress.coins = 0;
        progress.tokens = 0;
        saveDebugProfile("Wallet reset to zero // unlocks were preserved.");
        addLog("Debug // shop wallet reset. Unlocks were preserved.", "good");
        audio.uiConfirm();
      }
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
      progress.loadout = [...TOWER_ORDER].slice(0, 5);
      saveDebugProfile("All towers unlocked and the first five slots equipped.");
      game.setAvailableTowers(progress.loadout);
      addLog("Debug // all towers unlocked and the first five loadout slots filled.", "good");
      audio.uiConfirm();
      break;
    case "debug-unlock-perks":
      unlockAllDebugPerks(false);
      break;
    case "debug-equip-perks":
      unlockAllDebugPerks(true);
      break;
    case "debug-reload-profile":
      progress = loadProgress();
      game.setAvailableTowers(progress.loadout);
      game.setAvailablePerks(progress.perkLoadout);
      renderMeta();
      addLog("Debug // profile reloaded from local storage.", "good");
      audio.uiConfirm();
      break;
    case "debug-speed":
      game.cycleSpeed();
      break;
    case "debug-jump-wave":
      game.debugJumpToWave(Number(query<HTMLInputElement>("#debug-wave-input").value));
      break;
    case "debug-reset-progress":
      if (!await requestConfirmation({ title: "Reset progression?", copy: "Coins, Tokens, tower unlocks, loadout changes, victories, runs, and map clears will be removed. Creator content will be kept.", acceptLabel: "Reset progression" })) break;
      progress = resetProgress();
      game.setAvailableTowers(progress.loadout);
      game.setAvailablePerks(progress.perkLoadout);
      renderMeta();
      debugPanel.hidden = true;
      addLog("Debug // progression reset. Creator content was preserved.", "good");
      setSaveStatus("Progression reset // creator content preserved.", "good");
      break;
    case "counter":
      game.counterSelected();
      break;
    case "toggle-auto-counter":
      game.toggleSelectedAutoCounter();
      break;
    case "ability":
      game.activateSelectedAbility((source?.dataset["slot"] ?? value ?? "f") as TowerAbilitySlot);
      break;
    case "toggle-mecha-control":
      game.toggleSelectedMechaControl();
      break;
    case "cancel-aim":
      game.cancelAimSelected();
      break;
    case "cancel-move":
      game.cancelPlacement();
      break;
    case "sell":
      game.sellSelected();
      break;
    case "move":
      game.startMoveSelected();
      break;
    case "close-inspector":
      inspectorSuppressed = true;
      if (latestUiState) render(latestUiState);
      selectedPill.focus({ preventScroll: true });
      break;
    case "dismiss-boss": {
      const bossId = Number(source?.dataset["bossId"] ?? value);
      if (!Number.isInteger(bossId)) break;
      dismissedBossIds = dismissBossHudEntry(dismissedBossIds, bossId);
      if (latestUiState) render(latestUiState);
      break;
    }
    case "reopen-inspector":
      inspectorSuppressed = false;
      if (latestUiState) render(latestUiState);
      towerInspector.querySelector<HTMLButtonElement>("[data-testid=mecha-control-toggle]:not(:disabled), .inspector-close")?.focus({ preventScroll: true });
      break;
    case "toggle-inspector-details":
      inspectorDetailsOpen = !inspectorDetailsOpen;
      selectionSignature = "";
      if (latestUiState) renderSelection(latestUiState);
      window.requestAnimationFrame(() => query<HTMLElement>("[data-testid='inspector-telemetry-trigger']").focus());
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
  if (inspectorDetailsOpen && !target.closest("[data-inspector-popover-card='telemetry']")) {
    inspectorDetailsOpen = false;
    selectionSignature = "";
    if (latestUiState) renderSelection(latestUiState);
  }
  const actionable = target.closest<HTMLElement>("[data-action], [data-kind]");
  if (!actionable) return;
  void audio.unlock();
  const kind = actionable.dataset["kind"];
  const targeting = actionable.dataset["targeting"];
  const value = targeting ?? kind ?? actionable.dataset["map"] ?? actionable.dataset["towerKind"] ?? actionable.dataset["perkKind"] ?? actionable.dataset["testWaveTarget"] ?? actionable.dataset["preset"] ?? actionable.dataset["bossId"];
  const action = actionable.dataset["action"] ?? (kind ? "select" : "");
  if (action !== "sound-settings" && action !== "audio-settings-close" && action !== "audio-reset") audio.uiClick();
  void runAction(action, value, actionable);
});

// Give interactive controls a quiet, low-mid tick on entry. This is delegated
// so controls rendered by the creator/editor screens get the same feedback.
app.addEventListener("pointerover", (event) => {
  const target = event.target as HTMLElement;
  const interactive = target.closest<HTMLElement>("button, a, select, input[type='range'], [data-action], [data-kind]");
  if (!interactive || interactive.matches(":disabled") || interactive.getAttribute("aria-disabled") === "true") return;
  if (event.relatedTarget instanceof Node && interactive.contains(event.relatedTarget)) return;
  void audio.unlock();
  audio.uiHover();
});

window.addEventListener("pointerdown", (event) => {
  if (audioSettingsPanel.hidden) return;
  if (event.target === audioSettingsPanel) setAudioPanelOpen(false);
});

app.addEventListener("submit", (event) => {
  const form = event.target as HTMLFormElement;
  if (!form.matches(".creator-folder-editor")) return;
  event.preventDefault();
  void runAction("folder-editor-save", undefined, form);
});

app.addEventListener("input", (event) => {
  const field = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const uiPreference = field.dataset["uiPreference"];
  if (uiPreference) {
    if (uiPreference === "uiScale") void updateUiPreferences({ uiScale: Number(field.value) as UiPreferences["uiScale"] });
    else if (uiPreference === "displayMode") void updateUiPreferences({ displayMode: field.value as UiPreferences["displayMode"] }, true);
    else if (uiPreference === "effectsQuality") void updateGraphicsPreset(field.value as UiPreferences["effectsQuality"]);
    else if (uiPreference === "motion") void updateManualGraphicsPreferences({ motion: field.value as UiPreferences["motion"] });
    else if (uiPreference === "screenShake") void updateManualGraphicsPreferences({ screenShake: Number(field.value) });
    else if (uiPreference === "scanlineIntensity") void updateManualGraphicsPreferences({ scanlineIntensity: Number(field.value) });
    else if (uiPreference === "canvasResolution") void updateManualGraphicsPreferences({ canvasResolution: Number(field.value) });
    else if (uiPreference === "particleDensity") void updateManualGraphicsPreferences({ particleDensity: Number(field.value) });
    else if (uiPreference === "projectileDensity") void updateManualGraphicsPreferences({ projectileDensity: Number(field.value) });
    else if (uiPreference === "interfaceBlur" && field instanceof HTMLInputElement) void updateManualGraphicsPreferences({ interfaceBlur: field.checked });
    else if (uiPreference === "ambientEffects" && field instanceof HTMLInputElement) void updateManualGraphicsPreferences({ ambientEffects: field.checked });
    else if (uiPreference === "menuAtmosphere" && field instanceof HTMLInputElement) void updateManualGraphicsPreferences({ menuAtmosphere: field.checked });
    else if (uiPreference === "interfaceShadows" && field instanceof HTMLInputElement) void updateManualGraphicsPreferences({ interfaceShadows: field.checked });
    else if (uiPreference === "interfaceAnimations" && field instanceof HTMLInputElement) void updateManualGraphicsPreferences({ interfaceAnimations: field.checked });
    else if (uiPreference === "canvasGlow" && field instanceof HTMLInputElement) void updateManualGraphicsPreferences({ canvasGlow: field.checked });
    return;
  }
  const isCreatorNumberField = field instanceof HTMLInputElement && field.type === "number" && (
    field.dataset["mapField"] !== undefined ||
    field.dataset["mapBlockerField"] !== undefined ||
    field.dataset["mapPathField"] !== undefined ||
    field.dataset["enemyField"] !== undefined ||
    field.dataset["enemyAttackField"] !== undefined ||
    field.dataset["enemyAttackEffect"] !== undefined ||
    field.dataset["enemyAttackVisual"] !== undefined ||
    field.dataset["behaviorRuleField"] !== undefined ||
    field.dataset["behaviorActionField"] !== undefined ||
    field.dataset["modeField"] !== undefined ||
    field.dataset["waveField"] !== undefined ||
    field.dataset["blockField"] !== undefined
  );
  // These panels re-render after applying a value. Wait for change/blur so
  // typing a multi-digit number does not replace the field mid-entry.
  if (isCreatorNumberField && event.isTrusted) return;
  if (field.id === "multiplayer-color" || field.id === "multiplayer-username") {
    persistMultiplayerPlayer(field.id === "multiplayer-username");
    if (multiplayerSession.connected) multiplayerSession.sendControl({ type: "hello", player: localMultiplayerPlayer, gameVersion: GAME_VERSION });
    return;
  }
  if (field.id === "multiplayer-room-code") {
    renderMultiplayerRoomCode();
    return;
  }
  const audioBus = field.dataset["audioVolume"];
  if (isAudioBus(audioBus)) {
    audio.setVolume(audioBus, Number(field.value));
    renderAudioSettings();
    game.refreshAudioState();
    audio.uiClick();
    return;
  }
  const balancePath = field.dataset["balancePath"];
  if (balanceDraft && balancePath) {
    const value = Number(field.value);
    if (Number.isFinite(value)) {
      setBalanceValueAtPath(balanceDraft, balancePath, value);
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
    else if (mapField === "enemyRouting" && (field.value === "split" || field.value === "multiply")) mapDraft.enemyRouting = field.value;
    else if (mapField === "mapScale") {
      const value = Number(field.value);
      if (!Number.isFinite(value)) return;
      mapDraft.mapScale = clamp(value, MAP_SCALE_MIN, MAP_SCALE_MAX);
    }
    else if (mapField === "field" || mapField === "path" || mapField === "accent") mapDraft.palette[mapField] = field.value;
    else if (mapField === "blockerOpacity") {
      mapDraft.palette.blockerOpacity = clamp(Number(field.value) || mapDraft.palette.blockerOpacity, 0.15, 1);
      query<HTMLOutputElement>("#map-blocker-opacity-value").textContent = `${Math.round(mapDraft.palette.blockerOpacity * 100)}%`;
      drawMapEditor();
      return;
    }
    renderMapEditor();
    return;
  }
  const mapBlockerField = field.dataset["mapBlockerField"];
  if (mapDraft && mapBlockerField) {
    const blockerId = field.dataset["blockerId"];
    const blockerIndex = mapDraft.pathBlockers.findIndex((candidate) => candidate.id === blockerId);
    const blocker = mapDraft.pathBlockers[blockerIndex];
    if (!blocker || blockerIndex < 0) return;
    let pathIndex = blocker.pathIndex;
    if (mapBlockerField === "pathIndex") pathIndex = clamp(Math.round(Number(field.value) || 0), 0, mapDraft.paths.length - 1);
    const route = mapDraft.paths[pathIndex];
    if (!route) return;
    const routeLength = new Polyline(route.path).totalLength;
    const length = clamp(mapBlockerField === "length" ? Number(field.value) || blocker.length : blocker.length, PATH_BLOCKER_LENGTH_MIN, Math.min(PATH_BLOCKER_LENGTH_MAX, routeLength));
    const startDistance = clamp(mapBlockerField === "startDistance" ? Number(field.value) || blocker.startDistance : blocker.startDistance, 0, Math.max(0, routeLength - length));
    mapDraft.pathBlockers[blockerIndex] = { ...blocker, pathIndex, startDistance, length };
    activeMapPathIndex = pathIndex;
    mapSelectionState = { type: "pathBlocker", id: blocker.id };
    renderMapEditor();
    return;
  }
  const mapPathField = field.dataset["mapPathField"];
  if (mapDraft && mapPathField) {
    const pathIndex = Number(field.dataset["pathIndex"]);
    const route = mapDraft.paths[pathIndex];
    if (!route || !Number.isInteger(pathIndex)) return;
    activeMapPathIndex = pathIndex;
    if (mapPathField === "width") route.width = clamp(Number(field.value) || route.width, MAP_PATH_WIDTH_MIN, MAP_PATH_WIDTH_MAX);
    else if (mapPathField === "pathOpacity") {
      route.pathOpacity = clamp(Number(field.value) || 1, 0.1, 1);
      const output = query<HTMLOutputElement>(`[data-map-path-opacity-value='${pathIndex}']`);
      output.textContent = `${Math.round(route.pathOpacity * 100)}%`;
      drawMapEditor();
      return;
    }
    else if (mapPathField === "pathType") {
      if (field.value !== "round" && field.value !== "sharp" && field.value !== "rubble") return;
      route.pathType = field.value;
      if (route.pathType === "rubble") route.pathSurface = "solid";
    }
    else if (mapPathField === "pathSurface") {
      if (field.value !== "solid" && field.value !== "edges" || route.pathType === "rubble") return;
      route.pathSurface = field.value;
    }
    else if (mapPathField === "entryEdge" || mapPathField === "exitEdge") {
      const edge = field.value as MapEdge;
      if (edge !== "left" && edge !== "right" && edge !== "top" && edge !== "bottom") return;
      checkpointMapDraft();
      if (mapPathField === "entryEdge") {
        const current = route.path[0];
        if (current) { const position = terminalPosition(route.entryEdge, current); route.entryEdge = edge; route.path[0] = terminalPoint(edge, position); }
      } else {
        const current = route.path[route.path.length - 1];
        if (current) { const position = terminalPosition(route.exitEdge, current); route.exitEdge = edge; route.path[route.path.length - 1] = terminalPoint(edge, position); }
      }
    }
    mapDraft.entryEdge = mapDraft.paths[0]!.entryEdge;
    mapDraft.exitEdge = mapDraft.paths[0]!.exitEdge;
    mapDraft.path = mapDraft.paths[0]!.path.map((point) => ({ ...point }));
    renderMapEditor();
    return;
  }
  const behaviorRuleField = field.dataset["behaviorRuleField"];
  const behaviorActionField = field.dataset["behaviorActionField"];
  if (enemyDraft && (behaviorRuleField || behaviorActionField)) {
    const ruleIndex = Number(field.dataset["behaviorRuleIndex"]);
    const rule = enemyDraft.behaviorRules[ruleIndex];
    if (!rule) return;
    if (behaviorRuleField) {
      if (behaviorRuleField === "name") rule.name = field.value.slice(0, 40);
      else if (["minHp", "maxHp", "minAliveTime", "maxAliveTime"].includes(behaviorRuleField)) {
        const maximum = behaviorRuleField.includes("Hp") ? 10_000_000 : 86_400;
        (rule as unknown as Record<string, unknown>)[behaviorRuleField] = field.value === "" ? null : clamp(Number(field.value) || 0, 0, maximum);
      } else if (behaviorRuleField === "cooldown") rule.cooldown = clamp(Number(field.value) || 0.1, 0.1, 600);
      else if (behaviorRuleField === "maxUses") rule.maxUses = clamp(Math.round(Number(field.value) || 0), 0, 999);
      return;
    }
    const actionIndex = Number(field.dataset["behaviorActionIndex"]);
    const action = rule.actions[actionIndex];
    if (!action || !behaviorActionField) return;
    if (behaviorActionField === "type") {
      if (["stop", "invulnerable", "regenerate", "stomp", "stat-change", "blink"].includes(field.value)) {
        rule.actions[actionIndex] = createCustomEnemyBehaviorAction(field.value as EnemyBehaviorActionType);
        renderBehaviorRules();
      }
      return;
    }
    const number = Number(field.value);
    const maximum = behaviorActionField === "amount" ? 10_000_000 : behaviorActionField === "damage" ? 1_000_000 : behaviorActionField === "radius" || behaviorActionField === "distance" ? 1000 : behaviorActionField.includes("Multiplier") ? 10 : 600;
    const minimum = behaviorActionField === "duration" ? 0.1 : behaviorActionField === "radius" ? 20 : behaviorActionField === "distance" ? 5 : 0;
    (action as unknown as Record<string, unknown>)[behaviorActionField] = clamp(number || minimum, minimum, maximum);
    return;
  }
  if (field.id === "summon-enemy-search") {
    const q = field.value.trim().toLowerCase();
    query<HTMLElement>("#summon-enemy-options").querySelectorAll<HTMLLabelElement>("label").forEach((label) => {
      const text = label.textContent?.toLowerCase() ?? "";
      const kind = label.querySelector("input")?.dataset["summonKind"]?.toLowerCase() ?? "";
      label.style.display = !q || text.includes(q) || kind.includes(q) ? "" : "none";
    });
    return;
  }
  if (field.id === "enemy-drawing-size") {
    query<HTMLOutputElement>("#enemy-drawing-size-value").textContent = `${field.value} PX`;
    updateDrawingCursor();
    return;
  }
  if (field.id === "enemy-drawing-opacity") {
    query<HTMLOutputElement>("#enemy-drawing-opacity-value").textContent = `${field.value}%`;
    updateDrawingCursor();
    return;
  }
  if (field.id === "enemy-drawing-hardness") {
    query<HTMLOutputElement>("#enemy-drawing-hardness-value").textContent = `${field.value}%`;
    updateDrawingCursor();
    return;
  }
  if (field.id === "enemy-drawing-render-mode") {
    updateDrawingCursor();
    return;
  }
  if (field.id === "enemy-drawing-tool") {
    if (["brush", "eraser", "fill", "pan"].includes(field.value)) drawingTool = field.value as typeof drawingTool;
    renderDrawingToolState();
    return;
  }
  if (field.id === "enemy-drawing-resolution" || field.id === "enemy-crop-resolution") {
    const value = Number(field.value) === 256 ? 256 : 128;
    setDrawingResolution(value, true);
    if (cropModalOpen && cropImage) drawCropCanvas();
    return;
  }
  if (field.id === "enemy-drawing-color") {
    drawingBrushColor = field.value;
    updateDrawingCursor();
    return;
  }

  const enemyAttackField = field.dataset["enemyAttackField"];
  const enemyAttackEffectField = field.dataset["enemyAttackEffect"];
  const enemyAttackVisualField = field.dataset["enemyAttackVisual"];
  if (enemyDraft && (enemyAttackField || enemyAttackEffectField || enemyAttackVisualField)) {
    const attackIndex = Number(field.dataset["attackIndex"]);
    const attack = enemyDraft.attacks[attackIndex];
    if (!attack) return;
    if (enemyAttackField) {
      const key = enemyAttackField as keyof typeof attack;
      const record = attack as unknown as Record<string, unknown>;
      if (enemyAttackField === "name") record[key] = field.value.slice(0, 40);
      else if (enemyAttackField === "targeting" && ["first", "last", "strongest", "weakest", "closest"].includes(field.value)) record[key] = field.value;
      else if (enemyAttackField === "delivery" && ["ranged", "wave", "forward"].includes(field.value)) record[key] = field.value;
      else if (["minHp", "maxHp", "minAliveTime", "maxAliveTime"].includes(enemyAttackField)) record[key] = field.value === "" ? null : clamp(Number(field.value) || 0, 0, enemyAttackField.includes("Hp") ? 10_000_000 : 86_400);
      else if (enemyAttackField === "cooldown") record[key] = clamp(Number(field.value) || 0.1, 0.1, 600);
      else if (enemyAttackField === "maxUses" || enemyAttackField === "maxTargets") record[key] = Math.round(clamp(Number(field.value) || (enemyAttackField === "maxTargets" ? 1 : 0), enemyAttackField === "maxTargets" ? 1 : 0, enemyAttackField === "maxTargets" ? 64 : 999));
      else if (enemyAttackField === "range") record[key] = clamp(Number(field.value) || 20, 20, 2000);
      else if (enemyAttackField === "width") record[key] = clamp(Number(field.value) || 4, 4, 1000);
      else if (enemyAttackField === "depth") record[key] = clamp(Number(field.value) || 4, 4, 2000);
      else if (enemyAttackField === "angle") record[key] = clamp(Number(field.value) || 5, 5, 180);
      else if (enemyAttackField === "projectileSpeed") record[key] = clamp(Number(field.value) || 40, 40, 2000);
      return;
    }
    if (enemyAttackEffectField) {
      const effectIndex = Number(field.dataset["effectIndex"]);
      const effects = attack.effects as EnemyAttackEffectDefinition[];
      const effect = effects[effectIndex];
      if (!effect) return;
      if (enemyAttackEffectField === "type") {
        effects[effectIndex] = field.value === "stun" ? { type: "stun", duration: 1 } : { type: "damage", amount: 20 };
        renderEnemyAttacks();
      } else if (effect.type === "damage" && enemyAttackEffectField === "amount") effects[effectIndex] = { type: "damage", amount: clamp(Number(field.value) || 0, 0, 1_000_000) };
      else if (effect.type === "stun" && enemyAttackEffectField === "duration") effects[effectIndex] = { type: "stun", duration: clamp(Number(field.value) || 0, 0, 60) };
      return;
    }
    const visualIndex = Number(field.dataset["visualIndex"]);
    const visuals = attack.visuals as Array<{ type: EnemyAttackVisualType; color: string; size: number; width: number; duration: number; speed: number }>;
    const visual = visuals[visualIndex];
    if (!visual) return;
    if (enemyAttackVisualField === "type" && ["projectile", "beam", "explosion", "lightning", "wave", "slash"].includes(field.value)) {
      visual.type = field.value as EnemyAttackVisualType;
      renderEnemyAttacks();
    } else if (enemyAttackVisualField === "color" && /^#[0-9a-f]{6}$/i.test(field.value)) visual.color = field.value.toLowerCase();
    else if (enemyAttackVisualField === "size") visual.size = clamp(Number(field.value) || 0.1, 0.1, 10);
    else if (enemyAttackVisualField === "width") visual.width = clamp(Number(field.value) || 0.5, 0.5, 100);
    else if (enemyAttackVisualField === "duration") visual.duration = clamp(Number(field.value) || 0.05, 0.05, 10);
    else if (enemyAttackVisualField === "speed") visual.speed = clamp(Number(field.value) || 40, 40, 2000);
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
    else if (enemyField === "opacity") {
      enemyDraft.opacity = clamp(number / 100, 0, 1);
      query<HTMLOutputElement>("#enemy-opacity-value").textContent = `${Math.round(enemyDraft.opacity * 100)}%`;
    }
    else if (enemyField === "sides") enemyDraft.sides = Math.max(3, Math.min(12, Math.round(number || 3)));
    else if (enemyField === "hp") enemyDraft.hp = Math.max(1, Math.min(10_000_000, Math.round(number || 1)));
    else if (enemyField === "shieldHp") enemyDraft.shieldHp = Math.max(0, Math.min(10_000_000, Math.round(number || 0)));
    else if (enemyField === "speed") enemyDraft.speed = Math.max(1, Math.min(500, number || 1));
    else if (enemyField === "damage") enemyDraft.damage = Math.max(0, Math.min(1_000_000, Math.round(number || 0)));
    else if (enemyField === "attackInterval") enemyDraft.attackInterval = Math.max(0.1, Math.min(120, number || 0.1));
    else if (enemyField === "telegraphDuration") enemyDraft.telegraphDuration = Math.max(0.05, Math.min(30, number || 0.05));
    else if (enemyField === "coreDamage") enemyDraft.coreDamage = Math.max(0, Math.min(9999, Math.round(number || 0)));
    else if (enemyField === "radius") enemyDraft.radius = Math.max(6, Math.min(60, number || 6));
    else if (enemyField === "defense") enemyDraft.defense = Math.max(0, Math.min(1_000_000, number || 0));
    else if (enemyField === "protection") enemyDraft.protection = Math.max(0, Math.min(999, Math.round(number || 0)));
    else if (enemyField === "armor") enemyDraft.armor = clamp((number || 0) / 100, 0, 1);
    else if (enemyField === "superarmor") enemyDraft.superarmor = clamp((number || 0) / 100, 0, 1);
    else if (enemyField?.startsWith("resistance_")) {
      const type = enemyField.replace(/^resistance_/, "");
      enemyDraft.resistances ??= { ...DEFAULT_ENEMY_RESISTANCES };
      enemyDraft.resistances[type] = Math.min(1, (number || 0) / 100);
    }
    else if (enemyField === "hidden" && field instanceof HTMLInputElement) enemyDraft.hidden = field.checked;
    else if (enemyField === "boss" && field instanceof HTMLInputElement) enemyDraft.boss = field.checked;
    else if (enemyField === "timeLockEnabled" && field instanceof HTMLInputElement) enemyDraft.timeLockEnabled = field.checked;
    else if (enemyField === "waveLockEnabled" && field instanceof HTMLInputElement) enemyDraft.waveLockEnabled = field.checked;
    else if (enemyField === "summoningEnabled" && field instanceof HTMLInputElement) enemyDraft.summoningEnabled = field.checked;
    else if (enemyField === "stunningEnabled" && field instanceof HTMLInputElement) enemyDraft.stunningEnabled = field.checked;
    else if (enemyField === "regenerationEnabled" && field instanceof HTMLInputElement) enemyDraft.regenerationEnabled = field.checked;
    else if (enemyField === "hasteEnabled" && field instanceof HTMLInputElement) enemyDraft.hasteEnabled = field.checked;
    else if (enemyField === "drainEnabled" && field instanceof HTMLInputElement) enemyDraft.drainEnabled = field.checked;
    else if (enemyField === "phaseEnabled" && field instanceof HTMLInputElement) enemyDraft.phaseEnabled = field.checked;
    else if (enemyField === "blinkEnabled" && field instanceof HTMLInputElement) enemyDraft.blinkEnabled = field.checked;
    else if (enemyField === "summonInterval") enemyDraft.summonInterval = Math.max(0.2, Math.min(600, number || 0.2));
    else if (enemyField === "summonCount") enemyDraft.summonCount = Math.max(1, Math.min(100, Math.round(number || 1)));
    else if (enemyField === "summonHitCashMultiplier") enemyDraft.summonHitCashMultiplier = clamp(number || 0, 0, 10);
    else if (enemyField === "summonHpMultiplier") enemyDraft.summonHpMultiplier = clamp(number || 0, 0, 10);
    else if (enemyField === "summonShieldMultiplier") enemyDraft.summonShieldMultiplier = clamp(number || 0, 0, 10);
    else if (enemyField === "summonSpeedMultiplier") enemyDraft.summonSpeedMultiplier = clamp(number || 0, 0, 10);
    else if (enemyField === "summonDamageMultiplier") enemyDraft.summonDamageMultiplier = clamp(number || 0, 0, 10);
    else if (enemyField === "summonAttackIntervalMultiplier") enemyDraft.summonAttackIntervalMultiplier = clamp(number || 0.1, 0.1, 10);
    else if (enemyField === "summonCoreDamageMultiplier") enemyDraft.summonCoreDamageMultiplier = clamp(number || 0, 0, 10);
    else if (enemyField === "summonDefenseBonus") enemyDraft.summonDefenseBonus = clamp(number || 0, -1_000_000, 1_000_000);
    else if (enemyField === "summonProtectionBonus") enemyDraft.summonProtectionBonus = clamp(Math.round(number || 0), -999, 999);
    else if (enemyField === "summonArmorBonus") enemyDraft.summonArmorBonus = clamp((number || 0) / 100, -1, 1);
    else if (enemyField === "summonSuperarmorBonus") enemyDraft.summonSuperarmorBonus = clamp((number || 0) / 100, -1, 1);
    else if (enemyField === "timeLockDistance") enemyDraft.timeLockDistance = clamp(number || 0, 0, 2000);
    else if (enemyField === "timeLockDuration") enemyDraft.timeLockDuration = clamp(number || 0.1, 0.1, 600);
    else if (enemyField === "waveLockDistance") enemyDraft.waveLockDistance = clamp(number || 0, 0, 2000);
    else if (enemyField === "waveLockWaves") enemyDraft.waveLockWaves = clamp(Math.round(number || 1), 1, 999);
    else if (enemyField === "stunInterval") enemyDraft.stunInterval = Math.max(0.2, Math.min(600, number || 0.2));
    else if (enemyField === "stunRadius") enemyDraft.stunRadius = Math.max(20, Math.min(1000, number || 20));
    else if (enemyField === "stunDuration") enemyDraft.stunDuration = Math.max(0.1, Math.min(60, number || 0.1));
    else if (enemyField === "regenerationRate") enemyDraft.regenerationRate = Math.max(0.1, Math.min(1_000_000, number || 0.1));
    else if (enemyField === "hasteInterval") enemyDraft.hasteInterval = Math.max(0.2, Math.min(600, number || 0.2));
    else if (enemyField === "hasteRadius") enemyDraft.hasteRadius = Math.max(20, Math.min(1000, number || 20));
    else if (enemyField === "hasteDuration") enemyDraft.hasteDuration = Math.max(0.1, Math.min(60, number || 0.1));
    else if (enemyField === "hasteMultiplier") enemyDraft.hasteMultiplier = Math.max(1, Math.min(5, number || 1));
    else if (enemyField === "drainInterval") enemyDraft.drainInterval = Math.max(0.2, Math.min(600, number || 0.2));
    else if (enemyField === "drainRadius") enemyDraft.drainRadius = Math.max(20, Math.min(1000, number || 20));
    else if (enemyField === "drainDamage") enemyDraft.drainDamage = Math.max(0, Math.min(1_000_000, Math.round(number || 0)));
    else if (enemyField === "drainHealing") enemyDraft.drainHealing = Math.max(0, Math.min(1_000_000, Math.round(number || 0)));
    else if (enemyField === "phaseInterval") enemyDraft.phaseInterval = Math.max(0.2, Math.min(600, number || 0.2));
    else if (enemyField === "phaseDuration") enemyDraft.phaseDuration = Math.max(0.1, Math.min(60, number || 0.1));
    else if (enemyField === "blinkInterval") enemyDraft.blinkInterval = Math.max(0.2, Math.min(600, number || 0.2));
    else if (enemyField === "blinkDistance") enemyDraft.blinkDistance = Math.max(5, Math.min(1000, number || 5));

    if (enemyField === "summoningEnabled" || enemyField === "stunningEnabled" || enemyField === "regenerationEnabled" || enemyField === "hasteEnabled" || enemyField === "drainEnabled" || enemyField === "phaseEnabled" || enemyField === "blinkEnabled" || enemyField === "timeLockEnabled" || enemyField === "waveLockEnabled") {
      renderEnemyCreator();
      return;
    }
    query<HTMLElement>("#enemy-sides-value").textContent = enemyDraft.sides.toString();
    drawEnemyCreatorPreview();
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
  else if (modeField === "multiplayerHitCashMultiplier") {
    const percent = clamp(Number(field.value) || 0, 0, 100);
    creatorDraft.multiplayerHitCashMultiplier = percent / 100;
    query<HTMLOutputElement>("#multiplayer-hitcash-value").textContent = `${Math.round(percent)}% // $${(creatorDraft.multiplayerHitCashMultiplier * ECONOMY_RULES.damageCashPerHp).toFixed(2)} PER 1 DAMAGE`;
  }

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
  else if (blockField === "spawnPathIndex") {
    const rawVal = Math.max(1, Math.round(Number(field.value) || 1));
    block.spawnPathIndex = rawVal - 1;
    const parent = field.closest(".block-path-field");
    const small = parent?.querySelector("small");
    if (small) small.textContent = `Path ${rawVal}`;
  }
});

app.addEventListener("change", (event) => {
  const field = event.target as HTMLInputElement | HTMLSelectElement;
  if (field.id === "enemy-drawing-tool") {
    if (["brush", "eraser", "fill", "pan"].includes(field.value)) drawingTool = field.value as typeof drawingTool;
    renderDrawingToolState();
    return;
  }
  if (field.id === "enemy-drawing-resolution" || field.id === "enemy-crop-resolution") {
    const value = Number(field.value) === 256 ? 256 : 128;
    setDrawingResolution(value, true);
    if (cropModalOpen && cropImage) drawCropCanvas();
    return;
  }
  if (field instanceof HTMLSelectElement && field.dataset["modeTestWave"] !== undefined) {
    if (modeTestActive) {
      gameOverPanel.hidden = true;
      victoryPanel.hidden = true;
      runSettled = false;
      game.debugJumpToWave(Number(field.value));
    }
    return;
  }
  if (field instanceof HTMLSelectElement && field.dataset["modeTestMap"] !== undefined) {
    const map = getMapDefinition(field.value);
    if (map) saveModeTestMapKind(map.kind);
    return;
  }
  if (field instanceof HTMLInputElement && field.type === "number" && (
    field.dataset["mapField"] !== undefined ||
    field.dataset["mapBlockerField"] !== undefined ||
    field.dataset["mapPathField"] !== undefined ||
    field.dataset["enemyField"] !== undefined ||
    field.dataset["enemyAttackField"] !== undefined ||
    field.dataset["enemyAttackEffect"] !== undefined ||
    field.dataset["enemyAttackVisual"] !== undefined ||
    field.dataset["behaviorRuleField"] !== undefined ||
    field.dataset["behaviorActionField"] !== undefined ||
    field.dataset["modeField"] !== undefined ||
    field.dataset["waveField"] !== undefined ||
    field.dataset["blockField"] !== undefined
  )) {
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  if (field instanceof HTMLInputElement && field.dataset["audioEnabled"] !== undefined) {
    audio.setSettings({ enabled: field.checked });
    renderAudioSettings();
    game.refreshAudioState();
    if (field.checked) audio.uiConfirm();
    return;
  }
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
  if (field instanceof HTMLInputElement && field.dataset["blockField"] === "customPathToggle") {
    const wave = creatorDraft?.waves[creatorWaveIndex];
    const block = wave?.blocks[Number(field.dataset["blockIndex"])];
    if (block) {
      block.spawnPathIndex = field.checked ? 0 : undefined;
      renderCreator();
    }
    return;
  }
  if (creatorDraft && (field.dataset["blockField"] === "nextBlockDelay" || field.dataset["blockField"] === "spawnPathIndex")) renderCreator();
});

query<HTMLInputElement>("#save-import-input").addEventListener("change", async (event) => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const parsed = sanitizeSaveBundle(JSON.parse(await file.text()));
    if (!parsed) {
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
    game.setAvailablePerks(progress.perkLoadout);
    selectedMode = NORMAL_MODE;
    selectedMap = MAP_DEFINITIONS.sector07;
    renderMeta();
    renderModeList();
    renderMapLibrary();
    setSaveStatus(
      written ? "Backup imported into the desktop save." : "Backup imported for this session only.",
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


battleChatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = battleChatInput.value;
  battleChatInput.value = "";
  battleChatInput.blur();
  if (text.trim()) sendChatMessage(text);
});

battleChatInput.addEventListener("keydown", (event) => {
  event.stopPropagation();
  if (event.key === "Escape") {
    event.preventDefault();
    battleChatInput.blur();
  }
});

ingameChatToast.addEventListener("click", () => {
  dismissChatToast();
  setInGameChatState("expanded");
  battleChatInput.focus();
});

lobbyChatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = lobbyChatInput.value;
  lobbyChatInput.value = "";
  if (text.trim()) sendChatMessage(text);
});

lobbyChatInput.addEventListener("keydown", (event) => {
  event.stopPropagation();
});

window.addEventListener("keydown", (event) => {
  const movementKey = event.key.toLowerCase();
  const editing = event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest("input, textarea, select") !== null);
  if (!editing && event.key === "Enter" && shell.classList.contains("run-active") && multiplayerSession.connected && overlayState === "none") {
    event.preventDefault();
    if (inGameChatStore.getState() !== "expanded") {
      setInGameChatState("expanded");
    }
    battleChatInput.focus();
    return;
  }
  if (!editing && !event.ctrlKey && !event.metaKey && !event.altKey && overlayState === "none" && debugPanel.hidden && ["w", "a", "s", "d"].includes(movementKey) && game.setMechaMovementKey(movementKey, true)) {
    event.preventDefault();
    return;
  }
  if (event.repeat) return;
  if (drawingModalOpen && event.key === "Tab") {
    const controls = [...enemyDrawingOverlay.querySelectorAll<HTMLElement>("button:not(:disabled), select, input")].filter((element) => !element.hidden);
    if (controls.length > 0) {
      event.preventDefault();
      const current = controls.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (current <= 0 ? controls.length - 1 : current - 1) : (current + 1) % controls.length;
      controls[next]?.focus();
    }
    return;
  }
  if (cropModalOpen && event.key === "Tab") {
    const controls = [...enemyCropModal.querySelectorAll<HTMLElement>("button:not(:disabled):not([hidden]), select:not(:disabled), input:not(:disabled)")].filter((element) => !element.hidden);
    if (controls.length > 0) {
      event.preventDefault();
      const current = controls.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (current <= 0 ? controls.length - 1 : current - 1) : (current + 1) % controls.length;
      controls[next]?.focus();
    }
    return;
  }
  if (cropModalOpen && event.key === "Escape") {
    event.preventDefault();
    closeEnemyImageCropper();
    return;
  }
  if (cropModalOpen) return;
  if (drawingModalOpen && event.key === "Escape") {
    event.preventDefault();
    closeEnemyDrawingEditor();
    return;
  }
  if (drawingModalOpen) return;
  if (!debugPanel.hidden && event.key === "Tab") {
    const controls = [...debugPanel.querySelectorAll<HTMLElement>("button:not(:disabled):not([hidden]), input:not(:disabled)")].filter((element) => !element.hidden);
    if (controls.length > 0) {
      event.preventDefault();
      const current = controls.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (current <= 0 ? controls.length - 1 : current - 1) : (current + 1) % controls.length;
      controls[next]?.focus();
    }
    return;
  }
  if (event.key === "Tab" && overlayState !== "none") {
    const container = overlayState === "settings" ? audioSettingsPanel : overlayState === "pause" ? gameMenuOverlay : confirmOverlay;
    const controls = [...container.querySelectorAll<HTMLElement>("button:not(:disabled):not([hidden]), select:not(:disabled), input:not(:disabled), [tabindex='0']")].filter((element) => !element.hidden);
    if (controls.length > 0) {
      event.preventDefault();
      const current = controls.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (current <= 0 ? controls.length - 1 : current - 1) : (current + 1) % controls.length;
      controls[next]?.focus();
    }
    return;
  }
  if ((event.key === "Enter" || event.key === " ") && document.activeElement instanceof HTMLElement && document.activeElement.dataset["action"] === "toggle-inspector-details") {
    event.preventDefault();
    void runAction("toggle-inspector-details", undefined, document.activeElement);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (inspectorDetailsOpen) {
      inspectorDetailsOpen = false;
      selectionSignature = "";
      if (latestUiState) renderSelection(latestUiState);
      return;
    }
    if (overlayState === "none" && debugPanel.hidden && latestUiState?.selectedOwned && latestUiState.selectedTower?.tower.kind === "mecha" && latestUiState.selectedTower.tower.mechaControlled === true) {
      game.toggleSelectedMechaControl();
      return;
    }
    const chatTransient = !ingameChatPanel.hidden && inGameChatStore.getState() !== "closed";
    const transientOpen = !debugPanel.hidden || !balanceLab.hidden || !aimCancel.hidden || !moveCancel.hidden || !towerInspector.hidden || chatTransient;
    const escapeAction = resolveEscapeAction({ overlay: overlayState, transientOpen, runActive: shell.classList.contains("run-active"), frontScreen: activeFrontScreen });
    if (escapeAction === "dismiss-confirm") finishConfirmation(false);
    else if (escapeAction === "close-settings") setAudioPanelOpen(false);
    else if (escapeAction === "toggle-pause") {
      if (overlayState === "pause") closeGameMenu(true);
      else openGameMenu();
    } else if (escapeAction === "close-transient") {
      if (chatTransient) {
        closeInGameChat();
      }
      if (!aimCancel.hidden) game.cancelAimSelected();
      game.cancelPlacement();
      debugPanel.hidden = true;
      balanceLab.hidden = true;
      if (!towerInspector.hidden) {
        inspectorSuppressed = true;
        towerInspector.hidden = true;
        selectedPill.hidden = false;
      }
    } else if (escapeAction === "navigate-back") {
      if (activeFrontScreen === "enemy-creator") void runAction("enemy-back");
      else if (activeFrontScreen === "map-creator") void runAction("map-editor-back");
      else if (activeFrontScreen === "creator") void runAction("creator-back");
      else if (activeFrontScreen === "multiplayer") void runAction("multiplayer-back");
      else showFrontScreen(frontScreenBackTarget(activeFrontScreen));
    }
    return;
  }
  if (editing || (!debugPanel.hidden && event.key !== "F1")) return;
  void audio.unlock();
  if (event.key === "Tab" && shell.classList.contains("run-active") && overlayState === "none") {
    event.preventDefault();
    toggleBattleLog();
  } else if (event.key === "F1") {
    event.preventDefault();
    game.releaseMechaInput();
    if (overlayState === "none") debugPanel.hidden = !debugPanel.hidden;
  } else if (event.code === "Space" && overlayState === "none") {
    event.preventDefault();
    game.counterSelected();
  } else if (overlayState === "none" && event.key.toLowerCase() === "e") {
    event.preventDefault();
    game.upgradeSelected();
  } else if (overlayState === "none" && event.key === "Backspace") {
    event.preventDefault();
    game.sellSelected();
  } else if (overlayState === "none" && event.key.toLowerCase() === "q") {
    event.preventDefault();
    game.startMoveSelected();
  } else if (overlayState === "none" && ["f", "g", "h"].includes(event.key.toLowerCase())) {
    event.preventDefault();
    game.activateSelectedAbility(event.key.toLowerCase() as TowerAbilitySlot);
  } else if (event.key.toLowerCase() === "p" && overlayState === "none") game.togglePause();
  else if (overlayState === "none" && ["1", "2", "3", "4", "5"].includes(event.key)) {
    const kind = progress.loadout[loadoutIndexForDisplaySlot(Number(event.key))];
    if (kind) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      game.selectKind(kind);
    }
  }
});

window.addEventListener("keyup", (event) => {
  const movementKey = event.key.toLowerCase();
  if (["w", "a", "s", "d"].includes(movementKey) && game.setMechaMovementKey(movementKey, false)) {
    event.preventDefault();
  }
});

window.addEventListener("blur", () => game.releaseMechaInput());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) game.releaseMechaInput();
});

window.setInterval(() => {
  query<HTMLElement>("#clock").textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}, 1000);

multiplayerRoomCodeInput.addEventListener("paste", (event) => {
  const pasted = event.clipboardData?.getData("text")?.trim() ?? "";
  if (!pasted) return;
  event.preventDefault();
  multiplayerRoomCodeInput.value = pasted.toUpperCase();
  renderMultiplayerRoomCode();
});
renderMultiplayerRoomCode();

window.addEventListener("beforeunload", () => {
  stopUpdateStateSubscription?.();
  stopFullscreenSubscription?.();
  stopGpuStatusSubscription?.();
  stopHostServerSubscription?.();
  if (multiplayerSession.role === "host") void window.monochromiumDesktop?.stopHostServer("Window closed.");
  if (multiplayerSession.status !== "closed" && multiplayerSession.status !== "idle") multiplayerSession.close("Window closed.");
  game.destroy();
});
