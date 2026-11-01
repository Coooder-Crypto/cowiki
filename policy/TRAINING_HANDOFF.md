# CoWiki Policy — Windows 训练交接与学习计划

## 目标与上下文

目标岗位为大模型 Agent 应用实习，要求意图理解、ToolUse、多 Agent 工程与模型调优经验。
本项目从已有 CoWiki 业务 Agent 开发延伸，先完成可复现的轻量路由模型 SFT 实验。
输入是任务描述和环境，输出是路由 JSON；第一阶段不执行真实工具、不训练多步规划、
不做 DPO/RL、不声称金融投资能力或下游任务成本收益。

- 目标仓库：`https://github.com/Coooder-Crypto/cowiki`
- 分支：`feat/restore-agent-policy`
- 所有本项目新增内容都在 `policy/`；不需要启动 CoWiki 前端或后端。
- 训练设备：用户的 Windows 电脑，RTX 4070 Ti，按普通版 12GB 显存规划，使用 WSL2。
- 本地恢复提交：`529d762`；SFT 工作流提交：`a7e6b5b`；后续交接更新见分支最新提交。
- 用户希望学习 SFT 和模型训练基础，同时积累可用于简历的真实实验。

## 给接手 Agent 的工作要求

从环境诊断和小样本试训开始，修复实际遇到的兼容性问题并记录，不要只重复计划。
本仓库的 `AGENTS.md` 同样适用。使用目的明确的分支和提交标题，遵守仓库协作规范。
不要覆盖训练机上已有改动，不要清空 CUDA/模型缓存或重装整个系统。
如需系统重启或人工操作，说明具体原因；不要将未执行步骤报告为完成。

先完成：CUDA 诊断 → 本地测试 → 数据校验 → 16 样本 / 20 更新步试训 → 检查 loss mask
和显存 → 新进程重载 → 原始模型与 smoke Adapter 开发评测。该部分无需把待审核标签
改成 approved，明确使用 `--smoke` 即可。

正式训练需要新增独立任务族、真实人工标签审核和切分；不可批量把 pending 改成 approved
来绕过检查。可以准备样例、列出争议、自动检查并组织审核，不能冒充人工审核。
如用户尚未审核，完成全部不依赖审核的试训、诊断和复现工作，报告准确的下一步。

## 已完成与尚未完成

| 内容 | 状态 |
| --- | --- |
| 原始规则、mask、模拟执行器、轨迹与 20 个样例 | 已恢复，回归通过 |
| 独立路由评测、严格 JSON 检查、数据与切分校验 | 已实现并本地验证 |
| 40 任务族 / 80 开发样例 | 已编写；全部 pending；不是独立测试集 |
| 原规则开发评测 | 52/80 可接受决策（65%），参考标签待审核 |
| 本地测试 | 23 项通过；含 9 项原始测试 |
| LoRA 训练、基座/Adapter 推理入口 | 已编写，未在 GPU 上执行 |
| CUDA 依赖组合、真实 tokenizer mask、显存和速度 | 待 Windows/WSL2 实测 |
| 人工审核后的正式数据集、训练权重、效果提升 | 尚未完成 |

`policy/interview-qa.md` 是历史材料，其中 SFT 数据量、轨迹数、偏好对和最终模型指标
属于假设完成态数字，不是已有成果。实际证据以 `reports/` 和新训练记录为准。

## 1. 获取代码

在 WSL2 Ubuntu 中选一个新目录操作，建议放在 Linux 文件系统内：

```bash
mkdir -p ~/projects
cd ~/projects
git clone --branch feat/restore-agent-policy --single-branch https://github.com/Coooder-Crypto/cowiki.git cowiki-policy
cd cowiki-policy
git status --short --branch
git log -3 --oneline
```

如果已经有仓库，先检查工作区，再 `git fetch origin feat/restore-agent-policy`，使用已有
同名分支或创建跟踪分支。不要使用 reset --hard 或覆盖本地文件。私有仓库使用用户现有
GitHub 凭据；先检查 `gh auth status`，不输出 token，也不擅自重建登录。

## 2. 环境验收

Windows PowerShell 中检查 `wsl --status`、`wsl -l -v`；确保 Ubuntu 使用 WSL2。
Windows NVIDIA 驱动提供 WSL GPU 支持，不要在 WSL 安装另一个 Linux 显卡驱动。
进入 Ubuntu 后记录：

```bash
uname -a
python3 --version
nvidia-smi
```

