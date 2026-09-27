# REVIEW 轮 1 发现（M1，code-reviewer 子代理，fresh context，2026-09-27）

## 审查结论
VERDICT: REQUEST_CHANGES — M1 骨架完整、分层清晰，verify 证据亲自重跑全部复现（JS 21 passed/1 skip + py 8 passed + 双 tsc 0 错误），但有 2 个阻断性缺陷：质量报告对数值形态列存在已实证的假阴性，以及迁移残留导致 README 记载的 PERF 命令在全新 clone 下必挂。

## 阻断性问题（BLOCKER）
- [pybridge/src/pybridge/rules.py:62+98] 正则规则对非字符串列静默假阴性：pa.Column(str, str_matches) 在列 dtype 为 Int64 时产生无行号的 dtype 级失败，_pandera_check 丢弃无索引失败 → 全数字手机号列（无引号 CSV 常见形态）violations=0 谎报通过。实证：CSV `phone\n12345\n123\n999` → 0 违规（实际 3 行全非法）。击穿 PRD story 5 可信度。复检判据：该用例 violations=3。
- [adapters/openrefine/test/perf-100mb.test.ts:35] 迁移残留：cwd 指向已删除的 ../poc/openrefine，README 的 PERF 命令在全新 clone（无 workspace/messy-100mb.csv 掩盖）下 ENOENT。违反切片 1「无残留引用」与切片 8「按 README 可跑通」。复检判据：移走 100MB 夹具后 PERF 命令能进生成流程。

## 建议改进（SUGGESTION）
- [services/studio-api/src/engine-manager.ts:17-36] stop() 不等待在途 starting → 首次上传引擎引导期内退出会孤儿化 detached 引擎（PRD story 8 窄窗口）。
- [apps/studio-web/src/pages/UploadPage.tsx:114] 列表格式 chip 恒显示 "csv"（服务端 name 已去扩展名，endsWith(".xlsx") 恒 false）。
- [apps/studio-web/src/pages/DatasetPage.tsx:82] onRefreshed 传入 QualityTab 但 rerun 从不调用：重跑后切 tab 回显旧报告。
- [services/studio-api/src/app.ts:104-105 + UploadPage.tsx:95] 「未创建数据集」文案不总为真：insertDataset 之后 pybridge 失败时数据集已入库。
- [server.ts:1 + engine.ts:19] 注释/命名过期：0.0.0.0 注释 vs 实际 127.0.0.1 绑定；POC_ROOT 变量名失义。
- 测试负例缺口：空文件上传分支、XLSX 全链路（studio-api 层）、PyBridgeExecutor 真实非零退出/超时/坏 JSON 路径零覆盖（审查者已实测行为正确，降为覆盖建议）。
- [docs/spikes/openrefine-api-contract.md:4,10] poc/ 路径引用悬空（M0 冻结文档，路径需随迁移更新）。

## 待确认（UNVERIFIED）
- tasks.md 各切片 acceptance criteria 子项 checkbox 未逐一勾选（作者习惯：勾 task 级、验收证据在记录节）；切片 0「解释器版本记录在案」落点在 state.json history（py3.14.4），需补进 tasks 记录。
- GRILL G5 venv 位置偏差（workspace/pybridge-venv → pybridge/.venv）已在 state history 记录，需回签进 PRD。

## 覆盖确认
- 已检查：全部新增/迁移源码逐文件（adapters 4src+6test、studio-api 5src+2test、studio-web 7src+2test、pybridge 5模块+3test、配置/README/.gitignore）；verify 完整重跑复现；额外实证 3 项（执行器故障路径、数值列假阴性 ×3 输入、100MB 夹具/poc 存在性）；SQLite 参数化、路径穿越、G2/G7/G8 口径、DESIGN token、新依赖许可证——查过，除上述外无发现。
- 未检查：浏览器手动验收（信任 tasks.md 记录）；生产模式 build 托管实测；PERF=1 实跑；lock 文件逐行；M0 零改动迁移文件深审。

---

# REVIEW 轮 2 发现（M1，fresh code-reviewer，2026-09-27）

## 审查结论
VERDICT: PASS（APPROVE_WITH_COMMENTS）— 轮 1 的 2 BLOCKER + 6 建议 + 2 待确认全部处置到位（5 修复 + 1 记录不改 + 2 回签），verify 全链路亲自重跑复现（exit 0），修复经独立边界实证未引入新缺陷（数值列正则另做 5 组边界：null 不计/混类型正确/合法值无假阳/全 null 不崩/浮点计违规语义一致）。

## 阻断性问题
无。

## 建议改进（3 条，均记录不阻断）
- 桥失败时孤儿 OpenRefine 项目累积（换序副作用）→ M2 补偿。
- 「桥失败→零入库」无测试锁定 → 作者已补测试（上传后列表长度不变断言）。
- /usr/bin/false、/bin/echo 平台绝对路径 → Linux CI 复用时注意。

## 覆盖确认
- 已检查：轮 1 全部修复点逐条对照源码与测试；verify 完整重跑；.flow 文档改动确认为 M1 flow 自身文档生命周期而非规格事后改写。
- 未检查：PERF=1 实跑（信任作者复检记录+代码核对）；浏览器验收与生产 build 实测（信任 tasks.md 记录）。
