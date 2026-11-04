declare namespace Cloudflare {
  interface Env {
    ROOMS: DurableObjectNamespace<import("./src/index.ts").MultiplayerRoom>;
  }
}
