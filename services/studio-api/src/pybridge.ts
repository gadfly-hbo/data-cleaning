/** pybridge 子进程执行器：一次性 spawn，stdin JSON → stdout JSON，超时与非零退出转为结构化错误。 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PYBRIDGE_DIR = path.join(REPO_ROOT, "pybridge");
const DEFAULT_PYTHON = path.join(PYBRIDGE_DIR, ".venv", "bin", "python");
const TIMEOUT_MS = 120_000;

export class PyBridgeExecutor {
  constructor(private readonly pythonBin: string = DEFAULT_PYTHON) {}

  run(task: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.pythonBin, ["-m", "pybridge"], {
        cwd: PYBRIDGE_DIR,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`pybridge timeout after ${TIMEOUT_MS}ms`));
      }, TIMEOUT_MS);

      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`pybridge spawn failed: ${err.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          try {
            resolve(JSON.parse(stdout));
          } catch (err) {
            reject(new Error(`pybridge output not JSON: ${stdout.slice(0, 200)}`));
          }
        } else {
          reject(new Error(`pybridge exit ${code}: ${stderr.trim().slice(0, 300)}`));
        }
      });
      child.stdin.end(JSON.stringify(task));
    });
  }
}
