import {
  TOWER_DEFINITIONS,
  TOWER_ORDER,
  TOWER_PERK_DEFINITIONS,
  TOWER_PERK_ORDER,
} from "../../game/config.ts";
import { icon } from "../icons.ts";
import { togglePerkLoadout, toggleTowerLoadout, unlockPerk, unlockTower } from "../../game/meta.ts";
import type { MetaProgress } from "../../game/meta.ts";
import type { TowerKind, TowerPerkKind } from "../../game/types.ts";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      case "'": return "&#39;";
      default: return char;
    }
  });
}

export function renderTowerShopHtml(): string {
  return `
    <div class="menu-screen tower-shop" id="tower-shop" hidden>
      <div class="shop-heading">
        <button class="page-back" data-action="back-main">${icon("back")}<span>Back</span></button>
        <div><div class="onboarding-kicker">LOADOUT &amp; UNLOCKS</div><h2>ARMORY</h2></div>
        <div class="meta-wallet compact"><div><span>COINS</span><strong id="shop-coins">0</strong></div><div><span>TOKENS</span><strong id="shop-tokens">0</strong></div></div>
      </div>
      <p>Purchase towers permanently, then equip up to five for each battle. Your active loadout controls deployment and hotkeys.</p>
      <section class="loadout-panel" aria-label="Active tower loadout">
        <div class="loadout-heading"><div><span>ACTIVE LOADOUT</span><small>THESE TOWERS ENTER BATTLE</small></div><strong id="loadout-count">1 / 5</strong></div>
        <div class="loadout-slots" id="loadout-slots"></div>
        <small class="loadout-note" id="loadout-note">Equip towers from the armory below.</small>
      </section>
      <section class="loadout-panel perk-loadout-panel" aria-label="Active perk loadout">
        <div class="loadout-heading"><div><span>ACTIVE PERKS</span><small>APPLY TO EVERY MATCHING TOWER</small></div><strong id="perk-loadout-count">0 / 3</strong></div>
        <div class="loadout-slots perk-loadout-slots" id="perk-loadout-slots"></div>
        <small class="loadout-note" id="perk-loadout-note">Purchase a perk below to unlock its profile effect.</small>
      </section>
      <div class="shop-grid">
        ${TOWER_ORDER.map((kind) => {
          const tower = TOWER_DEFINITIONS[kind];
          return `<button class="shop-card" data-action="buy-tower" data-tower-kind="${kind}" style="--accent:${tower.accent};--dim:${tower.dimAccent}">
            <span class="shop-glyph">${tower.glyph}</span>
            <span class="shop-copy"><strong>${tower.name}</strong><small>${tower.offPath.title} // $${tower.cost} DEPLOY</small></span>
            <b class="shop-price" id="shop-price-${kind}">${tower.unlockCost === 0 ? "STARTER" : `${tower.unlockCost} COINS`}</b>
          </button>`;
        }).join("")}
      </div>
      <div class="shop-grid perk-shop-grid" aria-label="Tower perk shop">
        ${TOWER_PERK_ORDER.map((kind) => {
          const perk = TOWER_PERK_DEFINITIONS[kind];
          const target = TOWER_DEFINITIONS[perk.target];
          const currency = perk.currency === "coins" ? "COINS" : "TOKENS";
          return `<button class="shop-card perk-shop-card" data-testid="perk-card-${kind}" data-action="buy-perk" data-perk-kind="${kind}" style="--accent:${perk.accent};--dim:${target.dimAccent}">
            <span class="shop-glyph">✦</span>
            <span class="shop-copy"><strong>${perk.name}</strong><small>${target.name.toUpperCase()} // ${currency}-PRICED</small></span>
            <b class="shop-price" id="perk-shop-price-${kind}">${perk.cost.toLocaleString()} ${currency}</b>
            <span class="perk-card-description">${perk.description}</span><span class="perk-card-tradeoff">TRADEOFF // ${perk.tradeoff}</span>
          </button>`;
        }).join("")}
      </div>
    </div>
  `;
}

export function renderLoadoutSlotsHtml(loadout: readonly TowerKind[]): string {
  return Array.from({ length: 5 }, (_, index) => {
    const kind = loadout[index];
    if (!kind) return `<div class="loadout-slot empty"><span>${index + 1}</span><small>EMPTY SLOT</small></div>`;
    const tower = TOWER_DEFINITIONS[kind];
    return `<div class="loadout-slot filled" style="--accent:${tower.accent};--dim:${tower.dimAccent}"><span class="loadout-slot-number">${index + 1}</span><b>${tower.glyph}</b><strong>${tower.name}</strong></div>`;
  }).join("");
}

