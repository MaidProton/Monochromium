import { TOWER_DEFINITIONS, TOWER_ORDER } from "../../game/config.ts";
import type { MultiplayerConnectionStatus } from "../../game/multiplayer.ts";
import type { TowerKind } from "../../game/types.ts";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return char;
    }
  });
}

export function isMultiplayerRoomCodeValid(raw: string): boolean {
  return /^[A-HJ-NP-Z2-9]{8}$/.test(raw.trim().toUpperCase());
}

export function formatMultiplayerRoomCode(value: string): string {
  const invite = /Monochromium room ([A-HJ-NP-Z2-9]{8})\b/i.exec(value);
  return (invite?.[1] ?? value).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

export const MULTIPLAYER_STATUS_LABELS: Partial<Record<MultiplayerConnectionStatus, string>> = {
  idle: "READY",
  "creating-room": "CONTACTING RELAY",
  "joining-room": "CONTACTING RELAY",
  connecting: "CONTACTING RELAY",
  "waiting-for-player": "WAITING FOR FRIEND",
  connected: "CONNECTED",
  disconnected: "FRIEND RECONNECTING",
  closed: "CONNECTION CLOSED",
};

export function resolveMultiplayerFailureLabel(detail?: string): string {
  const normalized = (detail ?? "").toLowerCase();
  if (normalized.includes("room not found") || normalized.includes("room expired")) return "ROOM NOT FOUND";
  if (normalized.includes("already has a guest")) return "ROOM FULL";
  if (normalized.includes("incompatible") || normalized.includes("protocol")) return "VERSION MISMATCH";
  return "SERVICE UNAVAILABLE";
}

export function resolveMultiplayerStatusLabel(status: MultiplayerConnectionStatus, detail = ""): string {
  if (status === "failed") {
    return resolveMultiplayerFailureLabel(detail);
  }
  return MULTIPLAYER_STATUS_LABELS[status] ?? status.replaceAll("-", " ").toUpperCase();
}

export function renderMultiplayerLoadoutGridHtml(
  unlockedTowers: readonly TowerKind[],
  currentLoadout: readonly TowerKind[],
  allowedTowersList?: readonly TowerKind[],
  inLobby = true,
): string {
  const owned = new Set(unlockedTowers);
  const allowed = new Set(allowedTowersList ?? unlockedTowers);

  return TOWER_ORDER.map((kind) => {
    const tower = TOWER_DEFINITIONS[kind];
    const equipped = currentLoadout.includes(kind) && allowed.has(kind);
    const unlocked = owned.has(kind) && allowed.has(kind);
    const unavailableReason = !owned.has(kind)
      ? "Unlock this tower in the shop"
      : !allowed.has(kind)
        ? "The host has not authorized this tower for the room"
        : "";

    return `<button class="multiplayer-loadout-tower${equipped ? " equipped" : ""}${unlocked ? "" : " locked"}" data-action="multiplayer-toggle-loadout" data-tower-kind="${kind}" style="--accent:${tower.accent};--dim:${tower.dimAccent}" ${unlocked && inLobby ? "" : "disabled"} title="${unlocked ? (equipped ? "Remove from next round" : "Equip for next round") : unavailableReason}"><b>${tower.glyph}</b><span>${escapeHtml(tower.name)}</span><small>${unlocked ? (equipped ? "EQUIPPED" : "EQUIP") : "LOCKED"}</small></button>`;
  }).join("");
}
