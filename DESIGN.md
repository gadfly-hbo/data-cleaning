---
version: 1.0.0
name: JuanerAI 系统蓝图 v4.2 设计语言（Capability Blueprint · 2026-10-04 全局契约版）
description: JuanerAI 全系产品默认界面设计语言(2026-10-04 起生效)。完整复刻自已批准的《JuanerAI 系统蓝图 v4.2》页面(冻结源:source/juanerai-system-blueprint-v4.2.html,SHA-256 c94ec111258f002aca28a4f8315ea32698ea527ff07ce74b5805a1c5dd821ce0)。暖灰纸感底 + 铁锈橘 accent + 深藏青辅助的文档式工作台:左轨导航 + 内容阅读区;mono 编号与元数据、accent eyebrow、分段控件、深藏青原则横条;AI 推进任务、系统守住边界,人看得懂过程、掌握关键决策。取代已归档的 Xanthil 橘 accent 桌面工作台契约版(2026-09-28,见 archive/DESIGN-xanthil-contract-20260928.md)。
colors:
  bg: "#f7f6f3"
  panel: "#ffffff"
  soft: "#f0efeb"
  line: "#dedcd6"
  ink: "#242830"
  muted: "#626773"
  accent: "#b44626"
  accent-soft: "#fcf0e9"
  primary: "#b44626"
  navy: "#263442"
  navy-line: "#758290"
  navy-text: "#d6dde4"
  warn: "#815916"
  warn-soft: "#faf3e4"
  warn-line: "#e6d2a9"
  backdrop: "#20293270"
typography:
  sans:
    fontFamily: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif
  mono:
    fontFamily: ui-monospace, "SF Mono", Menlo, monospace
  page-title:
    fontSize: 2.15rem
    fontWeight: 650
    letterSpacing: -0.025em
    lineHeight: 1.3
  view-title:
    fontSize: 1.375rem
    fontWeight: 650
    lineHeight: 1.4
  card-title:
    fontSize: 1.05rem
    fontWeight: 650
    lineHeight: 1.5
  body:
    fontSize: 1rem
    lineHeight: 1.6
  node-title:
    fontSize: 0.875rem
    fontWeight: 650
    lineHeight: 1.45
  small:
    fontSize: 0.8125rem
    lineHeight: 1.65
  meta:
    fontSize: 0.75rem
    lineHeight: 1.7
  eyebrow:
    fontSize: 0.75rem
    fontWeight: 650
    letterSpacing: 0.1em
rounded:
  panel: 12px
  change-item: 10px
  segment: 9px
  button: 8px
  field: 7px
  badge: 5px
  dialog: 16px
spacing:
  panel-padding: 22px
  node-padding: 16px
  grid-gap: 16px
  layer-gap: 14px
  nav-gap: 7px
  segment-gap: 4px
components:
  app-shell:
    backgroundColor: "{colors.bg}"
    width: "222px + 1fr"
  rail:
    width: 222px
    backgroundColor: "{colors.panel}"
  brand-mark:
    size: 34px
    backgroundColor: "{colors.navy}"
    textColor: "#ffffff"
    rounded: 10px
  nav-item:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
  nav-item-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    padding: "{spacing.panel-padding}"
  node:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    padding: "{spacing.node-padding}"
  layer-title:
    backgroundColor: "{colors.soft}"
    rounded: "{rounded.panel}"
  segment:
    backgroundColor: "{colors.soft}"
    rounded: "{rounded.segment}"
    padding: "{spacing.segment-gap}"
  segment-active:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
  button:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.button}"
    padding: "8px 12px"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.button}"
  badge:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.muted}"
    rounded: "{rounded.badge}"
  badge-accent:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.badge}"
  badge-warn:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn}"
    rounded: "{rounded.badge}"
  focusbar:
    backgroundColor: "{colors.navy}"
    textColor: "#ffffff"
    rounded: "{rounded.button}"
  dialog:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.dialog}"
    width: "min(740px, calc(100vw - 32px))"
  field-input:
    height: 40px
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.field}"
  empty:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
---

## Overview

