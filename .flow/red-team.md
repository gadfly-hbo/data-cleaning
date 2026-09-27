# Red-Team: M6 — 多用户基础（认证 + 数据隔离）

> 评审对象：`.flow/proposal.md`。日期：2026-09-27。结论：**go**——认证选型与 owner 迁移是两个必测假设；范围裁剪（地基而非全 RBAC）方向正确。

## Top Kill-Assumptions（按 影响×看错概率×测试成本 排序）

### 1. 认证选型在 Node 25 + 无外部服务下可闭环
- **Claim**: 签名 cookie session + argon2/bcrypt 哈希可在现有依赖栈内实现完整登录流。
- **Steelman**: 单机产品无外部依赖需求；fastify cookie 插件成熟；@node-rs/argon2（Rust binding，Apache-2/MIT）或 bcryptjs（纯 JS，BSD）都是常见选择。
- **Fails if**: 所选哈希库在 Node 25 arm64 无预编译产物且本地编译失败 → 切纯 JS bcryptjs（性能差但可用）。
- **Kill criterion**: 两个候选都不可用（几乎不可能）→ 自研 PBKDF2（node:crypto 内置，无需第三方）。
- **Cheapest test**: uv/npm 试装 + 哈希 roundtrip（切片 0）。

### 2. owner 隔离在既有数据模型上可无损落地
- **Claim**: datasets/pipelines/runs/versions 加 owner 字段 + 全端点校验 = 完整隔离。
- **Steelman**: 表结构简单（5 张业务表），全部端点集中在 app.ts，中间件 + 每查询过滤即可。
- **Fails if**: 引擎项目（OpenRefine project_id）成为旁路——非 owner 若能通过引擎 API 直接操作（3333 端口本机可直连，无鉴权！）。**这是最实质的风险**：任何本机进程可绕过 studio-api 直打引擎。M6 的隔离是应用层隔离，引擎网络隔离（127.0.0.1 + 随机端口/Unix socket）是否纳入？
- **Kill criterion**: 若要求网络级隔离，范围膨胀明显（引擎 socket 化是 M7 工作）；M6 明确声明"应用层隔离，本机进程可直连引擎是已知边界"。
- **Cheapest test**: 明确边界声明 + 文档记录。

### 3. 存量数据迁移零丢失
- **Claim**: 现有 datasets（测试库+用户库）迁移加 owner 后全部可见。
- **Fails if**: 存量行 owner 为 NULL → 任何人都看不见（数据"消失"）。
- **Kill criterion**: 迁移策略必须给存量行显式归属（首管理员）+ 迁移测试。

### 4. 一轮预算（前五轮每轮 2-3 轮审查）
- **Fails if**: 认证细节（cookie flags/TTL/csrf）膨胀。
- **Kill criterion**: 熔断保底 =「认证 + 隔离 + 存量迁移」；文档项独立可弃。

## What's Well-Reasoned

- "地基而非全 RBAC"裁剪与 M4/M5 同模式（承诺债优先、一轮可交付）。
- 引擎旁路风险被主动识别（本机 3333 无鉴权）而非假装不存在——边界声明是正确处理。
- 封闭式用户创建（管理员建号）对本地单机产品合理，注册开放确需产品决策。
- M5 移交项全部有去向（做/记录/环境限制标注）。

## What I Couldn't Assess

- 用户预期的并发用户数（2-5 人本地 vs 更多——影响 session TTL 与引擎资源竞争模型，M6 不深究）。
- 是否有远程访问诉求（当前"本地单机维持"是推断——design.md 未明示网络暴露意图）。

## 净结论

go。切片 0 = 哈希选型试装 + 签名 cookie roundtrip；引擎旁路边界写进 proposal 的 PRD 并在 UI/文档声明；存量迁移有测试。
