import { spawn } from "node:child_process";

for (const scenario of ["default", "one_failed", "all_failed", "no_shops", "retry"]) {
  console.log(`\nBackend scenario: ${scenario}`);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.api.config.js"], {
      stdio: "inherit", env: { ...process.env, MOCK_SCENARIO: scenario }, windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code !== 0) { process.exitCode = code ?? 1; break; }
}
