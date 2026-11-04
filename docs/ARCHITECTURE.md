# Monochromium architecture and agent guide

## Change map

| Concern | Current source of truth | Preferred test seam |
| --- | --- | --- |
| Official balance/content | `src/game/config.ts` | `definitionValidation.test.ts`, focused simulation tests |
| Enemy registry/custom enemies | `src/game/customEnemies.ts`, `src/game/enemyRegistry.ts` | sanitizer/conversion tests and headless simulation |
| Custom modes/maps | `src/game/customModes.ts`, `src/game/customMaps.ts` | pure validation/migration tests |
| Wave spawn planning | `src/game/waveProgression.ts` | `waveProgression.test.ts`, fixed-tick simulation tests |
| Local simulation/orchestration | `src/game/Game.ts` | `SimulationCore`, `testSupport.ts`, fixed ticks |
| Canvas rendering | `src/game/GameRenderer.ts` | renderer fixtures and Electron smoke |
| Particle/VFX effects | `src/game/GameEffects.ts` | simulation-event tests and Electron smoke |
| Deterministic repro/replay | `src/game/replay.ts` | serialized command bundles and checkpoint digests |
| Multiplayer payload validation | `src/game/multiplayerValidation.ts` | `multiplayerValidation.test.ts` |
| Authoritative multiplayer | `src/game/SimulationCore.ts`, `src/server/simulationServer.ts` | `SimulationCore.test.ts`, server smoke |
| Binary replication | `src/game/replication.ts` | round-trip, malformed-frame, and bandwidth tests |
| Audio | `src/game/audio.ts` | simulation-event tests; later Electron smoke |
| DOM application shell | `src/main.ts`, `src/ui/` | navigation/policy tests, `npm run test:ui` |
| Desktop boundary | `electron/preload.cjs`, `src/desktop.d.ts`, `electron/main.mjs` | utility smoke and IPC contract tests |
| Internet relay | `relay/src/index.ts` | `relay/test/relay.test.ts` |

## Runtime shape

```text
renderer: src/main.ts
    ├── Game (simulation orchestration + gameplay commands)
    │     ├── GameRenderer (canvas presentation)
    │     └── GameEffects (particles/VFX presentation)
    ├── MultiplayerSession (control/realtime messages)
    └── preload bridge
          └── Electron main process
                ├── save/update/fullscreen IPC
                ├── authoritative utility process: SimulationCore -> Game(headless)
                └── RelayNetwork -> Cloudflare Durable Object relay
```

The desktop updater boundary is `electron/squirrel-updater.mjs`. The main process validates the latest release metadata, then drives the installed Squirrel `Update.exe` with `--checkForUpdate`, `--download`, and `--update`. Squirrel owns RELEASES hash verification, delta/full selection, package caching, version-directory installation, and launcher switching; the Electron layer owns approval, progress state, and restart UX. Keep updater downloads outside `%APPDATA%/Monochromium` so profile saves remain independent of application replacement.

`Game` has a headless mode and `advanceFixedStep`, so authoritative tests do not need a browser canvas. The simulation uses seeded randomness for authoritative behavior; presentation effects should remain cosmetic and must not affect snapshots or economy.

## How to debug a gameplay issue

1. Reproduce with a known seed and a minimal map/mode.
2. Use the development build's `F1` tools: infinite cash, stock restore, selected-tower maxing, wave jump, and wave clearing. During a host-authoritative multiplayer run, `COPY REPRO` or `EXPORT REPRO` captures the seed, command ticks, recent events, and session content.
3. Reduce the case to a headless fixed-tick test using `createHeadlessGame`, `makeTestTower`, or `makeTestEnemy` from `src/game/testSupport.ts`.
4. For a multi-step issue, use the F1 repro export or create a `SimulationReplayBundle` with `src/game/replay.ts`, then run `npm run replay -- repro.json --json`. Use `--expect-digest` in a regression check. `SimulationCore` uses fixed-tick time by default; do not add new wall-clock dependencies to authoritative behavior.
5. Assert semantic state and `SimulationEvent` output rather than particles, canvas pixels, or wall-clock timestamps.
6. If multiplayer is involved, test the authoritative command/snapshot first, then replication encoding, then mirror presentation.

## How to add a tower

1. Add the `TowerKind` and `TOWER_DEFINITIONS` entry.
2. Confirm the definition validator accepts its levels, upgrades, costs, and ability slots.
3. Add the tower's behavior under `src/game/towerBehaviors/` and register it in `index.ts`.
4. Keep `Game.ts` responsible for shared mechanics; expose only the narrow callbacks the behavior needs.
5. Add semantic events for effects that a guest must mirror. Do not replicate particles or projectiles as authoritative state.
6. Add focused solo tests and, for multiplayer-visible behavior, authoritative and mirror-event tests.
7. Run `npm run typecheck`, `npm test`, and `npm run test:server` after building.

