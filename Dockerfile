# 数据清洗平台容器镜像（M5/S5，REVIEW 轮 1 修复版）
# 构建：docker build -t data-cleaning .
# 运行：docker run -p 8787:8787 -v dc-workspace:/app/workspace data-cleaning
# 本机 docker 不可用：静态审查口径（REVIEW 轮 1 修复三处致命断裂后）；首次真实构建验证移交。

# ---------- 阶段 1：web 构建 ----------
FROM node:25-slim AS web-builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/studio-web/package.json apps/studio-web/
COPY services/studio-api/package.json services/studio-api/
COPY adapters/openrefine/package.json adapters/openrefine/
RUN npm install --workspace @data-cleaning/studio-web
COPY tsconfig.base.json ./
COPY apps/studio-web apps/studio-web
RUN npm run build --workspace @data-cleaning/studio-web

# ---------- 阶段 2：pybridge venv（与运行时同基底，保证符号链接有效） ----------
FROM python:3.14-slim AS py-builder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app/pybridge
COPY pybridge/pyproject.toml pybridge/uv.lock ./
COPY pybridge/src src
RUN uv sync --frozen --no-dev

# ---------- 阶段 3：引擎下载（保留版本目录名） ----------
FROM debian:bookworm-slim AS engine-builder
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
ARG OPENREFINE_VERSION=3.10.1
WORKDIR /engine
RUN curl -sL -o dist.tar.gz \
      "https://github.com/OpenRefine/OpenRefine/releases/download/${OPENREFINE_VERSION}/openrefine-linux-${OPENREFINE_VERSION}.tar.gz" \
    && mkdir dist && tar -xzf dist.tar.gz -C dist --strip-components=0 \
    && test -x "dist/openrefine-${OPENREFINE_VERSION}/refine" \
    && rm dist.tar.gz

# ---------- 运行时：python 基底 + node（pybridge venv 与 web 产物共存） ----------
FROM python:3.14-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates openjdk-21-jre-headless \
    && curl -fsSL https://deb.nodesource.com/setup_25.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# 引擎（版本目录名与 engine.ts 的 DIST 常量一致：workspace/dist/openrefine-<ver>）
COPY --from=engine-builder /engine/dist /opt/openrefine-dist

# Node 工作区依赖（tsx 在 dependencies——REVIEW 轮 1 BLOCKER 3）
COPY package.json package-lock.json ./
COPY apps/studio-web/package.json apps/studio-web/
COPY services/studio-api/package.json services/studio-api/
COPY adapters/openrefine/package.json adapters/openrefine/
RUN npm install --omit=dev --workspace @data-cleaning/studio-api \
      --workspace @data-cleaning/adapter-openrefine

# pybridge venv（运行时基底与 py-builder 同为 python:3.14-slim——符号链接有效）
COPY --from=py-builder /app/pybridge /app/pybridge

# TS 源码 + web 产物
COPY tsconfig.base.json ./
COPY services/studio-api services/studio-api
COPY adapters/openrefine adapters/openrefine
COPY --from=web-builder /app/apps/studio-web/dist apps/studio-web/dist

COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV PORT=8787 HOST=0.0.0.0
EXPOSE 8787
VOLUME /app/workspace
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/entrypoint.sh"]
