# MONOCHROMIUM

A pathbound tower-defense game built with TypeScript 7 and Vite 8.

## Desktop application

Run the same source in a dedicated Electron window with Vite live reloading:

```powershell
npm run desktop:dev
```

Build a Windows installer and a fresh unpacked desktop build:

```powershell
npm run desktop:make
```

The friend-friendly installer is generated at `out/make/squirrel.windows/x64/Monochromium-Setup.exe`. The unpacked application is generated under `out/Monochromium-win32-x64/`; its `Monochromium.exe` must stay beside that folder's DLL, resource, and locale files, so do not distribute that EXE by itself.

Desktop saves are written to `%APPDATA%/Monochromium/monochromium_save.json`, outside the installation directory, and remain intact when the application is replaced or updated. The in-game Export/Import Save controls remain available for manual migration and backups.

`npm run desktop:package` rebuilds only the unpacked application, while `npm run desktop:make` rebuilds both the application and Squirrel.Windows installer. `npm run desktop:make:fast` is the release-oriented variant: it assumes checks have already passed and skips the duplicate TypeScript pass before packaging. Ordinary game work remains in `src/`; packaging does not require maintaining a separate desktop copy. Squirrel's `.nupkg` and `RELEASES` artifacts are used by the optional desktop updater.

### Development verification

`npm run typecheck` performs strict TypeScript validation. `npm test` runs the game, UI, renderer, replication, and Electron unit tests; `npm run test:relay` runs the Cloudflare Worker suite; `npm run test:ui` launches an isolated Electron renderer and smoke-tests real navigation. `npm run replay -- <repro.json> --json` executes a deterministic bug repro and can enforce a digest with `--expect-digest`. `npm run verify` runs both test suites, builds the application and authoritative server bundle, and executes the compiled server and UI smoke tests. The architecture and feature-development guide is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### Multiplayer relay development

Internet multiplayer uses the Cloudflare Durable Object Worker in `relay/`. Run and test it locally with:

```powershell
npm run test:relay
npm run relay:dev
```

In another terminal, point the desktop app at the local Worker before starting development:

```powershell
$env:MONOCHROMIUM_RELAY_URL = "http://127.0.0.1:8787"
npm run desktop:dev
```

`npm run relay:deploy` publishes the Worker to the authenticated Cloudflare account and verifies that its deployed protocol matches the client. The desktop release helper runs this automatically before its checks, so a normal release command keeps the public relay and packaged client aligned. `npm run relay:check` performs that live compatibility check independently; the full release checks run it again before a desktop build can be published. Packaged builds use the public endpoint in `electron/multiplayer-config.mjs`; `MONOCHROMIUM_RELAY_URL` remains available as a development or staging override. `npm run relay:smoke` uses that configured endpoint by default and exercises room creation, forwarding, reconnect, and cleanup.

## Desktop updates

The packaged game has an update panel on the main menu. The current configuration uses the public GitHub release feed in `electron/update-config.mjs`.

For a public GitHub repository, publish the Squirrel artifacts to GitHub Releases. The default `latestReleaseUrl` discovers the newest release from the GitHub API and the updater then follows that release's `RELEASES` asset directly. If you use a static Squirrel host instead, clear `latestReleaseUrl` and set `feedUrl` to the host directory containing `RELEASES`:

```text
https://update.electronjs.org/OWNER/REPOSITORY/win32-x64/{version}
```

Electron's hosted update service requires a public GitHub repository and non-draft, non-prerelease GitHub Releases. The release includes `Monochromium-Setup.exe`, the versioned `monochromium-<version>-full.nupkg`, `RELEASES`, and—when a previous release is available—the matching `monochromium-<version>-delta.nupkg`. The full package remains available for new installations; existing players can use the delta package. The included workflow keeps the release private as a draft while the assets upload, then publishes it after the upload completes. GitHub automatically exposes source-code archive links for public tags; those generated links cannot be removed, but the workflow does not attach a second source archive as a release asset.

