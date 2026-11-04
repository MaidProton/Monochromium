import type { SimulationEvent } from "../game/simulationProtocol.ts";

/** Collapse repeated cosmetic attacks, but retain individually timed launches. */
export function coalesceEvents(events: readonly SimulationEvent[]): SimulationEvent[] {
  const output: SimulationEvent[] = [];
  for (const event of events) {
    const previous = output[output.length - 1];
    // Missile count is the rack index, not a number of interchangeable attacks.
    // Merging it loses warheads and turns that sum into a bogus launch delay.
    if (previous?.kind === "attack" && event.kind === "attack" && event.label !== "mecha-missile" &&
      previous.label === event.label && previous.entityId === event.entityId &&
      previous.targetId === event.targetId && event.tick - previous.tick <= 6 && previous.visual === event.visual) {
      const previousTicks = previous.occurrenceTickOffsets ?? [0];
      const occurrenceTickOffsets = [
        ...previousTicks.map((offset) => previous.tick + offset - event.tick),
        0,
      ].slice(-16);
      output[output.length - 1] = {
        ...event,
        count: Math.min(128, (previous.count ?? 1) + (event.count ?? 1)),
        occurrenceTickOffsets,
      };
    } else output.push(event);
  }
  return output;
}