使用 Python 3.11/3.12、venv 和 CUDA 版 PyTorch。具体 PyTorch 安装命令按驱动支持的
运行时从[官方选择器](https://pytorch.org/get-started/locally/)选择。随后执行 README
中的虚拟环境和 requirements 安装步骤。不要把安装 CPU 版 PyTorch 误判为硬件不可用。

验收：`torch.cuda.is_available()` 为 true、设备名称正确、一次 CUDA 张量运算成功。
记录驱动、PyTorch/CUDA/Python 版本和空闲显存。requirements 是初始约束，尚不是
GPU 验证过的锁文件；成功试训后保存 `python -m pip freeze`。

参考：[NVIDIA WSL 指南](https://docs.nvidia.com/cuda/wsl-user-guide/index.html)、
[Microsoft GPU 指南](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gpu-compute)。

## 3. 本地验证与数据准备

以下都在仓库根目录运行：

```bash
PYTHONPATH=policy/src python -m unittest discover -s policy/tests -v
PYTHONPATH=policy/src python -m cowiki_policy.lab validate policy/datasets/routing/dev.v1.jsonl
PYTHONPATH=policy/src python -m cowiki_policy.lab evaluate policy/datasets/routing/dev.v1.jsonl --output policy/runs/wsl-rule-v1
PYTHONPATH=policy/src python -m cowiki_policy.lab prepare policy/datasets/routing/dev.v1.jsonl --smoke --output policy/runs/wsl-smoke-data-v1
```

新运行使用新目录；不要覆盖已有实验。原始数据、参考答案、逐例规则输出及汇总均随分支
保存；`runs/` 是可重建的本地产物，不在 Git 中。

阅读 `datasets/routing/README.md`。标注依据是实际意图与项目约定，不是复刻规则输出。
任务 ID、类别、参考答案、标注理由不可进入模型输入。数据校验并不证明语义标签正确。
模型环境约束检查依赖预测意图，也不构成真实执行的安全保证。

## 4. 首次 GPU 试训

模型：`Qwen/Qwen2.5-1.5B-Instruct`。先完成一个模型规模，再研究 0.5B 压缩对照。
当前配置：BF16 LoRA（不支持 BF16 时 FP16），q/v 投影，rank=16，alpha=32，
micro batch=1，梯度累积=16，学习率=1e-4，gradient checkpointing。
最大长度 2048 是上限，动态 padding；根据实际 token 长度优化，禁止静默截断答案。
QLoRA 目前没有实现，不能仅修改文档就声称在使用 QLoRA。

```bash
POLICY_MODEL_REVISION=$(python -c 'from huggingface_hub import HfApi; print(HfApi().model_info("Qwen/Qwen2.5-1.5B-Instruct").sha)')
PYTHONPATH=policy/src python -m cowiki_policy.train --data policy/runs/wsl-smoke-data-v1 --config policy/configs/qwen-1.5b-lora.json --revision "$POLICY_MODEL_REVISION" --smoke --smoke-samples 16 --max-steps 20 --output policy/runs/wsl-smoke-20-v1
```

保存这个 SHA，后续基座、训练与评测必须使用同一 revision。不要每次重新解析 main。
20 steps 指优化器更新步；梯度累积 16 意味着约 320 次 micro-batch，不是只读 20 条数据。

验收：

- 检查 `mask-audit.json`：输入 token 的 label=-100；输出及结束 token 参与 loss；padding 忽略。
- 可训练参数应仅是 LoRA 参数；loss 为有限值，无 OOM。
- 记录 `run.json` 中时间、峰值 allocated/reserved 显存、实际样本与版本。
- 新进程重载 Adapter，能输出决策；不是仅在训练进程里成功。
- 20 步用于硬件与流程检查；若验证小样本拟合，另开运行逐步增加步数，不承诺 20 步已收敛。

若 OOM：记录最长样本和显存，检查其他占用；batch 已为 1，不要机械减 batch。
可以在不截断答案的前提下调整长度、LoRA 范围，或单独实现并验证 QLoRA。每次改动保存
新配置和结果。不要通过删除困难样本来制造成功指标。

## 5. 基座、Adapter 与规则对照

```bash
PYTHONPATH=policy/src python -m cowiki_policy.lab evaluate policy/datasets/routing/dev.v1.jsonl --backend model --model Qwen/Qwen2.5-1.5B-Instruct --revision "$POLICY_MODEL_REVISION" --output policy/runs/wsl-base-v1
PYTHONPATH=policy/src python -m cowiki_policy.lab evaluate policy/datasets/routing/dev.v1.jsonl --backend model --model Qwen/Qwen2.5-1.5B-Instruct --revision "$POLICY_MODEL_REVISION" --adapter policy/runs/wsl-smoke-20-v1 --output policy/runs/wsl-adapter-smoke-v1
```

两者使用同一 Prompt、greedy decoding 和输出长度，不加入一侧独有的 JSON 修复。
逐例结果在 predictions.jsonl。解析失败、推理异常计入总分母。区分模型原始违规、
格式错误、错误拒绝和语义错误。不要把“环境检查零违规”解释成安全性得到证明。

因为 Adapter 见过部分 dev 样本，以上只能称开发诊断。正式对照需人工审核后的数据、
独立任务族切分、validation 选择 checkpoint，然后冻结配置再评估 test。

## 6. 正式数据与训练路线

目标起点：240 个基础任务族，160 train / 40 validation / 40 test。训练族扩展到约
480–800 条，validation/test 各约 80 条。这是规划规模，不是已经完成的样本量。
按任务族先切分，再在各自集合中生成语言/环境变体，人工检查语义近重复。
同一句话改变环境的样本，以及固定环境的语言变体，应单独保留用于诊断。

只有真实审核后标 approved，才导出正式 train/validation；test 不进入训练导出。
`reviewed.v1.jsonl` 是计划产物，不是现有文件。正式命令模板：

```bash
PYTHONPATH=policy/src python -m cowiki_policy.lab prepare policy/datasets/routing/reviewed.v1.jsonl --output policy/runs/formal-data-v1
PYTHONPATH=policy/src python -m cowiki_policy.train --data policy/runs/formal-data-v1 --config policy/configs/qwen-1.5b-lora.json --revision "$POLICY_MODEL_REVISION" --output policy/runs/formal-train-v1
```

评测时加 `--split validation` 比较各 epoch Adapter，再用选定 Adapter 运行 `--split test`。
最后一个 Adapter 不自动等于最好。查看测试结果后进行针对性修改，原 test 就已成为开发
材料，需要新的留出数据。规则、未微调模型、SFT 模型都使用同一测试集。

## 学习与验收清单

| 步骤 | 要理解的基础 | 可以展示的证据 |
| --- | --- | --- |
| 数据与标签 | 任务输入/标签、数据泄漏、多解、标注噪声 | 来源、理由、审核记录、切分检查 |
| 基线评测 | 指标分母、类别不均衡、误拒绝、规则局限 | 原始逐例输出与失败分类 |
| Tokenization | chat template、EOS、teacher forcing、loss mask | 真实 tokenizer 的 mask-audit |
| LoRA SFT | 交叉熵、反向传播、冻结基座、低秩增量、rank/alpha | 可训练参数、配置、loss 曲线 |
| 训练调试 | 有效 batch、梯度累积、学习率、显存、过拟合 | 20-step 日志、显存峰值、小样本拟合 |
| 正式实验 | validation/test 职责、checkpoint 选择、公平对照 | 版本化数据、基座/规则/SFT 对比 |
| 工程交付 | Adapter 与基座关系、推理异常、可复现性 | 新进程重载、固定 revision、环境锁文件 |

关键问答：SFT 是监督方式，LoRA 是参数更新方式；QLoRA 对冻结基座量化，不等于全参
4-bit 训练；loss 降低不保证自由生成决策更好；loss mask 与动作约束是两种不同的 mask。
梯度累积降低单次 micro-batch 的内存需求，不消除每条长样本的激活成本。

验收不要求预设的提升百分比。若规则或未微调模型更好，分析原因并如实报告。
简历只填写真实完成的训练规模、设备、结果和局限。DPO、工具参数生成、真实 Agent
执行与成本收益留待后续独立实现及测量。

## 时间预算（未经本机实测）

首次环境和下载预留 30–90 分钟；20 步试训估算 5–20 分钟；500–800 条、3 epoch
估算 30 分钟–2 小时；两个模型各 80 条评测估算合计 10–40 分钟。以上只是安排时间
的范围，不是性能承诺；用实际 token 长度和 20 步耗时重新估算。整个项目的主要人工
工作是标签审核、数据独立性和错误分析，按每周 10–15 小时、约 4–6 周安排。

## 训练结束后交付

在 `policy/reports/` 新增日期明确的报告，包含环境、数据 hash、模型 SHA、代码 commit、
配置、实际步数/样本、显存、耗时、loss、各项计数与失败案例，并区分 smoke 与正式实验。
提交必要的源代码兼容性修复、配置和小体积结果；保留原基线，使用新文件名记录新实验。

`runs/`、venv、模型缓存、Adapter/optimizer/checkpoint 大文件保留在训练机，报告记录
绝对路径和校验和。不要把凭据、模型缓存或大量权重强行加进 Git。正式发布训练结果到
远程前按用户在训练会话中的授权及仓库规则执行。此交接文件不授权联系他人或启动付费服务。
