import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // live 引擎单实例：串行执行，避免并发打爆（PRD GRILL D7）
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 600_000,
  },
});
