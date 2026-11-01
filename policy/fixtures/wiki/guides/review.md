# Agent review

Background agents work in an isolated Git worktree. A human reviews the diff
before merging it into the current draft. Discarding a run removes the
candidate change without touching the draft.