export function renderPerkLoadoutSlotsHtml(perkLoadout: readonly TowerPerkKind[]): string {
  return Array.from({ length: 3 }, (_, index) => {
    const kind = perkLoadout[index];
    if (!kind) return `<div class="loadout-slot empty perk-slot" data-testid="perk-slot-${index}"><span>${index + 1}</span><small>EMPTY SLOT</small></div>`;
    const perk = TOWER_PERK_DEFINITIONS[kind];
    const target = TOWER_DEFINITIONS[perk.target];
    return `<div class="loadout-slot filled perk-slot" data-testid="perk-slot-${index}" style="--accent:${perk.accent};--dim:${target.dimAccent}" title="${escapeHtml(perk.description)}"><span class="loadout-slot-number">${index + 1}</span><b>✦</b><strong>${escapeHtml(perk.name)}</strong><small>${target.name.toUpperCase()}</small></div>`;
  }).join("");
}

export function updateShopAndLoadoutUi(root: ParentNode, progress: MetaProgress): void {
  const query = <T extends Element>(selector: string): T | null => root.querySelector<T>(selector);

  const loadoutSlots = query<HTMLElement>("#loadout-slots");
  if (loadoutSlots) loadoutSlots.innerHTML = renderLoadoutSlotsHtml(progress.loadout);

  const loadoutCount = query<HTMLElement>("#loadout-count");
  if (loadoutCount) loadoutCount.textContent = `${progress.loadout.length} / 5`;

  const loadoutNote = query<HTMLElement>("#loadout-note");
  if (loadoutNote) {
    loadoutNote.textContent = progress.loadout.length >= 5
      ? "Loadout full // toggle an equipped tower below to make room."
      : `${5 - progress.loadout.length} loadout ${5 - progress.loadout.length === 1 ? "slot" : "slots"} available.`;
  }

  const perkSlots = query<HTMLElement>("#perk-loadout-slots");
  if (perkSlots) perkSlots.innerHTML = renderPerkLoadoutSlotsHtml(progress.perkLoadout);

  const perkCount = query<HTMLElement>("#perk-loadout-count");
  if (perkCount) perkCount.textContent = `${progress.perkLoadout.length} / 3`;

  const perkNote = query<HTMLElement>("#perk-loadout-note");
  if (perkNote) {
    perkNote.textContent = progress.perkLoadout.length >= 3
      ? "Perk loadout full // toggle an equipped perk below to make room."
      : `${3 - progress.perkLoadout.length} perk ${3 - progress.perkLoadout.length === 1 ? "slot" : "slots"} available.`;
  }

  TOWER_ORDER.forEach((kind) => {
    const card = query<HTMLButtonElement>(`.shop-card[data-tower-kind='${kind}']`);
    if (!card) return;
    const owned = progress.unlockedTowers.includes(kind);
    const equipped = progress.loadout.includes(kind);
    const cost = TOWER_DEFINITIONS[kind].unlockCost;
    card.classList.toggle("owned", owned);
    card.classList.toggle("equipped", equipped);
    card.classList.toggle("unaffordable", !owned && progress.coins < cost);
    card.disabled = !owned && progress.coins < cost;
    card.dataset["action"] = owned ? "toggle-loadout" : "buy-tower";
    card.title = !owned
      ? `Unlock ${TOWER_DEFINITIONS[kind].name} for ${cost.toLocaleString()} Coins`
      : equipped
        ? "Remove from active loadout"
        : progress.loadout.length >= 5
          ? "Loadout full // remove another tower first"
          : "Equip for the next battle";
    const price = query<HTMLElement>(`#shop-price-${kind}`);
    if (price) price.textContent = owned ? (equipped ? "EQUIPPED" : "EQUIP") : `${cost.toLocaleString()} COINS`;
  });

  TOWER_PERK_ORDER.forEach((kind) => {
    const perk = TOWER_PERK_DEFINITIONS[kind];
    const card = query<HTMLButtonElement>(`.perk-shop-card[data-perk-kind='${kind}']`);
    if (!card) return;
    const owned = progress.unlockedPerks.includes(kind);
    const equipped = progress.perkLoadout.includes(kind);
    const balance = perk.currency === "coins" ? progress.coins : progress.tokens;
    card.classList.toggle("owned", owned);
    card.classList.toggle("equipped", equipped);
    card.classList.toggle("unaffordable", !owned && balance < perk.cost);
    card.disabled = !owned && balance < perk.cost;
    card.dataset["action"] = owned ? "toggle-perk-loadout" : "buy-perk";
    card.title = !owned
      ? `Unlock ${perk.name} for ${perk.cost.toLocaleString()} ${perk.currency === "coins" ? "Coins" : "Tokens"}`
      : equipped
        ? "Remove from active perk loadout"
        : progress.perkLoadout.length >= 3
          ? "Perk loadout full // remove another perk first"
          : `Equip ${perk.name} for matching ${TOWER_DEFINITIONS[perk.target].name} towers`;
    const price = query<HTMLElement>(`#perk-shop-price-${kind}`);
    if (price) price.textContent = owned ? (equipped ? "EQUIPPED" : "EQUIP") : `${perk.cost.toLocaleString()} ${perk.currency === "coins" ? "COINS" : "TOKENS"}`;
  });
}

