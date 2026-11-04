export type InGameChatState = "expanded" | "minimized" | "closed";

export interface ChatMessageEntry {
  readonly senderName: string;
  readonly senderColor: string;
  readonly text: string;
  readonly sentAt: number;
}

export const formatChatTime = (sentAt: number = Date.now()): string => {
  return new Date(sentAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
};

export const escapeChatText = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

export const sanitizeChatInput = (raw: string): string => {
  return raw
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 160);
};

export const renderChatEntryHtml = (entry: ChatMessageEntry): string => {
  const time = formatChatTime(entry.sentAt);
  const safeName = escapeChatText(entry.senderName);
  const safeText = escapeChatText(entry.text);
  const safeColor = escapeChatText(entry.senderColor || "#66d9ff");

  return `<div class="ingame-chat-entry">` +
    `<time>${time}</time>` +
    `<b style="color: ${safeColor}">${safeName}:</b>` +
    `<span>${safeText}</span>` +
    `</div>`;
};

export const renderToastHtml = (entry: ChatMessageEntry): string => {
  const safeName = escapeChatText(entry.senderName);
  const safeText = escapeChatText(entry.text);
  const safeColor = escapeChatText(entry.senderColor || "#66d9ff");

  return `<div class="ingame-chat-toast-content">` +
    `<span class="ingame-chat-toast-tag">TEAM</span>` +
    `<b style="color: ${safeColor}">${safeName}:</b> ` +
    `<span>${safeText}</span>` +
    `</div>`;
};

export interface InGameChatStore {
  getState(): InGameChatState;
  setState(state: InGameChatState): void;
  toggleOpen(): InGameChatState;
  toggleMinimize(): InGameChatState;
  getUnreadCount(): number;
  incrementUnread(): number;
  clearUnread(): void;
  getMessages(): readonly ChatMessageEntry[];
  addMessage(entry: ChatMessageEntry, maxHistory?: number): ChatMessageEntry;
  clearMessages(): void;
}

export const createInGameChatStore = (
  initialState: InGameChatState = "closed",
  initialMaxHistory: number = 100,
): InGameChatStore => {
  let state: InGameChatState = initialState;
  let unreadCount = 0;
  const messages: ChatMessageEntry[] = [];

  return {
    getState: () => state,
    setState: (nextState: InGameChatState) => {
      state = nextState;
      if (state === "expanded") {
        unreadCount = 0;
      }
    },
    toggleOpen: () => {
      state = state === "closed" ? "expanded" : "closed";
      if (state === "expanded") {
        unreadCount = 0;
      }
      return state;
    },
    toggleMinimize: () => {
      if (state === "closed") {
        state = "expanded";
        unreadCount = 0;
      } else if (state === "expanded") {
        state = "minimized";
      } else {
        state = "expanded";
        unreadCount = 0;
      }
      return state;
    },
    getUnreadCount: () => unreadCount,
    incrementUnread: () => {
      unreadCount += 1;
      return unreadCount;
    },
    clearUnread: () => {
      unreadCount = 0;
    },
    getMessages: () => Object.freeze([...messages]),
    addMessage: (entry: ChatMessageEntry, maxHistory: number = initialMaxHistory) => {
      messages.push(entry);
      while (messages.length > maxHistory) {
        messages.shift();
      }
      if (state !== "expanded") {
        unreadCount += 1;
      }
      return entry;
    },
    clearMessages: () => {
      messages.length = 0;
      unreadCount = 0;
    },
  };
};
