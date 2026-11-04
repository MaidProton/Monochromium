import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { createServer } from "vite";
import { withHeldInput } from "./smoke-input.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = "127.0.0.1";
let desktopOutput = "";
let rendererProbe = "";
let rendererErrors = [];

const findFreePort = async () => {
  const probe = net.createServer();
  probe.listen(0, host);
  await once(probe, "listening");
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  probe.close();
  await once(probe, "close");
  if (!port) throw new Error("Could not reserve a smoke-test port.");
  return port;
};

const waitFor = async (condition, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await condition()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out${lastError instanceof Error ? ` // ${lastError.message}` : ""}.`);
};

const fetchJson = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(500) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
};

const connectCdp = async (webSocketUrl) => {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Runtime.exceptionThrown") rendererErrors.push(message.params?.exceptionDetails?.text ?? message.params?.exceptionDetails?.exception?.description ?? "Renderer exception");
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") rendererErrors.push(message.params.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ") ?? "Renderer console error");
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message ?? "CDP request failed."));
    else request.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not connect to Chromium DevTools.")), { once: true });
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command("Runtime.enable");
  await command("Page.enable");
  // Native occlusion/minimization must not pause an automated input test.
  // CDP emulates an active page without changing production visibility handlers.
  await command("Emulation.setFocusEmulationEnabled", { enabled: true });
  return {
    command,
    close: () => socket.close(),
  };
};

const main = async () => {
  const debugPort = await findFreePort();
  const vite = await createServer({
    root,
    appType: "spa",
    logLevel: "silent",
    server: { host, port: 0 },
  });
  await vite.listen();
  const address = vite.httpServer?.address();
  const vitePort = typeof address === "object" && address ? address.port : 0;
  if (!vitePort) throw new Error("Could not start the UI smoke Vite server.");

  const userDataDirectory = await mkdtemp(path.join(tmpdir(), "monochromium-ui-smoke-"));
  // The managed Windows runner cannot start Chromium's OS sandbox reliably;
  // main.mjs scopes the matching renderer-sandbox exception to this marker.
  const desktop = spawn(electronPath, [
    "--disable-gpu",
    "--disable-gpu-compositing",
    "--disable-gpu-sandbox",
    "--no-sandbox",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--mute-audio",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDirectory}`,
    root,
  ], {
    cwd: root,
    env: { ...process.env, MONOCHROMIUM_DEV_URL: `http://${host}:${vitePort}`, MONOCHROMIUM_UI_SMOKE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  desktop.stdout?.on("data", (chunk) => { desktopOutput = (desktopOutput + String(chunk)).slice(-4_000); });
  desktop.stderr?.on("data", (chunk) => { desktopOutput = (desktopOutput + String(chunk)).slice(-4_000); });
  let cdp = null;
  try {
    await waitFor(async () => {
      try {
        const pages = await fetchJson(`http://${host}:${debugPort}/json/list`);
        const page = pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl && candidate.url !== "about:blank");
        if (!page) return false;
        cdp = await connectCdp(page.webSocketDebuggerUrl);
        return true;
      } catch {
        return false;
      }
    }, 15_000, "Electron renderer connection");

    const evaluate = async (expression) => {
      const response = await cdp.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Renderer evaluation failed.");
      return response.result?.value;
    };
    rendererProbe = JSON.stringify(await evaluate("({ url: location.href, readyState: document.readyState, width: innerWidth, height: innerHeight, title: document.title, body: document.body?.innerText?.slice(0, 500), html: document.documentElement?.outerHTML?.slice(0, 500) })"));
    const visible = (id) => evaluate(`Boolean(document.getElementById(${JSON.stringify(id)}) && !document.getElementById(${JSON.stringify(id)}).hidden)`);
    const clickAction = (action) => evaluate(`(() => { const button = document.querySelector('[data-action="${action}"]'); if (!button) throw new Error("Missing action: ${action}"); button.click(); return true; })()`);

    await waitFor(() => visible("main-menu"), 15_000, "main menu");
    await waitFor(() => evaluate("document.visibilityState === 'visible' && document.hasFocus()"), 5_000, "active smoke renderer");
    if (!await evaluate("Boolean(window.monochromiumDesktop && document.querySelector('#meta-coins'))")) throw new Error("Desktop preload bridge did not initialize.");
    if (await visible("graphics-setup-overlay")) {
      await clickAction("choose-graphics-preset");
      await waitFor(() => evaluate("document.querySelector('#graphics-setup-overlay')?.hidden === true"), 5_000, "graphics setup dismissal");
    }

    await clickAction("open-shop");
    await waitFor(() => visible("tower-shop"), 5_000, "armory");
    if (!await evaluate("Boolean(document.querySelector('#perk-loadout-slots') && document.querySelector('[data-testid=perk-slot-0]') && document.querySelector('[data-testid=perk-card-backdraft]') && document.querySelector('[data-testid=perk-card-high-noon]') && document.querySelector('[data-testid=perk-card-glass-cannon]'))")) throw new Error("Armory perk slots or cards did not render.");
    await clickAction("back-main");
    await waitFor(() => visible("main-menu"), 5_000, "main menu after armory");

    await clickAction("open-creators");
    await waitFor(() => visible("creator-hub"), 5_000, "creator hub");
    await clickAction("creator-hub-modes");
    await waitFor(() => visible("mode-selection"), 5_000, "mode creator list");
    await clickAction("library-back");
    await waitFor(() => visible("creator-hub"), 5_000, "creator hub return");
    await clickAction("creator-hub-enemies");
    await waitFor(() => visible("enemy-selection"), 5_000, "enemy creator list");
    await clickAction("new-enemy");
    await waitFor(() => visible("enemy-creator"), 5_000, "enemy creator");
    if (!await evaluate("Boolean(document.querySelector('[data-testid=enemy-appearance-editor]'))")) throw new Error("Enemy appearance editor did not render.");
    await clickAction("enemy-use-drawing");
    await waitFor(() => visible("enemy-drawing-overlay"), 5_000, "enemy drawing overlay");
    if (!await evaluate("Boolean(document.querySelector('[data-testid=enemy-drawing-canvas]'))")) throw new Error("Enemy drawing canvas did not render.");
    await clickAction("enemy-drawing-grid");
    await clickAction("enemy-drawing-zoom-in");
    if (!await evaluate("Boolean(document.querySelector('#enemy-drawing-grid') && !document.querySelector('#enemy-drawing-grid').hidden && document.querySelector('#enemy-drawing-zoom-value')?.textContent === '200%')")) throw new Error("Enemy drawing grid or zoom control did not update.");
    if (!await evaluate("Boolean(document.querySelector('[data-testid=enemy-drawing-upload-button]') && document.querySelector('[data-testid=enemy-upload-image-button]'))")) throw new Error("Enemy image upload buttons did not render.");
    await evaluate("(() => { const field = document.querySelector('#enemy-drawing-tool'); field.value = 'fill'; field.dispatchEvent(new Event('change', { bubbles: true })); const canvas = document.querySelector('[data-testid=enemy-drawing-canvas]'); const rect = canvas.getBoundingClientRect(); canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerId: 11, button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 })); return true; })()");
    await clickAction("enemy-close-drawing-editor");
    await waitFor(() => evaluate("document.querySelector('#enemy-drawing-overlay')?.hidden === true"), 5_000, "closed enemy drawing overlay");
    await evaluate("(() => { const preset = document.querySelector('[data-v4-action=preset][data-preset=last-stand]'); if (!preset) throw new Error('Last Stand preset missing.'); preset.click(); return true; })()");
    await evaluate("(() => { const advanced = document.querySelector('[data-v4-action=view-advanced]'); if (!advanced) throw new Error('Advanced ability control missing.'); advanced.click(); return true; })()");
    if (!await evaluate("Boolean(document.querySelector('[data-v4-field=priority]') && document.querySelector('[data-v4-field=exclusiveGroup]'))")) throw new Error("Advanced ability fields did not render.");
    await evaluate("document.querySelector('[data-testid=enemy-test]').click(); true");
    await waitFor(() => evaluate("document.querySelector('[data-testid=enemy-lab]')?.open === true"), 5_000, "enemy ability lab");
    await evaluate("document.querySelector('[data-v4-action=lab-close]').click(); true");
    await waitFor(() => evaluate("document.querySelector('[data-testid=enemy-lab]')?.open === false"), 5_000, "closed enemy ability lab");
    await clickAction("enemy-save");
    await waitFor(() => visible("enemy-selection"), 5_000, "saved enemy list");
    if (!await evaluate("Boolean(document.querySelector('#custom-enemy-list .enemy-card-drawing'))")) throw new Error("Enemy list did not preview the saved freeform drawing.");
    if (!await evaluate("Boolean(document.querySelector('#custom-enemy-list [data-enemy-version=\"4\"]')?.textContent.includes('LAST STAND'))")) throw new Error("Enemy list did not expose the saved v4 ability.");
    await clickAction("library-back");
    await waitFor(() => visible("creator-hub"), 5_000, "creator hub after enemy editor");
    await clickAction("back-main");
    await waitFor(() => visible("main-menu"), 5_000, "main menu return");

    // Prepare the late-game Mecha in the same profile flow a player would use:
    // unlock the tower, make room in the five-slot loadout, and equip it.
    await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', code: 'F1', bubbles: true, cancelable: true })); true");
    await waitFor(() => evaluate("!document.querySelector('#debug-panel')?.hidden"), 5_000, "debug panel for Mecha profile setup");
    await clickAction("debug-unlock");
    await clickAction("debug-close");
    await clickAction("open-shop");
    await waitFor(() => visible("tower-shop"), 5_000, "armory for Mecha loadout");
    await evaluate("(() => { const equipped = [...document.querySelectorAll('.shop-card.equipped')].find((card) => card.dataset.towerKind !== 'bandit'); if (!equipped) throw new Error('No equipped tower available to remove for Mecha.'); equipped.click(); const mecha = document.querySelector('.shop-card[data-tower-kind=mecha]'); if (!mecha) throw new Error('Mecha shop card missing.'); mecha.click(); return true; })()");
    await waitFor(() => evaluate("document.querySelector('#loadout-count')?.textContent === '5 / 5' && document.querySelector('#loadout-slots')?.textContent.includes('Tank')"), 5_000, "Tank loadout equip");
    await clickAction("back-main");
    await waitFor(() => visible("main-menu"), 5_000, "main menu after Mecha loadout");

    await clickAction("open-play");
    await waitFor(() => visible("battle-setup"), 5_000, "battle setup");
    await clickAction("start-map");
    await waitFor(() => evaluate("document.querySelector('.shell')?.classList.contains('run-active')"), 10_000, "run activation");
    await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', code: 'F1', bubbles: true, cancelable: true })); true");
    await waitFor(() => evaluate("!document.querySelector('#debug-panel')?.hidden"), 5_000, "debug panel for deployment");
    if (!await evaluate("Boolean(document.querySelector('[data-testid=debug-add-coins-500]') && document.querySelector('[data-testid=debug-add-token]') && document.querySelector('#debug-run-status') && document.querySelector('#debug-wave-input'))")) throw new Error("Debug console wallet, overview, or wave controls did not render.");
    await evaluate("document.querySelector('[data-testid=debug-add-coins-500]').click(); true");
    await waitFor(() => evaluate("document.querySelector('#debug-coins-value')?.textContent === '500'"), 5_000, "debug coin wallet update");
    await evaluate("document.querySelector('[data-testid=debug-add-token]').click(); true");
    await waitFor(() => evaluate("document.querySelector('#debug-tokens-value')?.textContent === '1'"), 5_000, "debug token wallet update");
    await clickAction("debug-unlock-perks");
    await waitFor(() => evaluate("document.querySelector('#debug-profile-count')?.textContent.includes('5 perks')"), 5_000, "debug perk unlock override");
    await clickAction("debug-equip-perks");
    await waitFor(() => evaluate("document.querySelector('#perk-loadout-count')?.textContent === '3 / 3'"), 5_000, "debug perk equip override");
    await clickAction("debug-cash-toggle");
    await clickAction("debug-close");

    await evaluate("(() => { const card = document.querySelector('[data-kind=mecha]'); if (!card) throw new Error('Mecha deployment card missing.'); card.click(); return true; })()");
    const canvasRect = await evaluate("(() => { const canvas = document.querySelector('#game-canvas'); if (!canvas) throw new Error('Battle canvas missing.'); const rect = canvas.getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }; })()");
    const mechaX = canvasRect.left + canvasRect.width * 0.5;
    const mechaY = canvasRect.top + canvasRect.height * 0.5;
    await cdp.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: mechaX, y: mechaY });
    await cdp.command("Input.dispatchMouseEvent", { type: "mousePressed", x: mechaX, y: mechaY, button: "left", clickCount: 1 });
    await cdp.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: mechaX, y: mechaY, button: "left", clickCount: 1 });
    await waitFor(() => evaluate("Boolean(document.querySelector('[data-testid=mecha-control-toggle]'))"), 5_000, "Mecha inspector control");
    if (!await evaluate("Boolean(document.querySelector('[data-testid=mecha-control-panel]')?.textContent.includes('WASD MOVE') && document.querySelector('[data-testid=mecha-control-toggle]')?.textContent.includes('ENTER PILOT MODE'))")) throw new Error("Mecha inspector control panel did not render.");
    for (let level = 1; level <= 3; level += 1) await clickAction("upgrade");
    await clickAction("toggle-mecha-control");
    await waitFor(() => evaluate("document.querySelector('[data-testid=mecha-control-toggle]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('[data-testid=mecha-control-toggle]')?.textContent.includes('LEAVE PILOT MODE')"), 5_000, "Mecha Pilot Mode entry");
    const initialMechaX = await evaluate("Number(document.querySelector('[data-testid=mecha-control-panel]')?.dataset.x)");
    await withHeldInput(
      () => cdp.command("Input.dispatchKeyEvent", { type: "keyDown", key: "d", code: "KeyD", windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 68 }),
      () => cdp.command("Input.dispatchKeyEvent", { type: "keyUp", key: "d", code: "KeyD", windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 68 }),
      () => waitFor(() => evaluate(`Number(document.querySelector('[data-testid=mecha-control-panel]')?.dataset.x) > ${initialMechaX + 5}`), 8_000, "Mecha WASD movement"),
    );
    await waitFor(() => evaluate("Number(document.querySelector('[data-testid=mecha-control-panel]')?.dataset.speed) === 0"), 5_000, "Tank brakes to rest after key release");
    await clickAction("close-inspector");
    await waitFor(() => evaluate("document.querySelector('#tower-inspector')?.hidden && !document.querySelector('#selected-pill')?.hidden && document.querySelector('[data-testid=mecha-control-toggle]')?.getAttribute('aria-pressed') === 'true'"), 5_000, "Mecha pilot inspector collapse");
    await cdp.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: mechaX + 120, y: mechaY });
    await withHeldInput(
      () => cdp.command("Input.dispatchMouseEvent", { type: "mousePressed", x: mechaX + 120, y: mechaY, button: "left", clickCount: 1 }),
      () => cdp.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: mechaX + 120, y: mechaY, button: "left", clickCount: 1 }),
      async () => {
        await waitFor(() => evaluate("Number(document.querySelector('.mecha-heat-track')?.getAttribute('aria-valuenow')) > 0"), 8_000, "Mecha cannon firing and heat");
      },
    );
    await cdp.command("Input.dispatchKeyEvent", { type: "keyDown", key: "f", code: "KeyF", windowsVirtualKeyCode: 70 });
    await cdp.command("Input.dispatchKeyEvent", { type: "keyUp", key: "f", code: "KeyF", windowsVirtualKeyCode: 70 });
    await waitFor(() => evaluate("Number(document.querySelector('[data-tank-cooldown=f] [role=progressbar]')?.getAttribute('aria-valuenow')) < 100"), 5_000, "Mecha missile cooldown");
    await cdp.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await cdp.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await waitFor(() => evaluate("document.querySelector('[data-testid=mecha-control-toggle]')?.getAttribute('aria-pressed') === 'false' && document.querySelector('[data-testid=mecha-control-toggle]')?.textContent.includes('ENTER PILOT MODE')"), 5_000, "Mecha Pilot Mode exit");
    await clickAction("reopen-inspector");
    await clickAction("sell");
    await waitFor(() => evaluate("document.querySelector('#tower-inspector')?.hidden === true"), 5_000, "Mecha sale after control smoke");
    await evaluate("(() => { const card = document.querySelector('[data-kind=bandit]'); if (!card) throw new Error('Battle deployment card missing.'); card.click(); return true; })()");
    for (const [x, y] of [[0.5, 0.5]]) {
      const clientX = canvasRect.left + canvasRect.width * x;
      const clientY = canvasRect.top + canvasRect.height * y;
      await cdp.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: clientX, y: clientY });
      await cdp.command("Input.dispatchMouseEvent", { type: "mousePressed", x: clientX, y: clientY, button: "left", clickCount: 1 });
      await cdp.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: clientX, y: clientY, button: "left", clickCount: 1 });
    }
    await waitFor(() => evaluate("Boolean(document.querySelector('[data-testid=tower-inspector-header]') && !document.querySelector('#tower-inspector')?.hidden)"), 5_000, "tower inspector");
    if (!await evaluate("Boolean(document.querySelector('.inspector-command-card') && document.querySelector('[data-testid=inspector-summary]') && document.querySelector('[data-testid=inspector-hp]') && document.querySelector('[data-testid=sell-value]') && document.querySelector('[data-testid=auto-counter-toggle]') && document.querySelector('#tower-inspector > .combat-dock'))")) throw new Error("Redesigned tower command card did not render.");
    const statCardRect = await evaluate("(() => { const card = document.querySelector('[data-testid=inspector-stat-card-damage]'); if (!card) throw new Error('Tower inspector stat card missing.'); const rect = card.getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }; })()");
    if (!await evaluate("(() => { const card = document.querySelector('[data-testid=inspector-stat-card-damage]'); return Boolean(card && card.tabIndex === 0 && card.getAttribute('role') === 'button' && card.getAttribute('aria-expanded') === 'false'); })()")) throw new Error("Tower inspector stat cards should expose keyboard hover cards.");
    const statCardX = statCardRect.left + statCardRect.width / 2;
    const statCardY = statCardRect.top + statCardRect.height / 2;
    await cdp.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: statCardX, y: statCardY });
    await waitFor(() => evaluate("document.querySelector('[data-testid=inspector-stat-card-damage]')?.dataset.popoverOpen === 'true'"), 5_000, "tower inspector stat hover");
    await cdp.command("Input.dispatchMouseEvent", { type: "mousePressed", x: statCardX, y: statCardY, button: "left", clickCount: 1 });
    await cdp.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: statCardX, y: statCardY, button: "left", clickCount: 1 });
    await cdp.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
    await waitFor(() => evaluate("(() => { const card = document.querySelector('[data-testid=inspector-stat-card-damage]'); const popover = document.querySelector('[data-testid=inspector-popover-damage]'); return card?.dataset.popoverOpen === 'false' && popover && getComputedStyle(popover).display === 'none'; })()"), 5_000, "tower inspector stat hover dismissal");
    await evaluate("(() => { window.__stableInspectorTarget = document.querySelector('[data-targeting=last]'); window.__stableInspectorTarget?.click(); return Boolean(window.__stableInspectorTarget); })()");
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!await evaluate("Boolean(window.__stableInspectorTarget === document.querySelector('[data-targeting=last]') && window.__stableInspectorTarget?.getAttribute('aria-pressed') === 'true')")) throw new Error("Live tower updates replaced an inspector action control.");
    if (!await evaluate("(() => { const panel = document.querySelector('#selection-panel'); const popover = document.querySelector('[data-testid=inspector-telemetry-popover]'); const trigger = document.querySelector('[data-testid=inspector-telemetry-trigger]'); const state = { ariaHidden: popover?.getAttribute('aria-hidden'), expanded: trigger?.getAttribute('aria-expanded'), scrollHeight: panel?.scrollHeight, clientHeight: panel?.clientHeight, children: [...(panel?.children ?? [])].map((child) => [child.className, Math.round(child.getBoundingClientRect().height), [...child.children].map((nested) => [nested.className, Math.round(nested.getBoundingClientRect().height)])]) }; if (state.ariaHidden !== 'true' || state.expanded !== 'false' || (state.scrollHeight ?? 0) > (state.clientHeight ?? 0) + 1) throw new Error('telemetry layout ' + JSON.stringify(state)); return true; })()")) throw new Error("Tower telemetry should be collapsed into a non-scrolling hover card by default.");
    const telemetryTriggerRect = await evaluate("(() => { const trigger = document.querySelector('[data-testid=inspector-telemetry-trigger]'); if (!trigger) throw new Error('Telemetry trigger missing.'); const rect = trigger.getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }; })()");
    // Hover over telemetry trigger: it must NOT open on hover
    await cdp.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: telemetryTriggerRect.left + telemetryTriggerRect.width / 2, y: telemetryTriggerRect.top + telemetryTriggerRect.height / 2 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (await evaluate("document.querySelector('[data-testid=inspector-telemetry-trigger]')?.dataset.popoverOpen === 'true'")) throw new Error("Telemetry should not open on hover; click is required.");
    // Click to open telemetry card
    await clickAction("toggle-inspector-details");
    await waitFor(() => evaluate("document.querySelector('[data-testid=inspector-telemetry-trigger]')?.dataset.popoverOpen === 'true'"), 5_000, "telemetry card opened on click");
    if (!await evaluate("Boolean(document.querySelector('[data-testid=inspector-telemetry-popover]'))")) throw new Error("Telemetry popover did not render.");
    // Moving mouse away should NOT dismiss click-opened telemetry
    await cdp.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (!await evaluate("document.querySelector('[data-testid=inspector-telemetry-trigger]')?.dataset.popoverOpen === 'true'")) throw new Error("Telemetry card should remain open after moving mouse away.");
    // Click again to close
    await clickAction("toggle-inspector-details");
    await waitFor(() => evaluate("document.querySelector('[data-testid=inspector-telemetry-trigger]')?.dataset.popoverOpen === 'false'"), 5_000, "telemetry card closed on click");
    if (!await evaluate("(() => { const card = document.querySelector('[data-testid=selected-perk-high-noon]'); return Boolean(card && card.querySelector(':scope > strong') && !card.querySelector(':scope > small')); })()")) throw new Error("Equipped perk inspector badges should show names without inline descriptions.");
    const perkBadgeRect = await evaluate("(() => { const card = document.querySelector('[data-testid=selected-perk-high-noon]'); if (!card) throw new Error('High Noon inspector badge missing.'); const rect = card.getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }; })()");
    await cdp.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: perkBadgeRect.left + perkBadgeRect.width / 2, y: perkBadgeRect.top + perkBadgeRect.height / 2 });
    await waitFor(() => evaluate("document.querySelector('[data-testid=selected-perk-high-noon]')?.dataset.popoverOpen === 'true' && getComputedStyle(document.querySelector('#inspector-perk-popover-high-noon'))?.display !== 'none'"), 5_000, "perk hover card");
    await cdp.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
    await waitFor(() => evaluate("document.querySelector('[data-testid=selected-perk-high-noon]')?.dataset.popoverOpen === 'false'"), 5_000, "perk hover card dismissal");
    await clickAction("toggle-inspector-details");
    await waitFor(() => evaluate("Boolean(document.querySelector('[data-testid=inspector-telemetry-popover]')?.getAttribute('aria-hidden') === 'false' && document.querySelector('[data-testid=inspector-live-systems]'))"), 5_000, "expanded tower telemetry hover card");
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!await evaluate("Boolean(document.querySelector('[data-testid=inspector-telemetry-popover]')?.getAttribute('aria-hidden') === 'false' && document.querySelector('[data-testid=inspector-telemetry-trigger]')?.getAttribute('aria-expanded') === 'true')")) throw new Error("Tower telemetry hover card did not persist through a live rerender.");
    await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', code: 'F1', bubbles: true, cancelable: true })); true");
    await waitFor(() => evaluate("!document.querySelector('#debug-panel')?.hidden"), 5_000, "F1 debug panel");
    if (!await evaluate("Boolean(document.querySelector('#debug-copy-repro')?.disabled)")) throw new Error("Repro action should be disabled outside a host multiplayer run.");
    await clickAction("debug-close");

    console.log("Electron UI smoke passed // menu, creator/drawing workflow, tower inspector, Mecha movement/weapons/stable controls, battle start, preload bridge, and F1 tools.");
  } catch (error) {
    // Capture the failing battle, not the startup DOM recorded before initialization.
    if (cdp) {
      let timer;
      try {
        const current = await Promise.race([
          cdp.command("Runtime.evaluate", { returnByValue: true, expression: `({ url: location.href, readyState: document.readyState, visibility: document.visibilityState, focused: document.hasFocus(), activeElement: document.activeElement?.outerHTML?.slice(0, 300), pilot: document.querySelector('[data-testid=mecha-control-panel]')?.dataset, controls: document.querySelector('[data-testid=mecha-control-panel]')?.textContent, body: document.body?.innerText?.slice(0, 2000) })` }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Renderer diagnostics timed out")), 3000); }),
        ]);
        rendererProbe = JSON.stringify(current.result?.value ?? current);
      } catch (probeError) { rendererProbe = `Current renderer unavailable: ${probeError.message}`; }
      finally { clearTimeout(timer); }
    }
    throw error;
  } finally {
    cdp?.close();
    if (!desktop.killed) desktop.kill();
    await new Promise((resolve) => {
      if (desktop.exitCode !== null) resolve();
      else desktop.once("exit", resolve);
    });
    await vite.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
};

try {
  await main();
} catch (error) {
  console.error(`Electron UI smoke failed // ${error instanceof Error ? error.message : String(error)}${rendererErrors.length ? `\nRENDERER ERRORS // ${rendererErrors.join("\n")}` : ""}${rendererProbe ? `\nRENDERER // ${rendererProbe}` : ""}${desktopOutput ? `\n${desktopOutput}` : ""}`);
  process.exitCode = 1;
}
