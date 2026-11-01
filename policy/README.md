# CoWiki Agent Policy: routing and SFT lab

The offline SFT workflow below extends the recovered v0.1 fixture experiment.
The data checks, exporter, evaluator, loss-mask helpers and regression tests run
without third-party dependencies. The optional model and training paths require
CUDA and have **not yet been executed on the target RTX 4070 Ti**.

## Current evidence

- 40 authored development task families, 80 examples across eight intent categories.
- Every new example is `source=agent_authored_development_scenario`,
  `review_status=pending`, `split=dev`. These are drafts, not human-reviewed labels
  or an independent benchmark.
- Frozen `RuleRouter` baseline: 52/80 acceptable decisions on this development set.
  See [the report](reports/dev-rule-v1.md). This is not task execution success.
- 23 local tests passed at initial implementation, including the original nine.
- No trained adapter, GPU memory/throughput result, model improvement, or cost
  saving has been established. The old interview document contains hypothetical
  figures and must not be used as an experimental report.

## Local workflow (from the repository root)

```bash
PYTHONPATH=policy/src python3 -m unittest discover -s policy/tests -v
PYTHONPATH=policy/src python3 -m cowiki_policy.lab validate policy/datasets/routing/dev.v1.jsonl
PYTHONPATH=policy/src python3 -m cowiki_policy.lab evaluate policy/datasets/routing/dev.v1.jsonl --output policy/runs/dev-rule-new
PYTHONPATH=policy/src python3 -m cowiki_policy.lab prepare policy/datasets/routing/dev.v1.jsonl --smoke --output policy/runs/dev-smoke-new
```

Output directories must be new. Evaluation writes `summary.json` and every raw
prediction to `predictions.jsonl`. Invalid JSON, inference errors and malformed
actions count as failures; no repair or rule fallback hides them. Reference
answers and fixture verifier instructions never enter model prompts. Sample IDs
are also removed because their names reveal intent categories.

The raw constraint metric only checks structure and environment. It cannot catch
all semantic intent/risk under-classification and is not an execution permission
gate. No command in this lab dispatches tools or modifies a user's Space.

## Labeling before formal training

Read [the data specification](datasets/routing/README.md), review the 40 families,
and resolve label disagreements first. Keep development cases as known material.
Build additional task families and assign `train`, `validation`, `test` before
generating paraphrases/environment variations. Never move a difficult example to
another split after looking at evaluation results.

Formal preparation requires reviewed, nonempty train/validation splits and does
not export test labels. Only set `review_status=approved` after actual human review.

```bash
PYTHONPATH=policy/src python3 -m cowiki_policy.lab prepare policy/datasets/routing/reviewed.v1.jsonl --output policy/runs/formal-data-v1
```

`reviewed.v1.jsonl` is a future input, not a file already delivered. The manifest
records file hashes, family/sample membership, prompt version and purpose.
`--smoke` is an explicit bypass for development-only pipeline checks; the trainer
refuses to present this export as a formal experiment.

## Windows + WSL2 training setup

1. On Windows, install/update the NVIDIA Windows driver with WSL CUDA support.
   In PowerShell check `wsl --status` and `wsl -l -v`; update with `wsl --update`.
   If Ubuntu is not installed, `wsl --install -d Ubuntu` installs it and may need
   a reboot. Use WSL version 2.
