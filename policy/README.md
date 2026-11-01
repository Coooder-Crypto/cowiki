# CoWiki Agent Policy v0.1

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
