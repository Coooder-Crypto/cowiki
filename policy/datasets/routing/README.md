# Routing dataset v1

`dev.v1.jsonl` contains 40 draft task families / 80 examples authored for this
development session, not collected from users. Labels are proposals and all are
pending human review. No formal train/validation/test split has been delivered.

## Annotation contract

- Label the requested action, not the presence of a keyword. Quoting or explaining
  deletion is different from requesting deletion. Negated edits remain read-only.
- Eight intents follow `Intent` in `types.py`. Status is independent of category:
  `routed`, `approval_required`, or `blocked` with `action=null`.
- Simple transformation and knowledge retrieval can use local/live. Code and long
  document work require an available nonlocal executor. Code prefers codex, long
  documents prefer claude. Both are accepted where allowed; these preferences
  are conventions, not evidence of measured executor quality.
- Privacy other than public, or exhausted budget, excludes nonlocal execution.
  A missing/broken/signed-out executor is unavailable. No repo excludes background.
- Editing prefers background/medium. Live editing needs high risk and approval.
  Actual remote writes, deletion, merging or external sends need high/approval.
- Tool requirements are explicit: search uses search_pages, named-page reading
  uses get_page, backlinks use list_backlinks, broken links use list_broken_links.
  A required unavailable tool means blocked; silently returning tool=none is wrong.
- `budget=low` currently equals normal; dirty equals clean. Do not invent additional
  behavior. Ambiguous tasks needing clarification belong in a future schema.
- This is offline routing only. A predicted approval status never grants authority.

## Fields and review procedure

`input` is the only task-specific model input (task_id is removed). `target` is
one canonical SFT answer. `acceptable_predictions` lists full acceptable answers
for evaluation. `category`, source, IDs, review metadata and annotation reasons
are not provided to the model.

Review each family's two examples against the contract and record disagreements
before setting approved. Do not auto-approve from rule agreement. Retain source
provenance, reasons, review changes and git history. Formal exporters reject
pending labels. The smoke exporter permits pending dev examples only for debugging.

The initial variants often change both wording and environment, so they are not
controlled causal pairs. Add fixed-wording/environment-only pairs and
fixed-environment/wording-only pairs when studying those effects specifically.

Before augmentation, assign every family to one split. Exact task/input leakage
and family overlap are checked in code; semantic near-duplicates still need manual
review. Expand to additional independent task families before claiming a holdout
benchmark. Existing development families have already been examined.

## Suggested review order

1. Risk and negation cases: inspect requested operations, not just risk words.
2. Blocked cases: verify the missing capability/tool is actually necessary.
3. Alternate routes: verify each accepted executor is available and legal.
4. Ordinary cases: check semantic clarity and label consistency.
5. Distribution and overlap: inspect similar families before splitting.

Programmatic constraint validation is necessary but cannot establish semantic
correctness or determine whether a refusal was justified.
