export type UiIconName = "play" | "users" | "tower" | "tools" | "settings" | "menu" | "pause" | "speed" | "audio" | "back" | "resume" | "exit" | "chat";

const paths: Record<UiIconName, string> = {
  play: '<path d="M8 5v14l11-7z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  tower: '<path d="M5 21h14M7 21V9h10v12M9 9V4h2v3h2V4h2v5M10 13h4M10 17h4"/>',
  tools: '<path d="M14.7 6.3a4 4 0 0 0-5-5l2.1 2.1-2.8 2.8-2.1-2.1a4 4 0 0 0 5 5L20 17.2a2 2 0 0 1-2.8 2.8L9.1 11.9a4 4 0 0 0-5-5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  speed: '<path d="M4 12a8 8 0 1 1 16 0M12 12l5-4"/><circle cx="12" cy="12" r="1"/>',
  audio: '<path d="M11 5 6 9H2v6h4l5 4zM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  resume: '<path d="M8 5v14l11-7z"/>',
  exit: '<path d="M10 17l5-5-5-5M15 12H3M15 4h5v16h-5"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
};

export const icon = (name: UiIconName): string =>
  `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;

export interface ControlReference {
  readonly keys: string;
  readonly label: string;
  readonly description: string;
}

export const CONTROL_REFERENCE: readonly ControlReference[] = Object.freeze([
  { keys: "Esc", label: "Game menu", description: "Close the current tool or open the pause menu." },
  { keys: "Enter", label: "Team chat", description: "Open multiplayer chat overlay or send message." },
  { keys: "P", label: "Pause", description: "Pause or resume the simulation directly." },
  { keys: "1–5", label: "Build slots", description: "Select a tower from the active loadout." },
  { keys: "Space", label: "Counter", description: "Counter with the selected pathbound tower." },
  { keys: "Q", label: "Move tower", description: "Relocate the selected tower on or off the path." },
  { keys: "F / G / H", label: "Abilities", description: "Activate unlocked abilities on the selected tower." },
  { keys: "Tab", label: "Battle log", description: "Show or hide the field log." },
  { keys: "Mouse wheel", label: "Camera zoom", description: "Zoom the battlefield camera." },
  { keys: "Drag / RMB", label: "Camera / cancel", description: "Pan the camera or cancel placement and aiming." },
  { keys: "F11", label: "Fullscreen", description: "Switch between windowed and fullscreen display." },
]);
