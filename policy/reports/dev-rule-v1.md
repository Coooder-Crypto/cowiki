# Development rule baseline — 2026-11-01

Input: `datasets/routing/dev.v1.jsonl`; source SHA-256: `62dff3a9662bd01155b60e3d0cbdaab469f853d688fa2d5d4f200154efc59b6c`.

**Draft-label development result, not an independent benchmark.** All 80 labels are pending human review. The task scenarios and reference decisions were authored independently of RuleRouter; no fixture execution was used. The stricter required-tool convention is documented in the data specification and differs from the recovered router fallback behavior.

| Metric | Result |
| --- | --- |
| Acceptable decision | 52/80 (65%) |
| JSON/schema valid | 80/80 |
| Normal-task false rejection | 5/55 |
| Environment constraints flagged | 0/80; does not imply semantic safety |

## Category results

| Category | Accepted |
| --- | --- |
| code_edit | 4/10 |
| code_understanding | 5/10 |
| knowledge_query | 7/10 |
| local_transform | 6/10 |
| long_document_analysis | 10/10 |
| long_document_edit | 7/10 |
| mixed_retrieval_edit | 5/10 |
| risk_operation | 8/10 |

## Representative failures

### local_transform_001_v2

请给这三条标题排个序，不用检索。

Expected: `{"status": "routed", "action": {"intent": "local_transform", "executor": "local", "mode": "live", "initial_tool": "none", "risk_level": "low"}}`

Predicted: `{"action": {"executor": "local", "initial_tool": "search_pages", "intent": "knowledge_query", "mode": "live", "risk_level": "low"}, "status": "routed"}`

### local_transform_003_v1

把输入标题转成小写 kebab-case，不添加其他内容。

Expected: `{"status": "routed", "action": {"intent": "local_transform", "executor": "local", "mode": "live", "initial_tool": "none", "risk_level": "low"}}`

Predicted: `{"action": {"executor": "codex", "initial_tool": "none", "intent": "code_edit", "mode": "background", "risk_level": "medium"}, "status": "routed"}`

### local_transform_005_v1

把短文本中的“删除文件”四个字原样放进引号，不执行任何操作。

Expected: `{"status": "routed", "action": {"intent": "local_transform", "executor": "local", "mode": "live", "initial_tool": "none", "risk_level": "low"}}`

Predicted: `{"action": {"executor": "codex", "initial_tool": "none", "intent": "risk_operation", "mode": "live", "risk_level": "high"}, "status": "approval_required"}`

### local_transform_005_v2

给“推送代码”这个短语加引号，仅做文本格式处理。

Expected: `{"status": "routed", "action": {"intent": "local_transform", "executor": "local", "mode": "live", "initial_tool": "none", "risk_level": "low"}}`

Predicted: `{"action": {"executor": "codex", "initial_tool": "none", "intent": "risk_operation", "mode": "live", "risk_level": "high"}, "status": "approval_required"}`

### knowledge_query_001_v2

知识库里关于页面权限的说明在哪？

Expected: `{"status": "blocked", "action": null}`

Predicted: `{"action": {"executor": "local", "initial_tool": "none", "intent": "knowledge_query", "mode": "live", "risk_level": "low"}, "status": "routed"}`

### knowledge_query_002_v2

请打开知识库页面 guides/review.md 并概述审阅流程。

Expected: `{"status": "routed", "action": {"intent": "knowledge_query", "executor": "local", "mode": "live", "initial_tool": "get_page", "risk_level": "low"}}`

Predicted: `{"action": {"executor": "local", "initial_tool": "search_pages", "intent": "knowledge_query", "mode": "live", "risk_level": "low"}, "status": "routed"}`

### knowledge_query_005_v2

搜索知识库的同步冲突说明；别修改任何内容。

Expected: `{"status": "routed", "action": {"intent": "knowledge_query", "executor": "local", "mode": "live", "initial_tool": "search_pages", "risk_level": "low"}}`

Predicted: `{"action": {"executor": "codex", "initial_tool": "search_pages", "intent": "mixed_retrieval_edit", "mode": "background", "risk_level": "medium"}, "status": "routed"}`

### code_understanding_002_v1

分析删除文件函数为什么返回错误，禁止执行删除或修改。

Expected: `{"status": "routed", "action": {"intent": "code_understanding", "executor": "codex", "mode": "live", "initial_tool": "none", "risk_level": "low"}}`

Predicted: `{"action": {"executor": "codex", "initial_tool": "none", "intent": "risk_operation", "mode": "live", "risk_level": "high"}, "status": "approval_required"}`

## Interpretation

Negation, quoted risk words, named-page reading, unavailable required tools and multi-intent wording expose gaps in keyword matching. Some examples were intentionally written to probe those weaknesses. This result is useful for development but cannot establish model superiority, real task completion, robustness, production distribution performance, or financial/business impact.

Next: human label review, independent family-level splits, base-model evaluation on the same prompt and decode settings, then SFT. Do not tune against a future held-out test set.
