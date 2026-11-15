import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.VQA_BACKEND_DIR || fileURLToPath(new URL("../../", import.meta.url));
const venv = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const python = process.env.VQA_PYTHON || (existsSync(venv) ? venv : "python");
if (!existsSync(path.join(root, "app/api/main.py"))) throw new Error("Run the API checks from the full integration checkout containing app/api/main.py.");
const child = spawn(python, ["-m", "uvicorn", "app.api.main:app", "--host", "127.0.0.1", "--port", "18082"], {
  cwd: root, stdio: "inherit", env: { ...process.env, R5_DATABASE_URL: "" }, windowsHide: true,
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
