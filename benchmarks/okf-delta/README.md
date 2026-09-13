# OKF DeltaBench

OKF DeltaBench is a paired evaluation harness for measuring what OKF v0.2
changes over v0.1. Its formal evidence comes from pinned public benchmarks; the
small synthetic corpus is retained only for regression testing. It deliberately
separates three questions:

1. Can an implementation parse, preserve, and migrate the formats correctly?
2. Do v0.2 lifecycle and trust fields improve an agent's decisions when the
   relevant documents are already in context?
3. Does a full CoWiki retrieval and editing workflow preserve those gains?

The public-data implementation currently adapts CONFLICTS for source-date and
knowledge-conflict classification, and ALCE QAMPARI for provenance. Retrieval,
UI, and Git behavior are excluded so they cannot be mistaken for a format
effect. See [EXTERNAL-PROTOCOL.md](EXTERNAL-PROTOCOL.md) for the public benchmark
rules, [PREREGISTRATION.md](PREREGISTRATION.md) for the frozen primary
CONFLICTS experiment, and [PROTOCOL.md](PROTOCOL.md) for the earlier synthetic
pilot.

## Quick start

Requires Node.js 22 or newer and no third-party packages.

```bash
cd benchmarks/okf-delta
npm test
npm run fetch:conflicts
npm run audit:conflicts
npm run smoke:conflicts
npm run report:conflicts
npm run compile
npm run smoke
npm run report:smoke
```

Generated prompts are written under `generated/`; run records and reports are
written under `runs/`. Both directories are intentionally ignored by Git.
Downloaded benchmark data is written under `data/`, is also ignored, and is
accepted only when it matches `sources.lock.json` byte size and SHA-256.

## Public benchmark tracks

Fetch and verify the complete 458-item CONFLICTS release:

```bash
npm run fetch:conflicts
```

Reproduce the corpus distribution, date-missingness, and per-arm prompt-length
audit used by the scientific assessment:

```bash
npm run audit:conflicts
```

After producing the balanced CONFLICTS pilot report and ALCE QAMPARI preflight
report, regenerate the five SVG figures embedded in
`docs/okf-v0.2-scientific-assessment.md`:

```bash
npm run figures:report
```

The fair audit is written to `runs/conflicts-fair-dataset-audit.json`. The
historical report figures use the legacy arms and can be rebuilt after
`npm run audit:conflicts:legacy`. The figure script reads `runs/conflicts-dataset-audit.json`,
`runs/conflicts-codex-balanced-pilot-report.md`, and
`runs/alce-qampari-codex-pilot-preflight.md`. It makes no model calls; if a
source report is absent, recreate that report before rendering. The paired
interval plots describe ten independent pilot items, not a confirmatory trial.

Run a deterministic plumbing check over a hash-selected public subset:

```bash
npm run smoke:conflicts
npm run report:conflicts
```

Public-data commands now use the fair `n,p,s,ps` arm profile by default. Use
`--arm-profile legacy-v1` only to reproduce an earlier pilot. The primary fair
contrast is structured-only `s` versus prose-only `p`; both are mechanically
rendered from the same canonical metadata record and carry its digest in the
manifest/run row.

Run a real-model pilot. `--sample-size` uses a stable SHA-256 ranking; do not
replace it with hand-selected items after seeing outputs.

```bash
node src/external-cli.mjs run \
  --benchmark conflicts \
  --runner codex \
  --model gpt-5.6-sol \
  --per-label 5 \
  --sample-seed okf-external-v1 \
  --reps 2 \
  --concurrency 2 \
  --resume \
  --out runs/conflicts-codex-pilot.jsonl

node src/external-cli.mjs analyze-conflicts \
  runs/conflicts-codex-pilot.jsonl \
  --out runs/conflicts-codex-pilot-report.md
```

After pilot validation, the preregistered 916-call primary run is guarded by:

```bash
npm run validate:formal

node src/external-cli.mjs run \
  --formal \
  --benchmark conflicts \
  --runner codex \
  --model gpt-5.6-sol \
  --concurrency 2 \
  --resume \
  --out runs/conflicts-fair-confirmatory-v1.jsonl
```

Do not add sampling, change arms, model, repetitions, document count, or seed
on this command. The runner rejects those deviations and binds every row to the
frozen preregistration digest.

`--per-label 5` selects five items from each of the five official CONFLICTS
labels by stable hash. This is preferable to an unstratified small pilot,
especially because the release contains only five misinformation items.
`--concurrency` is capped at eight. `--resume` validates the benchmark revision,
runner, model, document count, and sample seed before skipping completed
item/arm/repetition keys. Add `--retry-errors` only after recovery to append a
new attempt for recorded runner failures; prior failed attempts remain in the
JSONL. Formal runs stop at the first infrastructure error and allow at most one
registered retry per item/arm/repetition. The analyzer uses the latest attempt
while reporting the total attempt count.