JuanerAI 系统蓝图 v4.2 设计语言是全系产品 UI 的唯一默认基线（2026-10-04 用户裁定，以蓝图版为准）。冻结源文件 `source/juanerai-system-blueprint-v4.2.html` 是像素级权威；本文件是其产品化沉淀，冲突时以冻结源为准。形态是「文档式阅读工作台」而非营销页或仪表盘：暖灰纸感底承载阅读，白色面板承载内容，铁锈橘 accent 承载导向——eyebrow、链接、mono 元数据、编号、关联高亮与主操作；深藏青承载品牌标记、原则横条与「系统动作」通道。

四条产品语义随视觉语言一体复刻，任何产品不得剥离：① **AI 推进任务，系统守住边界**——循环归系统，闸门归代码，人只做关键决策；② **人看得懂过程**——证据与反证、授权与隐私、人的责任与 Owner、行动单独授权四原则常驻可查（深藏青横条形态），「有据、不越界、可检查，并不等于让用户逐个批准每一步」；③ **如实披露完成度**——「模块卡片表示产品责任，不表示全部已实现」，规划/已批准/待发布状态必须如文字标注，不伪造实现；④ **版本与边界常驻**——来源、版本与边界入口固定在导航轨底部。

## Brand Identity

左轨品牌块：34px 深藏青圆角标（radius 10px）内白色首字母或冻结品牌图裁切 + 品牌名（1.05rem）+ 灰色双语副题（0.75rem，格式「产品名 / 类型」）。`JuanerAI` 是品牌名，产品名与之并列可辨；slogan 精确为「持续做出更好的决策」，不得改写。有冻结品牌资产的产品（如图形 logo）优先用资产裁切，无资产的用藏青字母标，禁止其他临时配色图标。

## Colors

三级表面：`bg` 页面纸感底、`panel` 白色面板/按钮/输入、`soft` 分区底与分段容器与 layer-title；单级边框 `line`。文本两级：`ink` 正文、`muted` 次级说明与元数据（页脚再降为 0.75rem muted）。

铁锈橘 `accent`（#b44626）用于：eyebrow、全部链接与 link-btn、mono 元数据（编号/标签/关联计数/change-id）、导航与路由选中态（accent-soft 底 + accent 字 + 650）、primary 实心按钮、badge-accent/chip-n 底色、hover 反馈（描边 + soft 底）、关联高亮（inset 双描边）。`accent-soft` 是 accent 的浅底；`accent-line`（#eac4b5）用于 accent 语义的 badge/chip 描边。

深藏青 `navy` 用于：brand mark、focusbar/governance 原则横条（白字 + #758290 描边 chips + #d6dde4 注释）、story-card 的 system 左边框（人的动作用 accent 左边框——人橘机藏，双通道）。`warn` 语义为「待定/规划/注意」（badge-warn 成对出现）。关联性表达：相关 = inset 0 0 0 1px accent 双描边；无关 = opacity .4（打印时恢复 1）。对话框 backdrop `#20293270`。

状态绝不只用颜色表达：badge 与状态点必须同时带文字；语义色成对出现（深字 + soft 底 + line 描边）。

## Typography

系统栈优先（-apple-system / BlinkMacSystemFont / SF Pro Text / PingFang SC），不引入 Web 字体文件；编号、ID、指标名、元数据、代码用 `mono`。标题只用 650 字重：页面大标题 clamp(1.7rem, 2.2vw, 2.15rem) 且字距 -0.025em，视图标题 1.375rem，卡片标题 1.05rem，节点标题 0.875rem。正文 1rem/1.6；辅助 0.8125rem/1.65（muted）；页脚与徽标 0.75rem。eyebrow（0.75rem/650/0.1em/accent 色）位于页面与区块标题上方，是每视图的第一元素。数字一律 `font-variant-numeric: tabular-nums`（统计条大数字 1.05rem）。行内代码：mono 0.75rem、soft 底、radius 4、padding 2px 5px。

## Layout