Delta generation is enabled automatically by the release scripts: each release uses the preceding GitHub release as its Squirrel delta source. For a custom host, set `remoteReleasesUrl` to a URL for the existing Squirrel release directory containing `RELEASES` and the previous `.nupkg` files. You can also provide it during a build with `MONOCHROMIUM_REMOTE_RELEASES_URL`.

The packaged updater is a small controller around the `Update.exe` shipped by Squirrel. It validates the latest release, uses conditional GitHub metadata requests, asks Squirrel to choose the smallest applicable verified delta/full path, downloads into Squirrel's package cache, shows live progress, and applies the staged package only after the player confirms a restart. Squirrel builds the new version in a separate `app-<version>` directory and switches the launcher after the old process exits, so the updater never overwrites loaded game files or touches the save location at `%APPDATA%/Monochromium/monochromium_save.json`. If a download is interrupted, retrying reuses any valid package already in Squirrel's cache.

The repository also includes `.github/workflows/release.yml`. After this project is pushed to GitHub, create a version tag such as `v1.0.1` and push it; GitHub Actions will build the Windows installer and publish only the Squirrel updater artifacts as a GitHub Release. Add a `repository` entry to `package.json` pointing at that GitHub repository, and replace `OWNER/REPOSITORY` in `electron/update-config.mjs` before shipping the first updater-enabled build.

Before distributing a newer release, either update `version` in `package.json` or use:

```powershell
npm run desktop:release:github
```

That command advances only the patch value (`1.0.0` to `1.0.1`), rebuilds the installer, and publishes the installer, matching full package, `RELEASES`, and a delta package when the preceding release exists. It does not commit, push, or attach source files. Version bumps let Squirrel recognize the installer as an upgrade while leaving the AppData save untouched. Authenticate GitHub CLI once with `gh auth login`; the release helper does not require administrator privileges.

On Windows, `BUILD_DESKTOP_UPDATE.bat` is the local-only installer builder. It does not publish a GitHub release.

To publish the GitHub update directly from Windows, double-click `RELEASE_DESKTOP_UPDATE.bat` or run `release-update.ps1`. The helper deploys and verifies the multiplayer relay, runs release checks in parallel, checks the working tree, validates the manifest and local SHA-256 hashes, reuses an existing release when present, verifies the uploaded asset metadata, and uploads the full package plus a delta package when available, without publishing the source tree. Use `-AllowDirty` only when the current local changes are intentionally part of the release; use `-SkipTests` only when a test run is deliberately deferred. If an upload fails after the installer is built, `RELEASE_MONOCHROMIUM.bat /resume` publishes the already-generated next-version output without rebuilding.

### One-click release tool

On Windows with Python and Tkinter installed, double-click `RELEASE_MONOCHROMIUM.bat`. It opens `release_gui.pyw`, which provides:

- `BUILD AND PUBLISH UPDATE`: runs the complete tested release flow and enables `OPEN LAST RELEASE` when it succeeds.
- `BUILD INSTALLER ONLY`: creates a local installer without uploading anything to GitHub.
- A stage-based progress bar and live activity log.
- A required confirmation when the working tree contains uncommitted changes.

The tool never commits or pushes source files. Install Python with its standard Tkinter component if `pythonw.exe` is not available on PATH. If Python/Tkinter is unavailable, the batch file falls back to a native menu. It also supports `/publish`, `/build`, `/resume`, `/dry-run`, `/help`, and `/nopause`; the release helper can also be run directly with `RELEASE_DESKTOP_UPDATE.bat` or PowerShell.

## Controls

