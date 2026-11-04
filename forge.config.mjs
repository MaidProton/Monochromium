import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { NtExecutable, NtExecutableResource } from "resedit";
import { configuredUpdateValue, updateConfig } from "./electron/update-config.mjs";

const remoteReleasesUrl = configuredUpdateValue(updateConfig.remoteReleasesUrl, "MONOCHROMIUM_REMOTE_RELEASES_URL");

async function removeElectronAsarIntegrity(_forgeConfig, { platform, outputPaths }) {
  if (platform !== "win32") return;

  for (const outputPath of outputPaths) {
    const executablePath = join(outputPath, "Monochromium.exe");
    const executableBytes = await readFile(executablePath);
    const executable = NtExecutable.from(executableBytes, { ignoreCert: true });
    const resources = NtExecutableResource.from(executable, true);
    const hasAsarIntegrity = resources.entries.some(
      (entry) => entry.type === "INTEGRITY" && entry.id === "ELECTRONASAR",
    );

    if (!hasAsarIntegrity) continue;

    // Electron embeds the app.asar header hash in the executable. Removing
    // this resource keeps the Electron runtime binary stable across releases,
    // allowing Squirrel to delta the application files instead.
    resources.removeResourceEntry("INTEGRITY", "ELECTRONASAR");
    resources.outputResource(executable, false, true);
    await writeFile(executablePath, Buffer.from(executable.generate()));
  }
}

export default {
  hooks: {
    postPackage: removeElectronAsarIntegrity,
  },
  packagerConfig: {
    // Utility processes need a real on-disk entry point in packaged builds.
    // Electron transparently resolves the app.asar path to this unpacked copy.
    asar: { unpack: "dist-server/**" },
    name: "Monochromium",
    executableName: "Monochromium",
    // Keep Electron's PE metadata stable between releases so Squirrel can
    // delta the changing app.asar instead of shipping the whole runtime.
    // Squirrel's package/RELEASES versions remain driven by package.json.
    appVersion: "1.0.0",
    prune: true,
    ignore: [
      /^\/\.github(?:\/|$)/,
      /^\/\.wrangler(?:\/|$)/,
      /^\/\.wrangler-logs(?:\/|$)/,
      /^\/\.agents(?:\/|$)/,
      /^\/\.codex(?:\/|$)/,
      /^\/\.git(?:\/|$)/,
      /^\/__pycache__(?:\/|$)/,
      /^\/out(?:\/|$)/,
      /^\/relay(?:\/|$)/,
      /^\/save_data(?:\/|$)/,
      /^\/src(?:\/|$)/,
      /^\/scripts(?:\/|$)/,
      /^\/docs(?:\/|$)/,
      /^\/AGENTS\.md$/,
      /^\/\.gitignore$/,
      /^\/BUILD_DESKTOP_UPDATE\.bat$/,
      /^\/RELEASE_DESKTOP_UPDATE\.bat$/,
      /^\/RELEASE_MONOCHROMIUM\.bat$/,
      /^\/release_gui\.pyw$/,
      /^\/release-update\.ps1$/,
      /^\/Run Monochromium Dev\.cmd$/,
      /^\/node_modules\/\.cache(?:\/|$)/,
      /^\/node_modules\/\.mf(?:\/|$)/,
      /^\/node_modules\/\.package-lock\.json$/,
      /^\/node_modules\/\.vite(?:\/|$)/,
      /^\/node_modules\/\.vite-temp(?:\/|$)/,
      /^\/launch_game\.py$/,
      /^\/README\.md$/,
      /^\/forge\.config\.mjs$/,
      /^\/index\.html$/,
      /^\/public(?:\/|$)/,
      /^\/tsconfig(?:\..+)?\.json$/,
      /^\/tsconfig\.tsbuildinfo$/,
      /^\/vite\.config\.ts$/,
      /^\/vite\.server\.config\.ts$/,
      /^\/electron\/smoke-server\.mjs$/,
      /^\/electron\/smoke-ui\.mjs$/,
      /^\/electron\/dev\.mjs$/,
      /^\/electron\/cleanup-dev-server\.ps1$/,
      /^\/electron\/relay-network\.test\.mjs$/,
      /^\/electron\/squirrel-updater\.test\.mjs$/,
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "monochromium",
        setupExe: "Monochromium-Setup.exe",
        // When set, Squirrel downloads the previous release and emits a
        // smaller delta package alongside the full package.
        ...(remoteReleasesUrl ? { remoteReleases: remoteReleasesUrl } : {}),
      },
    },
  ],
};
