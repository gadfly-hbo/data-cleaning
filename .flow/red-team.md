# Red-Team: M4 — xlsx 完整支持 + 血缘审计 + LLM 清洗建议 + 生产化补课

> 评审对象：`.flow/proposal.md`。日期：2026-09-27。结论：**go**——范围裁剪是本提案最重要的决策，方向正确；两个技术假设需在切片 0/1 实测。

## Top Kill-Assumptions（按 影响×看错概率×测试成本 排序）

### 1. xlsx→csv 转换路线能产生与 CSV 等价的引擎体验
- **Claim**: pybridge 用 polars 读 xlsx → 写规范 CSV → 进引擎，即可获得全功能（清洗/管道/版本）。
- **Steelman**: polars read_excel（calamine）已在画像/规则链路稳定工作（M1 起）；转换是无新依赖的纯函数；引擎侧 CSV 契约全部实证。
- **Fails if**: xlsx 的富语义在 CSV 形态丢失到影响清洗价值（日期变字符串、精度丢失、合并单元格/多 sheet 数据错读）。
- **Evidence to get this week**: 切片 0 实测：构造含日期/数字/空值/中文的 xlsx → 转换 → 引擎全链路（清洗/管道/导出）与语义断言。
- **Kill criterion**: 转换丢列/错值 → 回退 importing-controller 探测（备选路线，工作量 +1 切片）；仅格式化差异（如日期变 ISO 字符串）→ 接受并记录口径。
- **Cheapest test**: 30 分钟。

### 2. LLM 建议在"无内置密钥、用户自配端点"约束下可用且可测
- **Claim**: OpenAI 兼容端点配置化（默认关）+ stub 测试能覆盖行为；建议经用户确认才应用，无自动执行面。
- **Steelman**: 建议输出 = GREL/mass-edit JSON（与现有 apply 端点同构）；stub 下单测确定性；边界声明是纯 UI。
- **Fails if**: LLM 输出不稳定 JSON → 应用失败率高。缓解：响应经 JSON 解析校验 + 失败结构化重试提示；建议面板永远"预览后人工应用"。
- **Kill criterion**: 真实端点上建议可用率过低（<50% 可解析）→ 降级为"仅文本建议、不生成可应用 JSON"。
- **Cheapest test**: stub 单测（切片内）；真实端点验收留给用户配好后手动。

### 3. 一轮交付四组件的预算（M3 用满 3 轮审查）
- **Claim**: 转换/血缘/LLM 三线各自轻量（前两个是既有资产的组装），可一轮完成。
- **Fails if**: xlsx 转换边界情况泛滥或 LLM 面板交互膨胀。
- **Kill criterion**: 熔断保底 =「xlsx 等价 + 孤儿清扫」（最小诚实债闭环）；血缘/LLM 独立切片可弃。
- **Cheapest test**: 拆解顺序（xlsx 先）。

## What's Well-Reasoned

- 范围裁剪有明确价值观（承诺优先、单机价值优先）且推迟项有去向，不是静默砍需求。
- xlsx 转换路线选"零新契约"而非协议探测——与全项目"复用优先"一致；importing-controller 留作备案。
- LLM 设计的三个安全阀（默认关/最小发送/人工确认应用）与 DESIGN.md 边界语义对齐。
- 血缘是纯组装（数据已在），零新风险。

## What I Couldn't Assess

- 用户是否真有可用的 OpenAI 兼容端点（影响验收方式——stub 可测但真实体验未验）。
- 多 sheet xlsx 的真实占比（单 sheet 假设沿用 M1，转换路线下多 sheet 可明确报错）。

## 净结论

go。切片 0 = xlsx 转换全链路实测；LLM 全链路 stub 化；拆解保「xlsx+清扫」为熔断保底。
