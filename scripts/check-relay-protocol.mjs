import protocol from "../shared/multiplayer-protocol.json" with { type: "json" };
import { configuredMultiplayerRelayUrl } from "../electron/multiplayer-config.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export const checkRelayProtocol = async ({
  relayUrl = configuredMultiplayerRelayUrl(),
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
  maxAttempts = 6,
  retryDelayMs = 2_000,
  requiredMatches = 2,
  sleep = delay,
  onRetry = () => undefined,
} = {}) => {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || !Number.isInteger(requiredMatches) || requiredMatches < 1 || requiredMatches > maxAttempts ||
    !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(retryDelayMs) || retryDelayMs < 0) throw new Error("Invalid relay check retry settings.");
  const healthUrl = `${relayUrl.replace(/\/+$/, "")}/health`;
  const probeId = randomUUID();
  let matches = 0;
  let lastFailure = "No stable protocol response received.";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const url = new URL(healthUrl);
    url.searchParams.set("release-probe", `${probeId}-${attempt}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url.href, {
        signal: controller.signal, cache: "no-store",
        headers: { "cache-control": "no-cache, no-store", pragma: "no-cache" },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`The multiplayer relay returned HTTP ${response.status}.`);
      }
      let payload;
      try { payload = await response.json(); }
      catch { throw new Error(`The multiplayer relay returned invalid or incomplete health data (HTTP ${response.status}).`); }
      if (!payload || typeof payload !== "object" || payload.ok !== true || payload.service !== "monochromium-multiplayer-relay") {
        throw new Error("The multiplayer relay returned unexpected health data.");
      }
      if (payload.protocol !== protocol.protocolVersion) {
        throw new Error(`Multiplayer protocol mismatch: the client expects ${protocol.protocolVersion}, but ${relayUrl} reports ${payload.protocol ?? "unknown"}. Deploy the relay before publishing this desktop build.`);
      }
      matches += 1;
      if (matches >= requiredMatches) return protocol.protocolVersion;
      lastFailure = `Protocol ${protocol.protocolVersion} responded correctly, but has not passed ${requiredMatches} consecutive checks yet.`;
    } catch (error) {
      matches = 0;
      lastFailure = controller.signal.aborted ? `Relay health request timed out after ${timeoutMs}ms.` : error instanceof Error ? error.message : "Relay health request failed.";
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < maxAttempts) {
      onRetry(`Relay check ${attempt}/${maxAttempts}: ${lastFailure} Retrying in ${retryDelayMs / 1000}s.`);
      await sleep(retryDelayMs);
    }
  }
  throw new Error(`Release blocked: relay compatibility did not stabilize after ${maxAttempts} checks. ${lastFailure}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const relayUrl = configuredMultiplayerRelayUrl();
  try {
    await checkRelayProtocol({ relayUrl, onRetry: (message) => console.log(message) });
    console.log(`Multiplayer relay check passed: ${relayUrl} consistently uses protocol ${protocol.protocolVersion}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