- The main menu provides map selection, a permanent tower shop, the Mode Creator, and the Enemy Creator. Profile Coins, Tokens, unlocked towers, run totals, victories, cleared maps, custom modes, and custom enemies are saved by the desktop application.
- The Mode List separates official modes from locally created modes. Created modes never award profile Coins or Tokens.
- The Mode Creator saves custom finite modes to the same local JSON file. It supports any number of waves, configurable starting cash/core integrity, a 0–100% multiplayer hit-cash slider, and a cash-clear reward for every wave. Older modes without the setting load at the 75% default.
- The renderer requires the Electron desktop bridge and a desktop-sized window; direct browser launches are intentionally blocked.
- **Export Save** downloads a portable JSON backup; **Import Save** validates and restores one. Importing also updates the on-disk save when the launcher service is active.
- Procedural audio is generated at runtime with Tone.js. Click **SND** during a run to open the mixer: master, tower, enemy, UI, and ambience buses each have independent sliders, and **SOUND ENABLED** mutes/unmutes without losing the mix. Preferences are stored separately in browser local storage and safely fall back to defaults if the stored value is invalid.
- `src/game/audio.ts` owns the shared audio graph: category gain buses feed the master gain and final limiter, while small capped synth pools provide tower variants, enemy signatures, UI feedback, stingers, and a restrained battlefield drone. Audio context startup is deferred until a click, key, or battlefield pointer gesture, and rapid voices are throttled to avoid runaway node creation.
- The Enemy List can export one custom enemy or a selected bulk bundle as JSON, and import those bundles later. The Mode List exports one custom mode per JSON file and can import it on another installation.
- Imported modes preserve their custom-enemy references. A mode that references an unavailable custom enemy is visibly locked and cannot start until that enemy is imported; deleting an enemy leaves dependent modes locked instead of silently replacing the enemy.
- The Creator Hub groups the Mode, Enemy, and Map creators behind one main-menu entry.
- The Map Creator provides a live 1600×700 route editor with draggable edge terminals, route points, palette presets, rectangular no-build zones, undo/redo, validation, and rewardless unsaved playtests. Maps created or imported through the creator always remain local custom maps and appear only in the Created Maps list.
- Official maps are packaged in the built-in map roster, are read-only in the library, are available to every installation of the release, and can award profile Coins, Tokens, victories, run totals, and map clears using their difficulty-based reward multiplier. Custom maps and unsaved playtests remain rewardless.
- To approve a creator map for everyone, its definition must be added to `MAP_DEFINITIONS` and shipped in a release; there is no in-game publish button that can turn local data into global content.
- Creator waves are block-based. Enemy Group blocks choose an enemy, amount, spawn delay, and time until the next block starts; each group's spawning continues asynchronously when later blocks begin.
- The Enemy Creator separates read-only official enemies from editable local enemies. A custom enemy can use a 3-12 sided polygon, any color/name, custom HP, shield HP, speed, tower damage, attack timing, telegraph timing, core damage, body radius, Hidden status, and an optional boss healthbar.
- Shield HP is a separate yellow damage buffer. Damage removes shield first, excess damage is discarded instead of bleeding into HP, and shield damage does not award hitcash.
- Custom enemies can combine configurable summoning and tower-stun shockwaves with five additional powers: passive regeneration, ally Haste Pulses, tower-damaging Siphons that heal the caster, temporary blocker-passing Phase Shift, and forward path Blinks. Once saved, they are available in every custom Mode Creator enemy-group block and are simulated authoritatively in multiplayer.
- A new profile begins with Bandit only. Winning an official mode awards its full map-adjusted reward; a loss awards Coins based on the wave reached.
- Three maps are available: the long and forgiving Sector 07-A, shorter Ashen Switchback, and shortest low-overlap Null Overpass.
- Select a construct from the bottom deploy dock, then click the battlefield to deploy it.
- Deploy directly on the marked path for a blocking, counter-capable form.
- Pathbound towers keep their complete normal attack and targeting range; path placement only adds HP, aggro/blocking, and counter access.
- Pathbound aggro is role-capped per tower definition, from single-target roadblocks to three-enemy frontliners.
- Surviving damaged pathbound towers repair `70% of missing HP + 4` after every cleared wave.
- Deploy off-path for an untargetable ranged form.
- The roster includes Bandit, Samurai, Tempest, Cyborg, Mercenary, Infernus, Bomber, Recon, Gunner, Warrior, Wraith, Vanguard, Admiral, Latch, Prism, and Zenith. Latch is an early-game tether controller, Prism is a midgame chain-beam specialist, and Zenith is an endgame line-piercing boss breaker.
- Mode 01 is a finite 25-wave recreation of CTD Normal Mode. Clearing wave 25 defeats the mode; it does not enter endless scaling.
- Normal Mode starts with $500 cash.
- Normal Mode includes its full enemy lineup, Hidden detection, Dummymancer summons, a wave-19 Necromancer Boss, and Big Dummy's tower-stunning shockwave. Necromancer Boss and Big Dummy use global boss health bars.
- Mode 02 is a finite 30-wave Hard Mode. It starts with $900 cash and 12 core integrity, introduces 15 Hard-only enemy variants across armor, shields, regeneration, support, siphon, phase, blink, and boss roles, and escalates through recurring boss checkpoints before a Big Dummy/Siege Colossus finale.
- Mercenary adds Onslaught, Infernus applies cone burn/slow, Bomber plants path charges and gains Time Bomb, and Warrior gains broad melee arcs, timed regeneration, delayed Double Strike, and a max-level relocation slash.
- In solo play, each point of actual enemy damage awards $1 hitcash; overkill does not pay. Wave clears award `$50 + $10 × wave`.
- Relocating a selected tower costs $200 and can switch it between pathbound and ranged forms without consuming another copy.
- A destroyed tower recovers 65% of its purchase-and-upgrade value: half immediately and half when the next wave begins.
- Every tower has four permanent copies per run. Destroyed or sold copies do not return.
- Set each construct to target First, Last, Strongest, Weakest, or Closest hostiles.
- Select an on-path construct and press **Space** during the narrow red attack ring to counter. Successful counters share an 8-second cooldown and use tower-specific attack effects.
- Press **F**, **G**, or **H** for an unlocked active ability. Press **Q** to relocate the selected tower. Samurai Blade Stance, Mercenary Onslaught, and Bomber Time Bomb have independent cooldown bars and work separately from countering on either placement form.
- Infernus uses a reusable cone-spray particle system whose rotating square particles transition from yellow to red; future frost, poison, or breath attacks can reuse it with different colors.
- Waves start automatically after a 3-second intermission. **1–9/0** select unlocked constructs, **Tab** toggles the persistent battle log, **P** pauses, **F1** opens debug tools, and **Esc** cancels placement.

