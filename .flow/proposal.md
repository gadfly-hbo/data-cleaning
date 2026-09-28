# M8 提案：审计 UI 页 + 债务清偿

> 来源：用户指令「/dev-flow M8」，未附范围说明。开工时以 AskUserQuestion 询问 M8 范围，用户未作答，按推荐方案继续（流程规则：可逆、范围内的假设可采，但需明示——此处明示：范围假设由 backlog 推荐项得出）。proposal 较薄，history 已注明。

## 决策（本期）

1. **M8 = 审计 UI 页 + 债务清偿** 两个部分，不做新能力主线（协作分享、API-key 认证、密码策略强化均不进入本期）：
   - **审计 UI 页**：M7 已落地 11-action 审计日志（后端 + 真实 SQLite 探针回归），但只有版本页的 recent_audit 局部展示，缺专用查询页。本期做：admin 全量审计查询（时间倒序、分页、action/user/resource 过滤），普通用户自查（仅自己的 action），与现有 RBAC 对齐（viewer 可看自己，editor 可看自己，admin 看全部）。
   - **债务 1：docker entrypoint 写入 `.engine-port`**。M7 引擎端口随机化（`-p 0` + `workspace/.engine-port` 0600）晚于 Dockerfile 定稿，entrypoint 未写入该文件——容器内首个 API 进程会误判无引擎可复用而另起一个引擎（功能仍正确但浪费内存且 stop 语义分叉）。属于潜在缺陷，必须修。
   - **债务 2：role-matrix O3 正例测试**。M7 已知覆盖缺口：admin 触发他人 pipeline 的正例未测。补测试。
   - **债务 3：审计保留策略**。audit_log 只增不减，长期运行会膨胀。本期给最小策略：容量上限 + 自动裁剪（保留最新 N 条），或定期清理接口，二者取最简。
2. **不改引擎契约、不改 Recipe 语义、不动 pybridge 任务面**。本期全部改动集中在 studio-api（审计查询/裁剪端点）、studio-web（审计页）、docker/entrypoint.sh、role-matrix 测试。
3. **UI 遵循 DESIGN.md（JuanerAI Xanthil）**：审计页用状态 chip + 三栏壳已有模式，不发明新视觉。

## 约束（继承，全部沿用）

- 许可证硬门：新依赖必须过许可证检查（ELv2/AGPL 否决；LGPL-3 客户端库可用先例=psycopg）。本期预计零新依赖——若 PRD 想加依赖必须先过这道门。
- 修复/完成声明必须有 diff/grep 证据；批量编辑后先验证再声称完成。
- 最小 diff：不顺手重构、不格式化无关代码。
- 密钥不入库不入日志；DB 连接信息单次请求内存内。
- 引擎边界声明不变（本地单机产品，app 层隔离）。
- verify gate：全量 `npm test` + pybridge pytest + 三处 tsc（沿用 M7 verify_command）。

## 明确不做（本期外）

- 协作/分享（跨用户授权）
- API-key 认证、密码策略强化
- docker 首次真实构建、PG/MySQL 真实服务验证（环境受限，README 已披露）
- 审计 UI 的导出/图表等增强
