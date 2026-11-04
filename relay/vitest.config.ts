import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

process.env["WRANGLER_LOG_PATH"] = "./.wrangler-logs/wrangler.log";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./relay/wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["relay/test/**/*.test.ts"],
  },
});
