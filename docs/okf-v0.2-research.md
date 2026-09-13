# OKF v0.2 调研与 CoWiki 采用建议

> 本文回答标准能力、生态与产品落地。关于 benchmark 构念效度、统计假设、样本量和现有结果的
> 科研复核，请以 [`okf-v0.2-scientific-assessment.md`](okf-v0.2-scientific-assessment.md) 为准。
> 当前实验支持继续工程试点，但尚不支持“v0.2 提高模型准确率”的对外结论。

## 结论

建议 CoWiki **采用 OKF v0.2，但按“双读、试写、后迁移”分阶段落地**，暂不直接把所有现有 Space 自动迁移到 v0.2，也暂不执行任意 `Attested Computation`。

原因有三点：

1. **方向高度匹配。** v0.1 解决“知识能否用普通 Markdown + Git 携带”，v0.2 开始解决“Agent 持续写知识之后，知识是否可追溯、可信、仍然有效”。这与 CoWiki 的本地优先、Git 审阅、Agent 参与编辑高度一致。
2. **升级主体可控。** `type` 仍是唯一必填字段，目录、Concept ID、索引、日志和普通 Markdown 链接均保持不变。迁移主要集中在元数据解析、来源展示、信任与时效策略。
3. **标准仍很年轻。** v0.2 于 2026-07-24 合并，2026-08 才迁入独立仓库；此后仍修正过时间格式。JSON Schema、删除语义、反证状态、扩展字段碰撞等问题尚未定型。因此适合尽快兼容和试点，不适合无条件批量重写用户知识库。

建议的产品决策是：

- 立即支持 v0.1/v0.2 双版本读取，保持未知字段无损；
- 新建 Space 提供 v0.2 试验选项，先验证 `sources`、`generated`、`verified`、`status`、`stale_after`；
- 通过本文 benchmark 门槛后，再把新 Space 默认版本切到 v0.2；
- 旧 Space 仅在用户明确操作后迁移，并产生独立、可审阅、可回滚的 Git commit；
- `Attested Computation` 先读和展示，执行器、证明器与沙箱协议另行立项。

## 1. OKF 是什么，v0.2 处于什么状态

