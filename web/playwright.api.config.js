import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-api", fullyParallel: true, workers: 2, reporter: "list",
  outputDir: "test-results-api",
  use: { baseURL: "http://127.0.0.1:18517", trace: "retain-on-failure" },
  webServer: [
    { command: "node scripts/serve-backend.mjs", url: "http://127.0.0.1:18082/openapi.json", reuseExistingServer: false, env: { MOCK_SCENARIO: process.env.MOCK_SCENARIO || "default" } },
    { command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 18517 --strictPort", url: "http://127.0.0.1:18517", reuseExistingServer: false, env: { VITE_TRANSPORT: "api", VITE_API_BASE_URL: "/api", BACKEND_ORIGIN: "http://127.0.0.1:18082" } },
  ],
  projects: [{ name: "api-desktop", use: { ...devices["Desktop Chrome"] } }, { name: "api-mobile", use: { ...devices["Pixel 5"] } }],
});