固定外壳 `grid: 222px + 1fr`：左轨 sticky 全高（panel 底、右边框线、padding 28px 18px）——品牌块 / 导航（mono 编号 + 文字，gap 7px）/ 底部 rail-note（border-top 分隔：粗体导语 + muted 说明 + 全宽描边小按钮，如「来源、版本与边界 ↗」）；右侧内容区 max-width 1700px 居中，padding 30px clamp(20px,3vw,48px) 40px。内容头部：top 区（eyebrow → 大标题 → muted 副题 max-width 760px；右侧 top-actions 放 badge 与描边动作）→ headline-strip 统计条（上下 1px 线夹住的大数字 + 标签，右侧状态注释 max-width 430px）→ focusbar（如需）→ section-head（标题 + muted 说明左，segment 分段控件右）→ 内容 → footer（border-top，0.75rem muted，左右分列）。

区块骨架两式：`.layer`（144px soft 左轨卡：mono 橙标 + 0.9375rem 标题 + 0.75rem 注；右侧 nodes 自适应网格 minmax(178px,1fr) gap 10px）与自由 `.panel` + `.grid`（auto-fit minmax(280px,1fr) gap 16px；`.grid.two` 双列）。长流程用 `.stage-grid` 三列卡。用户旅程用 `.story-map` 七列横向滚动（≥1800px 转自适应）。

响应式：≤1200px rail 188px、layer 左轨 116px、stage-grid 两列；≤800px rail 变顶部横条（nav 横向滚动、编号隐藏、rail-note 隐藏）、layer 左轨并入、valuechain 两列；≤480px 全单列。`prefers-reduced-motion` 时禁用全部过渡。打印（A3 横向）：隐藏 rail/top-actions/focusbar/segment/link-btn/footer 按钮，全部视图平铺分页，颜色 exact。

## Elevation & Depth

平时无阴影：层级由三级表面 + 1px line 边框 + 位置表达。唯一阴影给浮层 dialog：`0 18px 60px rgba(25,38,49,.14)`。焦点环全站统一 `3px solid accent + offset 3px`（含 button/input/select/summary/[tabindex]）。关联高亮用 inset 双描边（`border-color accent + inset 0 0 0 1px accent`），不用阴影或填充。

## Shapes

圆角阶梯：面板/节点/layer/空态 12px；变更折叠项/横向滚动区 10px；分段容器 9px；按钮/输入高 40px 场景/story-card/深条/tech 项 8px；输入 7px；badge/chip 5px；dialog 16px；brand mark 10px。无胶囊形（不用 999px 全圆角）。空态用 1px 虚线框 + muted 文案 + 下一步动作，不用实色块假装内容。

## Components

**自定义控件，不引入组件库**，类名语义以冻结源为准：

- **左轨导航 .nav**：透明底无边框按钮，mono 0.75rem 编号 + 0.875rem 文字；选中 accent-soft 底 + accent 字 + 650（编号同变 accent）。
- **.badge**：5px 圆角小徽（0.75rem/550），三态 neutral（soft/muted）/accent（#fcf0e9 底 #eac4b5 描边）/warn（#faf3e4 底 #e6d2a9 描边）；必须带文字。
- **.segment 分段控件**：soft 容器 padding 4px radius 9px，段按钮透明无边框；活动段白底 + line 描边 + 600。视图/口径切换专用，切换只换视图不清状态。
- **.panel 卡** 与 **.node 节点卡**：panel 白底 line 边框；node 内部 = 0.875rem/650 标题 + 0.8125rem muted 正文 + 底行 mono 0.6875rem accent 元数据（如「N 项关联能力 · 查看对应 ↗」），`margin-top:auto` 压底。
- **.layer-title 左轨卡**：soft 底，mono 0.6875rem accent 标签（字距 .08em）+ 0.9375rem 标题 + 0.75rem muted 注。
- **.valuechain 四联条**：单容器内四格 1px 竖线分隔，mono 橙标 + strong + muted 注。
- **.focusbar / .governance 深藏青横条**：navy 底白字 radius 8；白描边 chips（#758290 边）+ `small` #d6dde4 注释（右压或整行）。用于常驻原则与全局口径，不用于普通提示。
- **.story-card 旅程卡**：白底 8px 圆角 + **3px 左边框语义**：人（human）= accent，系统（system）= navy；small 类目标签 0.6875rem/600。
- **.field 表单**：label 在上、输入在下（高 40px、radius 7px、line 边框），不用 placeholder 代替标签；.filterline 行尾放 result-count。
- **.change-item 折叠条**（details）：radius 10px，summary 行 = mono accent 编号 + 标题（粗体 + muted 小注）+ 右侧 ＋/− 伪元素；展开体 kv 两列（100px 标签列）。
- **.kv 定义列表**：100px muted 标签列 + minmax(0,1fr) 内容，≤480px 单列。
- **.empty 空态**：虚线框 + 0.875rem muted 文案 + 后续动作按钮。
- **.comparison 表格**：th soft 底 600、行 1px 底线、cell padding 12px/行高 1.8、首列 105px 加粗。
- **dialog 模态**：min(740px, 100vw-32px)、radius 16px、sticky 头（22px 24px padding + 底边线）、dialog-actions 顶边线分离动作行；primary 按钮实心 accent。backdrop `#20293270`。
- **.link-btn 文字链接**：无边框透明底、accent 色、下划线 offset 3px。
- **footer**：border-top、0.75rem muted、左右分列；右侧动作用 link-btn。

