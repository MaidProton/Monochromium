# MONOCHROMIUM

A pathbound tower-defense game built with TypeScript 7 and Vite 8.

## Launch

Double-click `launch_game.py`, or run:

```powershell
python launch_game.py
```

The launcher installs dependencies on the first run, starts the local game and save servers, and opens the game in your default browser. Persistent data is written to `save_data/monochromium_save.json`; the previous version is retained as `save_data/monochromium_save.backup.json`.

For development:

```powershell
npm install
npm run dev
```

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

Desktop saves are written to `%APPDATA%/Monochromium/monochromium_save.json`, outside the installation directory, and remain intact when the application is replaced or updated. On its first development launch, the desktop application imports an existing `save_data/monochromium_save.json` when no AppData save exists. The in-game Export/Import Save controls remain available for manual migration and backups.

`npm run desktop:package` rebuilds only the unpacked application, while `npm run desktop:make` rebuilds both the application and Squirrel.Windows installer. Ordinary game work remains in `src/`; packaging does not require maintaining a separate desktop copy. Squirrel's `.nupkg` and `RELEASES` artifacts are used by the optional desktop updater.

## Desktop updates

The packaged game has an update panel on the main menu. It is intentionally disabled until a release feed is configured in `electron/update-config.mjs`.

For a public GitHub repository, publish the Squirrel artifacts to GitHub Releases and set `feedUrl` to:

```text
https://update.electronjs.org/OWNER/REPOSITORY/win32-x64/{version}
```

Electron's hosted update service requires a public GitHub repository and non-draft, non-prerelease GitHub Releases. The release must include `Monochromium-Setup.exe`, the versioned `monochromium-<version>-full.nupkg`, and `RELEASES`.

To generate delta packages, set `remoteReleasesUrl` to a URL for the existing Squirrel release directory containing `RELEASES` and the previous `.nupkg` files. You can also provide it during a build with `MONOCHROMIUM_REMOTE_RELEASES_URL`. Keep delta generation enabled; the full package remains available for new installations, while existing players can receive a much smaller delta package.

The updater downloads in the background and never touches the save location at `%APPDATA%/Monochromium/monochromium_save.json`. When the download finishes, the player can restart from the main menu to apply it.

The repository also includes `.github/workflows/release.yml`. After this project is pushed to GitHub, create a version tag such as `v1.0.1` and push it; GitHub Actions will build the Windows installer and publish the Squirrel artifacts as a GitHub Release. Add a `repository` entry to `package.json` pointing at that GitHub repository, and replace `OWNER/REPOSITORY` in `electron/update-config.mjs` before shipping the first updater-enabled build.

Before distributing a newer release, either update `version` in `package.json` or use:

```powershell
npm run desktop:release:patch
```

That command advances `1.0.0` to `1.0.1` (and so on) before rebuilding the installer. Version bumps let Squirrel recognize the installer as an upgrade while leaving the AppData save untouched.

On Windows, you can instead double-click `BUILD_DESKTOP_UPDATE.bat`. It runs the same version-and-installer workflow, keeps the console open if something fails, and prints the completed installer path when it succeeds.

## Controls

