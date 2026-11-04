/** Hold a real input until its observable result, and release even on failure. */
export async function withHeldInput(press, release, observe) {
  await press();
  try { await observe(); }
  finally { await release(); }
}
