#!/bin/sh
set -e
mkdir -p workspace/dist workspace/datasets workspace/versions
# 引擎版本层（与 engine.ts DIST = workspace/dist/openrefine-<ver> 对齐——REVIEW 轮 1 BLOCKER 1）
if [ ! -e workspace/dist/openrefine-3.10.1 ]; then
  ln -s /opt/openrefine-dist/openrefine-3.10.1 workspace/dist/openrefine-3.10.1
fi
exec npm run start --workspace @data-cleaning/studio-api
