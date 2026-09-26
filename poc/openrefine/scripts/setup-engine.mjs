/**
 * 幂等安装 OpenRefine 引擎与 JRE 到仓库 workspace/（全部不入库、不碰系统）。
 * 用法：node scripts/setup-engine.mjs
 * 已就位则直接跳过；中断后重跑安全（tar 覆盖解压）。
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WS = path.join(REPO, "workspace");
const DL = path.join(WS, "dl");
const DIST = path.join(WS, "dist");
const JRE = path.join(WS, "jre");

const OPENREFINE_VERSION = "3.10.1";
const DIST_TARBALL = `openrefine-linux-${OPENREFINE_VERSION}.tar.gz`;
const DIST_URL = `https://github.com/OpenRefine/OpenRefine/releases/download/${OPENREFINE_VERSION}/${DIST_TARBALL}`;
// 与 src/engine.ts 的 JRE_URL 保持一致（钉死版本）
const JRE_URL =
  "https://api.adoptium.net/v3/binary/version/jdk-21.0.12.1%2B1/mac/aarch64/jre/hotspot/normal/eclipse";
const JRE_TARBALL = "temurin21-jre-mac-arm64.tar.gz";

function sh(cmd) {
  console.log(`+ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function download(url, dest) {
  if (existsSync(dest)) {
    console.log(`已存在，跳过下载: ${dest}`);
    return;
  }
  // 先下到 .part 再原子改名：下载中途被杀不会留下被误判为完整的坏档
  const tmp = `${dest}.part`;
  sh(`curl -L --fail -o "${tmp}" "${url}"`);
  renameSync(tmp, dest);
}

mkdirSync(DL, { recursive: true });
mkdirSync(DIST, { recursive: true });
mkdirSync(JRE, { recursive: true });

if (existsSync(path.join(DIST, `openrefine-${OPENREFINE_VERSION}`, "refine"))) {
  console.log(`OpenRefine ${OPENREFINE_VERSION} 已安装，跳过`);
} else {
  download(DIST_URL, path.join(DL, DIST_TARBALL));
  sh(`tar -xzf "${path.join(DL, DIST_TARBALL)}" -C "${DIST}"`);
}

if (existsSync(path.join(JRE, "jdk-21.0.12.1+1-jre"))) {
  console.log("Temurin 21 JRE 已安装，跳过");
} else {
  download(JRE_URL, path.join(DL, JRE_TARBALL));
  sh(`tar -xzf "${path.join(DL, JRE_TARBALL)}" -C "${JRE}"`);
}

console.log("引擎环境就绪。");
