import { spawn as nodeSpawn } from "node:child_process";
import http from "node:http";
import path from "node:path";

const progressPattern = /^\s*(\d{1,3})\s*$/;
const versionPattern = /^(\d+)\.(\d+)\.(\d+)$/;

const normalizeVersion = (value) => {
  const match = versionPattern.exec(String(value ?? ""));
  return match ? match[0] : null;
};

export const compareVersions = (left, right) => {
  const a = versionPattern.exec(String(left ?? ""));
  const b = versionPattern.exec(String(right ?? ""));
  if (!a || !b) return 0;
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference !== 0) return difference;
  }
  return 0;
};

const releaseNameParts = (filename) => {
  const match = /^(?:.+)-((?:\d+)\.(?:\d+)\.(?:\d+))-(full|delta)\.nupkg$/i.exec(filename);
  if (!match) return null;
  return { version: match[1], kind: match[2].toLowerCase() };
};

/**
 * Parse the whitespace-delimited Squirrel RELEASES format.
 *
 * Both of these forms are emitted by Squirrel and are accepted here:
 *   sha1 filename size
 *   sha1 https://host/filename size
 *   sha1 https://host/filename filename size
 */
export const parseSquirrelReleaseFile = (source) => String(source ?? "")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const fields = line.split(/\s+/);
    if (fields.length < 3 || !/^[a-f\d]{40}$/i.test(fields[0])) return null;
    const size = Number(fields.at(-1));
    const rawFilename = fields.length === 3 ? fields[1] : fields.at(-2);
    const url = fields.length > 3 && /^https?:\/\//i.test(fields[1]) ? fields[1] : /^https?:\/\//i.test(rawFilename) ? rawFilename : null;
    let filename = rawFilename;
    if (url) {
      try {
        filename = decodeURIComponent(path.posix.basename(new URL(url).pathname));
      } catch {
        return null;
      }
    }
    if (!filename || !Number.isSafeInteger(size) || size < 0) return null;
    const parts = releaseNameParts(filename);
    if (!parts) return null;
    return {
      sha1: fields[0].toLowerCase(),
      filename,
      size,
      ...parts,
      url,
    };
  })
  .filter((entry) => entry !== null);

export const buildGitHubReleaseAssetUrl = (repoOrUrl, version, filename) => {
  const cleanRepo = String(repoOrUrl ?? "")
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  return `https://github.com/${cleanRepo}/releases/download/v${version}/${filename}`;
};

export const formatSquirrelReleaseFile = (entries) => {
  if (!Array.isArray(entries)) return "";
  const lines = entries
    .map((entry) => {
      if (!entry?.sha1 || !entry?.filename || !Number.isSafeInteger(entry?.size)) return null;
      const target = entry.url ? entry.url : entry.filename;
      return `${entry.sha1.toLowerCase()} ${target} ${entry.size}`;
    })
    .filter(Boolean);
  return lines.length > 0 ? lines.join("\n") + "\n" : "";
};

export const normalizeSquirrelReleaseLines = (source, repoSlug = "MaidProton/Monochromium") => {
  const parsed = parseSquirrelReleaseFile(source);
  const normalized = parsed.map((entry) => {
    if (entry.url) return entry;
    const url = buildGitHubReleaseAssetUrl(repoSlug, entry.version, entry.filename);
    return { ...entry, url };
  });
  return formatSquirrelReleaseFile(normalized);
};

export const isNextSequentialVersion = (prev, next) => {
  const p = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(prev ?? ""));
  const n = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(next ?? ""));
  if (!p || !n) return false;
  const [pMaj, pMin, pPatch] = [Number(p[1]), Number(p[2]), Number(p[3])];
  const [nMaj, nMin, nPatch] = [Number(n[1]), Number(n[2]), Number(n[3])];
  if (pMaj === nMaj && pMin === nMin && nPatch === pPatch + 1) return true;
  if (pMaj === nMaj && nMin === pMin + 1 && nPatch === 0) return true;
  if (nMaj === pMaj + 1 && nMin === 0 && nPatch === 0) return true;
  return false;
};

