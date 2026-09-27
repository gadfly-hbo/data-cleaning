/** studio-api 独立入口：监听 127.0.0.1:8787（本地单用户；PORT 环境变量可覆盖）。 */

import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const app = await buildApp();

// 进程退出时回收引擎子进程（SIGINT/SIGTERM 覆盖 Ctrl-C 与 kill）
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
}

await app.listen({ port, host: "127.0.0.1" });
console.log(`studio-api listening on http://127.0.0.1:${port}`);
