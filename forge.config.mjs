import { configuredUpdateValue, updateConfig } from "./electron/update-config.mjs";

const remoteReleasesUrl = configuredUpdateValue(updateConfig.remoteReleasesUrl, "MONOCHROMIUM_REMOTE_RELEASES_URL");

export default {
  packagerConfig: {
    asar: true,
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
