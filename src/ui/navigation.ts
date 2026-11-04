export type FrontScreen =
  | "main"
  | "setup"
  | "multiplayer"
  | "creators"
  | "enemies"
  | "enemy-creator"
  | "modes"
  | "map-library"
  | "map-creator"
  | "creator"
  | "shop";

export type OverlayState = "none" | "pause" | "settings" | "confirm";

export interface EscapeContext {
  readonly overlay: OverlayState;
  readonly transientOpen: boolean;
  readonly runActive: boolean;
  readonly frontScreen: FrontScreen;
}

export type EscapeAction = "dismiss-confirm" | "close-settings" | "close-transient" | "toggle-pause" | "navigate-back" | "none";

export const resolveEscapeAction = (context: EscapeContext): EscapeAction => {
  if (context.overlay === "confirm") return "dismiss-confirm";
  if (context.overlay === "settings") return "close-settings";
  if (context.overlay === "pause") return "toggle-pause";
  if (context.transientOpen) return "close-transient";
  if (context.runActive) return "toggle-pause";
  return context.frontScreen === "main" ? "none" : "navigate-back";
};

export const frontScreenBackTarget = (screen: FrontScreen): FrontScreen => {
  if (screen === "enemy-creator") return "enemies";
  if (screen === "map-creator") return "map-library";
  if (screen === "creator") return "modes";
  if (screen === "enemies" || screen === "modes" || screen === "map-library") return "creators";
  return "main";
};