## Server-authoritative relay multiplayer

Multiplayer is two-player cooperative defense in the Electron desktop app. Hosting starts a hidden Electron utility process that runs the authoritative 30 Hz enemy, damage, economy, tower, and wave simulation. Both visible game windows are presentation clients: they send validated command envelopes, interpolate protocol-11 state at an adaptive 8 Hz during combat, and generate particles, audio, screen shake, projectiles, and other cosmetic effects locally. Browser launches are blocked; multiplayer and solo play are desktop-only.

The host desktop process sends compact binary field-mask deltas to the guest through a two-player secure WebSocket room. Both apps make ordinary outbound TLS connections to the relay, so no inbound firewall rule, port forwarding, ICE negotiation, or TURN credentials are needed. One host packet multiplexes changed state, retained semantic events, the latest host cursor, timing, and guest-pulse acknowledgement; the guest sends at most one pulse at 8 Hz containing its latest cursor and acknowledgements. Traffic drops to 1 Hz when idle and 4 Hz under backpressure. Routine packets never carry particles, gameplay projectile arrays, delayed visual effects, or the server spawn queue. Sequence gaps and replaced deltas request a fresh keyframe, commands are idempotent by ID, and semantic events remain journaled only while the guest is connected and until its next pulse acknowledges them.

If the window is hidden or minimized, networking and the authoritative simulation continue while transient presentation is cleared rather than queued. Returning to the game discards IPC frames older than 250 ms, waits for one fresh keyframe, restores persistent effects at their current remaining duration, and does not replay old explosions, particles, sounds, floating text, or screen shake. The multiplayer diagnostics report packet rate, RTT, frame age, bandwidth, retained-event bytes, keyframes, replaced/stale frames, interpolation correction, and backpressure state.

To connect:

1. Both players open the Electron desktop app, choose **MULTIPLAYER**, and set a username and color.
2. The host clicks **CREATE NEW ROOM**, then uses **COPY INVITE** to send the displayed 8-character code through any trusted chat.
3. The guest enters that code in the single **ROOM CODE** box and clicks **JOIN ROOM**.
4. The host sees **CONNECTED** when the guest arrives and chooses the first mode and map.
5. Between rounds the room stays open: the host can retry the previous battle or choose another mode/map, while both players can adjust their loadout. The guest presses **READY FOR NEXT ROUND** to launch the selected battle.

