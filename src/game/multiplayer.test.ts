import { describe, expect, it } from "vitest";
import { isValidMultiplayerRoomCode, MultiplayerSession, sanitizeMultiplayerPlayer } from "./multiplayer.ts";

describe("relay room codes", () => {
  it("accepts only normalized eight-character codes from the unambiguous alphabet", () => {
    expect(isValidMultiplayerRoomCode("ABCD-2345")).toBe(true);
    expect(isValidMultiplayerRoomCode("abcd 2345")).toBe(true);
    expect(isValidMultiplayerRoomCode("ABCD234")).toBe(false);
    expect(isValidMultiplayerRoomCode("ABCD2341")).toBe(false);
    expect(isValidMultiplayerRoomCode("ABCD234O")).toBe(false);
  });
});

describe("multiplayer player sanitization", () => {
  it("uses PLAYER for an empty submitted username", () => {
    expect(sanitizeMultiplayerPlayer({ username: "   " }).username).toBe("PLAYER");
  });
});

describe("multiplayer chat handling", () => {
  it("processes and validates chat messages over the control channel", () => {
    const controls: unknown[] = [];
    const session = new MultiplayerSession({
      onStatus: () => {},
      onControl: (msg) => controls.push(msg),
      onRealtime: () => {},
      onBinary: () => {},
    });

    // Simulate connection
    session.handleDesktopMessage({
      type: "status",
      status: "connected",
      peerId: "relay-guest",
    });

    session.handleDesktopMessage({
      type: "control",
      peerId: "relay-guest",
      message: {
        type: "chat",
        text: "Ready to launch wave!",
        senderId: "player-guest-1",
        senderName: "ALLY",
        senderColor: "#ff99cc",
        sentAt: 12345678,
      },
    });

    expect(controls).toHaveLength(1);
    expect(controls[0]).toEqual({
      type: "chat",
      text: "Ready to launch wave!",
      senderId: "player-guest-1",
      senderName: "ALLY",
      senderColor: "#ff99cc",
      sentAt: 12345678,
    });
  });
});
