import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  cacheDir: ".vite-temp",
  server: {
    port: 5173,
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.{test,spec}.{js,jsx}"],
    setupFiles: "./src/test/setup.js",
    css: true,
  },
});
