#!/bin/sh
set -e
mkdir -p workspace/dist workspace/datasets workspace/versions
# 引擎版本层（与 engine.ts DIST = workspace/dist/openrefine-<ver> 对齐——REVIEW 轮 1 BLOCKER 1）
if [ ! -e workspace/dist/openrefine-3.10.1 ]; then
  ln -s /opt/openrefine-dist/openrefine-3.10.1 workspace/dist/openrefine-3.10.1
fi
# M8/V3b：容器每次启动时引擎必不在（新 netns，旧进程随容器死）——残留 .engine-port 只指向死端口，清掉
rm -f workspace/.engine-port
# M8/V3a：exec 直达 tsx（bin 为 #!/usr/bin/env node 脚本），成为 PID 1；tsx 的 SIGTERM 转发
# 已在 bundle 内实证（relaySignalToChild，同步）。经 npm 则转发属未证实灰色地带——docker stop
# 超时后 SIGKILL 全容器会硬杀引擎（M4 实验已证硬杀损坏已应用操作的项目）
exec /app/node_modules/.bin/tsx services/studio-api/src/server.ts
