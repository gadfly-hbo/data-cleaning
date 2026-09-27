# M5 提案 — 数据源接入 + 聚类去重 + 容器化（讨论稿固定）

> 来源：M4 flow DONE 后（commit 11b3cb9），用户启动 `/dev-flow 开始 M5`。
> 规格上位源：docs/design.md v2（M4 行原文：多源接入（SeaTunnel/DataX）、dedupe 实体匹配、多用户/RBAC（M5+）；M4 proposal 明示"多源 → M5、dedupe → M5、多用户/RBAC/Docker → M5+"）。
> M4 轮 3 移交项（.flow/review-findings.md）：冷启动重叠窗口、pkill -15 优先、畸形 URL 降级测试、_jsonify 合并、TERM 落盘实验。

## 范围裁剪（本提案第一决策，需用户在 diff 门确认）

延续 M4 裁剪模式（承诺债优先、单机价值优先、一轮可交付）：

**纳入（本 flow）**：
1. **DB 数据源接入（轻量直连路线）**：pybridge 新增 sqlalchemy 直连 SQLite/PostgreSQL/MySQL——"整表或自定义 SQL → CSV → 注册数据集"（复用现有上传链路：raw 版本 = 导出 CSV 快照）。**不引入 SeaTunnel/DataX**：二者为 JVM 集群级引擎，与"单用户本地、按需起停"形态冲突（偏差记录，见下）。
2. **聚类去重（dedupe）**：OpenRefine `compute-clusters` 契约实测（M0 列为"已确认存在未实测"）+ 工作台新增「聚类合并」操作类型：选定列 → 聚类预览（相似值分组）→ 勾选组合并 → 生成 mass-edit 操作（进历史，可回滚，与现有机制同构）。
3. **容器化**：单 Dockerfile 多阶段构建（Node 运行时 + workspace 内引擎/JRE 复制或首启下载）+ compose 样例 + README 部署节；`data` 卷持久化。
4. **M4 轮 3 五条低优先项清偿**（全部小项）。

**推迟（不在本 flow，记录去向）**：
- **SeaTunnel/DataX 重集成 → 云端/多用户形态再评估**（单机直连已覆盖核心场景：拉表/查询入平台；SeaTunnel 的增量同步/百连接器矩阵在单机单用户下收益不抵运维成本——这是对 design.md v2 "接入层可选 DataX/SeaTunnel"的具体化，非选型推翻）。
- **多用户/RBAC/鉴权 → M6**（涉及会话/权限模型设计，独立特性线）。
- LLM 对话式/增量管道调度等（维持既有 Out of Scope）。

## 背景与既定决策（M5 不可重议，继承 design.md v2 / M0-M4）

- 产品模式不变：TS 壳 + adapter 隔离 + pybridge；DESIGN.md UI 规范；许可证/依赖锁/workspace 纪律。
- DB 接入产物进既有数据模型（Dataset/Version/画像/规则/清洗/管道全链路复用）。
- dedupe 走引擎既有操作机制（mass-edit），不引入新的状态形态。
- 单用户本地形态；LLM 建议维持 M4 语义。

## M5 目标（本 flow 范围）

设计验收（自拟，diff 门确认）：**用户能从 SQLite/PG/MySQL 拉数据入平台走全链路；能在工作台用聚类合并清理相似值；能一条 docker 命令起完整服务。** 组件：

1. pybridge：`db_fetch` 任务（连接串/表名或 SQL → CSV 落盘 + 行列元数据）；sqlalchemy+驱动依赖入 lock（许可证核查）。
2. studio-api：`POST /api/sources/db`（连接参数 → 测试连接 → fetch → 注册数据集）；连接信息不落盘（一次性行为，PRD 决）。
3. adapters/openrefine：`computeClusters` 契约方法（M0 未实测端点）+ 契约测试。
4. studio-web：工作台「聚类合并」面板（选列 → 聚类组预览 → 勾选合并 → 应用）；侧栏「数据源」入口（DB 接入表单）。
5. 容器化：Dockerfile + compose + README。
6. M4 轮 3 五项清偿。

## 开放问题（proposal 未定，留给 PRD/GRILL）

- DB 驱动矩阵（sqlite3 内置/psycopg/mysql 驱动的版本与许可证）。
- 连接信息安全（是否支持保存数据源、密码掩码；M5 最小=不保存）。
- 聚类参数（算法选择 knn/blocking、距离函数）与 UI 呈现粒度。
- compute-clusters 的轮询/性能形态（同步 or pending）。
- 容器内引擎获取（构建期下载 vs 首启下载）与镜像体积取舍。
