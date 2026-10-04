# 任务拆解与开发清单

- [x] **Task 1: pybridge 安全沙箱与自定义 Python 代码执行器**
  - 在 `pybridge/src/pybridge/sandbox.py` 实现 AST 白名单静态安全检查（禁敏感模块导入、文件写入、系统调用）；
  - 实现动态数据列变换引擎：支持单值转换（1对1）与多列拆分（1对多），处理前 10 行预览及全量落盘；
  - 编写 `pybridge/tests/test_sandbox.py` 自动化测试通过（6/6 Passed）。

- [x] **Task 2: studio-api AI 生成与沙箱调用端点**
  - 在 `services/studio-api/src/ai-cleaning.ts` 构建带数据安全围栏的 LLM Prompt（仅传列名、类型、前 1~2 行匿名样本，绝不外发明细）；
  - 增加端点 `POST /api/datasets/:id/ai/custom-cleaning/generate-preview`；
  - 增加端点 `POST /api/datasets/:id/ai/custom-cleaning/apply`（产出新版本并沉淀为可重用算子）；
  - 编写 `services/studio-api/test/ai-cleaning.test.ts` 测试通过（2/2 Passed）。

- [x] **Task 3: 前端 AI 自然语言定制清洗组件与前后对比 Diff 浮层**
  - 在「清洗」页面顶部增加「✨ AI 定制清洗卡片」：自然语言输入框 + 列选择 + 灵感快捷推荐；
  - 封装「清洗前后效果对比弹窗（AI Cleaning Preview Modal）」：直观展示行级 Diff 对比、安全承诺徽章（“本地计算，0 明细数据外传”）；
  - 确认后一键应用并生成清洗成果单，并将算子收纳到清洗卡片列表中。

- [x] **Task 4: 全链路回归与交付验证**
  - 验证使用森马服饰真实表格：将“该商品主要销售时间段”自然语言拆分为“销售起日”与“销售止日”；
  - 验证将“产品经理”中的姓名自然语言提取为独立列；
  - 全量自动化测试回归与构建完成。
