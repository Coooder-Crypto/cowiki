# OKF encoding experiment preregistration

- Protocol ID: `okf-conflicts-encoding-ni-v1`
- Frozen: 2026-09-13, before any confirmatory run
- Machine-readable contract: [`preregistration/fair-conflicts-v1.json`](preregistration/fair-conflicts-v1.json)

## Evidence separation

The earlier ten-item runs are explicitly pilot evidence. They informed the
adapter redesign, the non-inferiority question, and the decision to use the
complete split. They are not pooled into the confirmatory estimate. No
confirmatory output exists at the time this protocol is frozen.

## Primary question and estimand

On the complete locked 458-item CONFLICTS split, is structured OKF source
metadata (`S`) non-inferior to a prose rendering of exactly the same source
metadata (`P`) for five-way exact-label conflict classification?

The primary estimand is the mean item-paired correctness difference `S − P` in
percentage points for the locked split, model, prompt, document count, and one
generation specified in the JSON contract. This is a deliberately narrow
claim. It does not establish a universal model, prompt, or product effect.

The non-inferiority margin is −5 percentage points. Success requires the lower
endpoint of the prespecified 95% item-paired percentile-bootstrap interval to
be strictly greater than −5pp. The one-sided alpha is 0.025; 100,000 resamples
and the bootstrap seed are frozen in the machine-readable contract. A lower
bound above zero may be described as evidence of superiority only if labeled
as a secondary interpretation; the experiment is powered and registered for
non-inferiority.

## Population, arms, and intervention integrity

The analysis includes all 458 items in the pinned CONFLICTS release at commit
`81ba921dd684a93db41a7e9dda6b6a7c67348a88`, using at most ten retrieved
documents per item. There is no post-run item exclusion.

Both arms are generated from one immutable `source_metadata` record per
document containing `id`, `resource`, `title`, and `last_modified` when the
source supplies a date:

- `P`: metadata values appear only in a labeled prose section;
- `S`: the same values appear only under OKF `sources` frontmatter.

Question, passage body, file name, document set, document order, output schema,
task instruction, model, and decoding interface are held fixed. The adapter
records a canonical metadata digest in every row. Tests require the same digest
and literal values in P and S, prohibit prose metadata markers in S, prohibit
structured `sources` in P, and prohibit both channels in N. Missing dates remain
missing; the adapter does not infer `verified`, `status`, `stale_after`, source
authority, freshness, correctness, or the gold conflict label.

`N` (no metadata) and `PS` (both channels) are implemented for later information
ablation and deployment studies, but they are not part of this primary run and
must not be substituted into the primary contrast.

## Randomization and execution

Item membership is the full split. Document order is a deterministic hash
permutation shared by P and S for the same item and repetition. Arm call order
is independently hash-randomized within each item to reduce time and provider
drift, and its index is recorded. The deterministic exact-label grader does not
read the arm identifier.

The registered run is 458 items × 2 arms × 1 repetition = 916 calls using
`codex/gpt-5.6-sol` and prompt `conflicts-classification-v1`. Because there is
one model, one template, and one stochastic generation, the inference covers
item variation but not full model, prompt, or decoding variation. Any later
multi-template, repeated-generation, or second-model study is a separately
reported robustness or replication experiment.

## Missingness and failures

All model-facing failures remain in the intention-to-evaluate denominator.
Before results are analyzed, an infrastructure failure may receive one retry
under the identical prompt hash. Any remaining timeout, refusal, malformed
JSON, or invalid label is scored incorrect. A per-protocol successful-call
analysis may be reported only as sensitivity analysis.

Source dates are observational input metadata, not an exclusion rule. Formal
reporting must stratify results by all/partial/no date visibility because only
48.3% of documents have a recorded date.

## Secondary and exploratory analysis

Macro-F1, per-label recall, invalid rate, prompt characters, UTF-8 bytes, and
latency are secondary. Token counts, context limit, and truncation are mandatory
only when the runner exposes trustworthy telemetry; absent telemetry must be
recorded as unavailable rather than estimated. N/PS contrasts, class-specific
effects, and all ALCE results are exploratory or separate tracks.

The five misinformation items are too few for a stable class-specific claim.
No secondary result can reverse a failed or inconclusive primary decision.

## Sample-size limitation

The full 458-item release is a benchmark census rather than a power-selected
sample. Under a normal approximation, a true zero difference and discordance of
10%, 15%, or 20% imply roughly 92%, 79%, or 67% power respectively for the
−5pp margin. Therefore an inconclusive result is possible even after all 458
items. Repetitions cannot be relabeled as additional independent items. If the
interval crosses −5pp, the registered conclusion is “non-inferiority not
established”; the margin will not be relaxed after observing results.

## Formal-run guard

The runner validates the JSON contract when `--formal` is supplied and embeds
its SHA-256 digest and Git revision in every output row. It rejects a dirty
repository, sampling, unlocked input, different arms, model, repetitions,
document count, or seed. The intended command is:

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

The output must not be called confirmatory if the guard was bypassed.
