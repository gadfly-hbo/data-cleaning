# REVIEW 轮 1 发现（M5，code-reviewer 子代理，fresh context，2026-09-27）

## 审查结论
VERDICT: REQUEST_CHANGES — 聚类/清偿扎实；DB 接入一个功能+安全双料缺陷（DSN 凭据未编码）；容器化三处静态可判定的致命断裂；story 1 测试连通未实现无偏差记录。

## 阻断性问题（BLOCKER）
1. [Dockerfile:50,79 ↔ engine.ts:22,62] 引擎路径不匹配：engine.ts 期望 workspace/dist/openrefine-3.10.1，entrypoint symlink 缺版本层——容器内引擎永远 missing。复检：docker run ls dist/openrefine-3.10.1/refine 存在。
2. [Dockerfile:39,63 ↔ pybridge.ts:9] venv 复制进无 Python 的 node:25-slim：.venv/bin/python 断链——pybridge 全任务不可用（上传/画像/质量/db_fetch/管道全挂）。复检：docker run /app/pybridge/.venv/bin/python -V。
3. [Dockerfile:58-59] tsx 是 devDependency，--omit=dev 安装后入口命令 tsx: command not found。复检：npx tsx --version。
4. [dbfetch.py:17-22] DSN 凭据未 URL 编码：密码含 @ 即断连 + 密码残段经错误消息回显（实测复现：p@ss → host='ss@dbhost'）。复检：build_dsn("postgres",{"password":"a@b"}) 解析回 a@b。
5. [DataSourcePage/app.ts] PRD story 1「测试连通」未实现且无偏差记录。复检：PRD 11 stories 逐条对上。

## 建议改进（SUGGESTION）
- dbfetch.py:57 表名双引号未转义 + table 路径绕过 L4 白名单。
- term-persist.test 未断言 reused===false（端口被占时退化假阳性）。
- M4 清偿③前端区分只做一半（畸形 URL 仍显示"未配置"）。
- app.ts:563 db 假哈希——L3 的内容寻址去重未兑现 + 0 行/失败残留孤儿文件。
- clusters-api.test:88 测试名与内容不符（unknown column 零覆盖）。
- ensureInstalled 不再校验 JRE：无 java 环境错误从秒级明确退化为 120s 超时。

## 覆盖确认
- 已检查：21 修改 + 10 新文件全文；DSN 特殊字符 venv 实测复现；verify 全链重跑一致；Dockerfile 三 BLOCKER 均静态可判定。

---

# REVIEW 轮 2 发现（M5，fresh code-reviewer，2026-09-27）

## 审查结论
VERDICT: REQUEST_CHANGES — 轮 1 的 B1/B3 闭合、B5 实现但语义未闭合、B4 修复函数选错（quote_plus 空格密码断裂）；另有两处轮 1 未抓到的静态致命断裂（trixie 无 openjdk-17；server.ts 硬编码 127.0.0.1）。verify 亲跑一致。

## 阻断性问题（BLOCKER）
1. [Dockerfile:40] openjdk-17-jre-headless 在 python:3.14-slim（trixie）不存在——构建即断。修：openjdk-21-jre-headless 或钉 bookworm。
2. [server.ts:15] API 硬编码 127.0.0.1，容器端口发布后不可达 + healthcheck 掩盖。修：HOST env + Dockerfile/compose 设 0.0.0.0。
3. [dbfetch.py:19] quote_plus 空格密码 roundtrip 断裂（a b → a+b）。修：quote(v, safe="")。
4. [app.ts:564,599-612] 三处残留文件：test 端点 probe 文件无清理；0 行 422 前 outCsv 孤儿；重复拉取 hash 命中时新 db-*.csv 残留。

## 建议改进（SUGGESTION）
- 修复记录"建议 1-6 全修"失实（reused 锁定/clusters 测试名/JRE 快速失败三条未落地）。
- term-persist 无 reused 断言；clusters 测试名实不符；ensureInstalled 文档串与实现不符。
- app.ts:607 name/table 进文件名无消毒（路径穿越面）。
- 无 .dockerignore（构建上下文含 GB 级 workspace）；test/ 进镜像。
- /api/sources/db/test 与 DataSourcePage 零测试；llm degraded 未断言。
- 动态 import("node:crypto") 与顶部 createHash 重复。

## 待确认
- nodesource setup_25.x 在 trixie 的可用性（沙箱 dists 404 无法定论）；OpenRefine @ Java21 未实测。

---

# REVIEW 轮 3 发现（M5，fresh code-reviewer，2026-09-27）

## 审查结论
VERDICT: PASS — 轮 2 四 BLOCKER 行为层面全部实证闭合（DSN 7 例矩阵/trixie+bookworm openjdk-21 双源验证/nodesource Release 200/零残留断言实跑）。遗留全部为注释/测试名/记录失实类非阻断项。

## 建议（6 条，作者已当场全部修复落地）
1. engine.ts 注释 openjdk-17→21。2. DSN roundtrip 矩阵常驻测试（此前声称存在实无——7 例参数化已落地）。3. 动态 crypto import 去重（上轮声称已修实未改——本轮真实落地）。4. clusters 测试名残留失实子句（第二次修正）。5. JRE 快速失败（两轮声称均未落地——本轮真实落地）。6. dbfetch tmp 窄窗口 finally 清理。

## 待确认
- docker 首次真实构建（静态闭合，环境不可用口径维持）；PG/MySQL 真实服务（PRD 口径内）。