## Tower behavior seam

Tower-specific authoritative behavior lives modularly under `src/game/towerBehaviors/`. The registry contains one
behavior file for every official tower (17 total): Admiral, Bandit, Bomber, Cyborg, Gunner, Infernus, Latch, Mecha (Tank),
Mercenary, Prism, Recon, Samurai, Tempest, Vanguard, Warrior, Wraith, and Zenith.

Each behavior owns the distinctive decisions for its tower: attack and counter selection, special targeting filters,
ability activation, upgrade/debug side effects, tower-specific timers and status changes, projectile or damage variants,
semantic event presentation, and tower-specific render overlays. `Game.ts` selects a behavior from the registry and
drives the same hooks for every tower, so adding a tower-specific branch to the simulation loop is no longer required.
The contexts are intentionally callback-based and narrow: Game supplies already-eligible candidates, computed shared
damage, positions, and effect primitives rather than exposing its private state wholesale.

The following remain in `Game.ts` for now:

- deployment, placement validation, ownership, economy, and multiplayer command validation;
- shared target eligibility and priority selection, common cooldown bookkeeping, and tower-independent stun/timer flow;
- shared damage, death, projectile/timed-effect queues, replication, snapshot construction, and deterministic scheduling;
- audio coordination, semantic event routing, and the presentation bridge that replays semantic events on a mirror. Canvas drawing and particle/VFX primitives live in `GameRenderer.ts` and `GameEffects.ts`; `Game` supplies their narrow host callbacks.

Some callbacks still have tower-shaped names because they bridge a behavior decision to shared state containers or
presentation primitives. They are intentionally not decision points in `Game.ts`: for example, Wraith's behavior owns
legal landing search and scoring while Game supplies path/placement legality and relocation mutation; Infernus's flame
stream uses a shared visual particle container; Tempest's field callback stores a shared persistent effect; and
Admiral/Cyborg callbacks enqueue projectiles for the common update loop. The behavior files decide when these effects
happen and supply their tower-specific inputs.

When adding a new tower or modifying an existing behavior, use this checklist:

1. Derive the smallest behavior context from the existing `Game.ts` path; do not duplicate `Tower` state or `TOWER_DEFINITIONS`.
2. Move the tower's attack/counter/ability decisions, special target filtering, lifecycle side effects, and semantic event handling.
3. Keep shared targeting eligibility, placement, ownership, economy, cooldown containers, damage/death, multiplayer validation, and snapshots in `Game.ts`.
4. Add headless fixed-tick tests with `src/game/testSupport.ts` fixtures for state changes and `SimulationEvent` parity.
5. Run the focused tests first, then the normal typecheck, unit, build, server, and UI checks.

## How to add a UI feature

1. Identify the state transition and the screen/overlay that owns it.
2. Add or reuse a delegated `data-action` and keep the action's side effects localized.
3. Preserve focus restoration, keyboard shortcuts, escape priority, disabled states, and reduced-motion behavior.
4. Add stable `data-testid` hooks to controls an automated test must use.
5. Test pure state/navigation behavior first; add an Electron flow test when the feature depends on the desktop bridge, file dialogs, or real canvas behavior.

## Test layering

- Pure tests: sanitizers, validators, navigation, preferences, codecs, and protocol parsing.
- Simulation tests: deterministic fixed ticks, commands, economy, targeting, tower/enemy behavior, and semantic events.
- Transport tests: replication field masks, malformed frames, relay admission/reconnect, and backpressure.
- Runtime smoke: compiled utility process plus the Electron renderer flow suite. The UI smoke should assert semantic state and bridge availability; leave visual layout and canvas pixels to targeted manual/visual checks.

Avoid making every test an end-to-end test. Use the lowest layer that can prove the invariant and reserve Electron tests for integration boundaries.

### Release-check regressions

For release failures, reproduce with `npm run release:checks` as well as the relevant focused tests. It reads the deployed relay health endpoint but does not deploy, package, version, or publish anything. Its scheduling differs from `npm run verify`: non-UI checks run in parallel, then Electron UI smoke runs alone. Do not put the UI test back into that parallel batch.

Electron smoke uses CDP active-page emulation so Windows occlusion cannot suspend its animation/input loop. Movement and firing assertions hold input until observable state changes, with bounded timeouts and guaranteed release. Keep those assertions and the visible-page precondition; do not replace them with fixed-duration input taps or blanket retries. Failure diagnostics must capture the current renderer before closing it.
