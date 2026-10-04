#!/bin/bash
# 一键启动数据清洗工作台（双击即用）
# 流程：检查环境 → 代码更新时自动构建前端 → 启动本机服务并守护引擎 → 打开浏览器。
# 退出：关闭本终端窗口或按 Ctrl+C，服务与后台引擎随之安全停止。
set -e
cd "$(dirname "$0")"

# Finder 双击启动时 PATH 不含 Homebrew / uv，兼容 Apple Silicon 与 Intel
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

echo "== 数据清洗工作台 =="

if ! command -v node >/dev/null 2>&1; then
  echo "[缺少环境] 未找到 Node.js。"
  echo "请先安装：打开 https://nodejs.org 下载 LTS 版本（建议 Node ≥ 22）；或联系技术同学协助。"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[缺少环境] 未找到 npm。请确认 Node.js 安装完整。"
  exit 1
fi

# 检查并自动初始化后台引擎与 Python 计算依赖（实现首次启动或换机器 100% 自愈）
if [ ! -f "pybridge/.venv/bin/python" ]; then
  echo "[初始化] 首次运行：正在自动准备 Python 计算组件 (pybridge)…"
  if command -v uv >/dev/null 2>&1; then
    (cd pybridge && uv sync)
  elif [ -f "$HOME/.cargo/bin/uv" ]; then
    export PATH="$HOME/.cargo/bin:$PATH"
    (cd pybridge && uv sync)
  else
    echo "[缺少环境] 未找到 uv 命令。请先安装 uv 或联系技术支持。"
    exit 1
  fi
fi

if [ ! -f "workspace/dist/openrefine-3.10.1/refine" ]; then
  echo "[初始化] 首次运行：正在自动准备本地清洗引擎 (OpenRefine)…"
  npm run setup:engine
fi

# 代码更新后自动重建前端：记录上次构建对应的提交，文件放 apps/studio-web/dist/（已 gitignore）
BUILD_HEAD="$(git log -1 --format=%H -- apps/studio-web package.json 2>/dev/null || echo none)"
if [ ! -f apps/studio-web/dist/index.html ] || [ "$(cat apps/studio-web/dist/.build-head 2>/dev/null)" != "$BUILD_HEAD" ]; then
  echo "[构建] 检测到界面代码更新（或首次运行），正在构建前端工作台…"
  npm run build:web
  echo "$BUILD_HEAD" > apps/studio-web/dist/.build-head
fi

# 模型凭证自动发现与注入（优先 MiniMax，备选 Xiaomi MIMO，不落仓不打印）
if [ -z "$LLM_API_KEY" ]; then
  MM=$(python3 - <<'PY' 2>/dev/null
import json, os
cfg_path = os.path.expanduser('~/.zcode/v2/config.json')
if os.path.exists(cfg_path):
    try:
        cfg = json.load(open(cfg_path))
        for p in (cfg.get('provider') or {}).values():
            opts = p.get('options') or {}
            base = str(opts.get('baseURL', ''))
            name = str(p.get('name', ''))
            if 'minimax' in base or 'minimax' in name.lower():
                key = opts.get('apiKey', '')
                if key:
                    print(key)
                    break
    except Exception:
        pass
PY
  )
  if [ -z "$MM" ]; then
    MM=$(python3 -c "import json,os;a=json.load(open(os.path.expanduser('~/.pi/agent/auth.json')));print(a.get('minimax-cn',{}).get('key',''))" 2>/dev/null)
  fi

  if [ -n "$MM" ]; then
    export LLM_BASE_URL="https://api.minimax.cn/v1"
    export LLM_API_KEY="$MM"
    export LLM_MODEL="${LLM_MODEL:-MiniMax-M3}"
  else
    XM=$(python3 - <<'PY' 2>/dev/null
import json, os
cfg_path = os.path.expanduser('~/.zcode/v2/config.json')
if os.path.exists(cfg_path):
    try:
        cfg = json.load(open(cfg_path))
        for p in (cfg.get('provider') or {}).values():
            opts = p.get('options') or {}
            if 'xiaomimimo' in str(opts.get('baseURL', '')):
                key = opts.get('apiKey', '')
                if key:
                    print(key)
                    break
    except Exception:
        pass
PY
    )
    if [ -n "$XM" ]; then
      export LLM_BASE_URL="https://token-plan-cn.xiaomimimo.com/v1"
      export LLM_API_KEY="$XM"
      export LLM_MODEL="${LLM_MODEL:-mimo-v2.6-flash}"
    fi
  fi
fi

PORT="${PORT:-8787}"
SERVER_PID=""

# 已有实例在运行时，直接打开浏览器（避免端口冲突）
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/health"; then
  echo "[提示] 数据清洗工作台已在运行中，直接打开浏览器（复用现有实例；若刚更新过代码请先关闭旧窗口再重开）。"
  open "http://127.0.0.1:$PORT"
  exit 0
fi

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  # 退出时轻量安全清扫可能残留的 OpenRefine 进程
  pkill -15 -f "data-cleaning/workspace/engine-data.*com.google.refine.Refine" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "[启动] 正在拉起工作台服务 http://127.0.0.1:$PORT …"
npm run start -w @data-cleaning/studio-api &
SERVER_PID=$!

for _ in $(seq 1 45); do
  if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$PORT/api/health"; then break; fi
  sleep 1
done

if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/api/health"; then
    echo "[提示] 数据清洗工作台已在运行中，直接打开浏览器。"
    SERVER_PID=""
    open "http://127.0.0.1:$PORT"
    exit 0
  fi
  echo "[启动失败] 服务未能正常启动（端口 $PORT 可能被其他程序占用，或依赖尚未初始化）。"
  echo "建议：请把本窗口内容截图发送给技术支持同学。"
  exit 1
fi

open "http://127.0.0.1:$PORT"
echo "[就绪] 工作台已在默认浏览器中打开！最小化本窗口不影响使用，使用完毕关闭本窗口即可退出。"

wait "$SERVER_PID"