ALCE's official archive is 451 MB, so it is not fetched as part of tests. Fetch
it explicitly, extract it, and point the runner at one official JSON file:

```bash
node src/external-cli.mjs fetch --source alce
tar -xf data/alce/ALCE-data.tar -C data/alce

node src/external-cli.mjs run \
  --benchmark alce \
  --dataset qampari \
  --input data/alce/ALCE-data/qampari_eval_gtr_top100_reranked_oracle.json \
  --runner codex \
  --sample-size 20 \
  --sample-seed okf-external-v1 \
  --ndoc 5 \
  --out runs/alce-qampari-pilot.jsonl

node src/external-cli.mjs export-alce \
  runs/alce-qampari-pilot.jsonl \
  --input data/alce/ALCE-data/qampari_eval_gtr_top100_reranked_oracle.json \
  --arm s \
  --out runs/alce-qampari-s-official.json
```

Run the exported file with the evaluator at the pinned ALCE code revision to
obtain official citation recall and precision. The local `analyze-alce` command
is intentionally labeled a preflight because it reproduces only deterministic
QAMPARI answer metrics, not AutoAIS citation scores.
The exported JSON uses ALCE's required top-level `{ "data": [...] }` envelope.

The completed small pilots are written to
`runs/conflicts-codex-balanced-pilot-report.md` (10 items, 2 repetitions, 80
calls) and `runs/alce-qampari-codex-pilot-preflight.md` (10 items, 40 calls).
The `runs/` directory is ignored because reports are generated from raw run
records; copy an accepted, redacted result into the research document before
publishing it.

## Run a real model pilot

The Codex runner uses the locally authenticated CLI, passes all documents in the
prompt, disables repository writes with a read-only sandbox, requests a JSON
Schema response, and runs ephemerally.

```bash
node src/cli.mjs run \
  --runner codex \
  --model gpt-5.6-sol \
  --limit 2 \
  --reps 1 \
  --out runs/codex-pilot.jsonl

node src/cli.mjs analyze runs/codex-pilot.jsonl \
  --out runs/codex-pilot-report.md
```

If grading logic changes, preserve the raw run and create an auditable regraded
copy before analysis:

```bash
node src/cli.mjs regrade runs/codex-pilot.jsonl \
  --out runs/codex-pilot-regraded.jsonl

node src/cli.mjs analyze runs/codex-pilot-regraded.jsonl \
  --out runs/codex-pilot-report.md
```

The Claude runner follows the same prompt and answer schema while disabling
tools and session persistence:

```bash
node src/cli.mjs run \
  --runner claude \
  --model sonnet \
  --limit 2 \
  --reps 1 \
  --out runs/claude-pilot.jsonl
```

Gemini CLI is also supported. Omit `--model` to use its configured default and
record the model label as `default`:

```bash
node src/cli.mjs run \
  --runner gemini \
  --model gemini-2.5-flash \
  --timeout-ms 60000 \
  --limit 2 \
  --reps 1 \
  --out runs/gemini-pilot.jsonl
```

`--limit 2` means two fixture items, not two model calls. With all four arms it
produces eight calls. Every JSONL row records the fixture, arm, model, prompt
hash, document order, latency, raw structured answer, and deterministic grade.
Use `--timeout-ms` to bound each model call; timeouts remain explicit invalid
rows.

## Synthetic lifecycle regression arms

These legacy-named arms belong to `src/cli.mjs` and the synthetic fixture
regression track. Public CONFLICTS/ALCE commands in `src/external-cli.mjs` use
the fair `n,p,s,ps` profile described above.

| Arm | Representation | Purpose |
| --- | --- | --- |
| `v1_native` | v0.1 `timestamp` and body `# Citations` | Real legacy baseline |
| `v1_rich` | v0.1 plus equivalent lifecycle facts in prose | Tests structured fields against a fair prose channel |
| `v2_native` | v0.2 `generated`, `verified`, `status`, `stale_after`, and `sources` | Treatment |
| `v2_ablated` | Same v0.2 concepts with new lifecycle/trust fields hidden | Field ablation |

The primary contrasts are `v2_native - v1_rich` and
`v2_native - v2_ablated`. `v1_native - v2_native` is reported as the total
migration effect, not as a pure structured-versus-prose effect.

## Adding fixtures

Add one JSON object per line to `fixtures/lifecycle.jsonl`. Each item must name
its evidence `stratum`, two conflicting documents, distinct answer values, and
frozen timestamps. Ambiguous items set `expected_outcome` to `abstain`; other
items default to `fresh`. Formal measurement fixtures must be accepted before
looking at a model's result on them; do not retain only cases where a control
arm fails.
