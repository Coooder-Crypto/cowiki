# OKF v0.2 × CONFLICTS 实验设计与中期报告

> - 状态：**INCOMPLETE — 不作正式非劣效判定**
> - 数据截点：2026-09-13 07:06:26 UTC
> - 完成度：223 / 458 个配对（48.7%），446 / 916 次有效调用
> - 证据等级：C（中期观察；原始逐条 JSONL 当前不可用）

## 0. 这个实验测什么

实验测的是一个窄而可归因的问题：

> 在问题、检索文档、正文、来源事实、文档顺序、任务指令、输出格式和模型都相同的条件下，把来源
> metadata 写成结构化 OKF frontmatter，而不是等价 prose，会不会降低模型的冲突分类正确率？

它不是对“OKF v0.2 整体价值”的一次总测评，也不是直接拿完整 v0.1 文件和 v0.2 文件对打。直接
比较两个版本会同时改变字段、信息量和编码位置，无法判断结果由什么造成。因此正式实验使用公平对照：

- `P`（prose）：来源 ID、URL、标题和日期位于正文 `Source metadata` 小节；
- `S`（structured）：完全相同的值位于 OKF `sources` frontmatter。

主结果只回答“**结构化表达相对等价 prose 是否非劣**”。它不验证 `verified`、`status`、
`stale_after`、Attested Computation，也不证明 OKF 会改善检索、编辑、权限、安全或引用维护。

整个实验链路是：

```text
锁定 CONFLICTS 数据
  → 校验文件大小与 SHA-256
  → 确定性适配成 canonical metadata
  → 从同一 metadata 生成 P/S 两种文档
  → 固定文档顺序、随机化 arm 先后
  → 独立调用同一模型与同一任务 prompt
  → JSON Schema 约束输出
  → exact-label 确定性评分
  → item-level 配对 bootstrap 与非劣效判定
```

## 1. 实验设计

### 1.1 参考 benchmark：CONFLICTS

