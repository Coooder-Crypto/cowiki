# Architecture review fixture

## Decision

Use deterministic rules to define the legal action space. A local Policy model
may rank only those actions. High-risk operations require human approval.

## Alternatives

- A cloud-only router was rejected because private tasks must remain local.
- Automatic merge was rejected because agent changes require review.

## Follow-up

Collect execution outcomes offline, curate failure cases, and retrain only
after the fixed regression suite passes.