## Interaction Semantics（蓝图承载的产品交互语义，全系必守）

- **视图切换只切视图**：segment/nav 用 aria-pressed 表达选中，切换不清空数据、不转换会话、不丢表单态。
- **四态如实标注**：已批准 / 规划 / 待发布 / 不改变——用 badge 带文字表达，禁止用颜色或位置暗示完成度；「模块卡片表示产品责任，不表示全部已实现」，任何产品不得展示未实现能力而不标注。
- **人机双通道**：用户旅程中人的动作（accent 左边框）与系统动作（navy 左边框）视觉可分；AI 建议、系统执行、人决策三者在同一页面可追溯。
- **关联可核查**：节点间的关联用「mono 元数据 + 查看对应 ↗」落到具体目标；选中节点高亮相关（双描边）、弱化无关（opacity .4），并给 legend 说明「主要对应，不是新的工程所有权」。
- **原则常驻**：focusbar/governance 四原则（证据与反证、授权与隐私、人的责任与 Owner、行动单独授权）在关键流程页常驻，并配「并不等于让用户逐个批准每一步」的边界说明——闸门归系统，人只做关键决策。
- **定位声明**：阅读型页面标注「规划阅读，不是运行控制台」；可执行产品标注真实运行边界（本机/云端、只读/写入）。
- **焦点与可达**：全站 3px accent 焦点环；skip-link 进入主内容；reduced-motion 尊重系统设置。

## Do's and Don'ts

Do:

- 每个视图以 eyebrow + 大标题 + 一句副题开场；数据密集视图配 headline-strip 统计条 + 右侧状态注释。
- 编号、ID、计数用 mono + accent；节点元数据压底对齐；数字 tabular-nums。
- 列表与网格提供虚线空态 + 下一步动作；长流程提供 stage 分段卡。
- 状态与完成度用 badge 带文字如实标注；来源、版本与边界入口常驻左轨底部。
- 深藏青横条只用于原则与全局口径；人/系统动作双通道用左边界色。

Don't:

- 不引入组件库默认皮肤覆盖本规范；不混用旧版 token（#e8643a 亮橘、14px 圆角、Inter 优先栈均已废弃）。
- 不做营销页：无 hero、无装饰渐变、无玻璃拟态、无嵌套卡片滥用；panel 内不再套 panel（layer-title/nodes 除外）。
- 不让颜色成为唯一状态信号；不用 placeholder 代替表单标签；不截断关键信息（长 ID/标题给 title 或换行）。
- 不隐藏失败与未完成：规划/待发布/未实现必须可见；不提供「跳过核查」「强制结论」类入口。
- 未授权不得静默调用模型或外发数据；授权不折叠成无内容复选框；打印只输出内容，交互件全部隐藏。
