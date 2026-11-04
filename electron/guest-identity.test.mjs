import { expect, it } from "vitest";
import { isGuestAction } from "./guest-identity.mjs";
it("accepts only the reserved guest for commands and continuous input", () => {
  const config = { players: [{ id: "host" }, { id: "guest" }] };
  expect(isGuestAction(config, { playerId: "guest" })).toBe(true);
  for (const action of [null, {}, { playerId: "host" }, { playerId: "unknown" }]) {
    expect(isGuestAction(config, action)).toBe(false);
  }
  expect(isGuestAction(null, { playerId: "guest" })).toBe(false);
});
