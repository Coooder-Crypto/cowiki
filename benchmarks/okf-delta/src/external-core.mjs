import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { ARMS, orderDocuments, promptHash } from "./core.mjs";

export const FAIR_ARMS = ["n", "p", "s", "ps"];
export const EXTERNAL_ARM_PROFILES = Object.freeze({
  "fair-v1": FAIR_ARMS,
  "legacy-v1": ARMS,
});

export function externalArms(profile = "fair-v1") {
  const arms = EXTERNAL_ARM_PROFILES[profile];
  if (!arms) throw new Error(`Unknown external arm profile: ${profile}`);
  return [...arms];
}

export const CONFLICT_TYPES = [
  "No conflict",
  "Complementary information",
  "Conflicting opinions and research outcomes",
  "Conflict due to outdated information",
  "Conflict due to misinformation",
];

const CONFLICT_TYPE_BY_NORMALIZED = new Map(
  CONFLICT_TYPES.map((value) => [normalizeLabel(value), value]),
);

function yamlString(value) {
  return JSON.stringify(String(value));
}

function normalizeLabel(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function loadJsonl(path) {
  const text = await readFile(path, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${path}:${index + 1}: ${error.message}`);
      }
    });
}

function stableId(prefix, ...parts) {
  return `${prefix}-${sha256(parts.map((part) => String(part ?? "")).join("\u0000")).slice(0, 12)}`;
}

function toIsoDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const dateOnly = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateOnly) return `${dateOnly[1]}T00:00:00Z`;
  const date = new Date(text);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function cleanText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function conflictsSourceId(result, index) {
  return stableId("conflicts", result.url, result.title, index);
}

function sourceMetadata({ source_id, url, title, source_date, resource }) {
  return Object.freeze({
    id: source_id,
    resource: resource || url || `urn:okf-deltabench:${source_id}`,
    title,
    ...(source_date ? { last_modified: source_date } : {}),
  });
}

function canonicalMetadataDigest(documents) {
  return sha256(JSON.stringify(documents.map((doc) => doc.source_metadata)));
}

export function adaptConflictsItem(raw, index, ndoc = 10) {
  if (!CONFLICT_TYPE_BY_NORMALIZED.has(normalizeLabel(raw.conflict_type))) {
    throw new Error(`Unknown CONFLICTS label at item ${index}: ${raw.conflict_type}`);
  }
  const documents = (raw.search_results ?? []).slice(0, ndoc).map((result, docIndex) => {
    const source_id = conflictsSourceId(result, docIndex);
    const title = cleanText(result.title) || `Source ${docIndex + 1}`;
    const url = cleanText(result.url);
    const source_date = toIsoDate(result.date);
    return {
      benchmark_index: docIndex + 1,
      source_id,
      filename: `source-${String(docIndex + 1).padStart(2, "0")}.md`,
      title,
      url,
      source_date,
      source_metadata: sourceMetadata({ source_id, url, title, source_date }),
      body: cleanText(result.short_text || result.snippet || result.response_str),
    };
  });
  return {
    benchmark: "conflicts",
    id: stableId("conflicts-item", raw.source, raw.question, index),
    source_dataset: raw.source,
    source_index: index,
    question: cleanText(raw.question),
    conflict_type: CONFLICT_TYPE_BY_NORMALIZED.get(normalizeLabel(raw.conflict_type)),
    correct_answer: cleanText(raw.correct_answer),
    documents,
  };
}

function proseMetadata(metadata) {
  return [
    "## Source metadata",
    "",
    `Source identifier: ${metadata.id}`,
    `Source resource: ${metadata.resource}`,
    `Source title: ${metadata.title}`,
    ...(metadata.last_modified ? [`Source last modified: ${metadata.last_modified}`] : []),
  ];
}

function structuredMetadata(metadata) {
  return [
    "sources:",
    `  - id: ${yamlString(metadata.id)}`,
    `    resource: ${yamlString(metadata.resource)}`,
    `    title: ${yamlString(metadata.title)}`,
    ...(metadata.last_modified ? [`    last_modified: ${yamlString(metadata.last_modified)}`] : []),
  ];
}

function renderConflictDocument(doc, arm) {
  const body = [`# ${doc.title}`, "", doc.body];
  if (arm === "p" || arm === "ps") {
    body.push("", ...proseMetadata(doc.source_metadata));
  } else if (arm === "v1_rich") {
    body.push(
      "",
      "## Source metadata",
      "",
      `Stable source identifier: ${doc.source_id}`,
      `Source URL: ${doc.url || "not recorded"}`,
      `Source publication date: ${doc.source_date || "not recorded"}`,
    );
  } else if (arm === "v1_native") {
    body.push("", "# Citations", "", `1. [${doc.title}](${doc.url})`);
  } else if (arm === "v2_native") {
    body.push("", `[^${doc.source_id}]: ${doc.title}`);
  }

  const frontmatter = ["---", "type: Note", `title: ${yamlString(doc.title)}`];
  if (arm.startsWith("v1_") && doc.source_date) {
    frontmatter.push(`timestamp: ${yamlString(doc.source_date)}`);
  }
  if (arm === "v2_native") {
    frontmatter.push(
      `generated: { by: ${yamlString("adapter:okf-deltabench")}, at: ${yamlString("2025-06-10T00:00:00Z")} }`,
      "sources:",
      `  - id: ${yamlString(doc.source_id)}`,
      `    resource: ${yamlString(doc.url || `urn:conflicts:${doc.source_id}`)}`,
      `    title: ${yamlString(doc.title)}`,
    );
    if (doc.source_date) frontmatter.push(`    last_modified: ${yamlString(doc.source_date)}`);
  }
  if (arm === "s" || arm === "ps") frontmatter.push(...structuredMetadata(doc.source_metadata));
  frontmatter.push("---", "");
  return [...frontmatter, ...body, ""].join("\n");
}

export function renderConflictsDocuments(item, arm, repetition = 0) {
  if (![...FAIR_ARMS, ...ARMS].includes(arm)) throw new Error(`Unknown arm: ${arm}`);
  const documents = item.documents.map((doc) => ({
    ...doc,
    content: renderConflictDocument(doc, arm),
  }));
  // Arm-independent ordering is a causal control: the four representations for
  // one item/repetition must expose documents in exactly the same order.
  return orderDocuments(documents, `${item.id}:${repetition}`);
}

export function buildConflictsPrompt(item, arm, repetition = 0) {
  const documents = renderConflictsDocuments(item, arm, repetition);
  const rendered = documents
    .map((doc) => `===== ${doc.filename} =====\n${doc.content.trim()}`)
    .join("\n\n");
  const prompt = [
    "Classify the relationship among the supplied search results for the question.",
    "Use only the supplied documents. Do not use tools, files, the network, or prior knowledge.",
    "Choose exactly one conflict_type from:",
    ...CONFLICT_TYPES.map((label) => `- ${label}`),
    "Return only the JSON object required by the supplied schema.",
    "If a current or correct answer is supported, place it in answer; otherwise use an empty string.",
    "evidence_source_ids may contain only stable identifiers explicitly visible in this arm.",
    "Do not infer trust, publication dates, or lifecycle states that are absent.",
    "",
    `Question: ${item.question}`,
    "",
    rendered,
  ].join("\n");
  return {
    prompt,
    prompt_sha256: promptHash(prompt),
    document_order: documents.map((doc) => doc.source_id),
    canonical_metadata_sha256: canonicalMetadataDigest(item.documents),
    metadata_channel: ({ n: "none", p: "prose", s: "structured", ps: "prose+structured" })[arm] ?? "legacy",
    citation_style: ["p", "s", "ps", "v2_native"].includes(arm) ? "okf-stable-id" : "none",
  };
}

export function parseJsonAnswer(raw) {
  if (typeof raw === "object" && raw !== null) return raw;
  const text = String(raw ?? "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("Response is not a JSON object");
  }
}

export function gradeConflictsAnswer(item, raw) {
  let parsed;
  try {
    parsed = parseJsonAnswer(raw);
  } catch (error) {
    return { correct: false, outcome: "invalid", predicted: null, gold: item.conflict_type, error: error.message, parsed: null };
  }
  const predicted = CONFLICT_TYPE_BY_NORMALIZED.get(normalizeLabel(parsed.conflict_type));
  if (!predicted) {
    return { correct: false, outcome: "invalid", predicted: null, gold: item.conflict_type, error: `Unknown label: ${parsed.conflict_type}`, parsed };
  }
  return {
    correct: predicted === item.conflict_type,
    outcome: predicted === item.conflict_type ? "correct" : "incorrect",
    predicted,
    gold: item.conflict_type,
    parsed,
  };
}

export function conflictsMetrics(rows) {
  const valid = rows.filter((row) => row.grade.predicted);
  const perClass = {};
  for (const label of CONFLICT_TYPES) {
    const tp = valid.filter((row) => row.grade.gold === label && row.grade.predicted === label).length;
    const fp = valid.filter((row) => row.grade.gold !== label && row.grade.predicted === label).length;
    const fn = rows.filter((row) => row.grade.gold === label && row.grade.predicted !== label).length;
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    perClass[label] = {
      support: rows.filter((row) => row.grade.gold === label).length,
      precision,
      recall,
      f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    };
  }
  return {
    trials: rows.length,
    valid: valid.length,
    invalid: rows.length - valid.length,
    accuracy: rows.length ? rows.filter((row) => row.grade.correct).length / rows.length : null,
    macro_f1: rows.length
      ? Object.values(perClass).reduce((sum, value) => sum + value.f1, 0) / CONFLICT_TYPES.length
      : null,
    per_class: perClass,
  };
}

export function conflictsDatasetAudit(items, arms = ARMS) {
  const labelCounts = Object.fromEntries(CONFLICT_TYPES.map((label) => [label, 0]));
  const sourceDatasetCounts = {};
  const promptCharacters = Object.fromEntries(arms.map((arm) => [arm, []]));
  let documents = 0;
  let datedDocuments = 0;
  let itemsWithAnyDate = 0;
  let itemsWithAllDates = 0;

  for (const item of items) {
    labelCounts[item.conflict_type] = (labelCounts[item.conflict_type] ?? 0) + 1;
    sourceDatasetCounts[item.source_dataset] = (sourceDatasetCounts[item.source_dataset] ?? 0) + 1;
    documents += item.documents.length;
    const dated = item.documents.filter((document) => document.source_date).length;
    datedDocuments += dated;
    if (dated > 0) itemsWithAnyDate += 1;
    if (dated === item.documents.length) itemsWithAllDates += 1;
    for (const arm of arms) {
      promptCharacters[arm].push(buildConflictsPrompt(item, arm, 0).prompt.length);
    }
  }

  const distribution = (values) => {
    if (!values.length) return { mean: null, p50: null, p95: null };
    const sorted = [...values].sort((a, b) => a - b);
    return {
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
    };
  };

  return {
    items: items.length,
    label_counts: labelCounts,
    source_dataset_counts: sourceDatasetCounts,
    documents,
    mean_documents_per_item: items.length ? documents / items.length : null,
    dated_documents: datedDocuments,
    dated_document_rate: documents ? datedDocuments / documents : null,
    items_with_any_date: itemsWithAnyDate,
    items_with_all_dates: itemsWithAllDates,
    prompt_characters: Object.fromEntries(
      arms.map((arm) => [arm, distribution(promptCharacters[arm])]),
    ),
  };
}

function alceSourceId(dataset, item, doc, index) {
  const raw = doc.id ?? stableId("doc", doc.title, doc.text, index);
  return `alce-${dataset}-${String(raw).replace(/[^A-Za-z0-9._-]+/g, "-")}`;
}

export function adaptAlceItem(raw, dataset, index, ndoc = 10) {
  const documents = (raw.docs ?? []).slice(0, ndoc).map((doc, docIndex) => {
    const source_id = alceSourceId(dataset, raw, doc, docIndex);
    const title = cleanText(doc.title) || `Source ${docIndex + 1}`;
    return {
      benchmark_index: docIndex + 1,
      source_id,
      filename: `source-${String(docIndex + 1).padStart(2, "0")}.md`,
      title,
      source_metadata: sourceMetadata({ source_id, title, resource: `urn:alce:${source_id}` }),
      body: cleanText(doc.text || doc.sent || doc.phrase),
      raw: doc,
    };
  });
  return {
    benchmark: "alce",
    dataset,
    id: String(raw.id ?? stableId("alce-item", dataset, raw.question, index)),
    source_index: index,
    question: cleanText(raw.question),
    documents,
    raw,
  };
}

function renderAlceDocument(doc, arm) {
  const frontmatter = ["---", "type: Note", `title: ${yamlString(doc.title)}`];
  const body = [`# ${doc.title}`, "", doc.body];
  if (arm === "p" || arm === "ps") {
    body.push("", ...proseMetadata(doc.source_metadata));
  } else if (arm === "v1_rich") {
    body.push("", "## Source metadata", "", `Stable source identifier: ${doc.source_id}`);
  }
  if (arm === "v1_native") {
    body.push("", "# Citations", "", `${doc.benchmark_index}. ${doc.title}`);
  }
  if (arm === "v2_native") {
    frontmatter.push(
      `generated: { by: ${yamlString("adapter:okf-deltabench")}, at: ${yamlString("2023-05-17T00:00:00Z")} }`,
      "sources:",
      `  - id: ${yamlString(doc.source_id)}`,
      `    resource: ${yamlString(`urn:alce:${doc.source_id}`)}`,
      `    title: ${yamlString(doc.title)}`,
    );
    body.push("", `[^${doc.source_id}]: ${doc.title}`);
  }
  if (arm === "s" || arm === "ps") frontmatter.push(...structuredMetadata(doc.source_metadata));
  frontmatter.push("---", "");
  return [...frontmatter, ...body, ""].join("\n");
}

export function buildAlcePrompt(item, arm, repetition = 0) {
  if (![...FAIR_ARMS, ...ARMS].includes(arm)) throw new Error(`Unknown arm: ${arm}`);
  const docs = orderDocuments(
    item.documents.map((doc) => ({ ...doc, content: renderAlceDocument(doc, arm) })),
    `${item.id}:${repetition}`,
  );
  const stableCitations = ["p", "s", "ps", "v2_native"].includes(arm);
  const citationInstruction = stableCitations
    ? "Cite sources inline using the exact OKF footnote identifier, for example [^alce-qampari-123]."
    : "Cite sources inline using their displayed document number, for example [1].";
  const rendered = docs
    .map((doc, index) => `===== Document ${index + 1}: ${doc.filename} =====\n${doc.content.trim()}`)
    .join("\n\n");
  const prompt = [
    item.dataset === "qampari"
      ? "Provide a list of accurate answers for the given question using only the supplied documents; some documents may be irrelevant."
      : "Answer the question using only the supplied documents.",
    citationInstruction,
    item.dataset === "qampari"
      ? "Always cite one and only one document for each answer. Separate answers by commas. For questions that have more than 5 answers, write at least 5 answers."
      : "Every factual answer or list item must have an inline citation.",
    "Do not use tools, files, the network, or prior knowledge.",
    item.dataset === "qampari" ? "Return only the comma-separated answer list." : "Return a concise answer with citations.",
    "",
    `Question: ${item.question}`,
    "",
    rendered,
  ].join("\n");
  return {
    prompt,
    prompt_sha256: promptHash(prompt),
    document_order: docs.map((doc) => doc.source_id),
    documents: docs,
    citation_style: stableCitations ? "okf-stable-id" : "alce-numeric",
    canonical_metadata_sha256: canonicalMetadataDigest(item.documents),
    metadata_channel: ({ n: "none", p: "prose", s: "structured", ps: "prose+structured" })[arm] ?? "legacy",
  };
}

export function convertOkfCitationsToAlce(output, orderedSourceIds) {
  const positions = new Map(orderedSourceIds.map((id, index) => [id, index + 1]));
  return String(output ?? "").replace(/\[\^([^\]]+)\]/g, (match, id) => {
    const position = positions.get(id);
    return position ? `[${position}]` : match;
  });
}

export function alceEvaluationPayload(items) {
  return { data: items };
}

function normalizeAnswer(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\b(a|an|the)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function qampariItemMetrics({ raw, output }) {
  const predictions = String(output ?? "")
    .replace(/[.\s,]+$/, "")
    .split(",")
    .map(normalizeAnswer)
    .filter(Boolean);
  const answers = (raw.answers ?? []).map((group) => group.map(normalizeAnswer));
  const flat = new Set(answers.flat());
  const precision = predictions.length
    ? predictions.filter((prediction) => flat.has(prediction)).length / predictions.length
    : 0;
  const hits = answers.filter((group) => group.some((answer) => predictions.includes(answer))).length;
  const recall = answers.length ? hits / answers.length : 0;
  const recallTop5 = Math.min(5, answers.length) ? Math.min(5, hits) / Math.min(5, answers.length) : 0;
  return {
    precision,
    recall,
    recall_top5: recallTop5,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    f1_top5: precision + recallTop5 ? (2 * precision * recallTop5) / (precision + recallTop5) : 0,
  };
}

export function qampariMetrics(items) {
  const values = items.map(qampariItemMetrics);
  const average = (key) => values.length ? values.reduce((sum, value) => sum + value[key], 0) / values.length : null;
  return {
    items: values.length,
    qampari_precision: average("precision"),
    qampari_recall: average("recall"),
    qampari_recall_top5: average("recall_top5"),
    qampari_f1: average("f1"),
    qampari_f1_top5: average("f1_top5"),
  };
}
