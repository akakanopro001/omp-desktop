import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The managed Freebuff preview injects PORT and proxies the dev server; keep the
// host bound to 0.0.0.0 so the preview tunnel can reach it.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: Number(process.env.PORT ?? 5173),
    strictPort: false,
    // Freebuff manages the dev/preview processes; HMR stays off on purpose.
    hmr: false,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
