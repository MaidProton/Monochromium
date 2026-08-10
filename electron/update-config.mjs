// Configure these values once the project has a release host.
//
// For a public GitHub repository using update.electronjs.org, use:
//   https://update.electronjs.org/OWNER/REPOSITORY/win32-x64/{version}
//
// For a static Squirrel-compatible host, use the directory containing
// RELEASES and the .nupkg files, with {version} omitted if the host does not
// use versioned feed URLs.
export const updateConfig = Object.freeze({
  feedUrl: "https://update.electronjs.org/MaidProton/Monochromium/win32-x64/{version}",
  remoteReleasesUrl: "",
});

export const configuredUpdateValue = (value, environmentName) => {
  const environmentValue = process.env[environmentName]?.trim();
  return environmentValue || value;
};
