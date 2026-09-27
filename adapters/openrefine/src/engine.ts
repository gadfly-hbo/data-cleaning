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

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SRC_DIR, "../../..");
const WS = path.join(REPO_ROOT, "workspace");
const DIST = path.join(WS, "dist", `openrefine-${ENGINE_VERSION}`);
const JRE_DIR = path.join(WS, "jre");
const DATA_DIR = path.join(WS, "engine-data");
const ENGINE_LOG = path.join(WS, "engine.log");

const OPENREFINE_TARBALL = `openrefine-linux-${ENGINE_VERSION}.tar.gz`;
const OPENREFINE_URL = `https://github.com/OpenRefine/OpenRefine/releases/download/${ENGINE_VERSION}/${OPENREFINE_TARBALL}`;

export interface EngineHandle {
  /** 复用外部已健康引擎时为 null（我们未持有进程句柄，stop 不做回收） */
  child: ChildProcess | null;
  port: number;
  /** true = 端口上已有健康引擎，直接复用（REVIEW 轮 2：消除双 spawn 与误判所有权） */
  reused: boolean;
}

/**
 * JRE resolution: prefer workspace/jre (macOS layout, installed by setup-engine);
 * fall back to JAVA_HOME or system PATH java (container image uses openjdk-21).
 * See M5/S5 containerization.
 */
function findJreHome(): string | null {
  if (existsSync(JRE_DIR)) {
    const entries = readdirSync(JRE_DIR).filter((e) => e.startsWith("jdk"));
    if (entries.length === 1) {
      const home = path.join(JRE_DIR, entries[0]!, "Contents", "Home");
      if (existsSync(path.join(home, "bin", "java"))) {
        return home;
      }
    }
  }
  const envHome = process.env.JAVA_HOME;
  if (envHome && existsSync(path.join(envHome, "bin", "java"))) {
    return envHome;
  }
  return null; // 系统 PATH 上的 java（容器/服务器形态）
}

/** 幂等安装检查：发行包缺失时指引到安装脚本；JRE 快速失败见 startEngine 开头。 */
export function ensureInstalled(): void {
  if (!existsSync(path.join(DIST, "refine"))) {
    throw new Error(
      `OpenRefine dist missing at ${DIST}. Run: node scripts/setup-engine.mjs (downloads ${OPENREFINE_URL})`,
    );
  }
}

export async function startEngine(): Promise<EngineHandle> {
  ensureInstalled();
  // JRE 快速失败（REVIEW 轮 1 建议 6 / 轮 3 落地）：无 workspace/jre、无 JAVA_HOME、
  // PATH 也没有 java 时立即指引，而非 120s 超时 + 泛化报错
  if (
    findJreHome() === null &&
    !process.env.PATH?.split(":").some((p) => existsSync(path.join(p, "java")))
  ) {
    throw new Error(
      "no java found: run node scripts/setup-engine.mjs (installs workspace/jre) or install a JDK/JRE",
    );
  }
  // 先探测复用：端口上已有健康引擎（如上一测试套件或外部进程遗留）直接复用，
  // 不再 spawn（spawn 会绑定失败退出，且让我们误持有"所有权"导致 stop 误杀/误查端口）
  try {
    await waitHealthy(ENGINE_PORT, 2_000);
    return { child: null, port: ENGINE_PORT, reused: true };
  } catch {
    // 端口无健康引擎——走正常启动
  }
  // 冷启动重叠窗口（M4 轮 3 清偿①）：spawn 后若 child 因端口被占早退（他人引擎
  // 尚在启动中），waitHealthy 会打到他人引擎成功——此时本地 child 已死，转判复用
  // 语义，避免 stopEngine 对死 child 误查端口
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
      ...(jreHome ? { JAVA_HOME: jreHome } : {}), // 本地 JRE 必须绝对路径（refine 相对路径陷阱）；null=系统 java
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
  // 冷启动重叠窗口（M4 轮 3 清偿①）：本地 child 因端口被占早退（他人引擎尚在
  // 启动中）而 waitHealthy 打到他人引擎成功——转判复用，避免 stop 误查端口
  if (child.exitCode !== null || child.signalCode !== null) {
    log.write(`===== engine reused (local spawn exited early) =====\n`);
    return { child: null, port: ENGINE_PORT, reused: true };
  }
  return { child, port: ENGINE_PORT, reused: false };
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
  if (child === null) {
    return; // 复用的外部引擎：非我们所有，不杀不查端口（REVIEW 轮 2）
  }
  // 两段式（REVIEW 轮 1 修复）：操作后的项目状态只靠 JVM 优雅退出落盘（TERM 对照实验证明
  // KILL 会损坏已应用操作的项目），TERM 优先 + 有界等待；child 已死亡时（外部崩溃/被杀）
  // exit 事件已发过、once 永不 resolve——用 exitCode+signalCode 双守卫（REVIEW 轮 2）
  if (child.exitCode === null && child.signalCode === null) {
    killGroup(child, "SIGTERM");
    const exited = await Promise.race([
      once(child, "exit").then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 12_000)),
    ]);
    if (!exited && child.exitCode === null && child.signalCode === null) {
      killGroup(child, "SIGKILL");
      await once(child, "exit").catch(() => undefined);
    }
  }

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
