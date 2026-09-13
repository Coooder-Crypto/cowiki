import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const ARMS = ["v1_native", "v1_rich", "v2_native", "v2_ablated"];
export const NOW = "2026-09-07T00:00:00Z";

function yamlString(value) {
  return JSON.stringify(String(value));
}

export async function loadFixtures(path) {
  const text = await readFile(path, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid fixture JSON on line ${index + 1}: ${error.message}`);
      }
    });
}

function renderV1Document(doc, lifecycleNote = "") {
  return [
    "---",
    "type: Note",
    `title: ${yamlString(doc.title)}`,
    `timestamp: ${yamlString(doc.generated_at)}`,
    "---",
    "",
    `# ${doc.title}`,
    "",
    doc.body,
    lifecycleNote ? `\n## Lifecycle\n\n${lifecycleNote}` : "",
    "",
    "# Citations",
    "",
    `1. [${doc.source_title}](${doc.source_url})`,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n") + "\n";
}

function renderV2Body(doc) {
  return [
    `# ${doc.title}`,
    "",
    doc.body,
    "",
    `[^${doc.source_id}]: ${doc.source_title}`,
    "",
  ].join("\n");
}

function renderV2Document(doc, status) {
  const frontmatter = [
    "---",
    "type: Note",
    `title: ${yamlString(doc.title)}`,
    `generated: { by: ${yamlString("fixture-author/1.0")}, at: ${yamlString(doc.generated_at)} }`,
  ];
  if (doc.verified_at) {
    frontmatter.push(
      "verified:",
      `  - by: ${yamlString(doc.verified_by ?? "human:fixture-reviewer")}`,
      `    at: ${yamlString(doc.verified_at)}`,
    );
  }
  frontmatter.push(
    `status: ${doc.status ?? status}`,
    `stale_after: ${yamlString(doc.stale_after)}`,
    "sources:",
    `  - id: ${yamlString(doc.source_id)}`,
    `    resource: ${yamlString(doc.source_url)}`,
    `    title: ${yamlString(doc.source_title)}`,
    `    author: ${yamlString(doc.source_author)}`,
    `    last_modified: ${yamlString(doc.source_last_modified ?? doc.generated_at)}`,
    "---",
  );
  return [
    ...frontmatter,
    "",
    renderV2Body(doc),
  ]
    .filter((line) => line !== "")
    .join("\n") + "\n";
}

function renderAblatedDocument(doc) {
  return [
    "---",
    "type: Note",
    `title: ${yamlString(doc.title)}`,
    "---",
    "",
    renderV2Body(doc),
  ].join("\n");
}

export function renderDocuments(item, arm) {
  if (!ARMS.includes(arm)) throw new Error(`Unknown arm: ${arm}`);

  if (arm === "v1_native") {
    return [
      { filename: item.stale.filename, content: renderV1Document(item.stale) },
      { filename: item.fresh.filename, content: renderV1Document(item.fresh) },
    ];
  }

  if (arm === "v1_rich") {
    const staleNote = item.stale.rich_note ?? `This document was superseded on ${item.fresh.generated_at} by \`${item.fresh.filename}\`. Do not use it for current answers.`;
    const freshNote = item.fresh.rich_note ?? `This is the current stable guidance as of ${item.fresh.generated_at}. It was reviewed by ${item.fresh.verified_by ?? "human:fixture-reviewer"} on ${item.fresh.verified_at}.`;
    return [
      { filename: item.stale.filename, content: renderV1Document(item.stale, staleNote) },
      { filename: item.fresh.filename, content: renderV1Document(item.fresh, freshNote) },
    ];
  }

  if (arm === "v2_native") {
    return [
      {
        filename: item.stale.filename,
        content: renderV2Document(item.stale, "deprecated"),
      },
      { filename: item.fresh.filename, content: renderV2Document(item.fresh, "stable") },
    ];
  }

  return [
    { filename: item.stale.filename, content: renderAblatedDocument(item.stale) },
    { filename: item.fresh.filename, content: renderAblatedDocument(item.fresh) },
  ];
}

function seededNumber(seed) {
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

export function orderDocuments(documents, seed) {
  const docs = [...documents];
  if (seededNumber(seed) < 0.5) docs.reverse();
  return docs;
}

export function buildPrompt(item, arm, repetition = 0) {
  const docs = orderDocuments(renderDocuments(item, arm), `${item.id}:${arm}:${repetition}`);
  const version = arm.startsWith("v1_") ? "0.1" : "0.2";
  const rendered = docs
    .map(({ filename, content }) => `===== ${filename} =====\n${content.trim()}`)
    .join("\n\n");
  const prompt = [
    "You are evaluating a frozen knowledge bundle as a read-only consumer.",
    `The current instant is ${NOW}. The bundle declares OKF v${version}.`,
    "Use only the supplied documents. Resolve conflicts using information actually present in this arm.",
    "If the current answer cannot be determined, abstain instead of guessing.",
    "Do not use tools, files, the network, or prior knowledge.",
    "Return only the JSON object required by the supplied schema.",
    "selected_document must be one supplied filename or \"unknown\".",
    "source_ids should contain only explicit stable source identifiers visible in the documents.",
    "",
    `Question: ${item.question}`,
    "",
    rendered,
  ].join("\n");
  return { prompt, documents: docs.map((doc) => doc.filename) };
}

export function promptHash(prompt) {
  return createHash("sha256").update(prompt).digest("hex");
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseModelAnswer(raw) {
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

export function gradeAnswer(item, raw) {
  let answer;
  try {
    answer = parseModelAnswer(raw);
  } catch (error) {
    return { outcome: "invalid", correct: false, grader_version: 2, error: error.message, parsed: null };
  }

  const answerText = normalize(answer.answer);
  const selected = normalize(answer.selected_document);
  const fresh = normalize(item.fresh.value);
  const stale = normalize(item.stale.value);
  const freshSelected = selected === normalize(item.fresh.filename);
  const staleSelected = selected === normalize(item.stale.filename);
  const freshMentioned = fresh && answerText.includes(fresh);
  const staleMentioned = stale && answerText.includes(stale);
  const isFresh = freshSelected || freshMentioned;
  const isStale = staleSelected || staleMentioned;

  let outcome;
  const explicitAbstain = answer.abstain === true;
  const selectedUnknown = selected === "unknown";
  if (explicitAbstain || selectedUnknown) {
    outcome = explicitAbstain && selectedUnknown ? "abstain" : "invalid";
  } else if (freshSelected) outcome = "fresh";
  else if (staleSelected) outcome = "stale";
  else if (isFresh && isStale) outcome = "invalid";
  else if (isFresh) outcome = "fresh";
  else if (isStale) outcome = "stale";
  else outcome = "invalid";

  const sourceIds = Array.isArray(answer.source_ids) ? answer.source_ids.map(normalize) : [];
  return {
    outcome,
    correct: outcome === (item.expected_outcome ?? "fresh"),
    grader_version: 2,
    parsed: answer,
    provenance_correct:
      outcome === "abstain" ? null : sourceIds.includes(normalize(item.fresh.source_id)),
  };
}

export function mockAnswer(item, arm) {
  if (item.expected_outcome === "abstain") {
    return {
      answer: "",
      selected_document: "unknown",
      source_ids: [],
      abstain: true,
      reason: "The supplied evidence does not establish a current answer.",
    };
  }
  const controlCanSolve =
    (arm === "v1_native" && ["timestamp-solvable", "source-solvable"].includes(item.stratum)) ||
    (arm === "v2_ablated" && item.stratum === "source-solvable");
  if (arm === "v1_rich" || arm === "v2_native" || controlCanSolve) {
    return {
      answer: item.fresh.value,
      selected_document: item.fresh.filename,
      source_ids: arm === "v2_native" ? [item.fresh.source_id] : [],
      abstain: false,
      reason: "The current document is explicitly identified by the available lifecycle channel.",
    };
  }
  return {
    answer: item.stale.value,
    selected_document: item.stale.filename,
    source_ids: [],
    abstain: false,
    reason: "Deterministic mock control behavior.",
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

export function summarize(rows) {
  const arms = {};
  for (const arm of ARMS) {
    const selected = rows.filter((row) => row.arm === arm);
    const counts = Object.fromEntries(["fresh", "stale", "abstain", "invalid"].map((key) => [key, 0]));
    for (const row of selected) counts[row.grade.outcome] += 1;
    const committed = counts.fresh + counts.stale;
    arms[arm] = {
      trials: selected.length,
      ...counts,
      correct: selected.filter((row) => row.grade.correct === true).length,
      correct_rate: selected.length
        ? selected.filter((row) => row.grade.correct === true).length / selected.length
        : null,
      stale_rate: selected.length ? counts.stale / selected.length : null,
      conditional_stale_rate: committed ? counts.stale / committed : null,
      median_latency_ms: median(selected.map((row) => row.latency_ms).filter(Number.isFinite)),
      p95_latency_ms: percentile(selected.map((row) => row.latency_ms).filter(Number.isFinite), 0.95),
    };
  }
  return arms;
}

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function itemRates(rows, arm, outcome) {
  const grouped = new Map();
  for (const row of rows.filter((entry) => entry.arm === arm)) {
    const values = grouped.get(row.item_id) ?? [];
    values.push(outcome === "correct" ? (row.grade.correct === true ? 1 : 0) : row.grade.outcome === outcome ? 1 : 0);
    grouped.set(row.item_id, values);
  }
  return new Map([...grouped].map(([id, values]) => [id, values.reduce((a, b) => a + b, 0) / values.length]));
}

export function pairedBootstrap(rows, treatment, control, outcome = "stale", iterations = 2000, seed = 0x0f0f2026) {
  const a = itemRates(rows, treatment, outcome);
  const b = itemRates(rows, control, outcome);
  const ids = [...a.keys()].filter((id) => b.has(id));
  if (!ids.length) return null;
  const differences = ids.map((id) => a.get(id) - b.get(id));
  const point = differences.reduce((sum, value) => sum + value, 0) / differences.length;
  const numericSeed = typeof seed === "number"
    ? seed >>> 0
    : Number.parseInt(createHash("sha256").update(String(seed)).digest("hex").slice(0, 8), 16);
  const random = mulberry32(numericSeed);
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    let sum = 0;
    for (let j = 0; j < differences.length; j += 1) {
      sum += differences[Math.floor(random() * differences.length)];
    }
    samples.push(sum / differences.length);
  }
  samples.sort((x, y) => x - y);
  return {
    items: ids.length,
    outcome,
    point,
    low: samples[Math.floor(iterations * 0.025)],
    high: samples[Math.floor(iterations * 0.975)],
  };
}

export function formatPercent(value) {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}
