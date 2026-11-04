import { describe, expect, it } from "vitest";
import type { TowerKind } from "../../game/types.ts";
import {
  formatMultiplayerRoomCode,
  isMultiplayerRoomCodeValid,
  renderMultiplayerLoadoutGridHtml,
  resolveMultiplayerFailureLabel,
  resolveMultiplayerStatusLabel,
} from "./multiplayerLobby.ts";

describe("multiplayerLobby", () => {
  describe("isMultiplayerRoomCodeValid", () => {
    it("accepts valid 8-character Base32 room codes", () => {
      expect(isMultiplayerRoomCodeValid("ABCD2345")).toBe(true);
      expect(isMultiplayerRoomCodeValid("  ZXYW9876  ")).toBe(true);
      expect(isMultiplayerRoomCodeValid("abcd2345")).toBe(true);
    });

    it("rejects codes with excluded Crockford/Base32 letters (I, L, O, 0, 1) or invalid symbols", () => {
      expect(isMultiplayerRoomCodeValid("ABCD1234")).toBe(false); // contains 1
      expect(isMultiplayerRoomCodeValid("ABCD0234")).toBe(false); // contains 0
      expect(isMultiplayerRoomCodeValid("ABCDI234")).toBe(false); // contains I
      expect(isMultiplayerRoomCodeValid("ABCDO234")).toBe(false); // contains O
      expect(isMultiplayerRoomCodeValid("ABCD-234")).toBe(false); // special char
      expect(isMultiplayerRoomCodeValid("ABC")).toBe(false); // too short
      expect(isMultiplayerRoomCodeValid("ABCDEFGH2345")).toBe(false); // too long
    });
  });

  describe("formatMultiplayerRoomCode", () => {
    it("sanitizes, uppercases, and truncates input to 8 characters", () => {
      expect(formatMultiplayerRoomCode("abcd-efgh-extra")).toBe("ABCDEFGH");
      expect(formatMultiplayerRoomCode("  x2y3!z4  ")).toBe("X2Y3Z4");
    });
  });

  describe("resolveMultiplayerStatusLabel and resolveMultiplayerFailureLabel", () => {
    it("resolves friendly labels for normal statuses", () => {
      expect(resolveMultiplayerStatusLabel("idle")).toBe("READY");
      expect(resolveMultiplayerStatusLabel("creating-room")).toBe("CONTACTING RELAY");
      expect(resolveMultiplayerStatusLabel("waiting-for-player")).toBe("WAITING FOR FRIEND");
      expect(resolveMultiplayerStatusLabel("connected")).toBe("CONNECTED");
    });

    it("resolves specific failure labels depending on error detail", () => {
      expect(resolveMultiplayerStatusLabel("failed", "Room not found")).toBe("ROOM NOT FOUND");
      expect(resolveMultiplayerStatusLabel("failed", "Room expired")).toBe("ROOM NOT FOUND");
      expect(resolveMultiplayerStatusLabel("failed", "Room already has a guest")).toBe("ROOM FULL");
      expect(resolveMultiplayerStatusLabel("failed", "Incompatible protocol version")).toBe("VERSION MISMATCH");
      expect(resolveMultiplayerStatusLabel("failed", "Timeout")).toBe("SERVICE UNAVAILABLE");
      expect(resolveMultiplayerFailureLabel(undefined)).toBe("SERVICE UNAVAILABLE");
    });
  });

  describe("renderMultiplayerLoadoutGridHtml", () => {
    it("renders towers with equipped, locked, and available states", () => {
      const unlocked: TowerKind[] = ["bandit", "samurai", "tempest"];
      const loadout: TowerKind[] = ["bandit"];
      const allowed: TowerKind[] = ["bandit", "samurai"];

      const html = renderMultiplayerLoadoutGridHtml(unlocked, loadout, allowed, true);

      expect(html).toContain('data-tower-kind="bandit"');
      expect(html).toContain("multiplayer-loadout-tower equipped");
      expect(html).toContain("EQUIPPED");

      expect(html).toContain('data-tower-kind="samurai"');
      expect(html).toContain("EQUIP");

      // mecha is not unlocked, should be locked
      expect(html).toContain('data-tower-kind="mecha"');
      expect(html).toContain("multiplayer-loadout-tower locked");
      expect(html).toContain("LOCKED");
    });

    it("disables buttons when not in lobby", () => {
      const unlocked: TowerKind[] = ["bandit"];
      const loadout: TowerKind[] = ["bandit"];

      const html = renderMultiplayerLoadoutGridHtml(unlocked, loadout, undefined, false);
      expect(html).toContain('disabled title="Remove from next round"');
    });
  });
});

it("accepts an official invite copied by older clients", () => {
  expect(formatMultiplayerRoomCode("Monochromium room ABCD2345\nOpen Multiplayer → Join a Friend")).toBe("ABCD2345");
});
