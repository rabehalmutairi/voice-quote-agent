import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxy = { "/api": { target: env.BACKEND_ORIGIN || "http://127.0.0.1:8002", changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, "") } };
  return {
  plugins: [react()],
  cacheDir: ".vite-temp",
  server: {
    port: 5173,
    proxy,
  },
  test: {
    env: { VITE_TRANSPORT: "mock" },
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.{test,spec}.{js,jsx}"],
    setupFiles: "./src/test/setup.js",
    css: true,
  },
  preview: { proxy },
  };
});
