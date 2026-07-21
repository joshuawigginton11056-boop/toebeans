import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  // Serve the repo-level /assets directory (art, audio) at the site root,
  // e.g. assets/slope/PineTree_Snow_1.glb -> /slope/PineTree_Snow_1.glb.
  publicDir: "../assets",
  server: {
    port: 5173,
  },
});
