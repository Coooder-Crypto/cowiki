# OKF v0.1 → v0.2 stratified pilot protocol

Status: synthetic implementation pilot; superseded as headline evidence by
`EXTERNAL-PROTOCOL.md`.

## 1. Scope

This pilot estimates whether an agent uses OKF v0.2 lifecycle and trust fields
to avoid superseded facts. It is an **oracle-context** experiment: both relevant
documents are supplied directly. It does not measure retrieval, index quality,
CoWiki UI behavior, migration safety, or Attested Computation.

The v0.2 rendering is pinned to the official specification at commit
`ad30107` (2026-08-21), including the requirement that every timestamp-valued
field be an ISO 8601 datetime with an explicit UTC offset.

## 2. Hypotheses

- H1: `v2_native` is not worse than semantically equivalent `v1_rich` prose
  on current-answer success.
- H2: `v2_native` has higher current-answer success than `v1_native` and
  `v2_ablated` on lifecycle states that cannot be represented by document edit
  time alone.
- H3: Any success gain is accompanied by separately reported stale and refusal
  rates, rather than being created by removing refusals from the denominator.

The comparison against `v1_native` measures the total migration effect and is
secondary because v0.1 has no standardized lifecycle channel.

## 3. Unit and arms

The unit of analysis is the fixture item. Repetitions are averaged within an
item before paired bootstrap resampling.

All arms receive the same question, answer facts, current instant, filenames,
and core prose. Only the representation of provenance and lifecycle changes.
Document order is deterministically shuffled for every item/arm/repetition and
recorded. Filenames are neutral identifiers and carry no `old`, `new`,
`legacy`, `current`, version, or date cue.

- `v1_native`: canonical v0.1 metadata and numbered citations.
- `v1_rich`: `v1_native` plus semantically equivalent lifecycle prose.
- `v2_native`: structured v0.2 metadata; no lifecycle prose.
- `v2_ablated`: v0.2 bundle declaration but the new metadata families are
  hidden from the consumer.

## 4. Corpus

The regression pilot uses ten synthetic, openly redistributable operational facts
balanced across five evidence strata, with two items per stratum:

1. `timestamp-solvable`: v0.1 document time is sufficient;
2. `source-solvable`: v0.1 citation text contains a legitimate signal;
3. `lifecycle-only`: later maintenance makes document time misleading;
4. `ambiguous`: neither document records adoption, so abstention is correct;
5. `authority-conflict`: a newer low-authority draft conflicts with an approved source.

The fixtures are not selected or removed based on model behavior. They now serve
as regression and harness tests only. Formal lifecycle and provenance evidence
comes from the pinned CONFLICTS and ALCE tracks described in
`EXTERNAL-PROTOCOL.md`.

## 5. Response and grading

The model must return the JSON shape in `schema/answer.schema.json`.
Deterministic grading assigns exactly one outcome:

- `fresh`: answer or selected document identifies the current value;
- `stale`: answer or selected document identifies the superseded value;
- `abstain`: the model explicitly abstains or selects neither value;
- `invalid`: malformed output or simultaneous stale and fresh selection.

Grader v2 first checks the structured decision: a consistent
`abstain=true`/`selected_document=unknown` is an abstention, and an exact known
`selected_document` determines the selected fact. Answer-text matching is only
a fallback. This prevents rationale text such as “the old endpoint remains for
legacy clients” from being misclassified as selecting both answers. Regrading
creates a new JSONL and preserves the original grade on every row.

Refusals remain in the denominator and are reported separately. The report also
shows conditional stale rate over committed (`fresh + stale`) answers, but it is
never the only headline metric.

## 6. Statistics

For every arm, report correct, fresh, stale, abstain, invalid, raw stale rate,
conditional stale rate, and median/p95 latency. For each contrast, report paired
correct, stale, and abstain differences in percentage points with a percentile
95% bootstrap confidence interval resampled at item level. Also report each
stratum, repetition disagreement, and correctness split by document order.

Current-answer success and stale rate are co-primary; refusal and invalid rate
are mandatory secondary outcomes. The pilot does not define a product pass threshold. After the pilot, use the
observed paired disagreement rate to choose a formal sample size and declare a
minimum practically important effect before collecting the measurement set.

## 7. Reproducibility controls

- Freeze the specification commit, fixture revision, prompt template, model
  identifier, runner version, current instant, and repetition count.
- Run at least two model families for the formal measurement.
- Do not calibrate by keeping only fixtures where the control fails.
- Preserve raw responses, prompt hashes, grades, errors, and latency.
- Never silently drop parse failures, refusals, or tool errors.
- Treat model output as untrusted data; the runner exposes no write tools.

## 8. Next tracks

- Provenance: adapt ALCE to grade `sources[].id` attribution correctness and
  completeness.
- Authority/conflict: adapt RGB and AuthorityBench while keeping source text and
  order paired.
- Computation: compare v0.1 prose/SQL with v0.2 Attested Computation on the same
  BIRD questions, model, database, and evaluator.
- Engineering: add deterministic v0.1/v0.2 parsing, round-trip, migration,
  rollback, and cross-validator conformance tests outside the model score.
