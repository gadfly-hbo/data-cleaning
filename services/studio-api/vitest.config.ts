import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 600_000,
    // vite 解析器不认识 node:sqlite 等新内置模块，统一外部化交给 Node
    server: { deps: { external: [/^node:/] } },
  },
});