export const isContinuousDeltaChain = (currentVersion, targetVersion, releaseEntries, maxChainLength = 15) => {
  if (!normalizeVersion(currentVersion) || !normalizeVersion(targetVersion)) return false;
  if (compareVersions(currentVersion, targetVersion) >= 0) return false;
  if (!Array.isArray(releaseEntries)) return false;

  const deltas = releaseEntries
    .filter((entry) => entry?.kind === "delta" && entry.version &&
      compareVersions(entry.version, currentVersion) > 0 &&
      compareVersions(entry.version, targetVersion) <= 0)
    .sort((a, b) => compareVersions(a.version, b.version));

  if (deltas.length === 0 || deltas.length > maxChainLength) return false;
  if (compareVersions(deltas.at(-1).version, targetVersion) !== 0) return false;

  let current = currentVersion;
  for (const delta of deltas) {
    if (!isNextSequentialVersion(current, delta.version)) return false;
    current = delta.version;
  }
  return compareVersions(current, targetVersion) === 0;
};

export const createFullPackageManifest = (targetVersion, releaseEntries, repoSlug = "MaidProton/Monochromium") => {
  if (!Array.isArray(releaseEntries)) return null;
  const fullEntry = releaseEntries.find((e) => e?.kind === "full" && compareVersions(e.version, targetVersion) === 0);
  if (!fullEntry) return null;
  const url = fullEntry.url ?? buildGitHubReleaseAssetUrl(repoSlug, fullEntry.version, fullEntry.filename);
  return formatSquirrelReleaseFile([{ ...fullEntry, url }]);
};

export const createLocalUpdateFeedServer = async (manifestContent) => {
  const content = String(manifestContent ?? "");
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/RELEASES") {
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": Buffer.byteLength(content, "utf8"),
      });
      res.end(content);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const feedUrl = `http://127.0.0.1:${port}`;

  const close = () => new Promise((resolve) => {
    server.close(() => resolve());
  });

  return {
    feedUrl,
    close,
  };
};

export const withUpdateFeed = async (feedUrlOrManifest, action) => {
  if (!feedUrlOrManifest || typeof feedUrlOrManifest !== "string") {
    throw new Error("Invalid feed URL or manifest.");
  }
  const trimmed = feedUrlOrManifest.trim();
  if (/^https?:\/\//i.test(trimmed) && !trimmed.includes("\n")) {
    return await action(trimmed);
  }
  const server = await createLocalUpdateFeedServer(feedUrlOrManifest);
  try {
    return await action(server.feedUrl);
  } finally {
    await server.close();
  }
};

export const parseSquirrelCommandResult = (stdout) => {
  const lines = String(stdout ?? "").trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const result = JSON.parse(lines[index]);
      if (!result || typeof result !== "object" || Array.isArray(result)) continue;
      const releasesToApply = Array.isArray(result.releasesToApply) ? result.releasesToApply : [];
      return {
        ...result,
        currentVersion: normalizeVersion(result.currentVersion),
        futureVersion: normalizeVersion(result.futureVersion),
        releasesToApply,
      };
    } catch {
      // Squirrel writes progress numbers before its final JSON line.
    }
  }
  throw new Error("Squirrel returned no update details.");
};

export const progressFromSquirrelLine = (line) => {
  const match = progressPattern.exec(String(line ?? ""));
  if (!match) return null;
  const progress = Number(match[1]);
  return progress >= 0 && progress <= 100 ? progress : null;
};

export const getSquirrelUpdaterPath = (execPath) =>
  path.resolve(path.dirname(execPath), "..", "Update.exe");

export const runSquirrelCommand = (updateExe, args, options = {}) => {
  const spawn = options.spawn ?? nodeSpawn;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const spawnOptions = {
    cwd: options.cwd,
    detached: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  };

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(updateExe, args, spawnOptions);
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";
    let pendingLine = "";
    let settled = false;

    const consume = (chunk) => {
      const text = String(chunk);
      stdout += text;
      pendingLine += text;
      const lines = pendingLine.split(/\r?\n/);
      pendingLine = lines.pop() ?? "";
      lines.forEach((line) => {
        const progress = progressFromSquirrelLine(line);
        if (progress !== null) onProgress(progress);
      });
    };

    child.stdout?.on("data", consume);
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (pendingLine) {
        const progress = progressFromSquirrelLine(pendingLine);
        if (progress !== null) onProgress(progress);
      }
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `Squirrel exited with code ${code ?? "unknown"}.`;
        const error = new Error(detail);
        error.code = code;
        error.signal = signal;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
};

export const launchSquirrelDetached = (updateExe, args, options = {}) => {
  const spawn = options.spawn ?? nodeSpawn;
  const child = spawn(updateExe, args, {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  child.unref?.();
  return child;
};
