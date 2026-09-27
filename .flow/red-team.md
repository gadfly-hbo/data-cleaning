# Red-Team: M5 — DB 直连接入 + 聚类去重 + 容器化 + 清偿

> 评审对象：`.flow/proposal.md`。日期：2026-09-27。结论：**go**——两个契约假设（compute-clusters、sqlalchemy 直连矩阵）设为切片 0/1 实测；容器化设为独立可弃切片。

## Top Kill-Assumptions（按 影响×看错概率×测试成本 排序）

### 1. compute-clusters 契约可用且同步可用
- **Claim**: 引擎聚类端点能对选定列返回相似值分组，可在工作台做成"预览→合并"交互。
- **Steelman**: 端点在官方 UI 的 Facet→Cluster 功能背后（M0 契约文档列过端点名与两个伴随端点 get-clustering-functions-and-distances）；mass-edit 合并机制 M2 起成熟。
- **Fails if**: 端点仅支持 facet 上下文（需要先建 facet）或返回形态不适合预览；聚类同步耗时在大列上超秒级影响交互。
- **Evidence to get this week**: 切片 0：真实引擎对 messy 夹具 city 列（广州市/上海 vs 北京 朝阳区等）curl 实测三种聚类器（fingerprint/key-collision ngram 等）。
- **Kill criterion**: 契约不可程序化驱动 → dedupe 降级为"top 值手动多选合并"（M2 已有能力）+ 记录偏差。
- **Cheapest test**: 30 分钟 curl。

### 2. sqlalchemy 直连矩阵在 py3.14 可用且许可证干净
- **Claim**: psycopg/mysql 驱动 + sqlalchemy 在 3.14 有 wheel 且商用友好。
- **Steelman**: sqlalchemy 2.x MIT；psycopg3 是纯 Python（pgx 路线）；mysql 官方驱动 Oracle 双许可（需核）。
- **Fails if**: 3.14 wheel 缺失或 mysql 驱动许可证不可接受 → 驱动矩阵缩水（如 M5 仅 SQLite+PG）。
- **Cheapest test**: uv add 试装 + 许可证核查（切片 1 内）。
- **Kill criterion**: 许可证一票否决该驱动 → 缩矩阵并回签。

### 3. 容器化多运行时镜像可交付（Node+JRE+Python+uv+引擎 ~1GB 级）
- **Claim**: 单镜像可构建、可启动完整服务。
- **Fails if**: 镜像 >3GB 或首启下载在生产环境不可接受；darwin arm64 构建/运行问题。
- **Kill criterion**: 构建不可行 → 降级 compose 多镜像（或推迟，容器化是独立可弃切片）。
- **Cheapest test**: docker build 一次（切片内）。

### 4. 一轮交付四组件的预算
- **Steelman**: DB 接入与聚类都是既有链路的延伸（注册数据集/mass-edit），无新架构面。
- **Fails if**: 容器化调试吞噬预算。
- **Kill criterion**: 熔断保底 =「聚类去重 + M4 清偿」；DB 接入与容器化独立可弃。

## What's Well-Reasoned

- 直连替代 SeaTunnel/DataX 的裁剪有明确形态依据（单机按需起停 vs JVM 集群），是具体化不是推翻，且记录了重评条件（云端/多用户）。
- dedupe 走 mass-edit 同构机制——零新状态形态，历史/回滚/管道全部免费获得。
- 清偿项全部小且具体（五条来自上轮审查）。
- 连接信息不落盘（最小安全面）符合渐进。

## What I Couldn't Assess

- 用户真实 DB 环境分布（PG vs MySQL 占比——影响驱动矩阵优先级）。
- docker 在本机是否可用（构建实验环境依赖）。

## 净结论

go。切片 0 = compute-clusters 契约实测；切片 1 = 驱动矩阵试装+许可证核查；容器化独立最后、可弃。