Each room is a Cloudflare Durable Object with one authenticated host slot and one authenticated guest slot. The service stores only hashed connection tickets, role/admission state, protocol version, and expiry metadata; gameplay messages are forwarded in memory and are not persisted. Wrong, expired, incompatible, and full rooms fail immediately. A guest whose local connection drops automatically reuses the reserved guest ticket with short backoff while the original host room remains open.

Each player starts with the mode's full normal cash, has their own tower stock and wallet, owns only the towers they deploy, and receives the full wave-clear reward. Damage hit cash is credited to the owning damage source using the mode's multiplayer hit-cash percentage, including projectiles, splash, burns, bombs, delayed attacks, lightning, counters, and abilities. The default is 75%, meaning each point of actual damage accumulates $0.75 hit cash. A colored owner ring and label mark teammate towers; they can be inspected but not moved, sold, targeted, upgraded, countered, or activated by the other player.

Both players can request pause and speed changes; the authoritative process applies accepted requests in reliable arrival order. Map/mode choice, retry, debug commands, and permanent session ending are host-only. Between rounds, each player can equip up to five owned towers; changing a loadout clears that player's Ready state. Host custom maps, modes, and required custom enemies are sent as in-memory session content and do not alter the guest's saved creator library.

If the guest disconnects, the hidden authoritative simulation continues and the guest's wallet and towers remain active. The guest automatically retries the reserved identity, receives a fresh keyframe, and restores control. A host disconnect, intentional room close, or replacement-room request permanently invalidates the old room and its tickets; hosts always create a fresh room instead of reconnecting an old one. There is no host migration, and ending the host app or losing its simulation process ends the match without granting an unverified result.

Official content grants each connected player the normal local profile reward from the host's final result. Custom and sandbox restrictions are unchanged. Result IDs are remembered locally to prevent the same reconnect result from being claimed twice; the relay does not validate gameplay, so there is no central anti-cheat authority beyond trusting the host.

## Balancing and customization

All editable gameplay definitions are grouped in [`src/game/config.ts`](src/game/config.ts):

- `ENEMY_DEFINITIONS` gives every enemy its own name, base HP, shield HP, speed, tower damage, attack/telegraph timing, core damage, radius, and assigned sprite colors/shape/glyph.
- `ECONOMY_RULES` contains solo hitcash, wave stipend, relocation cost, and casualty-refund tuning. Each `ModeDefinition` contains its own multiplayer hit-cash multiplier.
- `COMBAT_RULES` contains the shared counter window and successful-counter cooldown.
- `TOWER_DEFINITIONS` contains every tower's price, copy limit, forms, level stats, counter signature, active ability, and upgrade costs/skills.
- `MAP_DEFINITIONS` contains the built-in official maps. Custom-map validation, sandbox conversion, and persistence live in `src/game/customMaps.ts`, while shared battlefield/editor drawing lives in `src/game/mapRendering.ts`.
- `NORMAL_MODE` and `HARD_MODE` contain starting resources, rewards, and their finite wave definitions. Future finite modes belong in `MODE_DEFINITIONS`.

Persistent profile handling is isolated in [`src/game/meta.ts`](src/game/meta.ts). The in-game **DBG** panel (or **F1**) can toggle infinite cash, add cash, heal the core, clear the current wave, restore stock, max the selected tower, or permanently unlock every tower. Infinite cash makes deployments, upgrades, and relocations free without replacing the visible balance values in the config.

Custom-mode validation and conversion are isolated in [`src/game/customModes.ts`](src/game/customModes.ts). Custom-enemy validation and conversion live in [`src/game/customEnemies.ts`](src/game/customEnemies.ts), while [`src/game/enemyRegistry.ts`](src/game/enemyRegistry.ts) combines immutable official definitions with the current custom roster for modes and gameplay. Desktop persistence is exposed through [`src/game/persistence.ts`](src/game/persistence.ts) and the Electron main process.