2. In Ubuntu, run `nvidia-smi` and confirm the 4070 Ti is visible. The Windows
   driver provides GPU access; do not install a separate Linux display driver
   inside WSL. See [NVIDIA's WSL guide](https://docs.nvidia.com/cuda/wsl-user-guide/index.html).
3. Transfer this local branch's source to the machine. It has not been pushed,
   so a fresh remote clone does not yet include these changes. Keep the working
   copy and virtual environment in the WSL Linux filesystem.
4. Use Python 3.11 or 3.12 with venv support. In the repository root:

```bash
python3 -m venv policy/.venv
source policy/.venv/bin/activate
python -m pip install --upgrade pip
```

Install a CUDA-enabled PyTorch build using the official
[Linux / Pip / CUDA selector](https://pytorch.org/get-started/locally/), choosing
a runtime supported by the Windows driver. Then install this lab's dependencies:

```bash
python -m pip install -r policy/requirements-train.txt
python -m pip install -e policy
python -m pip check
python -c 'import torch; print(torch.__version__, torch.version.cuda); assert torch.cuda.is_available(); print(torch.cuda.get_device_name(0))'
```

The requirements are initial compatibility constraints, not a validated lockfile.
After a successful GPU smoke run, save `python -m pip freeze` with its artifacts.
The lab does not need Docker, a model API key, or a hosted inference service.

## First GPU run: a smoke check, not a result for a resume

Resolve and keep the same immutable base revision for baseline and SFT runs:

```bash
POLICY_MODEL_REVISION=$(python -c 'from huggingface_hub import HfApi; print(HfApi().model_info("Qwen/Qwen2.5-1.5B-Instruct").sha)')
```

Run preparation on the training machine if the ignored `runs/` files were not
transferred. The development export interleaves categories; the first 16 samples
cover all eight categories. The command below trains only those 16 known samples:

```bash
cowiki-policy-lab prepare policy/datasets/routing/dev.v1.jsonl --smoke --output policy/runs/gpu-smoke-data
cowiki-policy-train --data policy/runs/gpu-smoke-data --config policy/configs/qwen-1.5b-lora.json --revision "$POLICY_MODEL_REVISION" --smoke --smoke-samples 16 --max-steps 20 --output policy/runs/gpu-smoke-20
```

Inspect `mask-audit.json`: prompt labels are -100, completion/end-of-turn tokens
are supervised and padding is ignored. A template prefix mismatch or over-length
sample fails rather than silently corrupting/truncating the answer. `max_length`
is currently 2048 as a ceiling to accommodate the full routing specification;
batches pad dynamically, not to 2048. Inspect actual token lengths before lowering
the ceiling or scaling batch size. LoRA targets q/v projections, rank 16, alpha 32,
micro batch 1 and accumulation 16. The implementation currently uses BF16 LoRA
(FP16 if BF16 unsupported), **not QLoRA**.

Acceptance: finite loss, no OOM, expected trainable parameters, adapter saved,
and fresh-process reload works. `run.json` records source/data/model versions,
actual sample membership, elapsed time and peak allocated/reserved CUDA memory.
20 steps check the pipeline; extend a separate run only if needed to verify the
16 samples can be fitted. Do not call memorization generalization.

## Baseline and adapter comparison

Both commands use the same fixed prompt, model revision and greedy decoding.
Evaluation warms up on a synthetic public task before measuring per-case latency.

```bash
cowiki-policy-lab evaluate policy/datasets/routing/dev.v1.jsonl --backend model --model Qwen/Qwen2.5-1.5B-Instruct --revision "$POLICY_MODEL_REVISION" --output policy/runs/dev-base-v1
cowiki-policy-lab evaluate policy/datasets/routing/dev.v1.jsonl --backend model --model Qwen/Qwen2.5-1.5B-Instruct --revision "$POLICY_MODEL_REVISION" --adapter policy/runs/gpu-smoke-20 --output policy/runs/dev-adapter-smoke
```

Because smoke training uses development samples, these scores are diagnostics
only. A fresh process tests adapter reload without retaining the training model.

For formal training, use the reviewed export, omit `--smoke`/`--max-steps`, and
evaluate saved epoch adapters on `--split validation`. The last adapter is not
automatically the best: select by validation decision metrics, then freeze the
configuration and evaluate `--split test` once. Epoch adapters live under
`checkpoints/checkpoint-*` and carry provenance for the same evaluator.

## Implementation and learning milestones

| Milestone | Work | Learn | Acceptance |
| --- | --- | --- | --- |
| 1 (implemented locally) | Dataset contracts, independent evaluation, rule baseline | Labels, leakage, metric denominators | Local tests; raw failures visible |
| 2 (next) | Review draft labels; create genuinely separate task families/splits | Ambiguity, multiple acceptable answers, sampling bias | Reviewed data and no cross-split family leakage |
| 3 (GPU pending) | WSL CUDA setup; 16-sample smoke and adapter reload | Tokenization, teacher forcing, loss masks, LoRA, gradients | CUDA report, mask audit, finite loss, reload |
| 4 (pending) | Full SFT and validation checkpoint comparison | Learning rate, accumulation, overfitting | Reproducible config, logs and validation errors |
| 5 (pending) | Frozen holdout comparison and report | Controlled experiments, generalization, uncertainty | Rule/base/SFT comparison with counts and failures |

Start with one model and LoRA. Defer DPO, real Agent dispatch and claims about
downstream cost savings until independently measured execution evidence exists.

## Recovered v0.1 fixture experiment

This directory contains the first executable slice of CoWiki's local,
task-level Agent Policy experiment. It is deliberately small and uses only the
Python standard library.

The current loop is:

```text
PolicyInput
  -> deterministic legal-action mask
  -> rule baseline
  -> schema and cross-field validation
  -> side-effect-free fixture executor
  -> task verifier
  -> Trajectory JSONL
```

The fixture executor does **not** impersonate Codex, Claude, MCP, or Git. It
exists to stabilize the routing, verification, and trajectory contracts before
real adapters are connected. No current run edits the user's Space or working
tree.

## Run the 20-case smoke suite

From the repository root:

```bash
PYTHONPATH=policy/src python3 -m cowiki_policy.cli
```

The generated file is `policy/runs/rule-v0.1.jsonl`; local runs are ignored by
Git. Run one representative mixed task with full output:

```bash
PYTHONPATH=policy/src python3 -m cowiki_policy.cli \
  --task-id mixed_001 \
  --print-trajectories
```

Run the unit tests:

```bash
PYTHONPATH=policy/src python3 -m unittest discover -s policy/tests -v
```

## Contracts

- `schemas/policy-input.schema.json` describes the task and compact environment
  state presented to a router.
- `schemas/policy-action.schema.json` constrains intent, executor, mode, initial
  read-only tool, and risk level.
- `schemas/trajectory.schema.json` records the legal action space, routing
  result, execution evidence, verifier result, and normalized resource usage.

The action does not contain a model-authored approval decision. A high risk
level can tighten the system, while deterministic gates retain authority over
execution and review.

## Seed data

`datasets/seeds.v0.1.jsonl` has 20 manually authored cases covering:

- local transformations;
- CoWiki retrieval;
- code understanding and edits;
- long-document analysis;
- retrieval-plus-edit tasks;
- approval, privacy, unavailable Agent, budget, and unknown-tool failures.

Every case references a fixed fixture, declares acceptable actions, and defines
its verifier before execution. These records are smoke tests, not training or
benchmark claims.

## Next implementation gate

Do not generate thousands of synthetic examples yet. The next gate is to
replace one fixture route at a time with real adapters:

1. execute a read-only CoWiki prefetch against a disposable fixture Space;
2. execute a background code edit in a disposable fixture repository;
3. collect real token, latency, diff, test, and review evidence;
4. repeat each route from a clean snapshot;
5. only then expand to 60 canonical seeds and add classifier/model baselines.