本实验的主 benchmark 是 Cattan 等人在 2025 年提出的
[`CONFLICTS`](https://arxiv.org/abs/2506.08500)。原论文研究检索增强生成（RAG）场景中的知识冲突，
给出冲突类型 taxonomy、符合真实检索形态的多来源问答数据，以及专家标注。实验数据取自
[`google-research-datasets/rag_conflicts`](https://github.com/google-research-datasets/rag_conflicts)
官方仓库，并锁定到固定 commit 和文件哈希；因此这里的“参考”不是只借用评价思路，而是直接在
CONFLICTS 的公开题目和检索文档上进行受控实验。

选择 CONFLICTS，而不是自行构造题库，主要基于以下对应关系：

| CONFLICTS 提供的条件 | 对本实验的价值 |
| --- | --- |
| 每题包含一个 query 和多篇已冻结的检索 passage | 可以固定证据内容，只改变 metadata 的表达方式 |
| 专家标注的五类 `conflict_type` | 可以用 exact-label 确定性评分，避免把 LLM judge 引入主指标 |
| passage 附带 title、URL，部分附带 date | 可以映射为 OKF `sources` 的 `title`、`resource`、`last_modified` |
| 458 个公开 item | 可以在固定全集上做 item-level P/S 配对分析，而非挑选有利样例 |
| 数据集是静态 release | 不受在线检索排序、网页更新和搜索个性化的漂移影响 |

但本实验**不是 CONFLICTS 原论文实验的完整复现**。两者的继承与新增关系如下：

| 实验要素 | 来源 |
| --- | --- |
| question、retrieved passages、文档顺序、五类 gold label | 直接继承 CONFLICTS release |
| title、URL、date | 继承 CONFLICTS，并通过确定性规则映射为 canonical metadata |
| P（prose）与 S（OKF frontmatter）两种表示 | 本研究新增的干预变量 |
| 等值校验、arm 顺序随机化、JSON Schema 输出约束 | 本研究新增的控制条件 |
| `Δ = correct_S − correct_P`、`−5pp` 非劣界值、配对 bootstrap | 本研究预注册的统计协议 |
| 原论文中的生成质量与冲突应对评价 | 不作为本报告的主结果 |

因此，这个实验可以回答的是：在 CONFLICTS 的多来源冲突分类任务上，OKF 结构化来源 metadata 相对
等价 prose 是否造成可检测的性能损失。它不能单独证明 OKF v0.2 的整体优越性，也不能直接测量
`verified`、`status`、`stale_after` 等 CONFLICTS 没有 gold truth 的字段。ALCE 等引用 benchmark
被保留为后续 provenance/citation 轨道，不与本报告的 CONFLICTS 主实验混算。

### 1.2 研究假设

主 estimand 是每个题目上 S 与 P 正确性的配对差：

```text
Δ = mean(correct_S − correct_P)
```

其中正确为 1、错误为 0。采用非劣效而不是优效设计，是因为结构化格式即使不提高单次分类准确率，
只要不造成不可接受的能力下降，仍可能因机器可解析、字段验证、迁移和审计能力而具有工程价值。

预注册假设为：

```text
H0: Δ ≤ −5pp
H1: Δ > −5pp
```

非劣界值冻结为 `−5pp`。只有满足以下两个条件才允许判定 `PASS`：

1. 458 个题目的 P/S 配对全部完成；
2. 预指定的 item-level 配对 percentile bootstrap 95% 区间下界严格大于 `−5pp`。

使用 100,000 次重采样，随机种子为 `okf-conflicts-ni-bootstrap-v1`，单侧 `α = 0.025`。若区间
下界高于 0，只能作为次要优效解释；主目标仍是非劣效。

### 1.3 实验单位与样本量

- 实验单位：CONFLICTS 中的独立问题 item；
- 总体：锁定 release 中全部 458 个 item，不做结果后排除；
- 每题输入：最多 10 篇官方检索结果；
- 每题处理：P 与 S 各调用一次；
- 重复次数：1；
- 计划调用量：`458 × 2 × 1 = 916`；
- 主分析 cluster：item，而不是单次调用或文档。

完整 split 是 benchmark census，不是按功效抽出的样本。预注册近似计算显示：若真实差值为 0，配对
discordance 为 10%、15%、20%，458 题对 `−5pp` 界值的功效约为 92%、79%、67%。所以即使
跑完全量也可能“不足以建立非劣”，不能事后放宽界值。

### 1.4 变量定义

| 类型 | 内容 |
| --- | --- |
| 自变量 | 同一份来源 metadata 的编码位置：prose（P）或 OKF frontmatter（S） |
| 主因变量 | 五分类 exact-label correctness |
| 次要因变量 | Macro-F1、分类别 recall、invalid rate、prompt 字符数、UTF-8 bytes、延迟 |
| 固定变量 | question、正文、文档集合与顺序、文件名、来源事实、任务指令、JSON Schema、模型、runner、文档数、重复次数 |
| 明确不操纵 | `verified`、`status`、`stale_after`、来源权威性、事实正确性、gold label |
| 不进入主实验 | `N`（无 metadata）和 `PS`（两种通道都有），仅供后续消融/部署研究 |

### 1.5 为什么使用配对设计

CONFLICTS 题目难度差异很大。同一题分别运行 P 和 S，再计算题内差值，可以消除共同难度噪声。如果
把两臂当成互不相关样本，会浪费“双方在同一题共同正确或共同错误”的信息，并给出不适合本设计的
标准误。

## 2. 实验数据如何准备

### 2.1 数据来源与版本锁定

数据来自公开 CONFLICTS release。下载前即在 `sources.lock.json` 中固定：

| 字段 | 固定值 |
| --- | --- |
| 仓库 | `google-research-datasets/rag_conflicts` |
| Commit | `81ba921dd684a93db41a7e9dda6b6a7c67348a88` |
| 文件 | `conflicts.jsonl` |
| 文件大小 | 46,717,034 bytes |
| SHA-256 | `14559d5c08fde057d7b46783e3345ee5852d6cf6a750f370dc072a0b957fac54` |
| License | Apache-2.0 |

`fetch`、`compile` 和 `run` 都校验字节数与 SHA-256，不是只在下载时检查。已有文件校验失败时，
runner 会拒绝继续；正式运行也禁止 `--allow-unlocked-input`。
机器可读锁文件见 [`sources.lock.json`](../benchmarks/okf-delta/sources.lock.json)。

### 2.2 使用的原始字段

每个 JSONL item 主要包含：

- `source`：题目来源子数据集；
- `question`：问题；
- `search_results[]`：检索结果，读取 `title`、`url`、`date`，以及
  `short_text` / `snippet` / `response_str` 中可用的正文；
- `conflict_type`：五分类 gold label；
- `correct_answer`：存在明确答案时的 gold answer。

实验没有重新检索网页，也没有用当前互联网内容替换 benchmark 文档。模型只看到 release 中冻结的
检索结果，避免把搜索结果变化混入格式效应。

### 2.3 确定性转换流程

适配器对每个 item 执行：

1. 验证 `conflict_type` 属于官方五类，否则报错；
2. 保留最多前 10 个 `search_results`，不按模型结果筛选；
3. 统一换行、去除首尾空白，不重写 passage；
4. 标题为空时用 `Source N`，URL 缺失时用稳定 URN；
5. 用 `URL + title + 原始文档位置` 的 SHA-256 前 12 位生成稳定 source ID；
6. 用 `source + question + 原始 item 位置` 生成稳定 item ID；
7. `YYYY-MM-DD` 日期转为同一日 `T00:00:00Z`；无法解析或缺失则保持缺失；
8. 建立不可变 canonical metadata：`id`、`resource`、`title`，以及可用时的 `last_modified`；
9. 从同一 canonical object 渲染 P 与 S，并记录 item 级 metadata SHA-256 digest。

适配器不会从 URL 推断来源权威性，不会把发布日期解释为事实新鲜度，也不会补造 `verified`、
`status` 或 `stale_after`。否则 S 会获得 P 没有的新语义，实验就不再是纯表示对照。

### 2.4 两个实验组实际长什么样

两组正文和 metadata 字面值完全相同，只有位置与语法不同。

P 组：

```markdown
---
type: Note
title: "Example source"
---

# Example source

<原始 passage，不改写>

## Source metadata

Source identifier: conflicts-a1b2c3d4e5f6
Source resource: https://example.test/article
Source title: Example source
Source last modified: 2024-03-04T00:00:00Z
```

S 组：

```markdown
---
type: Note
title: "Example source"
sources:
  - id: "conflicts-a1b2c3d4e5f6"
    resource: "https://example.test/article"
    title: "Example source"
    last_modified: "2024-03-04T00:00:00Z"
---

# Example source

<同一段原始 passage，不改写>
```

自动化测试逐个检查 P 与 S 都包含 canonical object 的所有字面值，并禁止 channel leakage：

- P 中不能出现结构化 `sources:`；
- S 中不能出现 `## Source metadata` 或 `Source identifier:`；
- 同一 item/repetition 的两臂文档顺序完全相同；
- 两臂 canonical metadata digest 相同。

### 2.5 完整语料构成

锁定语料共 458 题、4,052 篇检索文档，平均每题 8.85 篇。

![CONFLICTS 完整语料与早期平衡 pilot 的类别分布](./assets/okf-conflicts-label-distribution.svg)

| Gold label | 题数 | 比例 |
| --- | ---: | ---: |
| No conflict | 161 | 35.2% |
| Complementary information | 115 | 25.1% |
| Conflicting opinions and research outcomes | 115 | 25.1% |
| Conflict due to outdated information | 62 | 13.5% |
| Conflict due to misinformation | 5 | 1.1% |

题目来自：`conflicting_qa` 162 题、`situated_qa_geo` 105 题、`freshqa` 95 题、`qacc` 55
题、`situated_qa_temp` 41 题。

![CONFLICTS 来源日期覆盖](./assets/okf-conflicts-date-coverage.svg)

4,052 篇文档中 1,959 篇带日期，占 48.3%。458 题中，114 题的全部文档都有日期，176 题只有
部分文档有日期，168 题完全没有日期。因此不能把“缺日期”当作失败，也不能假设 S 总能使用
`last_modified`。

调用前全量静态审计中，P 平均 17,756.9 字符，S 平均 17,549.3 字符；S 平均短约 1.2%，没有
由结构化格式造成的大规模上下文预算不平衡。

## 3. Prompt、模型与执行设置

### 3.1 模型任务

每次调用要求模型只依据给定文档，把搜索结果间关系分类为恰好一类：

1. `No conflict`
2. `Complementary information`
3. `Conflicting opinions and research outcomes`
4. `Conflict due to outdated information`
5. `Conflict due to misinformation`

Prompt 禁止使用工具、文件、网络和先验知识，禁止推断输入中没有的信任、发布日期或生命周期状态。
若文档支持当前/正确答案则填写 `answer`，否则填空字符串；`evidence_source_ids` 只能使用当前 arm
可见的稳定 ID。

### 3.2 输出与评分

Codex CLI 用 JSON Schema 强制输出：

```json
{
  "conflict_type": "one of the five official labels",
  "answer": "string",
  "evidence_source_ids": ["stable-source-id"],
  "reason": "string"
}
```

主评分器只判断规范化后的 `conflict_type` 是否与官方 gold label 完全相同。`answer`、证据 ID 和理由
用于审计，不进入主正确率，避免引入新的 LLM judge。未知标签、无法解析的 JSON、拒答和最终超时均
记为错误。完整约束见
[`conflicts-answer.schema.json`](../benchmarks/okf-delta/schema/conflicts-answer.schema.json)。

### 3.3 模型与 runner 参数

| 参数 | 设置 |
| --- | --- |
| Runner | 本地认证 Codex CLI，实验时版本 `0.147.0` |
| Model | `gpt-5.6-sol` |
| Prompt template | `conflicts-classification-v1` |
| Sandbox | `read-only` |
| Session | `--ephemeral`，每次调用独立 |
| 用户环境影响 | `--ignore-user-config --ignore-rules` |
| 输出 | `--output-schema` + `--output-last-message` |
| 单次超时 | 180 秒 |
| 并发 | 2 |
| 重复 | 每个 item/arm 1 次 |

每次调用在新临时目录执行，结束后删除该调用目录。runner 不把 CoWiki 仓库作为可写工作区。CLI 未
提供可靠的 input token、context limit 和 truncation telemetry，所以这些字段记为 `unavailable`，
没有用字符数伪造 token 数。CLI 也没有暴露可由本 harness 固定的 decoding seed，因此本次每个
item/arm 只有一次随机生成；推断覆盖 item 差异，不覆盖完整的生成随机性、prompt 变体或模型差异。

### 3.4 顺序随机化

- 文档顺序：根据 `item_id + repetition` 确定；同一题 P/S 共享完全相同的顺序；
- arm 调用顺序：根据固定 sample seed、item ID、repetition 和 arm 独立哈希排序，有的题先 P、
  有的先 S。

顺序不读取 gold label 或模型输出；每行结果记录 `document_order` 和 `arm_order_index`。

## 4. 预注册、正式门禁与审计

### 4.1 冻结内容

协议 `okf-conflicts-encoding-ni-v1` 于 2026-09-13 12:07:51 +08:00、正式输出前冻结。

| 项目 | 固定值 |
| --- | --- |
| Preregistration SHA-256 | `92e382f4f13679484148a2916bdaff91ddc0466541dae15b60bebc5877e093e5` |
| 实验代码 commit | `81625879b6ebff54ef95c7cb9460b86304830227` |
| Benchmark revision | `81ba921dd684a93db41a7e9dda6b6a7c67348a88` |
| Arms / seed | `s,p` / `okf-conflicts-fair-v1` |
| 计划 | 458 items、10 docs、1 repetition、916 calls |

`--formal` 会拒绝脏工作树、抽样、offset、limit、未锁定数据，以及不同 benchmark、arms、模型、重复
次数、文档数或 seed，防止看到结果后改变设置。

### 4.2 每条结果记录

每次调用追加一行 JSONL，不覆盖已有成功记录。字段包括：

- benchmark revision、item ID、原始位置、子数据集、arm、repetition；
- attempt 与 `supersedes_attempt`；
- model、runner、代码 commit、预注册 ID 和哈希；
- prompt SHA-256、字符数、UTF-8 bytes、canonical metadata SHA-256；
- 文档顺序、metadata channel、citation style；
- 原始响应、确定性 grade、延迟与 runner error。

分析按 `item + arm + repetition` 取最新 attempt，旧失败行仍保留。

### 4.3 失败与恢复规则

- 基础设施失败可在相同 prompt hash 下重试一次；
- 正式运行遇到首个基础设施错误即停止；
- `--retry-errors` 必须与 `--resume` 同时使用；
- 每个键最多一次注册重试；
- 最终失败、超时、拒答、JSON 无效或标签无效均计为错误。

## 5. 实际执行过程

### 5.1 调用前检查

正式运行前完成：

1. 数据文件大小与 SHA-256 校验；
2. 458 items、P/S 两臂、916 次调用的 formal validation；
3. P/S canonical metadata 等价性和 channel leakage 测试；
4. 文档顺序一致性、稳定采样和确定性 grader 测试；
5. 4 次真实模型 canary，验证登录、Schema、响应解析与落盘。

Canary 不并入正式结果。harness 共 10 项自动化测试，全部通过。

### 5.2 正式运行

```bash
node src/external-cli.mjs run \
  --formal \
  --benchmark conflicts \
  --runner codex \
  --model gpt-5.6-sol \
  --concurrency 2 \
  --resume \
  --out runs/conflicts-fair-confirmatory-v1.jsonl
```

运行中发生一次额度边界中断，产生 2 条 `runner_error`。额度恢复后以相同配置和
`--resume --retry-errors` 重试，两条均成功，原失败 attempts 未删除。之后因资源限制，在 223 个
完整配对处主动暂停。

| 执行量 | 数值 |
| --- | ---: |
| 计划配对 / 调用 | 458 / 916 |
| 已完成配对 / 有效调用 | 223 / 446 |
| JSONL attempts | 448 |
| 基础设施失败 attempts | 2 |
| 成功重试 | 2 |
| 当前有效 invalid | 0 |

## 6. 数据完整性与限制

![中期样本完成度与配对结果](./assets/okf-conflicts-interim-paired-outcomes.svg)

223 个题目是完整数据执行顺序的前缀，不是预定义的随机或分层中期样本。虽然停止原因是资源限制而
不是成绩，不同类别的完成比例仍明显不均，因此当前结果不能直接外推到完整 458 题。

另有更强限制：逐条 JSONL 原本位于可清理的临时 worktree，任务中断后被系统清理。中断前保留了
analyzer 输出、配对计数、分层计数、元数据和原始文件 SHA-256，但现在无法逐条复算、重新评分或
继续同一 run。因此下文数字可由冻结汇总重绘，却不是可独立逐条审计的预注册证据。

## 7. 中期结果

### 7.1 主指标

![中期准确率与配对效应](./assets/okf-conflicts-interim-effect.svg)

| 指标 | P：等价 prose | S：结构化 OKF | S − P |
| --- | ---: | ---: | ---: |
| 正确数 / n | 134 / 223 | 134 / 223 | 0 |
| Accuracy | 60.1% | 60.1% | 0.0pp |
| Accuracy Wilson 95% CI | [53.5%, 66.3%] | [53.5%, 66.3%] | — |
| Macro-F1 | 49.2% | 48.9% | −0.3pp |
| 配对 bootstrap 95% CI | — | — | [−3.6pp, +3.6pp] |

| P | S | 题数 | 占比 |
| --- | --- | ---: | ---: |
| 正确 | 正确 | 126 | 56.5% |
| 错误 | 错误 | 81 | 36.3% |
| 错误 | 正确 | 8 | 3.6% |
| 正确 | 错误 | 8 | 3.6% |

`S-only = P-only = 8`，配对点估计为零，McNemar 精确双侧 `p = 1.0`。当前样本没有方向性差异，
但这不是“证明相同”。区间下界 `−3.6pp` 暂高于 `−5pp`，然而 completeness gate 优先：没有完成
458 个配对，判定必须保持 `INCOMPLETE`。

### 7.2 分类别结果

![中期分类别召回率](./assets/okf-conflicts-interim-label-recall.svg)

| Gold label | 当前 n / 全量 n | 覆盖率 | P recall | S recall | S − P |
| --- | ---: | ---: | ---: | ---: | ---: |
| No conflict | 86 / 161 | 53.4% | 48.8% | 47.7% | −1.2pp |
| Complementary information | 66 / 115 | 57.4% | 65.2% | 68.2% | +3.0pp |
| Conflicting opinions and research outcomes | 39 / 115 | 33.9% | 82.1% | 82.1% | 0.0pp |
| Conflict due to outdated information | 30 / 62 | 48.4% | 56.7% | 53.3% | −3.3pp |
| Conflict due to misinformation | 2 / 5 | 40.0% | 0.0% | 0.0% | 0.0pp |

覆盖明显不均：互补信息完成 57.4%，观点/研究冲突只完成 33.9%。错误信息只有 2 题，`0%` 无稳定
解释。Macro-F1 也受极小类别和未完成构成影响，分类别结果只能形成后续误差分析假设。

### 7.3 输入成本与延迟

| 指标 | P | S | S 相对 P |
| --- | ---: | ---: | ---: |
| 平均 prompt 字符数 | 17,414.5 | 17,202.4 | −1.2% |
| 平均调用延迟 | 16.54 s | 16.65 s | +0.7% |
| 延迟中位数 | 16.29 s | 15.81 s | −2.9% |
| 延迟 p95 | 24.20 s | 25.55 s | +5.6% |

S 平均少约 212 字符，但延迟均值几乎相同。延迟受网络、服务负载、并发和额度边界影响，没有为系统
性能推断做单独随机化，不能解释为结构化编码导致的速度变化。

## 8. 如何解释

当前数据支持：

1. 已完成的 223 题中，S 没有明显整体崩溃，accuracy 与 P 相同；
2. 只有 16 / 223 题出现正确性分歧，方向各 8 题；
3. adapter 能从同一 canonical metadata 无泄漏地生成两种通道；
4. 正式门禁、逐行审计和基础设施重试在真实运行中按设计工作；
5. S 在当前样本略短，但没有可解释的延迟优势。

当前数据不支持：

1. “结构化 OKF 已被证明不劣于 prose”；
2. “OKF v0.2 提高准确率”或“两者已经等价”；
3. “分类别差异可推广到完整 CONFLICTS”；
4. “本次结果可独立逐条复现”；
5. “实验验证了完整 v0.2 trust/lifecycle 或真实 CoWiki 编辑体验”。

最恰当的表述是：**中期结果与‘结构化来源 metadata 可能在 5pp 内非劣’相容，但正式非劣性尚未
建立；主结论保持 INCOMPLETE。**

## 9. 复现材料

机器可读汇总见
[interim-aggregate-2026-09-13.json](../benchmarks/okf-delta/results/interim-aggregate-2026-09-13.json)。

| 复现组件 | 文件 |
| --- | --- |
| 数据与版本锁 | [`sources.lock.json`](../benchmarks/okf-delta/sources.lock.json) |
| 公共数据适配器与评分器 | [`external-core.mjs`](../benchmarks/okf-delta/src/external-core.mjs) |
| 下载、正式门禁、runner、恢复与分析 | [`external-cli.mjs`](../benchmarks/okf-delta/src/external-cli.mjs) |
| 输出 Schema | [`conflicts-answer.schema.json`](../benchmarks/okf-delta/schema/conflicts-answer.schema.json) |
| 人类可读预注册 | [`PREREGISTRATION.md`](../benchmarks/okf-delta/PREREGISTRATION.md) |
| 机器可读预注册 | [`fair-conflicts-v1.json`](../benchmarks/okf-delta/preregistration/fair-conflicts-v1.json) |
| 等价性与评分测试 | [`external.test.mjs`](../benchmarks/okf-delta/tests/external.test.mjs) |

| 字段 | 值 |
| --- | --- |
| Benchmark revision | `81ba921dd684a93db41a7e9dda6b6a7c67348a88` |
| 实验代码 revision | `81625879b6ebff54ef95c7cb9460b86304830227` |
| Preregistration ID | `okf-conflicts-encoding-ni-v1` |
| Preregistration SHA-256 | `92e382f4f13679484148a2916bdaff91ddc0466541dae15b60bebc5877e093e5` |
| Runner / model | `codex / gpt-5.6-sol` |
| 原始 JSONL SHA-256 | `16dcb3ae13337a861a6e0f681e4e5c197b6fa33f9a99ec71f8a91f982625a464` |

只根据冻结汇总重建三张图、不调用模型：

```bash
cd benchmarks/okf-delta
npm run figures:interim
```

它复现“汇总值 → 图表”，不能复现“原始响应 → 汇总值”。若以后找回原始 JSONL，必须先核对 SHA-256。

## 10. 下一轮实验

1. 原始 run 放在仓库工作区的持久 `runs/`，不使用 `/private/tmp`；每 20–50 个配对生成只读快照和
   SHA-256。
2. 因当前结果已被查看且原始数据丢失，下一次正式运行使用新 protocol ID，从第 1 题重跑；本次汇总
   只作为设计与方差 pilot，不能并入新 run。
3. 保留相同额度中断规则：断点恢复、基础设施失败最多重试一次、所有 attempts 保留。
4. 若资源不能支持 458 题，必须在调用前按功效和类别分布预注册分层随机样本或 group-sequential
   边界，不能事后把 223 题定义成正式样本。
5. 仍优先完整 split：misinformation 全量也只有 5 题，缩样会进一步削弱 Macro-F1 和分类别解释。
6. 编码非劣效完成后，再独立运行 N/PS 消融、第二模型、重复生成、ALCE 官方引用 evaluator，以及
   CoWiki 编辑过程中的 stable citation 和 lifecycle 测试。

完整构念边界、历史 pilot 与产品级路线见
[OKF v0.2 科研评估与实验重构](./okf-v0.2-scientific-assessment.md)。
