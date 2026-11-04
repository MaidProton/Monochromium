import { describe, expect, it, vi } from "vitest";
import { checkRelayProtocol } from "./check-relay-protocol.mjs";
import protocol from "../shared/multiplayer-protocol.json" with { type: "json" };

const response = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});
const health = (version = protocol.protocolVersion) => response(200, { ok: true, service: "monochromium-multiplayer-relay", protocol: version });
const options = (fetchImpl, extra = {}) => ({ relayUrl: "https://relay.example", fetchImpl, sleep: vi.fn(async () => undefined), ...extra });

describe("deployed multiplayer relay preflight", () => {
  it("accepts the shared protocol version", async () => {
    const fetchImpl = vi.fn(async () => response(200, {
      ok: true,
      service: "monochromium-multiplayer-relay",
      protocol: protocol.protocolVersion,
    }));

    await expect(checkRelayProtocol(options(fetchImpl))).resolves.toBe(protocol.protocolVersion);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const urls = fetchImpl.mock.calls.map(([url]) => new URL(url));
    expect(urls.every((url) => url.pathname === "/health")).toBe(true);
    expect(new Set(urls.map((url) => url.searchParams.get("release-probe"))).size).toBe(2);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ cache: "no-store", headers: { "cache-control": "no-cache, no-store", pragma: "no-cache" }, signal: expect.any(AbortSignal) });
  });

  it("refuses to release when the deployed relay is stale", async () => {
    const fetchImpl = vi.fn(async () => health(10));
    const settings = options(fetchImpl);

    await expect(checkRelayProtocol(settings)).rejects.toThrow(
      `the client expects ${protocol.protocolVersion}, but https://relay.example reports 10`,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(settings.sleep).toHaveBeenCalledTimes(5);
  });

  it("recovers from the observed new-old-new rollout sequence", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(health()).mockResolvedValueOnce(health(12)).mockResolvedValue(health());
    const onRetry = vi.fn();
    await expect(checkRelayProtocol(options(fetchImpl, { onRetry }))).resolves.toBe(protocol.protocolVersion);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(onRetry).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls[1][0]).toContain("reports 12");
  });

  it("does not accept unstable alternating versions", async () => {
    let attempt = 0;
    const fetchImpl = vi.fn(async () => health(++attempt % 2 ? 12 : protocol.protocolVersion));
    await expect(checkRelayProtocol(options(fetchImpl))).rejects.toThrow("Release blocked");
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("retries network, HTTP and invalid JSON failures", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(response(503, {}))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error("not JSON"); } })
      .mockResolvedValue(health());
    await expect(checkRelayProtocol(options(fetchImpl))).resolves.toBe(protocol.protocolVersion);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("rejects an unrelated service even if its protocol number matches", async () => {
    const fetchImpl = vi.fn(async () => response(200, { ok: true, service: "other", protocol: protocol.protocolVersion }));
    await expect(checkRelayProtocol(options(fetchImpl))).rejects.toThrow("unexpected health data");
  });

  it("bounds slow response bodies as well as the initial request", async () => {
    const fetchImpl = vi.fn(async (_url, { signal }) => ({ ok: true, status: 200,
      json: () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
    }));
    await expect(checkRelayProtocol(options(fetchImpl, { timeoutMs: 5, maxAttempts: 2 }))).rejects.toThrow("timed out after 5ms");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
