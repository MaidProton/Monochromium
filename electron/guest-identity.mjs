/** Bind remote actions to the guest slot owned by the admitted relay peer. */
export const isGuestAction = (config, action) => {
  const guestId = config?.players?.[1]?.id;
  return typeof guestId === "string" && typeof action?.playerId === "string" && action.playerId === guestId;
};
