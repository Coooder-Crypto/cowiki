import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FAIR_ARMS,
  adaptAlceItem,
  adaptConflictsItem,
  alceEvaluationPayload,
  buildAlcePrompt,
  buildConflictsPrompt,
  conflictsDatasetAudit,
  conflictsMetrics,
  convertOkfCitationsToAlce,
  externalArms,
  gradeConflictsAnswer,
  qampariItemMetrics,
  qampariMetrics,
  renderConflictsDocuments,
} from "../src/external-core.mjs";

const conflictRaw = {
  source: "freshqa",
  question: "Which value is current?",
  search_results: [
    { title: "Earlier report", url: "https://example.test/a", date: "2023-01-02", short_text: "The value was 10." },
    { title: "Later report", url: "https://example.test/b", date: "2024-03-04", short_text: "The value is 12." },
  ],
  conflict_type: "Conflict due to outdated information",
  correct_answer: "12",
};

test("CONFLICTS adapter preserves official task data and changes only representation", () => {
  const item = adaptConflictsItem(conflictRaw, 7, 10);
  assert.equal(item.question, conflictRaw.question);
  assert.equal(item.conflict_type, conflictRaw.conflict_type);
  assert.equal(item.documents.length, 2);
  assert.equal(item.documents[0].body, conflictRaw.search_results[0].short_text);

  const v1 = renderConflictsDocuments(item, "v1_native").map((doc) => doc.content).join("\n");
  const rich = renderConflictsDocuments(item, "v1_rich").map((doc) => doc.content).join("\n");
  const v2 = renderConflictsDocuments(item, "v2_native").map((doc) => doc.content).join("\n");
  const ablated = renderConflictsDocuments(item, "v2_ablated").map((doc) => doc.content).join("\n");
  assert.match(v1, /timestamp: "2023-01-02T00:00:00Z"/);
  assert.match(v1, /# Citations/);
  assert.match(rich, /Stable source identifier:/);
  assert.match(v2, /sources:/);
  assert.match(v2, /last_modified: "2024-03-04T00:00:00Z"/);
  assert.doesNotMatch(ablated, /timestamp:|sources:|last_modified:|Stable source identifier:/);

  for (const arm of ["v1_native", "v1_rich", "v2_native", "v2_ablated"]) {
    const prompt = buildConflictsPrompt(item, arm, 0);
    assert.match(prompt.prompt, /Which value is current\?/);
    assert.equal(prompt.document_order.length, 2);
  }
  const orders = ["v1_native", "v1_rich", "v2_native", "v2_ablated"]
    .map((arm) => buildConflictsPrompt(item, arm, 0).document_order);
  for (const order of orders.slice(1)) assert.deepEqual(order, orders[0]);
});

test("fair N/P/S/PS arms derive prose and structured channels from one canonical record", () => {
  assert.deepEqual(externalArms(), FAIR_ARMS);
  const item = adaptConflictsItem(conflictRaw, 7, 10);
  const rendered = Object.fromEntries(
    FAIR_ARMS.map((arm) => [arm, renderConflictsDocuments(item, arm, 0).map((doc) => doc.content).join("\n")]),
  );

  assert.doesNotMatch(rendered.n, /## Source metadata|^sources:|last_modified:|Source identifier:/m);
  assert.match(rendered.p, /## Source metadata/);
  assert.match(rendered.p, /Source identifier: conflicts-/);
  assert.match(rendered.p, /Source last modified: 2023-01-02T00:00:00Z/);
  assert.doesNotMatch(rendered.p, /^sources:/m);
  assert.match(rendered.s, /^sources:/m);
  assert.match(rendered.s, /last_modified: "2023-01-02T00:00:00Z"/);
  assert.doesNotMatch(rendered.s, /## Source metadata|Source identifier:/);
  assert.match(rendered.ps, /^sources:/m);
  assert.match(rendered.ps, /## Source metadata/);

  for (const document of item.documents) {
    const values = Object.values(document.source_metadata);
    for (const arm of ["p", "s", "ps"]) {
      for (const value of values) assert.ok(rendered[arm].includes(String(value)), `${arm} omits canonical value ${value}`);
    }
  }

  const prompts = FAIR_ARMS.map((arm) => buildConflictsPrompt(item, arm, 0));
  assert.equal(new Set(prompts.map((prompt) => prompt.canonical_metadata_sha256)).size, 1);
  for (const prompt of prompts.slice(1)) assert.deepEqual(prompt.document_order, prompts[0].document_order);
  assert.deepEqual(prompts.map((prompt) => prompt.metadata_channel), ["none", "prose", "structured", "prose+structured"]);
});

test("CONFLICTS classification has a deterministic exact-label grader", () => {
  const item = adaptConflictsItem(conflictRaw, 0, 10);
  const correct = gradeConflictsAnswer(item, {
    conflict_type: "Conflict due to outdated information",
    answer: "12",
    evidence_source_ids: [],
    reason: "The dated reports disagree.",
  });
  assert.equal(correct.correct, true);
  assert.equal(gradeConflictsAnswer(item, "not json").outcome, "invalid");
  const metrics = conflictsMetrics([{ grade: correct }]);
  assert.equal(metrics.accuracy, 1);
  assert.equal(metrics.per_class[conflictRaw.conflict_type].recall, 1);
});

test("CONFLICTS dataset audit makes corpus and prompt-cost claims reproducible", () => {
  const item = adaptConflictsItem(conflictRaw, 0, 10);
  const audit = conflictsDatasetAudit([item]);
  assert.equal(audit.items, 1);
  assert.equal(audit.documents, 2);
  assert.equal(audit.dated_document_rate, 1);
  assert.equal(audit.label_counts[conflictRaw.conflict_type], 1);
  assert.ok(audit.prompt_characters.v2_native.mean > audit.prompt_characters.v2_ablated.mean);
  const fairAudit = conflictsDatasetAudit([item], FAIR_ARMS);
  assert.deepEqual(Object.keys(fairAudit.prompt_characters), FAIR_ARMS);
  assert.ok(fairAudit.prompt_characters.ps.mean > fairAudit.prompt_characters.s.mean);
});

test("ALCE adapter maps stable OKF citations back to official numeric citations", () => {
  const raw = {
    id: "example",
    question: "What did the artist draw?",
    answers: [["Heat"], ["Sanctuary"]],
    docs: [
      { id: "10", title: "Artist", text: "The artist drew Heat and Sanctuary." },
      { id: "20", title: "Other", text: "An unrelated passage." },
    ],
  };
  const item = adaptAlceItem(raw, "qampari", 0, 2);
  const compiled = buildAlcePrompt(item, "v2_native", 0);
  assert.deepEqual(
    buildAlcePrompt(item, "v1_native", 0).document_order,
    compiled.document_order,
  );
  assert.match(compiled.prompt, /sources:/);
  assert.match(compiled.prompt, /write at least 5 answers/);
  const citedId = compiled.document_order[0];
  assert.equal(convertOkfCitationsToAlce(`Heat [^${citedId}]`, compiled.document_order), "Heat [1]");
  assert.equal(convertOkfCitationsToAlce("Heat [^missing]", compiled.document_order), "Heat [^missing]");

  const evaluatedItem = { raw, output: "Heat [1], Sanctuary [1]" };
  const itemMetrics = qampariItemMetrics(evaluatedItem);
  assert.equal(itemMetrics.f1_top5, 1);
  const metrics = qampariMetrics([evaluatedItem]);
  assert.equal(metrics.qampari_precision, 1);
  assert.equal(metrics.qampari_recall, 1);
  assert.equal(metrics.qampari_f1, 1);

  const payload = alceEvaluationPayload([{ ...raw, output: "Heat [1]" }]);
  assert.deepEqual(Object.keys(payload), ["data"]);
  assert.equal(payload.data.length, 1);

  const fair = Object.fromEntries(FAIR_ARMS.map((arm) => [arm, buildAlcePrompt(item, arm, 0)]));
  assert.equal(fair.n.citation_style, "alce-numeric");
  assert.equal(fair.p.citation_style, "okf-stable-id");
  assert.equal(fair.s.citation_style, "okf-stable-id");
  assert.equal(fair.ps.citation_style, "okf-stable-id");
  assert.equal(new Set(FAIR_ARMS.map((arm) => fair[arm].canonical_metadata_sha256)).size, 1);
  assert.deepEqual(fair.p.document_order, fair.s.document_order);
  assert.match(fair.p.prompt, /## Source metadata/);
  assert.doesNotMatch(fair.p.prompt, /^sources:/m);
  assert.match(fair.s.prompt, /^sources:/m);
  assert.doesNotMatch(fair.s.prompt, /## Source metadata/);
});