OKF 是一种面向人和 Agent 的开放知识格式：一个 bundle 是任意层级的目录树，Concept 是带 YAML frontmatter 的 UTF-8 Markdown 文件，普通 Markdown 链接形成跨 Concept 关系。格式强调可读、可解析、可 diff、可 Git 化和可迁移，不要求专用服务、SDK 或中心化 schema registry。[官方规范](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md?plain=1)和[官方仓库说明](https://github.com/GoogleCloudPlatform/open-knowledge-format)均明确把“格式”而非参考 Agent 或可视化器作为核心产物。

### 1.1 时间线与成熟度快照

- 2026-06-11：v0.1 随 `knowledge-catalog` 的 reference agent 导入。
- 2026-07-24：v0.2 通过 `knowledge-catalog#227` 合并，加入 provenance、trust、freshness/lifecycle 和 attestation。[迁移 PR](https://github.com/GoogleCloudPlatform/knowledge-catalog/pull/227)
- 2026-08-11 至 08-14：OKF 从 `knowledge-catalog/okf` 迁入独立官方仓库 `GoogleCloudPlatform/open-knowledge-format`。[独立仓库](https://github.com/GoogleCloudPlatform/open-knowledge-format)
- 2026-08-21：规范再次统一所有时间字段，要求 ISO 8601 datetime 且必须带 UTC offset，说明 v0.2 仍在快速收敛。[时间格式修正 PR](https://github.com/GoogleCloudPlatform/knowledge-catalog/pull/323)
- 截至 2026-08-30：独立仓库页面显示约 173 stars、7 forks、6 个 open issues、0 个 open PR；仓库还没有 release/tag。数字会变化，只应作为“已有早期关注、尚未形成稳定发布节奏”的快照，不应当作市场占有率。

判断：**v0.2 是正式上游规范，不是传闻或路线图；但它目前更像可试用的早期标准，而不是已有大规模兼容认证的成熟行业标准。** CoWiki 应固定到审核过的 commit，而不是在生产行为中直接追踪 `main`。

## 2. v0.2 解决了什么问题

v0.1 的最小格式约束适合“人维护的 Markdown 知识库”，但当大部分内容由 Agent 生成和持续重写时，仅有 `type/title/description/tags` 无法回答：

1. 内容来自哪里？
2. 谁生成、谁验证过？
3. 当前是否仍然有效？
4. 是否已经废弃或被替代？
5. 某个数值是否真的按约定方法算出？

v0.2 的产品迭代逻辑，是在不引入专用数据库或运行时的前提下，把这些信号放进可查询、可 Git diff、可被普通工具保留的 frontmatter。官方仍维持“只有 `type` 永远必填”的低门槛，因此 v0.2 不是重型知识图谱协议，而是给 Agent 维护知识增加一层最小可信度结构。[v0.2 迁移说明](https://github.com/GoogleCloudPlatform/knowledge-catalog/pull/227)

## 3. v0.1 与 v0.2 对比

| 维度 | v0.1 | v0.2 | 对 CoWiki 的价值 / 影响 |
| --- | --- | --- | --- |
| 必填字段 | 仅 `type` | 仅 `type` | 基础 conformance 不变 |
| 内容时间 | `timestamp` | `generated.at`，并同时记录 `generated.by` | 可区分“谁生成”和“何时改变”；属于字段替换 |
| 来源/引用 | Body 中 `# Citations` 列表 | `sources[]` frontmatter；可带稳定 `id`、`author`、`usage_count`、`last_modified`，正文脚注以 `[^id]` 对应来源 | 来源变得可查询、可逐条归因；属于表示方式替换 |
| 验证 | 无统一字段 | `verified[] = {by, at}` | 可以呈现机器确认、人审确认和最后验证时间 |
| 信任等级 | 无 | 从 `verified` 推导 `unverified` / `machine-confirmed` / `human-reviewed` | 不存主观分数，只存事实信号，适合 UI 筛选与审阅 |
| 生命周期 | 无 | `status: draft | stable | deprecated`，缺省为 `stable` | 支持草稿与废弃知识；注意与既有 producer 的 `status` 扩展冲突 |
| 新鲜度 | 无 | `stale_after` | 可让检索与回答显式降级或拒用过期内容 |
| 可执行计算 | SQL/过程通常写在正文 | 新增 `type: Attested Computation`，含 `runtime`、`parameters`、`computation`、`executor`、`attester` | 能把“定义可信”和“本次运行可信”分开，但带来代码执行安全边界 |
| Actor 命名 | 无 | Agent/工具用 `<producer>/<version>`，人用 `human:<id>`，流程用 `process:<id>` | CoWiki 需要可靠地把本地用户、云端用户、Agent 与自动任务映射为 actor |
| 时间语义 | 较宽松 | 所有时间值要求带 offset 的 ISO 8601 datetime | 解析器必须避免 YAML 隐式日期类型导致的格式破坏 |
| 目录与链接 | 任意层级；普通 Markdown 链接 | 保持不变 | CoWiki 现有 tree、Concept ID、backlink 基本可复用 |
| `index.md` / `log.md` | 保留文件，渐进披露与变更日志 | 保持不变 | 现有索引维护逻辑可复用 |
| 扩展性 | 接受未知 type/key | 保持不变 | 必须继续无损 round-trip 未知字段 |

规范将 v0.2 称为 minor bump，但也明确承认两处有意的 breaking change：`timestamp` 被 `generated.at` 取代，`# Citations` 被 `sources` 取代。v0.2 consumer 可以回退读取旧字段，但迁移器不能把它们当成纯粹“新增可选字段”。[规范 §13](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md?plain=1)

## 4. 市场与社区反馈

目前还没有足够证据声称 OKF 已获得广泛市场验证。更准确的说法是：**早期开发者兴趣明显，实际互操作问题也已经快速出现。**

### 4.1 积极信号

- 上游迁移 PR 很快被多个外部仓库引用，包含 v0.2 迁移、知识目录 Skill、导出兼容修复等，说明已经有人把它用于实际工具链，而非只阅读规范。[v0.2 PR 的引用记录](https://github.com/GoogleCloudPlatform/knowledge-catalog/pull/227)
- 社区已经出现独立 CLI，实现 validate、lint、index、search、graph 和 v0.2 trust/lifecycle 检查，说明格式足够小，第三方可以在不依赖 Google runtime 的情况下实现 consumer。[okfcli/okf](https://github.com/okfcli/okf)
- 有使用者请求官方 JSON Schema，以便验证自己的 wiki。这代表“编辑器/CI 可验证性”是明确需求，而不只是格式作者的设想。[JSON Schema issue](https://github.com/GoogleCloudPlatform/open-knowledge-format/issues/8)
- 已有非数据仓库场景尝试提交小企业运营知识 bundle，覆盖价格、服务范围、升级策略和 attestation，证明潜在使用范围不只限于 BigQuery catalog。[样例提案](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/282)

### 4.2 负面反馈与未解决问题

| 问题 | 已观察到的证据 | 对 CoWiki 的含义 |
| --- | --- | --- |
| minor 版本语义不够严格 | 社区质疑 v0.2 一面称 minor，一面退休两个 v0.1 字段 | 迁移必须显式，不可静默覆盖 |
| 扩展字段碰撞 | 一个 v0.1 producer 的 826 个文档中，336 个已有 `status`，331 个值不属于 v0.2 生命周期枚举 | CoWiki 必须在改写前检测 key/value 冲突，不能直接解释或重命名 |
| 时间解析曾不稳定 | v0.2 发布后又统一了所有 datetime 的 offset，并修复 PyYAML round-trip 破坏 | 必须做跨 YAML parser fixture 和 byte-preservation 测试 |
| 链接在普通 renderer 中可能失效 | 社区提出 bundle-root absolute link 在 GitHub/嵌套目录等环境的解析问题 | CoWiki 新生成内容应优先相对链接，同时兼容读取两种形式 |
| 缺少标准 schema | 独立仓库仍有 JSON Schema 请求 | CoWiki 可先做内部 validator，但不应把内部 schema 宣称为官方规范 |
| 删除语义缺失 | 删除后的 Concept 与从未存在过的 Concept 对当前 consumer 不可区分 | CoWiki 的 Git 历史能补足审计，但跨 bundle 导出仍需 tombstone/保留策略 |
| 反证状态缺失 | `verified` 能表达已确认，却不能表达“检查后确认错误” | 审阅 UI 不应把“未审”和“审核失败”混为一谈；失败状态先放 CoWiki review 层而非伪造 OKF 字段 |
| 多 bundle 首跳发现不足 | 社区提议给 root index 增加 title/description，避免 consumer 为判断 bundle 用途而扫描全部 bundle | CoWiki 多 Space / 云端目录需要自己的轻量 discovery metadata |
| Attestation runtime 未完成 | 规范明确把 receipt/verdict wire format、attester ABI、沙箱和缓存延期 | 当前只能把它当可携带的契约，不应当作安全执行标准 |

相关一手讨论：[扩展字段碰撞 #272](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/272)、[相对链接 PR #165](https://github.com/GoogleCloudPlatform/knowledge-catalog/pull/165)、[多 bundle discovery #302](https://github.com/GoogleCloudPlatform/knowledge-catalog/issues/302)、[删除语义 #11](https://github.com/GoogleCloudPlatform/open-knowledge-format/issues/11)、[反证状态 #13](https://github.com/GoogleCloudPlatform/open-knowledge-format/issues/13)。

## 5. 与相邻标准/方案的关系

这些方案不是互斥竞品。它们解决的是不同层级的问题，CoWiki 最合理的架构是组合使用。

| 方案 | 解决的问题 | 是否规定知识正文 | 是否规定传输/运行时 | 与 OKF 的关系 |
| --- | --- | --- | --- | --- |
| OKF v0.2 | 持久知识 bundle 的文件结构、元数据、链接、可信与时效信号 | 是，Markdown + YAML frontmatter | 否 | CoWiki Space 的磁盘/Git 数据格式 |
| AGENTS.md | 告诉 coding agent 如何在一个仓库工作 | 自由 Markdown 指令 | 否 | 放置维护规则，不替代知识 corpus；官网称已有 60k+ 开源项目采用，[说明](https://agents.md/) |
| Agent Skills | 打包可复用工作流、脚本、参考资料和资产 | `SKILL.md` + 可选资源 | 不规定远程传输 | 教 Agent 如何读写/维护 OKF；规范同样采用渐进披露，[规范](https://agentskills.io/specification) |
| llms.txt | 给网站提供一个精简、可发现的 Agent 导航入口 | 一个小型 Markdown 索引 | HTTP 路径约定 | 可作为公开 CoWiki Space 的 Web 入口，不替代完整 bundle；v2 提案称已有数千站点采用，[规范](https://llmstxt.org/) |
| MCP Resources | 让 client 发现、读取、订阅远端或本地资源 | 不限制资源内部格式 | 是，资源 URI、list/read、订阅等协议 | CoWiki 可以把 OKF Concept 通过 MCP 暴露；MCP 负责“怎么取”，OKF 负责“取到的知识长什么样”[MCP 2026-07-28 Resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources) |
| RAG / 向量索引 | 运行时检索与生成 | 不规定 source-of-truth 文件格式 | 由具体实现决定 | 是 OKF 的消费策略；索引应可从 OKF 重建，不能反客为主 |

建议的定位语句：

> CoWiki 用 OKF + Git 保存可审阅的知识源，用 MCP 暴露资源，用 Skill/AGENTS.md 约束 Agent 的维护行为，并按需构建全文、向量或图索引。

## 6. CoWiki 当前差距

1. `web/src-tauri/src/okf.rs` 将 `OKF_VERSION` 固定为 `0.1`。
2. 声明为 `0.2` 的 Space 可以 best-effort 读取，但所有写路径会被 `ensure_supported_for_write` 拒绝。因此当前不是 v0.2 writer。
3. 已 conform 的 Concept 会原样保留，未知 frontmatter 字段不会被主动删除；这是升级的良好基础。
4. 当前 Source ingestion 主要写 `title`、`type: Source` 和内部 `source_hash`，没有写标准 `sources`、`generated` 或 verification/freshness 信号。
5. UI/API 目前主要展示 title/description，不呈现 trust tier、验证时间、生命周期或过期状态。
6. `docs/spec.md` 仍把 `timestamp` 列为推荐 OKF 字段，需要在正式升级时同步修订。
7. 当前 Git 提交、diff review、迁移快照与失败回滚能力，正好可以承载 v0.2 的显式迁移和审计，不必另造专用版本系统。

### 6.1 关键产品风险

- **身份伪造：** Agent 不得自行写入 `verified.by: human:<id>`；human verification 必须由可信 UI 操作或已认证服务产生。
- **时间欺骗与时区：** `stale_after` 必须严格校验 offset；显示时再转换为用户时区，磁盘中保留原始合法值。
- **来源安全：** `sources[].resource` 是数据，不是可信命令。打开 URL、文件路径和执行器前必须经过协议、路径与权限校验。
- **任意代码执行：** `Attested Computation` 的 executor/attester 只是声明，不代表已获执行授权。默认只展示，执行必须进入独立沙箱和审批模型。
- **错误信任暗示：** `human-reviewed` 只说明有人验证过，不等于永远正确。UI 必须同时展示 verifier、时间、staleness 与来源。
- **迁移污染：** 不能用 YAML parse + serialize 重写整个 frontmatter；必须证明未知字段、标量类型、注释和正文没有无关变化。

## 7. CoWiki OKF Benchmark 提案

现有 RAG benchmark 主要测检索与回答，不足以评估一个可写、可迁移、可 Git 审阅的知识格式。建议建立两层 benchmark：**格式/迁移正确性**与**Agent 使用效果**。

[RAGAS](https://arxiv.org/abs/2309.15217)把 RAG 评估拆为 context relevance、answer faithfulness 和 answer relevance，适合作为回答层指标；中文多文档、结构理解、时效与去噪能力可参考 [DomainRAG](https://arxiv.org/abs/2406.05654) 的任务设计。但 CoWiki 还必须增加来源、时效、信任、round-trip 和 Git 安全指标。

### 7.1 测试集

建立可公开复现的 fixture corpus：

| Fixture | 规模/特征 | 主要验证点 |
| --- | --- | --- |
| `small-handbook` | 50 个 Concept，手工真值 | 基础导航、引用、编辑 |
| `nested-project` | 500 个 Concept，重复文件名、深层相对链接 | Concept ID、渐进披露、backlink |
| `large-corpus` | 10,000 个 Concept | 索引性能、token/latency、首跳发现 |
| `v01-legacy` | `timestamp`、`# Citations`、未知字段、非标准 `status` | 兼容读取、冲突检测、显式迁移 |
| `trust-conflicts` | 同一事实的 verified/unverified/stale/deprecated/互相矛盾版本 | 信任与时效策略 |
| `roundtrip-torture` | YAML 字符串/日期/引号/注释、Unicode、非 UTF-8 旁路文件 | 无损 round-trip 与失败回滚 |
| `attestation-safe` | 固定输入输出的无网络计算、成功/失败/超时样例 | 契约读取、拒绝策略；首阶段不执行任意代码 |

每类至少准备 20 个带 ground truth 的问题或操作任务，覆盖单文档事实、多跳链接、矛盾判断、过期知识、来源定位、增量更新和迁移。

### 7.2 对照组

- A：当前 CoWiki + OKF v0.1。
- B：同一 corpus 去掉 index 与结构化 trust/provenance 元数据，仅保留 Markdown。
- C：OKF v0.2，但 consumer 忽略 trust/lifecycle（消融组）。
- D：CoWiki 完整 v0.2 consumer/writer（实验组）。
- 可选 E：D 的全文检索与向量检索两种消费策略；用于区分格式收益和检索器收益。

### 7.3 指标与建议验收门槛

以下门槛是 CoWiki 的产品验收建议，不是 OKF 官方认证标准：

| 类别 | 指标 | 建议门槛 |
| --- | --- | --- |
| Conformance | 标准 fixture 通过率 | 100% |
| Round-trip | 未知字段、合法标量与正文保持率 | 100%；无关 byte change 为 0 |
| 迁移安全 | v0.1 fixture 成功迁移且可回滚 | 100%；任何失败均不改变 HEAD/工作树 |
| 检索 | Hit@5 / MRR@10 或 nDCG@10 | 不低于 v0.1 基线；大型 corpus 有显著提升再宣称收益 |
| 回答正确性 | ground-truth exact/F1 + 人工抽检 | 不低于 v0.1；关键事实单独报告 |
| Faithfulness | 回答中被所取 context 支持的 claim 比例 | ≥ 95% |
| Provenance | 可验证 claim 连接到正确 `sources[].id` 的比例 | ≥ 95%；错误来源率 < 1% |
| Freshness | stale/deprecated 内容在必须阻止的用例中被阻止或显式警告 | 100% |
| Trust policy | 在成对冲突用例中按规定选择更可信 Concept | ≥ 95%，并保留解释 |
| 编辑安全 | 非目标文件变化、未知字段丢失、隐藏源文件变化 | 均为 0 |
| 性能 | 首次建索引、增量更新、查询 p50/p95、峰值内存 | 与 v0.1 同机对照，不设脱离硬件的绝对数 |
| 成本 | 正确答案所用输入 token、读取文件数、工具调用数 | 报告中位数和 p95；在正确率不降的前提下优于无 index 组 |
| 互操作 | CoWiki → 官方/第三方 validator → CoWiki | 语义字段 100% 保持；差异必须可解释 |

不要只用 LLM-as-judge。至少 10% 样本应由两位人工独立标注；来源、版本、过期、字段保持等可确定性指标必须由程序断言。

### 7.4 Benchmark 最终回答的问题

1. v0.2 的结构化来源、信任和时效是否真的提升正确率，而不只是让 frontmatter 更复杂？
2. 渐进披露是否减少读取文件数和 token，同时保持召回？
3. CoWiki 是否能无损读取、编辑和迁移真实 v0.1 bundle？
4. Agent 是否会错误地把“机器确认”“人审”“新鲜”“正确”混为一谈？
5. Git diff 是否只包含用户意图内的变化，失败时能否完全回滚？

## 8. 落地方案对比

| 方案 | 收益 | 风险/成本 | 结论 |
| --- | --- | --- | --- |
| 继续只写 v0.1 | 零迁移成本 | v0.2 Space 永久只读；无法利用 trust/freshness；产品叙事落后 | 不建议作为中期方案 |
| 在声明 v0.1 时直接写 v0.2 同名扩展字段 | 开发快 | `status` 等字段可能与 producer 扩展碰撞；版本语义不清 | 不建议 |
| 双读 + v0.2 试写 + 显式迁移 | 风险可控，可尽早学习 | 需要版本分支、UI 与 benchmark | **推荐** |
| 立即把新旧 Space 全部切到 v0.2 | 一次到位 | 标准仍在变化，迁移与任意执行风险过高 | 当前不建议 |

## 9. 推荐实施路线

### Phase 0：固定规范与产品规则

- 固定 canonical repo commit，并记录升级审查流程；不要直接追踪 `main`。
- 明确 CoWiki producer profile：哪些字段由人写、Agent 写、系统写，哪些扩展使用 `cowiki_*` 或 `.cowiki/` 命名空间。
- 定义 actor 映射与信任边界，尤其是 `human:<id>` 的签发来源。
- 先建立 benchmark fixture 和 v0.1 回归基线。

### Phase 1：v0.2 consumer

- 解析并展示 `sources/generated/verified/status/stale_after`，但不因缺失可选字段拒绝文档。
- 派生 trust tier，不把派生分数写回文件。
- 检索结果显示 stale/deprecated/human-reviewed 等状态和来源。
- 保持所有未知 key、未知 type 和正文无损；支持 v0.1 fallback。
- 对 `Attested Computation` 只读展示，不执行。

### Phase 2：可选 v0.2 writer

- 新 Space 可选择 `okf_version: "0.2"`。
- Agent 创建内容时写 `generated`；只有真实验证动作才写 `verified`。
- 来源导入建立稳定 `sources[].id`，正文具体 claim 用同 id 脚注关联。
- 新生成链接优先相对路径；继续读取绝对 bundle-relative link。
- 合法时间统一使用带 offset 的 ISO 8601 datetime。

### Phase 3：显式迁移

- 迁移前扫描 `timestamp`、`# Citations` 和同名字段冲突，先生成预览报告。
- 不确定来源、actor 或 `status` 语义时保留原值并要求人工选择，禁止猜测。
- 每个 Space 单独生成迁移 commit；沿用现有全工作树快照、失败恢复和幂等测试。
- 迁移后运行官方/独立 validator、CoWiki 测试和 benchmark 子集。

### Phase 4：Attested Computation（另立安全项目）

- 等待或自定义 receipt/verdict、attester ABI、超时、缓存和沙箱协议。
- 默认 deny 网络、文件系统写入和任意命令；以 allowlist runtime 开始。
- 执行前展示来源、代码、参数、权限与成本，保留独立审批和审计记录。
