# Monochromium — agent guidance

This file records durable project conventions, not a map of every file or a checklist that must be followed for every task. Inspect the relevant code, scripts, and documentation before making assumptions about the current implementation.

## Working approach

- Follow the user's requested scope and the project's existing conventions. Make the smallest coherent change that solves the problem.
- Understand where state and behavior are owned before editing. Prefer fixing the underlying cause over adding workarounds in another layer.
- Avoid unrelated refactors, gameplay balance changes, dependency updates, or format changes unless they are needed for the task.
- Treat documentation as guidance, not proof that the code still works exactly as described. Update relevant documentation when behavior or architecture changes.

## Architecture and correctness

- Keep gameplay definitions, simulation, presentation/UI, desktop integration, and multiplayer networking in their appropriate layers. Treat the canonical game configuration as the source of truth for official content and balance; avoid duplicating rules across boundaries.
- Preserve deterministic, authoritative gameplay behavior wherever multiplayer synchronization or replay depends on it. Do not make authoritative decisions depend on rendering state or uncontrolled wall-clock timing.
- Treat network data and user-created or saved content as untrusted input. Validate at the relevant boundary and account for compatibility or migration when formats change.
- When changing gameplay, trace the affected flow through definitions, simulation, events, presentation, persistence, and multiplayer replication as applicable. Change only the parts that actually participate in that behavior.
- When changing UI, preserve relevant keyboard, focus, navigation, and dismissal behavior, including desktop integration where applicable.
- For changes spanning multiple systems, consult `docs/ARCHITECTURE.md` and verify its descriptions against the current code.

## Testing and debugging

- Start with the smallest meaningful test or reproduction. Add or update regression coverage for bugs and important behavior changes.
- Use the project's existing typecheck, unit, relay, UI, and integration checks as appropriate to the change. `npm run verify` is the broad check for substantial or cross-cutting work when feasible.
- For multiplayer or intermittent bugs, prefer the project's deterministic reproduction and replay tools when available. Investigate authoritative state and event order rather than relying only on visual symptoms.
- Report which checks actually ran, what passed or failed, and anything that could not be verified. Never imply that a check passed if it was not run.

## Desktop releases and sensitive operations

- A code change does not by itself authorize committing, pushing, tagging, publishing, or deploying. Perform those actions only when explicitly requested.
- Desktop updates use packaged Squirrel.Windows updater artifacts. When asked to release, follow the maintained release tooling and current versioning policy rather than manually recreating the process.
- Keep release packages, version metadata, and updater manifests consistent. Verify generated and uploaded assets before reporting a successful release.
- Do not include source archives, unpacked build output, or diagnostic files as routine update assets unless explicitly requested.
- Do not elevate privileges or overwrite/remove published assets without authorization. If a release fails or is only partially completed, report its actual state clearly.

## Handoff

Summarize what changed, what was tested, and any remaining risks or limitations. Mention relevant implications for multiplayer, saved content, or releases when applicable.