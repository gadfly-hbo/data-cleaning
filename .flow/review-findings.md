# REVIEW 轮 1 发现（M2，code-reviewer 子代理，fresh context，2026-09-27）

## 审查结论
VERDICT: REQUEST_CHANGES — M2 整体实现质量高（undoRedo 语义/getOperations 闭环/孤儿补偿/串行收敛正确且有实证），但一个已实证阻断项：中文数据集名的导出/Recipe 端点必然 500。

## 阻断性问题（BLOCKER）
- [services/studio-api/src/app.ts:212,224] 中文名 content-disposition 头 ERR_INVALID_CHAR → 500（审查者用同版 fastify 5.12.5 实证；上传白名单明确保留中文）。测试只用了 ASCII 名 → 全绿为假阴性。修复：RFC 5987 filename* + ASCII fallback + 前端解析同步。复检判据：上传「客户数据.csv」后 GET export 返回 200。

## 建议改进（SUGGESTION）
- [app.ts:174-176,195-197] 缺 body/非 JSON 的 POST → body.operations TypeError → 500 而非 400。
- [CleaningTab.tsx:117-120] resetForm 在 apply 成功后、history 刷新前执行；刷新失败时错误文案「数据未被破坏」与事实相反（操作已生效）。
- [CleaningTab.tsx:298,311,360] 新代码白底 text-text-3 text-[10.5px] 与 H5（白底 meta 统一 text-2）自相矛盾。
- [DatasetPage.tsx:100 + CleaningTab.tsx:17] DatasetPage ⇄ CleaningTab 循环依赖（运行时无害，H3 本意抽独立共享组件）。
- [CleaningTab.tsx:316] future 倒序展示与 PRD「future 正序」字面不符（可辩护 UX 裁量，需留痕）。
- [DatasetPage.tsx:281-283] 违规率 ≥50% chip-fail 超出 H5 清单——已记录在案，留痕即可。
- [.flow/tasks.md:18-70] C0-C3 子验收 checkbox 未勾（文档卫生）。
- [cleaning.test.ts:153-160] 双 buildApp 依赖固定端口 3333 的偶得行为（断言有效但脆弱，建议端口探测——M3）。

## 待确认（UNVERIFIED）
- blob+<a download> 真实落盘路径无真浏览器证据（IAB 限制已声明；叠加 BLOCKER 修复后需补）。
- createProject 客户端抛错（302 无 project 参数形态）留下无法定位 id 的孤儿——补偿无法覆盖，是否接受为已知残余。
- mass-edit 提取回放 fromBlank:true 分支未覆盖（产品 UI 不产生该输入，「回填字段无害」仅实证 false 分支）。

## 覆盖确认
- 已检查：diff 全部 15 文件；规格四件套；全部调用方（无漏改）；既有测试未削弱；verify 全链亲自重跑 exit 0 与冻结证据一致。
- 额外实证：引擎对 5 类畸形 operations（非对象/未知 op/缺 op 键/好坏混合/未知列）结构化抛错且原子失败（past 不变、无部分应用）——透传疑虑解除；fastify CJK header 500 实证。
- 重点方向逐项结论：undoRedo expected 计算（0/future 定位/重复 id）无发现；值替换 from 重复幂等无后果；busy 串行收敛时序无发现；组件测试只打 fetch 边界 ✓。
- 未检查：真实浏览器 UI（采信 tasks.md 记录）；pybridge（diff 未触及）；workspace 磁盘累积（M3 观察）。

---

# REVIEW 轮 2 发现（M2，fresh code-reviewer，2026-09-27）

## 审查结论
VERDICT: PASS（APPROVE_WITH_COMMENTS）— 轮 1 全部处置到位且未引入功能缺陷；轮 1 BLOCKER 复检判据（「客户数据.csv」导出 200）由回归测试在本轮 verify 实跑满足。头值合法性推演确认（safeName 白名单恰好排除 RFC attr-char 之外的字符）。redoOne future[0] 顺序假设被矩阵测试钉住。

## 建议（2 条，作者已当场修复）
- 错误渲染层双重包装（渲染层只输出 {error}，包装由 guarded 产出）+ 补刷新失败路径测试（文案含「操作已生效」不含「数据未被破坏」）。
- DatasetPage 死导入（getRows/RowsPage）删除。

## 待确认
- PRD future 口径已同步（作者裁量完成）；真浏览器 blob 落盘以头+内容断言替代（IAB 限制声明在案）。

## 覆盖确认
- 轮 1 逐条复检（8 项全部证据在案）；verify 全链亲自重跑 exit 0 与冻结证据一致；decodeURIComponent 对称编码无畸形面；PreviewTable 抽取逐行等价；busy 解锁三路径完备；调用方 rg 无漏改。
