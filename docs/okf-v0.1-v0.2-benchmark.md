---
title: "OKF v0.1 与 v0.2 增益评测方案"
description: "用配对实验区分格式兼容、结构化元数据增益与 CoWiki 端到端产品效果。"
type: Research
tags: [OKF, benchmark, evaluation, CoWiki]
---

# OKF v0.1 与 v0.2 增益评测方案

> 本文保留实验实现和 pilot 日志。对构念效度、非劣/优效假设、样本量和采用结论的科研复核，以
> [`okf-v0.2-scientific-assessment.md`](okf-v0.2-scientific-assessment.md) 为准。复核确认当前
> CONFLICTS 轨道主要测试来源日期/provenance 表示，并未直接测试 `verified/status/stale_after`。
>
> 2026-09-13 更新：公平 N/P/S/PS adapter 与正式 CONFLICTS `S−P` 非劣性方案已经实现并在
> [`PREREGISTRATION.md`](../benchmarks/okf-delta/PREREGISTRATION.md) 冻结。本文下方既有
> `v1_native/v1_rich/v2_native/v2_ablated` 数字均为历史 pilot，不属于新的确认性分析。

## 结论

目前没有一套公开 benchmark 能直接回答“OKF v0.2 相比 v0.1 提升了什么”，但不应因此自行编写
正式题库。推荐方法是复用公开 benchmark 的原始问题、证据、标签和官方 evaluator，只维护一个
确定性的 OKF v0.1/v0.2 表达适配层。

CoWiki 应把 `OKF-DeltaBench` 定位为公开 benchmark 的配对实验 harness，并把问题拆为三层：

1. **确定性兼容性**：能否正确解析、保留、迁移和回滚；
2. **格式语义增益**：在相关文档已经给定时，v0.2 的结构化字段是否改变 Agent 决策；
3. **端到端产品收益**：加入 CoWiki 检索、渐进披露、编辑和 Git Review 后是否仍有收益。

三层结果分别报告，不合并成一个模糊总分。当前仓库已接入 CONFLICTS 的生命周期/冲突分类轨道，
并实现 ALCE QAMPARI 的来源适配与官方 evaluator 导出；原有合成 lifecycle 题只保留为回归测试。
实现位于 [`benchmarks/okf-delta`](../benchmarks/okf-delta/README.md)。

## 1. 为什么不能沿用原来的 benchmark 章节

原方案把 OKF 版本、index、检索器、consumer、writer、Git 工作流和语料规模同时改变。
即使实验组更好，也无法判断收益来自 v0.2、搜索实现还是额外提示词。

另外，RAGAS、DomainRAG 等通用 RAG benchmark 主要评价检索和回答，不能直接测试
`verified`、`status`、`stale_after`、`sources` 和 Attested Computation。
`50/500/10,000 Concept` 之类规模可用于工程压测，但在没有生成过程、代表性说明和
ground truth 时不能构成语义 benchmark。

确定性工程指标可以要求 100%，LLM 行为指标则不应预先拍出 95% 之类门槛。应先完成
pilot，估计配对分歧率和实际效应，再冻结最小有意义提升与正式样本量。

## 2. 现有证据能提供什么

