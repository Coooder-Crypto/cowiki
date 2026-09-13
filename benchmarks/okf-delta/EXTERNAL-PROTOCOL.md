# Public benchmark adaptation protocol

Status: public-data pilots are complete. The fair-v1 representation adapter and
CONFLICTS primary analysis are frozen in [`PREREGISTRATION.md`](PREREGISTRATION.md)
before the confirmatory run.

## Evidence boundary

The public benchmark owns the questions, retrieved passages, gold labels, and
task metrics. This repository owns only a deterministic representation adapter,
runner, audit log, and paired comparison. Synthetic lifecycle fixtures remain
unit and regression tests; they are not headline product evidence.

The immutable source revisions, byte sizes, checksums, paper links, and known
license scope are recorded in `sources.lock.json`. Downloaded data is ignored by
Git and must pass both size and SHA-256 verification before use. The ALCE code
repository is MIT-licensed, but its separate Hugging Face dataset repository
does not declare a dataset license; do not redistribute the archive from this
repository without clarifying those terms.

Compile and run commands verify the selected benchmark file again, not only at
download time. `--allow-unlocked-input` exists for adapter development against
small local fixtures; results produced with it are not formal benchmark runs.

## CONFLICTS track

The primary task is the official five-way conflict classification over the full
458-item CONFLICTS release. It is selected because it provides real retrieved
passages, source dates, expert-reconciled conflict labels, and gold answers for
applicable categories.

Headline metrics are exact-label accuracy and macro-F1. Per-label recall,
invalid outputs, and paired item-level bootstrap intervals are mandatory. The
paper's LLM-judged generation task is not used as a headline score.

Adapter rules:

- preserve question, passage text, title, URL, source date, label, and answer;
- convert a date-only source date to midnight UTC without changing its calendar
  date, and record absence rather than guessing a missing date;
- derive stable source IDs from the original URL, title, and source position;
- never infer `verified`, `status`, authority, freshness, or correctness;
- keep document ordering deterministic, identical across all arms for the same
  item/repetition, and record it in every result row.

## ALCE track

The provenance task uses the official ALCE QAMPARI reranked-oracle file and
evaluator. This locked file contains 1,000 questions and exactly five documents
per item; its extracted-file checksum is recorded separately from the archive.
The adapter preserves the question, answer aliases, retrieved passages, and
document set. v0.2 responses cite stable OKF source IDs; before official
evaluation those IDs are deterministically translated to ALCE's positional
`[N]` citations using the recorded document order.

The built-in preflight reproduces only ALCE's deterministic QAMPARI answer
precision, recall, Recall@5, F1, and F1@5. Citation recall and precision are
official only after exporting each arm and running the pinned ALCE `eval.py`
with its AutoAIS dependencies. Preflight results must not be presented as an
official ALCE citation score.

The QAMPARI task instruction retains the official requirements to use only the
provided results, cite exactly one document per answer, separate answers with
commas, and return at least five answers when more than five exist. The OKF
adapter changes citation syntax and document representation, not the task.

## Arms and causal interpretation

- `N` / CLI `n`: no source metadata channel; information-availability baseline.
- `P` / CLI `p`: canonical source facts appear only in labeled prose.
- `S` / CLI `s`: the same canonical facts appear only in OKF `sources` frontmatter.
- `PS` / CLI `ps`: the same facts appear in both locations; deployment-shape arm.

`S - P` isolates encoding location while holding represented facts fixed.
`S - N` and `P - N` estimate information availability through their respective
channels. `PS - N` estimates the combined deployment representation. The
adapter creates one immutable canonical record per source and records its digest
in every compiled manifest and run row. P, S, and PS are rendered exclusively
from that record. Tests reject channel leakage and missing canonical values.

The previous `v1_native`, `v1_rich`, `v2_native`, and `v2_ablated` arms remain
available only as `--arm-profile legacy-v1` so the published pilot can be
reproduced. They are not valid substitutes for the preregistered primary
contrast because their information and representation costs are not fully
balanced.

Use the full official evaluation split when affordable. If a pilot subset is
required, select it before model inference with `--per-label` (preferred for a
small CONFLICTS pilot) or `--sample-size` and a declared `--sample-seed`; the
harness ranks item IDs by SHA-256. `--limit` is for local debugging only and
selects the leading items after sampling.

For a formal result, freeze the source lock, adapter commit, sample seed, model
identifier, runner version, prompt hashes, context size, arm set, repetitions,
and official evaluator environment. Run at least two model families. Preserve
all raw outputs, parse failures, timeouts, and refusals.

The first confirmatory run is deliberately narrower: the complete 458-item
CONFLICTS split, arms `s,p`, one locked prompt, one generation, and one model,
for 916 calls. `--formal` enforces the machine-readable preregistration and
stores its SHA-256 digest. N and PS, additional prompts, repetitions, and the
second model are separate robustness/replication studies rather than extra
independent samples in the primary analysis.

Long runs use `--resume`; an existing file is accepted only when its benchmark
revision, runner, model, document count, and sample seed match the requested
run. Concurrency changes scheduling but not prompts, item selection, or document
order. Failed rows are never silently discarded; `--retry-errors` rewrites the
run with successful rows intact before retrying failures.

## Current pilot evidence

The current CONFLICTS pilot uses ten hash-selected items, two from every
official label, two repetitions, four arms, and `gpt-5.6-sol` (80 calls). It is
an adapter and variance pilot, not a powered comparison. Because the public
data does not contain OKF-native `verified`, `status`, or `stale_after` truth,
this track tests provenance/date representation rather than the complete v0.2
trust and lifecycle construct. The current ALCE pilot
uses ten hash-selected QAMPARI items and four arms (40 calls); its local report
contains deterministic answer metrics only. The ALCE exports have no unresolved
stable citations, but official citation recall and precision remain pending
until the pinned AutoAIS evaluator is reproduced. See the generated reports in
`runs/` and the research document for exact results and limitations.

`export-alce` writes the top-level `{ "data": [...] }` object required by the
pinned `eval.py`; a bare JSON array is not evaluator-compatible.
