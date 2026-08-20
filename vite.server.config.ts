import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    target: "node22",
    outDir: "dist-server",
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, "src/server/simulationServer.ts"),
      formats: ["es"],
      fileName: () => "simulation-server.mjs",
    },
    rollupOptions: {
      external: ["electron"],
    },
  },
});
