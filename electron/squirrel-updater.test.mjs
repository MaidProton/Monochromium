import { describe, expect, it, vi } from "vitest";
import {
  buildGitHubReleaseAssetUrl,
  compareVersions,
  createFullPackageManifest,
  createLocalUpdateFeedServer,
  formatSquirrelReleaseFile,
  isContinuousDeltaChain,
  isNextSequentialVersion,
  launchSquirrelDetached,
  normalizeSquirrelReleaseLines,
  parseSquirrelCommandResult,
  parseSquirrelReleaseFile,
  progressFromSquirrelLine,
  runSquirrelCommand,
  withUpdateFeed,
} from "./squirrel-updater.mjs";

describe("Squirrel updater helpers", () => {
  it("compares strict three-part versions", () => {
    expect(compareVersions("1.0.10", "1.0.9")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(0);
  });

  it("parses local and URL RELEASES entries", () => {
    const releases = parseSquirrelReleaseFile([
      "0123456789abcdef0123456789abcdef01234567 monochromium-1.0.41-full.nupkg 1234",
      "abcdef0123456789abcdef0123456789abcdef01 https://cdn.example.test/monochromium-1.0.42-delta.nupkg 56",
      "not a valid release line",
    ].join("\n"));

    expect(releases).toEqual([
      {
        sha1: "0123456789abcdef0123456789abcdef01234567",
        filename: "monochromium-1.0.41-full.nupkg",
        size: 1234,
        version: "1.0.41",
        kind: "full",
        url: null,
      },
      {
        sha1: "abcdef0123456789abcdef0123456789abcdef01",
        filename: "monochromium-1.0.42-delta.nupkg",
        size: 56,
        version: "1.0.42",
        kind: "delta",
        url: "https://cdn.example.test/monochromium-1.0.42-delta.nupkg",
      },
    ]);
  });

  it("extracts the final JSON result after progress output", () => {
    const result = parseSquirrelCommandResult("0\r\n50\r\n100\r\n{\"currentVersion\":\"1.0.41\",\"futureVersion\":\"1.0.42\",\"releasesToApply\":[{\"version\":\"1.0.42\"}]}\r\n");
    expect(result.currentVersion).toBe("1.0.41");
    expect(result.futureVersion).toBe("1.0.42");
    expect(result.releasesToApply).toHaveLength(1);
  });

  it("accepts only bounded progress values", () => {
    expect(progressFromSquirrelLine(" 42\r")).toBe(42);
    expect(progressFromSquirrelLine("101")).toBeNull();
    expect(progressFromSquirrelLine("log message")).toBeNull();
  });

  it("reports progress and output from a child process", async () => {
    const progress = [];
    const child = {
      stdout: { on: vi.fn((_event, listener) => { child.stdout.listener = listener; }) },
      stderr: { on: vi.fn() },
      once: vi.fn((event, listener) => { child.listeners[event] = listener; }),
      listeners: {},
    };
    const promise = runSquirrelCommand("Update.exe", ["--download", "https://updates.example.test"], {
      spawn: vi.fn(() => child),
      onProgress: (value) => progress.push(value),
    });
    child.stdout.listener("25\n100\n");
    child.listeners.close(0, null);
    const result = await promise;
    expect(progress).toEqual([25, 100]);
    expect(result.stdout).toContain("100");
  });

  it("launches the post-install process detached", () => {
    const child = { unref: vi.fn() };
    const spawn = vi.fn(() => child);
    expect(launchSquirrelDetached("Update.exe", ["--processStartAndWait", "Monochromium.exe"], { spawn })).toBe(child);
    expect(spawn).toHaveBeenCalledWith("Update.exe", ["--processStartAndWait", "Monochromium.exe"], expect.objectContaining({ detached: true, windowsHide: true }));
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("builds GitHub release asset URLs", () => {
    expect(buildGitHubReleaseAssetUrl("MaidProton/Monochromium", "1.0.33", "monochromium-1.0.33-delta.nupkg"))
      .toBe("https://github.com/MaidProton/Monochromium/releases/download/v1.0.33/monochromium-1.0.33-delta.nupkg");
    expect(buildGitHubReleaseAssetUrl("https://github.com/MaidProton/Monochromium/", "1.0.33", "Monochromium-Setup.exe"))
      .toBe("https://github.com/MaidProton/Monochromium/releases/download/v1.0.33/Monochromium-Setup.exe");
  });

  it("formats and normalizes Squirrel RELEASES entries to absolute URLs", () => {
    const raw = [
      "0123456789abcdef0123456789abcdef01234567 monochromium-1.0.31-full.nupkg 100",
      "abcdef0123456789abcdef0123456789abcdef01 monochromium-1.0.32-delta.nupkg 20",
      "1111111111111111111111111111111111111111 https://custom.test/monochromium-1.0.33-delta.nupkg 30",
    ].join("\n");

    const normalized = normalizeSquirrelReleaseLines(raw, "MaidProton/Monochromium");
    expect(normalized).toBe([
      "0123456789abcdef0123456789abcdef01234567 https://github.com/MaidProton/Monochromium/releases/download/v1.0.31/monochromium-1.0.31-full.nupkg 100",
      "abcdef0123456789abcdef0123456789abcdef01 https://github.com/MaidProton/Monochromium/releases/download/v1.0.32/monochromium-1.0.32-delta.nupkg 20",
      "1111111111111111111111111111111111111111 https://custom.test/monochromium-1.0.33-delta.nupkg 30",
    ].join("\n") + "\n");
  });

  it("verifies sequential version steps", () => {
    expect(isNextSequentialVersion("1.0.31", "1.0.32")).toBe(true);
    expect(isNextSequentialVersion("1.0.31", "1.0.33")).toBe(false);
    expect(isNextSequentialVersion("1.0.99", "1.1.0")).toBe(true);
    expect(isNextSequentialVersion("1.9.99", "2.0.0")).toBe(true);
    expect(isNextSequentialVersion("1.0.32", "1.0.31")).toBe(false);
  });

  it("evaluates continuous delta chains", () => {
    const raw = [
      "0000000000000000000000000000000000000001 monochromium-1.0.30-full.nupkg 1000",
      "0000000000000000000000000000000000000002 monochromium-1.0.31-delta.nupkg 50",
      "0000000000000000000000000000000000000003 monochromium-1.0.32-delta.nupkg 50",
      "0000000000000000000000000000000000000004 monochromium-1.0.33-delta.nupkg 50",
      "0000000000000000000000000000000000000005 monochromium-1.0.33-full.nupkg 1000",
    ].join("\n");
    const entries = parseSquirrelReleaseFile(raw);

    // Continuous 1 step
    expect(isContinuousDeltaChain("1.0.32", "1.0.33", entries)).toBe(true);
    // Continuous multi-step
    expect(isContinuousDeltaChain("1.0.30", "1.0.33", entries)).toBe(true);
    // Missing intermediate step (30 -> 33 when 31 is missing)
    const brokenEntries = entries.filter((e) => e.version !== "1.0.31" || e.kind !== "delta");
    expect(isContinuousDeltaChain("1.0.30", "1.0.33", brokenEntries)).toBe(false);
    // Current version older than any available delta
    expect(isContinuousDeltaChain("1.0.25", "1.0.33", entries)).toBe(false);
    // Max chain length cutoff
    expect(isContinuousDeltaChain("1.0.30", "1.0.33", entries, 2)).toBe(false);
  });

  it("creates a full-package-only manifest for clean fallback", () => {
    const raw = [
      "0000000000000000000000000000000000000001 monochromium-1.0.32-delta.nupkg 50",
      "0000000000000000000000000000000000000002 monochromium-1.0.33-delta.nupkg 50",
      "0000000000000000000000000000000000000003 monochromium-1.0.33-full.nupkg 1000",
    ].join("\n");
    const entries = parseSquirrelReleaseFile(raw);

    const fullManifest = createFullPackageManifest("1.0.33", entries, "MaidProton/Monochromium");
    expect(fullManifest).toBe(
      "0000000000000000000000000000000000000003 https://github.com/MaidProton/Monochromium/releases/download/v1.0.33/monochromium-1.0.33-full.nupkg 1000\n"
    );
  });

  it("spins up and tears down an ephemeral local update feed server", async () => {
    const manifest = "0000000000000000000000000000000000000001 https://cdn.test/pkg.nupkg 123\n";
    const server = await createLocalUpdateFeedServer(manifest);

    try {
      expect(server.feedUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      // Fetch with query params, as Squirrel sends
      const res = await fetch(`${server.feedUrl}/RELEASES?id=monochromium&localVersion=1.0.31&arch=amd64`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe(manifest);

      const notFound = await fetch(`${server.feedUrl}/nonexistent`);
      expect(notFound.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("manages feed lifecycle via withUpdateFeed for both URLs and manifests", async () => {
    // 1. Direct URL pass-through
    const resultUrl = await withUpdateFeed("https://github.com/releases/test", async (feedUrl) => {
      expect(feedUrl).toBe("https://github.com/releases/test");
      return "url-success";
    });
    expect(resultUrl).toBe("url-success");

    // 2. Manifest content: serves RELEASES and cleans up server
    const manifest = "0000000000000000000000000000000000000001 https://cdn.test/pkg.nupkg 123\n";
    let servedUrl = "";
    const resultManifest = await withUpdateFeed(manifest, async (feedUrl) => {
      servedUrl = feedUrl;
      expect(feedUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const res = await fetch(`${feedUrl}/RELEASES`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(manifest);
      return "manifest-success";
    });
    expect(resultManifest).toBe("manifest-success");

    // Server should be closed after withUpdateFeed completes
    await expect(fetch(`${servedUrl}/RELEASES`)).rejects.toThrow();
  });
});