| 来源 | 可复用内容 | 不能直接证明的内容 |
| --- | --- | --- |
| [OKF trust benchmark](https://github.com/scaccogatto/okf-skills/blob/main/benchmark/trust/RESULTS.md) | 过期、废弃、事实替换任务和可复现 harness | 对照组没有可用时效信号，正式主结果按其自身协议无效；不是 v0.1 对照 |
| [OKF gate benchmark](https://github.com/scaccogatto/okf-skills/blob/main/benchmark/gate/RESULTS.md) | 写入门禁和读取 lifecycle metadata 的实验结构 | 比较的是 gate 与 metadata，不是 v0.1/v0.2 |
| [FreshQA](https://arxiv.org/abs/2310.03214) | 动态事实、错误前提、时效问题 | 不含 OKF 表达和迁移 |
| [ALCE](https://arxiv.org/abs/2305.14627) | citation correctness、completeness | 不测试 lifecycle |
| [RGB](https://arxiv.org/abs/2309.01431) | 噪声、拒答、信息整合和反事实冲突 | 不测试 OKF provenance 结构 |
| [AuthorityBench](https://arxiv.org/html/2603.25092v1) | 不同权威来源发生冲突时的选择 | 较新的独立 benchmark，需要筛选领域并冻结版本 |
| [AWS BIRD mini_dev 实验](https://github.com/aws-samples/sample-okf-llm-wiki/blob/main/benchmark/mini_dev/RESULTS.md) | 数据库问答、Computation 和执行准确率 | 没有相同模型、相同输入下的 v0.1 对照 |

这些来源应当被描述为“改造来源”，而不是 OKF v0.2 的既有市场证明。

## 3. 实验问题与假设

### 3.1 Lifecycle

- H1：`v2_native` 在 current-answer success 上不差于语义等价的 `v1_rich` 正文。
- H2：在仅靠文档编辑时间无法表达的生命周期状态上，`v2_native` 比
  `v1_native` 和 `v2_ablated` 更容易选中当前事实。
- H3：正确率提升不能通过隐藏拒答实现；fresh、stale、abstain、invalid 必须同时报告。

### 3.2 Provenance

- H4：`sources[].id` 与正文脚注的稳定连接能提升逐条 claim 的来源归因正确性和完整性。
- H5：来源列表重排后，基于稳定 ID 的引用不会发生静默错配。

### 3.3 Trust 与 authority

- H6：`verified`、`author`、`usage_count`、`last_modified` 能改善冲突来源选择。
- H7：Agent 不会把 `human-reviewed` 误读成永远正确，也不会忽略更新、更直接的反证。

### 3.4 Computation

- H8：同一 SQL/过程和输入下，v0.2 Attested Computation 能提升参数遵从、执行结果归因和
  receipt/verdict 校验，但不自动授予执行权限。

## 4. 三层评测

### Track A：确定性兼容性

这一层不用 LLM，程序直接断言：

- v0.1/v0.2 parse 和 validate；
- `timestamp` 与 `# Citations` fallback；
- v0.1 → v0.2 显式迁移；
- 未知字段、YAML 标量、注释、正文和 Unicode 保持；
- 所有 timestamp-valued 字段均为带 UTC offset 的 ISO 8601 datetime；
- 迁移失败时 HEAD、index 和工作树完整恢复；
- CoWiki 与官方/独立 validator 的互操作。

格式目标固定到官方仓库 commit
[`ad30107`](https://github.com/GoogleCloudPlatform/open-knowledge-format/commit/ad30107)。

### Track B：oracle-context 语义实验

把两份相关文档直接放入 prompt，不经过搜索，使结果只反映格式与 Agent 的使用方式。

| Arm | 表达 | 回答的问题 |
| --- | --- | --- |
| `v1_native` | v0.1 `timestamp` + `# Citations` | 真实 legacy baseline 能解决多少问题 |
| `v1_rich` | v0.1 + 语义等价的 lifecycle 正文 | 结构化字段是否优于公平的 prose channel |
| `v2_native` | `generated`、`verified`、`status`、`stale_after`、`sources` | v0.2 treatment |
| `v2_ablated` | 保留完全相同正文，只隐藏 v0.2 新 frontmatter | 收益是否来自结构化字段 |

每个 fixture 的问题、事实、文件名和正文保持配对。文件名不能包含 `old`、`new`、
`legacy`、`current`、日期或版本号。外部 benchmark 中，同一 item/repetition 的文档顺序在四个
arm 中完全一致，并记录在结果中；改变 arm 时不能同时改变顺序。

### Track C：CoWiki 端到端

Track B 稳定后，才加入全文检索、index、MCP、编辑、Review 和 Git merge。端到端结果同时
报告 Hit@k、正确率、Token、延迟、读取文件数和 Git diff，不能反推为格式本身的因果效果。

## 5. Lifecycle 回归 corpus

当前 10 个合成 fixture 只用于单元、回归和 smoke test，不进入正式结论。它们按“v0.1 自身可用
信号”分为五层，每层 2 个：

| Stratum | 特征 | 用途 |
| --- | --- | --- |
| timestamp-solvable | 当前文档确实编辑得更晚 | 防止 benchmark 只挑 v0.1 必败题 |
| source-solvable | `# Citations` 中存在合法的来源日期或版本线索 | 测量真实 v0.1 provenance 能力 |
| lifecycle-only | 已废弃文档后来发生维护编辑，单看 `timestamp` 会选错 | 测 `status`、`stale_after`、`verified` 的新增表达能力 |
| ambiguous | 时间、文件名、正文均无法判定 | 区分正确拒答与猜测 |
| authority-conflict | 新但低权威来源与旧但已验证来源冲突 | 测可信度信号，而不是简单“越新越好” |

fixture 不得作为公开 benchmark 的替代品，也不能据此声称真实任务收益。

## 6. 指标和统计

Lifecycle 的共同主要结果：

- current-answer success；
- raw stale assertion rate。

必须同时报告：

- abstain rate；
- invalid/parse failure；
- conditional stale rate，但不得单独作为 headline；
- 每个 conflict shape 和 stratum 的结果；
- median/p95 latency 与 Token（runner 能稳定提供时）。

统计单位是 item。多次 repetition 先在 item 内取平均，再按 item 做 paired bootstrap 95% CI。
正式实验至少使用两个模型家族；固定模型标识、Prompt、当前时间、文档顺序算法和上下文预算。

## 7. 已实现内容

`benchmarks/okf-delta` 当前包含：

- 固定到 commit 和 SHA-256 的 CONFLICTS 完整 458 题下载器；
- 保留官方问题、搜索证据、日期和专家标签的四 arm 适配器；
- CONFLICTS 五分类 accuracy、macro-F1、逐类 recall 与配对 bootstrap；
- ALCE QAMPARI 的四 arm provenance 适配器；
- OKF 稳定 source ID 到 ALCE 官方 `[N]` 引用的可审计转换与 `eval.py` 导出；
- 按 SHA-256 排序、在模型运行前确定的固定抽样；
- 10 个公开可再分发的合成 fixture，五个 stratum 各 2 个；
- 四个 arm 的确定性文档生成器；
- 中性文件名和确定性顺序随机化；
- JSON Schema 结构化回答；
- fresh/stale/abstain/invalid 确定性 grader；
- item-level paired bootstrap；
- correct rate、分层结果、重复分歧和文档顺序诊断；
- 保留原始评分的 grader v2 重评分流程；
- Markdown 报告生成；
- mock、Codex、Claude、Gemini runner 接口；
- harness 单元测试与 smoke run。

Codex runner 使用临时工作目录、ephemeral session、结构化输出和只读 sandbox；模型看不到仓库或
外部工具。Claude 和 Gemini runner 的失败与超时也会保留为 invalid，而不会从数据中静默删除。

## 8. 2026-09-07 实现 pilot

### 8.1 有效运行

- 模型：`gpt-5.6-sol`；
- 2 个 fixture × 4 arms × 1 repetition；
- 8 次调用；
- oracle-context，无搜索、无写工具；
- 结果：

| Arm | Fresh | Stale | Abstain | Invalid |
| --- | ---: | ---: | ---: | ---: |
| `v1_native` | 0/2 | 2/2 | 0/2 | 0/2 |
| `v1_rich` | 2/2 | 0/2 | 0/2 | 0/2 |
| `v2_native` | 2/2 | 0/2 | 0/2 | 0/2 |
| `v2_ablated` | 2/2 | 0/2 | 0/2 | 0/2 |

这是实现验证，不是有效的版本结论。样本只有两个，置信区间没有解释价值。

### 8.2 Pilot 暴露的问题

1. 最早 fixture 使用 `old`、`legacy` 文件名，模型可以绕过 lifecycle 字段猜出答案；现已改为
   中性文件名。
2. 最早 `v2_native` 正文额外包含 replacement 提示，把正文收益错误归给 frontmatter；现已确保
   `v2_native` 与 `v2_ablated` 正文完全一致。
3. v0.1 的 `timestamp` 可以正确处理普通“新文档替换旧文档”，因此正式 corpus 不能只做这种题。
4. `# Citations` 中的月份、版本和 edition 本身就是合法的 v0.1 信号。本次
   `v2_ablated` 仍能据此回答，说明新字段在简单双文档上下文中不一定产生额外收益。
5. 相同题目在早期重复中出现过选择和拒答波动，正式实验必须增加 repetition。
6. 本机 Claude CLI 因全局自定义模型映射而超时，Gemini CLI 也未在 180 秒内返回；当前不能声称
   已完成多模型验证，也不应为跑通实验而修改用户的全局配置。

这个结果否定了“只要给 v0.2 frontmatter 就必然显著提升”的简单叙事。更合理的待验证命题是：
**v0.2 在非单调生命周期、来源冲突和规模化处理时提供稳定、可机器查询的信号；当 v0.1 正文已经
明确写出同等信息时，强模型可能表现相当。**

## 9. 2026-09-07 分层 pilot

### 9.1 设置

- 模型：`gpt-5.6-sol`；
- 10 个 fixture × 4 arms × 2 repetitions，共 80 次真实调用；
- 五个 stratum 各 2 题；
- oracle-context、无搜索、无写工具；
- 两次重复使用不同但确定性的文档顺序；
- 原始响应保留，使用 grader v2 生成独立 regraded JSONL 后统计。

grader v2 修正了实现 pilot 暴露的误判：当模型已选择正确文档，但解释中说明旧值只适用于 legacy
场景时，不再把它判成同时选择新旧答案；`abstain=true` 且
`selected_document=unknown` 时，解释中列举两个候选值也仍判为拒答。

### 9.2 总体结果

| Arm | Correct | Fresh | Stale | Abstain | Invalid | Median / p95 latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `v1_native` | 10/20（50%） | 6 | 10 | 4 | 0 | 14.24 / 19.94 s |
| `v1_rich` | 20/20（100%） | 16 | 0 | 4 | 0 | 12.84 / 15.53 s |
| `v2_native` | 20/20（100%） | 16 | 0 | 4 | 0 | 11.93 / 15.12 s |
| `v2_ablated` | 9/20（45%） | 5 | 0 | 15 | 0 | 12.77 / 14.68 s |

按 item 配对的 pilot 差值：

- `v2_native - v1_rich`：正确率 `0pp`，结构化字段没有胜过语义等价 prose；
- `v2_native - v2_ablated`：正确率 `+55pp`，95% bootstrap CI `[+25pp, +85pp]`；
- `v2_native - v1_native`：正确率 `+50pp`，95% bootstrap CI `[+20pp, +80pp]`。

这些区间只描述小样本 pilot，不是正式显著性结论，也不能作为产品 SLA。

### 9.3 分层发现

| Stratum | `v1_native` | `v1_rich` | `v2_native` | `v2_ablated` | 说明 |
| --- | ---: | ---: | ---: | ---: | --- |
| timestamp-solvable | 4/4 | 4/4 | 4/4 | 0/4 | v0.1 时间戳足够；消融组因无时间信号而拒答 |
| source-solvable | 2/4 | 4/4 | 4/4 | 4/4 | 引用线索强度会影响模型是否压过冲突时间戳 |
| lifecycle-only | 0/4 | 4/4 | 4/4 | 0/4 | v0.1 被后来维护的废弃文档误导；消融组拒答 |
| ambiguous | 4/4 | 4/4 | 4/4 | 4/4 | 四组都能识别没有 adoption 决策并正确拒答 |
| authority-conflict | 0/4 | 4/4 | 4/4 | 1/4 | v0.2 和等价 prose 能使用审批/来源权威信号 |

40 个 item-arm 重复对中仅 1 对两次 outcome 不同，分歧率 2.5%。顺序切分样本很小，暂未发现
`v1_rich` 或 `v2_native` 的顺序敏感性；不能据此宣称没有顺序效应。

### 9.4 能支持与不能支持的结论

这轮可以支持：在这些冻结的合成题中，v0.2 结构化 lifecycle/trust 字段可达到与等价正文相同的
决策效果，并在 v0.1 缺少表达能力的非单调生命周期和权威冲突中避免过期断言。它的产品价值更像
“把可用的 prose 信号变成统一、可校验、可查询的字段”，而不是让强模型凭空获得新推理能力。

这轮不能支持：v0.2 对所有知识任务提升 50%、结构化字段优于明确正文、真实 CoWiki 检索已经受益、
或跨模型普遍成立。语料只有 10 个合成 item，且只有一个模型家族。

## 10. 2026-09-09 至 2026-09-12 公开 benchmark 接入与真实模型验证

### 10.1 数据与实现

- CONFLICTS 固定到仓库 commit `81ba921dd684a93db41a7e9dda6b6a7c67348a88`；
- 官方 `conflicts.jsonl` 共 458 条、46,717,034 bytes；
- SHA-256 为 `14559d5c08fde057d7b46783e3345ee5852d6cf6a750f370dc072a0b957fac54`；
- 下载后同时校验长度和 SHA-256，不把第三方数据提交到 CoWiki 仓库；
- CONFLICTS 采用官方五分类 exact-label accuracy 与 macro-F1；生成质量暂不作为 headline，避免把
  LLM-as-judge 的变化混入格式比较；
- ALCE 代码固定到 `246c476a4edfc564266b7346b6e29ef4861ae937`，数据固定到 Hugging Face
  revision `334fa2e7dd32040c3fef931a123c4be1a81e91a0`；
- ALCE 官方归档为 451,297,280 bytes，SHA-256 为
  `eda837bf659a91b3648dc6e7ab6b17197664d93593857e8fdf3800b6aa6a98f0`；本轮采用的
  `qampari_eval_gtr_top100_reranked_oracle.json` 共 1,000 题、每题 5 篇文档，文件为
  8,434,999 bytes，SHA-256 为
  `88f618efefe448779126ef2fa1d28c50bb12eb4e841951c85a9b3e3c6b5ac092`；
- ALCE code repo 是 MIT，但独立 dataset repo 没有声明数据许可证，因此当前只做本地下载与评测，
  不在本仓库重新分发数据。

### 10.2 CONFLICTS 平衡 pilot

使用 `gpt-5.6-sol`，从五个官方类别中各按 SHA-256 固定抽取 2 题，每题重复 2 次，运行 4 个 arm，
共 80 次调用。四组在同一 item/repetition 上使用完全一致的文档顺序。

| Arm | Accuracy | Macro-F1 | 说明 |
| --- | ---: | ---: | --- |
| `v1_native` | 7/20（35%） | 34.9% | 原生 v0.1 基线 |
| `v1_rich` | 9/20（45%） | 46.7% | 语义等价 prose 公平对照 |
| `v2_native` | 9/20（45%） | 45.1% | v0.2 结构化表示 |
| `v2_ablated` | 6/20（30%） | 30.0% | 移除新增元数据字段 |

按 item 配对、先对 repetition 求平均后的正确率差值为：

- `v2_native - v1_rich = 0pp`，95% bootstrap CI `[-15pp, +15pp]`；
- `v2_native - v2_ablated = +15pp`，95% bootstrap CI `[0pp, +40pp]`；
- `v2_native - v1_native = +10pp`，95% bootstrap CI `[0pp, +25pp]`。

因果控制诊断中，20 个 item/repetition 组没有文档顺序不一致；40 个重复 item/arm 对中有 7 对预测
不同，分歧率 17.5%。这说明 runner 的顺序混杂已被消除，但模型随机性不可忽略，正式实验必须保留
多次 repetition。当前样本只有 10 题，区间仍宽：它支持 `v2_native` 与公平 prose 对照表现相当，
并显示新增字段相对消融组可能有帮助；不能据此宣称 v0.2 已取得统计显著或可泛化的提升。

最初每类 1 题、共 20 次调用的 probe 仅用于发现适配器问题，不再作为主要结果。该 probe 暴露出四个
arm 文档顺序不同会使分类翻转；问题修复后，测试会断言同一 item/repetition 四组顺序完全一致。

### 10.3 ALCE QAMPARI pilot

从锁定的 1,000 题 official reranked-oracle 文件按 SHA-256 固定抽取 10 题，运行 4 个 arm，共 40 次
调用。第一次运行成功保存 29 行，另有 11 行因账户用量限制明确记为失败；随后使用
`--resume --retry-errors` 保留成功行并只重跑失败键，最终得到 40 行有效记录、0 个 runner error。

| Arm | QAMPARI precision | Recall | Recall@5 | F1 | F1@5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `v1_native` | 49.0% | 32.9% | 50.0% | 34.1% | 46.8% |
| `v1_rich` | 49.0% | 30.2% | 48.0% | 31.6% | 45.7% |
| `v2_native` | 49.8% | 29.7% | 50.0% | 31.3% | 47.3% |
| `v2_ablated` | 49.8% | 29.0% | 48.0% | 30.5% | 46.2% |

所有 v0.2 stable source ID 都成功、确定性地转换为 ALCE 的 `[N]` 引用，未出现无法解析的引用。
按 item 配对的 QAMPARI F1@5 差值为：`v2_native - v1_rich = +1.5pp`（95% bootstrap CI
`[0pp, +4.0pp]`）、`v2_native - v2_ablated = +1.1pp`（`[0pp, +3.3pp]`）、
`v2_native - v1_native = +0.4pp`（`[0pp, +1.3pp]`）。四组在 10 题上的答案指标接近；这些区间只
描述该固定小样本，单次运行也无法估计生成随机性，因此不能把非负区间解释为正式显著性结论。

这些数值是本地 preflight，不是完整官方 ALCE 分数。官方 citation recall/precision 依赖锁定的
`eval.py` 与 `google/t5_xxl_true_nli_mixture` AutoAIS 模型；当前 32 GB 本地环境和 Python 3.14
没有该旧版 PyTorch/约 11B 参数评测栈，因此没有生成官方引用分数，也没有用自制 LLM judge 替代。
在官方 evaluator 可复现之前，本轮 ALCE 只能证明数据适配、引用映射、恢复运行和答案级确定性评分
链路成立，不能证明某一 OKF 版本的引用质量更高。

## 11. 下一阶段

### 11.1 CONFLICTS 样本量与分阶段方案

平衡 pilot 中，`v2_native` 对 `v1_rich`、`v2_ablated`、`v1_native` 的逐次配对不一致率分别为
10%、15%、20%。以双侧 `alpha=0.05`、power 80% 和较保守的 20% 不一致率做 McNemar 近似规划：

| 希望检出的绝对提升 | 所需独立 item 对（约） | 仅跑两个 primary arm、1 个模型、1 次的调用数 |
| --- | ---: | ---: |
| 5pp | 626 | 1,252；已超过 CONFLICTS 的 458 题规模 |
| 10pp | 155 | 310 |
| 15pp | 68 | 136 |

该估算来自 10 题 pilot，误差很大，只用于预算量级判断，而且只对应“发现正向 superiority”，不能
用来证明 non-inferiority 或 equivalence。若真实差值为 0、配对不一致率为 10–20%，使用单侧
`alpha=0.025`、power 80%、non-inferiority margin 5pp，粗略需要 314–628 个独立 item 对。
CONFLICTS 全量只有 458 题，因此保守条件下甚至可能不足以证明 5pp 非劣。

这也说明原先“每类 5 题 × 4 arm × 2 次 × 2 模型 = 400 调用”的方案把调用分散得太薄：每个模型
只有 25 个独立 item，不能可靠检出 10pp。正式运行应先冻结 `v2_native - v1_rich` 为 primary
contrast，并先确定要检验 superiority、non-inferiority 还是 equivalence，再执行：

1. 首轮正式估计：优先跑全部 458 题、两个 primary arm、一次生成，共 916 次调用，以获得 458 个
   独立 item 对；然后依据 blinded variance estimate 决定是否增加 template/repetition。
2. 若只预算 620 次调用，155 item × 2 arms × 2 repetitions 可以估计随机性并检测约 10pp 的大幅
   superiority，但不能被描述为 5pp non-inferiority 验证。
3. 跨模型复现：第二个模型家族复用同一锁定 item 和 prompt；作为独立 replication 报告，不把两个
   模型的调用当作同一批独立样本混合增大显著性。
4. `v2_ablated` 与 `v1_native` 是 secondary contrasts；primary 结果成立后再加入，避免四组同时跑
   导致主要对照欠功效。多重比较使用 Holm 校正或明确标为探索性分析。

### 11.2 其余 benchmark 工作

1. 为锁定的 ALCE commit 建立可复现的兼容环境或使用能承载 T5-XXL AutoAIS 的云端 GPU；先在官方
   示例输出上复现 evaluator，再评四个 arm。没有这一步，不发布 citation recall/precision。
2. 官方 ALCE scorer 就绪后，再扩大 QAMPARI 固定样本并增加 repetition；答案指标与官方引用指标
   分开报告，按 item 做配对区间，不只比较聚合均值。
3. BIRD computation track 只在 Attested Computation 适配规则冻结后接入，不能用不同基础模型的
   leaderboard 分数代替版本对照。
4. 最后将稳定的 Track B 接入 CoWiki 本地检索和 Cloud Review，形成 Track C。

正式报告必须同时发布协议 revision、fixture、生成后的 prompts、原始 JSONL、grader、分析脚本、
模型标识和失败记录。只有在正式 measurement 冻结并完成后，结果才能进入 OKF 采用决策。
