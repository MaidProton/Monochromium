# Monochromium agent instructions

## Desktop release/update policy

Routine desktop updates are artifact releases only. Do not publish the source tree as part of an update.

- Do not commit, push, or attach source files, source archives, unpacked application folders, `dist/`, or debug files for a routine update unless the user explicitly asks for source publication.
- Increase only the patch component by one (`1.0.17` → `1.0.18`). Do not change major/minor versions or invent a release number.
- Use `release-update.ps1` (or `RELEASE_DESKTOP_UPDATE.bat`) for the complete flow: calculate the next patch version, build the Squirrel.Windows installer, and publish exactly these three updater assets:
  - `Monochromium-Setup.exe`
  - `monochromium-<version>-full.nupkg`
  - `RELEASES`
- The three assets must be uploaded together. `RELEASES` must reference the same versioned `.nupkg`; never upload a stale manifest or a package from another version.
- Never run `git add`, `git commit`, `git push`, or manually create a source tag as part of the routine release helper. GitHub may automatically expose source archives for a release tag, but no source archive should be manually attached.
- If `gh` needs elevated authentication, run the helper from an elevated PowerShell once. Do not repeatedly interrupt a large upload; an interrupted `--clobber` upload can temporarily remove existing release assets.
- If packaging or upload fails, leave no partially published new version when possible. Verify the release assets and hashes before reporting success.

The release helper intentionally does not publish source changes. Source changes and release artifacts are separate operations and require separate user authorization.
