// Configure these values once the project has a release host.
//
// For a public GitHub repository using update.electronjs.org, use:
//   https://update.electronjs.org/OWNER/REPOSITORY/win32-x64/{version}
//
// For a static Squirrel-compatible host, use the directory containing
// RELEASES and the .nupkg files, with {version} omitted if the host does not
// use versioned feed URLs.
export const updateConfig = Object.freeze({
  // Static Squirrel feed fallback. Set latestReleaseUrl to an empty string
  // when using this instead of GitHub's release API.
  feedUrl: "https://update.electronjs.org/MaidProton/Monochromium/win32-x64/{version}",
  // GitHub release discovery. This endpoint's release asset becomes the
  // version-specific Squirrel feed used by Update.exe.
  latestReleaseUrl: "https://api.github.com/repos/MaidProton/Monochromium/releases/latest",
  // Release scripts set this automatically to the preceding GitHub release.
  // An explicit MONOCHROMIUM_REMOTE_RELEASES_URL can still override it.
  remoteReleasesUrl: "",
});

export const configuredUpdateValue = (value, environmentName) => {
  const environmentValue = process.env[environmentName]?.trim();
  return environmentValue || value;
};