export interface ShopActionContext {
  progress: MetaProgress;
  onLoadoutChange: () => void;
  onPerkChange?: () => void;
  onLog: (message: string, tone: "good" | "danger" | "neutral") => void;
  onAudioConfirm: () => void;
  onAudioError: () => void;
  renderMeta: () => void;
}

export function handleShopAction(action: string, value: string | undefined, ctx: ShopActionContext): boolean {
  if (action === "buy-tower") {
    if (value) {
      const kind = value as TowerKind;
      if (unlockTower(ctx.progress, kind)) {
        ctx.onLoadoutChange();
        ctx.onLog(`${TOWER_DEFINITIONS[kind].name} permanently unlocked${ctx.progress.loadout.includes(kind) ? " and equipped" : ""}.`, "good");
        ctx.onAudioConfirm();
      } else {
        ctx.onAudioError();
      }
      ctx.renderMeta();
    }
    return true;
  }

  if (action === "toggle-loadout") {
    if (value) {
      const kind = value as TowerKind;
      const result = toggleTowerLoadout(ctx.progress, kind);
      if (result === "equipped" || result === "unequipped") {
        ctx.onLoadoutChange();
        ctx.onLog(`${TOWER_DEFINITIONS[kind].name} ${result === "equipped" ? "equipped to" : "removed from"} the active loadout.`, "good");
        ctx.onAudioConfirm();
      } else if (result === "full") {
        ctx.onLog("Loadout full // remove an equipped tower before adding another.", "danger");
        ctx.onAudioError();
      }
      ctx.renderMeta();
    }
    return true;
  }

  if (action === "buy-perk") {
    if (value && TOWER_PERK_ORDER.includes(value as TowerPerkKind)) {
      const kind = value as TowerPerkKind;
      if (unlockPerk(ctx.progress, kind)) {
        ctx.onLoadoutChange();
        ctx.onPerkChange?.();
        ctx.onLog(`${TOWER_PERK_DEFINITIONS[kind].name} permanently unlocked${ctx.progress.perkLoadout.includes(kind) ? " and equipped" : ""}.`, "good");
        ctx.onAudioConfirm();
      } else {
        ctx.onAudioError();
      }
      ctx.renderMeta();
    }
    return true;
  }

  if (action === "toggle-perk-loadout") {
    if (value && TOWER_PERK_ORDER.includes(value as TowerPerkKind)) {
      const kind = value as TowerPerkKind;
      const result = togglePerkLoadout(ctx.progress, kind);
      if (result === "equipped" || result === "unequipped") {
        ctx.onLoadoutChange();
        ctx.onPerkChange?.();
        ctx.onLog(`${TOWER_PERK_DEFINITIONS[kind].name} ${result === "equipped" ? "equipped to" : "removed from"} the active perk loadout.`, "good");
        ctx.onAudioConfirm();
      } else if (result === "full") {
        ctx.onLog("Perk loadout full // remove an equipped perk before adding another.", "danger");
        ctx.onAudioError();
      }
      ctx.renderMeta();
    }
    return true;
  }

  return false;
}
