import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { existsSync, readdirSync } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 锁定的发行资产版本（GitHub Releases tag） */
export const ENGINE_VERSION = "3.10.1";
/**
 * 该发行包 get-version 端点自报的版本串。3.10.1 linux 发行包内嵌的是
 * "3.10-SNAPSHOT [TRUNK]"（打包怪癖，资产目录名为 openrefine-3.10.1）。
 * 契约文档记录此观察；断言以此实测字面量为独立真值。
 */
export const REPORTED_VERSION = "3.10-SNAPSHOT [TRUNK]";

export const ENGINE_PORT = 3333;

const POC_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(POC_ROOT, "../../..");
const WS = path.join(REPO_ROOT, "workspace");
const DIST = path.join(WS, "dist", `openrefine-${ENGINE_VERSION}`);
const JRE_DIR = path.join(WS, "jre");
const DATA_DIR = path.join(WS, "engine-data");
const ENGINE_LOG = path.join(WS, "engine.log");

const OPENREFINE_TARBALL = `openrefine-linux-${ENGINE_VERSION}.tar.gz`;
const OPENREFINE_URL = `https://github.com/OpenRefine/OpenRefine/releases/download/${ENGINE_VERSION}/${OPENREFINE_TARBALL}`;

export interface EngineHandle {
  child: ChildProcess;
  port: number;
}

function findJreHome(): string {
  const entries = readdirSync(JRE_DIR).filter((e) => e.startsWith("jdk"));
  if (entries.length !== 1) {
    throw new Error(`expected exactly one JDK dir under ${JRE_DIR}, found: ${entries.join(", ")}`);
  }
  const home = path.join(JRE_DIR, entries[0]!, "Contents", "Home");
  if (!existsSync(path.join(home, "bin", "java"))) {
    throw new Error(`no java binary under ${home}`);
  }
  return home;
}

/** 幂等安装检查：发行包与 JRE 缺失时指引到安装脚本（scripts/setup-engine.mjs 完成下载解压）。 */
export function ensureInstalled(): void {
  if (!existsSync(path.join(DIST, "refine"))) {
    throw new Error(
      `OpenRefine dist missing at ${DIST}. Run: node scripts/setup-engine.mjs (downloads ${OPENREFINE_URL})`,
    );
  }
  findJreHome();
}

export async function startEngine(): Promise<EngineHandle> {
  ensureInstalled();
  const jreHome = findJreHome();
  const log = createWriteStream(ENGINE_LOG, { flags: "a" });
  log.write(`\n===== engine start ${new Date().toISOString()} =====\n`);

  const child = spawn(path.join(DIST, "refine"), [
    "-p", String(ENGINE_PORT),
    "-i", "127.0.0.1",
    "-d", DATA_DIR,
  ], {
    env: {
      ...process.env,
      JAVA_HOME: jreHome, // 必须绝对路径：refine 脚本在自身目录下解析相对 JAVA_HOME
      REFINE_MEMORY: "2048M",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // 独立进程组：kill(-pid) 可连带 java 子进程一起收掉
  });
  child.stdout!.pipe(log);
  child.stderr!.pipe(log);

  try {
    await waitHealthy(ENGINE_PORT, 120_000);
  } catch (err) {
    // 健康检查失败必须回收子进程组，否则孤儿引擎占死端口（REVIEW 轮 1 修复）
    killGroup(child, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    killGroup(child, "SIGKILL");
    throw err;
  }
  return { child, port: ENGINE_PORT };
}

function killGroup(child: ChildProcess, sig: NodeJS.Signals): void {
  try {
    process.kill(-child.pid!, sig);
  } catch {
    child.kill(sig);
  }
}

export async function stopEngine(engine: EngineHandle): Promise<void> {
  const { child, port } = engine;
  killGroup(child, "SIGTERM");
  const exited = await Promise.race([
    once(child, "exit").then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 15_000)),
  ]);
  if (!exited) killGroup(child, "SIGKILL");

  const closed = await waitPortClosed(port, 15_000);
  if (!closed) throw new Error(`engine port ${port} still open after stop`);
}

async function waitHealthy(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/command/core/get-version`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await sleep(500);
  }
  throw new Error(`engine not healthy on port ${port} within ${timeoutMs}ms: ${String(lastErr)}`);
}

async function waitPortClosed(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/command/core/get-version`);
    } catch {
      return true;
    }
    await sleep(500);
  }
  return false;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
