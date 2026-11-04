import { describe, expect, it } from "vitest";
import {
  createInGameChatStore,
  escapeChatText,
  formatChatTime,
  renderChatEntryHtml,
  renderToastHtml,
  sanitizeChatInput,
} from "./ingameChat.ts";

describe("ingameChat", () => {
  describe("escapeChatText", () => {
    it("escapes dangerous HTML characters to prevent XSS injection", () => {
      const malicious = '<script>alert("xss")</script> & \'test\'';
      const escaped = escapeChatText(malicious);
      expect(escaped).not.toContain("<script>");
      expect(escaped).toBe("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#039;test&#039;");
    });
  });

  describe("sanitizeChatInput", () => {
    it("trims whitespace, removes control characters, and truncates to 160 characters", () => {
      expect(sanitizeChatInput("   hello world   ")).toBe("hello world");
      expect(sanitizeChatInput("hello\u0000world\u001F")).toBe("helloworld");
      const longText = "a".repeat(200);
      expect(sanitizeChatInput(longText)).toHaveLength(160);
    });
  });

  describe("formatChatTime", () => {
    it("formats epoch milliseconds into HH:MM:SS format", () => {
      const timestamp = new Date(2026, 8, 8, 14, 30, 45).getTime();
      const formatted = formatChatTime(timestamp);
      expect(formatted).toBe("14:30:45");
    });
  });

  describe("renderChatEntryHtml and renderToastHtml", () => {
    it("renders safe, valid HTML for a chat log entry", () => {
      const entry = {
        senderName: "PlayerOne",
        senderColor: "#66d9ff",
        text: "Need support on lane 2!",
        sentAt: 1788888888000,
      };
      const html = renderChatEntryHtml(entry);
      expect(html).toContain('class="ingame-chat-entry"');
      expect(html).toContain('style="color: #66d9ff"');
      expect(html).toContain("PlayerOne:");
      expect(html).toContain("Need support on lane 2!");
    });

    it("renders safe, valid HTML for a floating message toast", () => {
      const entry = {
        senderName: "<Admin>",
        senderColor: "#ff5555",
        text: "<b>Boss incoming!</b>",
        sentAt: 1788888888000,
      };
      const html = renderToastHtml(entry);
      expect(html).toContain('class="ingame-chat-toast-content"');
      expect(html).toContain("&lt;Admin&gt;:");
      expect(html).toContain("&lt;b&gt;Boss incoming!&lt;/b&gt;");
    });
  });

  describe("createInGameChatStore", () => {
    it("initializes with the specified state and zero unread", () => {
      const store = createInGameChatStore("closed");
      expect(store.getState()).toBe("closed");
      expect(store.getUnreadCount()).toBe(0);
      expect(store.getMessages()).toEqual([]);
    });

    it("toggles open between expanded and closed", () => {
      const store = createInGameChatStore("closed");
      expect(store.toggleOpen()).toBe("expanded");
      expect(store.getState()).toBe("expanded");
      expect(store.toggleOpen()).toBe("closed");
      expect(store.getState()).toBe("closed");
    });

    it("toggles minimize between expanded and minimized", () => {
      const store = createInGameChatStore("closed");
      expect(store.toggleMinimize()).toBe("expanded");
      expect(store.toggleMinimize()).toBe("minimized");
      expect(store.toggleMinimize()).toBe("expanded");
    });

    it("tracks unread count when messages arrive while not expanded, and resets on expansion", () => {
      const store = createInGameChatStore("closed");
      store.addMessage({ senderName: "P1", senderColor: "#fff", text: "Hello", sentAt: 1000 });
      expect(store.getUnreadCount()).toBe(1);

      store.addMessage({ senderName: "P1", senderColor: "#fff", text: "Second msg", sentAt: 2000 });
      expect(store.getUnreadCount()).toBe(2);

      // Opening/expanding resets unread count
      store.setState("expanded");
      expect(store.getUnreadCount()).toBe(0);

      // When expanded, incoming messages do not increment unread count
      store.addMessage({ senderName: "P1", senderColor: "#fff", text: "Third msg", sentAt: 3000 });
      expect(store.getUnreadCount()).toBe(0);

      // Minimizing makes subsequent incoming messages increment unread count
      store.setState("minimized");
      store.addMessage({ senderName: "P1", senderColor: "#fff", text: "Fourth msg", sentAt: 4000 });
      expect(store.getUnreadCount()).toBe(1);
    });

    it("caps messages at maxHistory limit", () => {
      const store = createInGameChatStore("expanded", 3);
      store.addMessage({ senderName: "P1", senderColor: "#fff", text: "1", sentAt: 1 });
      store.addMessage({ senderName: "P1", senderColor: "#fff", text: "2", sentAt: 2 });
      store.addMessage({ senderName: "P1", senderColor: "#fff", text: "3", sentAt: 3 });
      store.addMessage({ senderName: "P1", senderColor: "#fff", text: "4", sentAt: 4 });

      const messages = store.getMessages();
      expect(messages).toHaveLength(3);
      expect(messages[0]?.text).toBe("2");
      expect(messages[2]?.text).toBe("4");
    });
  });
});
