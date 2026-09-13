import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARMS,
  buildPrompt,
  gradeAnswer,
  loadFixtures,
  mockAnswer,
  pairedBootstrap,
  renderDocuments,
  summarize,
} from "../src/core.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtures = await loadFixtures(resolve(ROOT, "fixtures/lifecycle.jsonl"));

test("pilot is balanced across five evidence strata", () => {
  assert.equal(fixtures.length, 10);
  const strata = Object.groupBy(fixtures, (item) => item.stratum);
  assert.deepEqual(Object.keys(strata).sort(), [
    "ambiguous",
    "authority-conflict",
    "lifecycle-only",
    "source-solvable",
    "timestamp-solvable",
  ]);
  for (const items of Object.values(strata)) assert.equal(items.length, 2);
});

test("arms encode only their intended OKF channels", () => {
  const item = fixtures[0];
  const v1 = renderDocuments(item, "v1_native").map((doc) => doc.content).join("\n");
  const rich = renderDocuments(item, "v1_rich").map((doc) => doc.content).join("\n");
  const v2 = renderDocuments(item, "v2_native").map((doc) => doc.content).join("\n");
  const ablated = renderDocuments(item, "v2_ablated").map((doc) => doc.content).join("\n");

  assert.match(v1, /timestamp:/);
  assert.match(v1, /# Citations/);
  assert.doesNotMatch(v1, /stale_after:/);
  assert.match(rich, /## Lifecycle/);
  assert.match(rich, /superseded/);
  assert.match(v2, /generated:/);
  assert.match(v2, /verified:/);
  assert.match(v2, /verified:\n\s+- by:/);
  assert.match(v2, /status: deprecated/);
  assert.match(v2, /stale_after: "\d{4}-\d{2}-\d{2}T/);
  assert.match(v2, /sources:/);
  assert.match(v2, /fixture-author\/1\.0/);
  assert.doesNotMatch(v2, /# Citations/);
  assert.doesNotMatch(ablated, /generated:|verified:|status:|stale_after:|sources:|timestamp:/);

  const bodies = (documents) => documents.map((document) => document.content.split(/^---$/m).at(-1).trim());
  assert.deepEqual(bodies(renderDocuments(item, "v2_native")), bodies(renderDocuments(item, "v2_ablated")));
});

test("prompt order is deterministic and arm-specific", () => {
  const item = fixtures[0];
  const a = buildPrompt(item, "v2_native", 2);
  const b = buildPrompt(item, "v2_native", 2);
  assert.deepEqual(a, b);
  assert.match(a.prompt, /OKF v0\.2/);
  assert.deepEqual([...a.documents].sort(), [item.fresh.filename, item.stale.filename].sort());
});

test("deterministic grader keeps refusals and invalid answers separate", () => {
  const item = fixtures.find((fixture) => fixture.stratum === "lifecycle-only");
  const ambiguous = fixtures.find((fixture) => fixture.stratum === "ambiguous");
  assert.equal(gradeAnswer(item, mockAnswer(item, "v2_native")).outcome, "fresh");
  assert.equal(gradeAnswer(item, mockAnswer(item, "v1_native")).outcome, "stale");
  const refusal = gradeAnswer(ambiguous, {
      answer: "",
      selected_document: "unknown",
      source_ids: [],
      abstain: true,
      reason: "Conflict cannot be resolved.",
    });
  assert.equal(refusal.outcome, "abstain");
  assert.equal(refusal.correct, true);
  const explanatoryMention = gradeAnswer(item, {
    answer: `${item.fresh.value}; ${item.stale.value} is retained only for existing clients.`,
    selected_document: item.fresh.filename,
    source_ids: [item.fresh.source_id],
    abstain: false,
    reason: "The selected document is current.",
  });
  assert.equal(explanatoryMention.outcome, "fresh");
  assert.equal(explanatoryMention.correct, true);
  assert.equal(gradeAnswer(item, "not json").outcome, "invalid");
});

test("summary and paired bootstrap operate at item level", () => {
  const rows = fixtures.flatMap((item) =>
    ARMS.map((arm) => ({ item_id: item.id, arm, latency_ms: 1, grade: gradeAnswer(item, mockAnswer(item, arm)) })),
  );
  const summary = summarize(rows);
  assert.equal(summary.v2_native.stale, 0);
  assert.equal(summary.v2_native.correct, fixtures.length);
  assert.equal(summary.v2_ablated.stale, 6);
  assert.equal(summary.v2_ablated.correct, 4);
  const contrast = pairedBootstrap(rows, "v2_native", "v2_ablated", "stale", 500);
  assert.equal(contrast.items, fixtures.length);
  assert.equal(contrast.point, -0.6);
  const correctness = pairedBootstrap(rows, "v2_native", "v2_ablated", "correct", 500);
  assert.equal(correctness.point, 0.6);
});
