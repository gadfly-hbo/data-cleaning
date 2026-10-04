/** studio-api 独立入口：默认监听 127.0.0.1:8787（本地单用户）；PORT/HOST 环境变量可覆盖（容器需 HOST=0.0.0.0）。 */

import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1"; // 容器形态需 0.0.0.0（REVIEW 轮 2 BLOCKER 2）
const app = await buildApp({ localAuthBypass: true });

// 进程退出时回收引擎子进程（SIGINT/SIGTERM 覆盖 Ctrl-C 与 kill）
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
}

await app.listen({ port, host });
console.log(`studio-api listening on http://${host}:${port}`);
