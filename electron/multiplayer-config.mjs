export const multiplayerConfig = Object.freeze({
  // Development and staging can override this without rebuilding the app.
  relayUrl: "https://monochromium-multiplayer-relay.monochromium.workers.dev",
});

export const configuredMultiplayerRelayUrl = () => {
  const configured = String(process.env.MONOCHROMIUM_RELAY_URL ?? multiplayerConfig.relayUrl).trim().replace(/\/+$/g, "");
  if (!configured) throw new Error("The multiplayer relay URL is not configured.");
  const url = new URL(configured);
  const localDevelopment = (url.protocol === "http:" || url.protocol === "https:") &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !localDevelopment) throw new Error("The multiplayer relay must use HTTPS.");
  return url.toString().replace(/\/+$/g, "");
};
