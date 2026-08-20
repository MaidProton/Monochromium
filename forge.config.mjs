import { configuredUpdateValue, updateConfig } from "./electron/update-config.mjs";

const remoteReleasesUrl = configuredUpdateValue(updateConfig.remoteReleasesUrl, "MONOCHROMIUM_REMOTE_RELEASES_URL");

export default {
  packagerConfig: {
    // Utility processes need a real on-disk entry point in packaged builds.
    // Electron transparently resolves the app.asar path to this unpacked copy.
    asar: { unpack: "dist-server/**" },
    name: "Monochromium",
    executableName: "Monochromium",
    prune: true,
    ignore: [
      /^\/\.agents(?:\/|$)/,
      /^\/\.codex(?:\/|$)/,
      /^\/\.git(?:\/|$)/,
      /^\/__pycache__(?:\/|$)/,
      /^\/out(?:\/|$)/,
      /^\/save_data(?:\/|$)/,
      /^\/src(?:\/|$)/,
      /^\/launch_game\.py$/,
      /^\/README\.md$/,
      /^\/tsconfig(?:\..+)?\.json$/,
      /^\/tsconfig\.tsbuildinfo$/,
      /^\/vite\.config\.ts$/,
      /^\/vite\.server\.config\.ts$/,
      /^\/electron\/smoke-server\.mjs$/,
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