- The main menu provides map selection, a permanent tower shop, the Mode Creator, and the Enemy Creator. Profile Coins, Tokens, unlocked towers, run totals, victories, cleared maps, custom modes, and custom enemies are saved to the local JSON file when launched with `launch_game.py`.
- The Mode List separates official modes from locally created modes. Created modes never award profile Coins or Tokens.
- The Mode Creator saves custom finite modes to the same local JSON file. It supports any number of waves, configurable starting cash/core integrity, and a cash-clear reward for every wave.
- Browser local storage remains a fallback for direct `npm run dev` sessions. The launcher migrates an existing browser save when no disk save exists.
- **Export Save** downloads a portable JSON backup; **Import Save** validates and restores one. Importing also updates the on-disk save when the launcher service is active.
- Creator waves are block-based. Enemy Group blocks choose an enemy, amount, spawn delay, and time until the next block starts; each group's spawning continues asynchronously when later blocks begin.
- The Enemy Creator separates read-only official enemies from editable local enemies. A custom enemy can use a 3-12 sided polygon, any color/name, custom HP, speed, tower damage, attack timing, telegraph timing, core damage, body radius, Hidden status, and an optional boss healthbar.
- Custom enemies can summon a selectable mix of official and custom enemies on a configurable cooldown, stun nearby towers with configurable shockwaves, or combine both abilities. Once saved, they are available in every custom Mode Creator enemy-group block.
- A new profile begins with Bandit only. Winning Normal Mode awards the full map-adjusted reward; a loss awards Coins based on the wave reached.
- Three maps are available: the long and forgiving Sector 07-A, shorter Ashen Switchback, and shortest low-overlap Null Overpass.
- Select a construct from the bottom deploy dock, then click the battlefield to deploy it.
- Deploy directly on the marked path for a blocking, counter-capable form.
- Pathbound towers keep their complete normal attack and targeting range; path placement only adds HP, aggro/blocking, and counter access.
- Pathbound aggro is role-capped: Tempest, Infernus, Bomber, Recon, and Gunner block 1; Bandit and Cyborg block 2; Samurai, Mercenary, and Warrior block 3.
- Surviving damaged pathbound towers repair `70% of missing HP + 4` after every cleared wave.
- Deploy off-path for an untargetable ranged form.
- The roster is Bandit, Samurai, Tempest, Cyborg, Mercenary, Infernus, Bomber, Recon, Gunner, and Warrior. Recon uses Semi-Auto Shotgun by default; Gunner uses Ultraburst Gunner by default.
- Mode 01 is a finite 25-wave recreation of CTD Normal Mode. Clearing wave 25 defeats the mode; it does not enter endless scaling.
- Normal Mode starts with $500 cash.
- Normal Mode includes its full enemy lineup, Hidden detection, Dummymancer summons, a wave-19 Necromancer Boss, and Big Dummy's tower-stunning shockwave. Necromancer Boss and Big Dummy use global boss health bars.
- Mercenary adds Onslaught, Infernus applies cone burn/slow, Bomber plants path charges and gains Time Bomb, and Warrior gains broad melee arcs, timed regeneration, delayed Double Strike, and a max-level relocation slash.
- Each point of actual enemy damage awards $1 hitcash; overkill does not pay. Wave clears award `$50 + $10 × wave`.
- Relocating a selected tower costs $200 and can switch it between pathbound and ranged forms without consuming another copy.
- A destroyed tower recovers 65% of its purchase-and-upgrade value: half immediately and half when the next wave begins.
- Every tower has four permanent copies per run. Destroyed or sold copies do not return.
- Set each construct to target First, Last, Strongest, Weakest, or Closest hostiles.
- Select an on-path construct and press **Space** during the narrow red attack ring to counter. Successful counters share an 8-second cooldown and use tower-specific attack effects.
- Press **Q** for an unlocked active ability. Samurai Blade Stance, Mercenary Onslaught, and Bomber Time Bomb have independent cooldown bars and work separately from countering on either placement form.
- Infernus uses a reusable cone-spray particle system whose rotating square particles transition from yellow to red; future frost, poison, or breath attacks can reuse it with different colors.
- Waves start automatically after a 3-second intermission. **1–9/0** select unlocked constructs, **Tab** toggles the persistent battle log, **P** pauses, **F1** opens debug tools, and **Esc** cancels placement.

## Balancing and customization

All editable gameplay definitions are grouped in [`src/game/config.ts`](src/game/config.ts):

- `ENEMY_DEFINITIONS` gives every enemy its own name, base HP, speed, tower damage, attack/telegraph timing, core damage, radius, and assigned sprite colors/shape/glyph.
- `ECONOMY_RULES` contains hitcash, wave stipend, relocation cost, and casualty-refund tuning.
- `COMBAT_RULES` contains the shared counter window and successful-counter cooldown.
- `TOWER_DEFINITIONS` contains every tower's price, copy limit, forms, level stats, counter signature, active ability, and upgrade costs/skills.
- `MAP_DEFINITIONS` contains map paths, core positions, palettes, descriptions, and reward multipliers.
- `NORMAL_MODE` contains starting resources, rewards, and the exact 25 finite wave definitions. Future finite modes belong in `MODE_DEFINITIONS`.

Persistent profile handling is isolated in [`src/game/meta.ts`](src/game/meta.ts). The in-game **DBG** panel (or **F1**) can toggle infinite cash, add cash, heal the core, clear the current wave, restore stock, max the selected tower, or permanently unlock every tower. Infinite cash makes deployments, upgrades, and relocations free without replacing the visible balance values in the config.

Custom-mode validation and conversion are isolated in [`src/game/customModes.ts`](src/game/customModes.ts). Custom-enemy validation and conversion live in [`src/game/customEnemies.ts`](src/game/customEnemies.ts), while [`src/game/enemyRegistry.ts`](src/game/enemyRegistry.ts) combines immutable official definitions with the current custom roster for modes and gameplay. The browser-to-launcher bridge lives in [`src/game/persistence.ts`](src/game/persistence.ts), while [`launch_game.py`](launch_game.py) owns atomic JSON writes and automatic backups.
