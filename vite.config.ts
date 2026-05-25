import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  // see workspace memory: vite cacheDir under node_modules breaks with symlinked deps
  cacheDir: path.resolve(__dirname, ".vite"),
  server: {
    host: true,
    // allow ngrok and any tunnel host
    allowedHosts: true,
  },
});
