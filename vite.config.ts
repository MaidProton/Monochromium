import { defineConfig } from "vite";

export default defineConfig({
  // Relative production assets work from Electron's file:// origin while the
  // development server continues to serve them normally.
  base: "./",
});
