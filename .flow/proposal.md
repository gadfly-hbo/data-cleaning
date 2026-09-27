# M7 提案 — 平台化收尾：细粒度权限、引擎端口隔离、审计日志与债清偿（讨论稿固定）

> 来源：M6 flow DONE 后（commit 7292248 + 6e4dd96），用户启动 `/dev-flow M7`。
> 规格上位源：docs/design.md v2 + M6 proposal（"细粒度 RBAC → M7"、"网络级引擎隔离 → M7"）。
> M6 遗留清单：RBAC 角色矩阵、引擎 socket 化、S3/协作（远期）、suggest 分支无测试、用户菜单组件测试、docker/PG/MySQL 环境限制项。

## 范围裁剪（本提案第一决策，需用户在 diff 门确认）

**纳入（本 flow）**：
1. **细粒度 RBAC**：admin / editor / viewer 三级角色——viewer 只读（预览/画像/质量/血缘/导出）、editor 可清洗/定版/触发管道、admin 全权+用户管理。替换 M6 的"admin 他人只读"简化语义为完整权限矩阵。
2. **引擎端口随机化**：OpenRefine 引擎启动时绑定 OS 分配的随机端口（`-p 0`），studio-api 记录并代理——本机进程不再能通过固定 3333 直连引擎绕过应用层隔离。
3. **审计日志**：数据集创建/清洗操作/管道触发/用户管理等关键动作记录 `audit_log` 表（谁/何时/什么/结果），admin 可查——最小审计能力（无专用 UI，API 查询 + 前端血缘详情页嵌入即可）。
4. **M6 遗留债清偿**：suggest 未配置分支测试、用户菜单/登出组件测试、setup 并发竞态（先 hash 再同步段）、login timing 侧信道（哑哈希恒时 verify）、DDL 直接带 owner_id。
5. **文档**：design.md 补 M7 权限矩阵决策段；README 更新角色说明。

**推迟（不在本 flow，记录去向）**：
- S3/对象存储、分布式引擎、协作（多人同时编辑）→ 远期（维持 design.md 原案）。
- docker 首次真实构建 / PG/MySQL 真实服务验证 → 环境限制持续记录。
- 审计日志专用 UI 页 → 后续迭代（M7 只做 API + 血缘详情嵌入）。

## 背景与既定决策（M7 不可重议，继承 design.md v2 / M0-M6）

- 产品模式不变：TS 壳 + adapter 隔离 + pybridge；DESIGN.md UI 规范；许可证/依赖锁纪律。
- 认证/隔离（M6）继承：签名 cookie + argon2id + owner 隔离 + admin 体系。
- 引擎随机端口需要 adapter 的 startEngine/waitHealthy/复用探测全链路改造（端口不再是常量）。
- 审计日志是 append-only 事件流（不做可变审计——只有插入没有更新/删除）。

## M7 目标（本 flow 范围）

设计验收（自拟，diff 门确认）：**三种角色各自看到/做到恰好自己的权限边界；引擎端口对进程扫描不可预测；关键动作有审计记录且 admin 可查。** 组件：

1. studio-api：role 枚举扩展（admin|editor|viewer）+ 权限矩阵守卫替换现有 owner 检查 + 引擎随机端口 + 审计日志表与写入钩子。
2. adapters/openrefine：startEngine 返回动态端口 + client 接受 port 参数（去常量化）。
3. studio-web：角色 chip 三级 + viewer 权限 UI 隐藏（清洗/定版按钮不渲染）+ 审计记录在血缘详情的嵌入展示。
4. 测试：角色矩阵全路径测试 + 端口随机化验证（两次启动端口不同）+ 审计写入与查询测试。
5. 文档与 M6 债清偿。

## 开放问题（proposal 未定，留给 PRD/GRILL）

- viewer 能否上传数据集？（推荐：否——viewer 纯消费已有数据）
- editor 能否管理管道调度（改间隔）？（推荐：否——调度属 admin）
- 审计日志的保留策略与清理。（推荐：M7 不清理，append-only 无限增长，后续迭代处理）
- 引擎随机端口的复用探测语义（探测哪个端口？随机分配后如何知道"已有引擎"？——workspace 文件记录当前端口）。
