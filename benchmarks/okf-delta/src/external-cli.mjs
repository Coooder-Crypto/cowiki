#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { formatPercent, pairedBootstrap } from "./core.mjs";
import {
  CONFLICT_TYPES,
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
  loadJson,
  loadJsonl,
  qampariItemMetrics,
  qampariMetrics,
  sha256,
} from "./external-core.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_PATH = resolve(ROOT, "sources.lock.json");
const PREREGISTRATION_PATH = resolve(ROOT, "preregistration/fair-conflicts-v1.json");
const CONFLICTS_SCHEMA = resolve(ROOT, "schema/conflicts-answer.schema.json");
const DEFAULT_ARM_PROFILE = "fair-v1";

function armProfile(options) {
  const profile = String(options.arm_profile ?? DEFAULT_ARM_PROFILE);
  return { profile, arms: externalArms(profile) };
}

function reportArmConfiguration(rows) {
  const present = new Set(rows.map((row) => row.arm));
  const profile = rows[0]?.arm_profile
    ?? (present.has("s") || present.has("p") ? "fair-v1" : "legacy-v1");
  const arms = externalArms(profile).filter((arm) => present.has(arm));
  const contrasts = profile === "fair-v1"
    ? [["s", "p"], ["s", "n"], ["ps", "n"]]
    : [["v2_native", "v1_rich"], ["v2_native", "v2_ablated"], ["v2_native", "v1_native"]];
  return { profile, arms, contrasts: contrasts.filter(([a, b]) => present.has(a) && present.has(b)) };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) {
      (options.positionals ??= []).push(arg);
      continue;
    }
    const key = arg.slice(2).replaceAll("-", "_");
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

async function ensureParent(path) {
  await mkdir(dirname(path), { recursive: true });
}

async function fileSha256(path) {
  const hash = await import("node:crypto").then(({ createHash }) => createHash("sha256"));
  await pipeline(createReadStream(path), async function* (source) {
    for await (const chunk of source) hash.update(chunk);
  });
  return hash.digest("hex");
}

function defaultSourcePath(source) {
  if (source === "conflicts") return resolve(ROOT, "data/conflicts/conflicts.jsonl");
  if (source === "alce") return resolve(ROOT, "data/alce/ALCE-data.tar");
  throw new Error(`Unknown source: ${source}`);
}

async function verifySource(path, sourceLock) {
  const info = await stat(path);
  if (info.size !== sourceLock.bytes) {
    throw new Error(`Size mismatch for ${path}: expected ${sourceLock.bytes}, got ${info.size}`);
  }
  const digest = await fileSha256(path);
  if (digest !== sourceLock.sha256) {
    throw new Error(`SHA-256 mismatch for ${path}: expected ${sourceLock.sha256}, got ${digest}`);
  }
  return digest;
}

async function fetchSource(options) {
  const source = String(options.source ?? options.positionals?.[0] ?? "");
  if (!source) throw new Error("fetch requires --source conflicts|alce");
  const lock = (await loadJson(LOCK_PATH)).sources[source];
  if (!lock) throw new Error(`Unknown source: ${source}`);
  const output = resolve(options.out ?? defaultSourcePath(source));
  try {
    const digest = await verifySource(output, lock);
    process.stdout.write(`Verified existing ${source} source at ${output}\nSHA-256: ${digest}\n`);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(`Existing source failed verification; remove or move it before retrying: ${error.message}`);
    }
  }
  await ensureParent(output);
  const temporary = `${output}.partial`;
  const response = await fetch(lock.url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: "wx" }));
  try {
    const digest = await verifySource(temporary, lock);
    await rename(temporary, output);
    process.stdout.write(`Downloaded and verified ${source} at ${output}\nSHA-256: ${digest}\n`);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function numericOption(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Expected a non-negative integer, got ${value}`);
  return parsed;
}

function stableSample(items, size, seed) {
  if (size === undefined || size >= items.length) return items;
  return [...items]
    .map((item) => ({ item, rank: sha256(`${seed}:${item.id}`) }))
    .sort((a, b) => a.rank.localeCompare(b.rank))
    .slice(0, size)
    .map(({ item }) => item);
}

function stableStratifiedSample(items, perLabel, seed) {
  return CONFLICT_TYPES.flatMap((label) =>
    stableSample(
      items.filter((item) => item.conflict_type === label),
      perLabel,
      `${seed}:${label}`,
    ),
  );
}

async function loadBenchmarkItems(options) {
  const benchmark = String(options.benchmark ?? "");
  const ndoc = numericOption(options.ndoc, 10);
  const offset = numericOption(options.offset, 0);
  const sourceLocks = (await loadJson(LOCK_PATH)).sources;
  let raw;
  let items;
  if (benchmark === "conflicts") {
    const input = resolve(options.input ?? defaultSourcePath("conflicts"));
    if (!options.allow_unlocked_input) await verifySource(input, sourceLocks.conflicts);
    raw = await loadJsonl(input);
    items = raw.map((item, index) => adaptConflictsItem(item, index, ndoc));
  } else if (benchmark === "alce") {
    const input = options.input ? resolve(options.input) : null;
    if (!input) throw new Error("ALCE requires --input pointing to an extracted official dataset JSON file");
    if (!options.allow_unlocked_input) await verifySource(input, sourceLocks.alce.evaluation_file);
    raw = await loadJson(input);
    const dataset = String(options.dataset ?? "qampari").toLowerCase();
    items = raw.map((item, index) => adaptAlceItem(item, dataset, index, ndoc));
  } else {
    throw new Error("--benchmark must be conflicts or alce");
  }
  items = items.slice(offset);
  const sampleSize = options.sample_size === undefined ? undefined : numericOption(options.sample_size);
  const perLabel = options.per_label === undefined ? undefined : numericOption(options.per_label);
  if (sampleSize !== undefined && perLabel !== undefined) {
    throw new Error("Use either --sample-size or --per-label, not both");
  }
  if (perLabel !== undefined) {
    if (benchmark !== "conflicts") throw new Error("--per-label is supported only for CONFLICTS");
    items = stableStratifiedSample(items, perLabel, String(options.sample_seed ?? "okf-external-v1"));
  } else {
    items = stableSample(items, sampleSize, String(options.sample_seed ?? "okf-external-v1"));
  }
  const limit = options.limit === undefined ? undefined : numericOption(options.limit);
  if (limit !== undefined) items = items.slice(0, limit);
  return { benchmark, items, ndoc };
}

function buildPrompt(item, benchmark, arm, repetition) {
  return benchmark === "conflicts"
    ? buildConflictsPrompt(item, arm, repetition)
    : buildAlcePrompt(item, arm, repetition);
}

async function compile(options) {
  const { benchmark, items } = await loadBenchmarkItems(options);
  const { profile, arms } = armProfile(options);
  const output = resolve(options.out ?? resolve(ROOT, `generated/external/${benchmark}`));
  const manifest = [];
  for (const item of items) {
    for (const arm of arms) {
      const compiled = buildPrompt(item, benchmark, arm, 0);
      const path = resolve(output, item.id, `${arm}.txt`);
      await ensureParent(path);
      await writeFile(path, compiled.prompt, "utf8");
      manifest.push({
        benchmark,
        dataset: item.dataset ?? item.source_dataset,
        item_id: item.id,
        source_index: item.source_index,
        arm,
        arm_profile: profile,
        prompt_sha256: compiled.prompt_sha256,
        canonical_metadata_sha256: compiled.canonical_metadata_sha256,
        metadata_channel: compiled.metadata_channel,
        document_order: compiled.document_order,
        gold: benchmark === "conflicts" ? item.conflict_type : undefined,
      });
    }
  }
  await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`Compiled ${items.length} ${benchmark} items × ${arms.length} ${profile} arms to ${output}\n`);
}

async function auditConflicts(options) {
  const { items } = await loadBenchmarkItems({ ...options, benchmark: "conflicts" });
  const { profile, arms } = armProfile(options);
  const audit = { arm_profile: profile, ...conflictsDatasetAudit(items, arms) };
  const serialized = `${JSON.stringify(audit, null, 2)}\n`;
  if (options.out) {
    const output = resolve(options.out);
    await ensureParent(output);
    await writeFile(output, serialized, "utf8");
    process.stdout.write(`CONFLICTS audit written to ${output}\n`);
  } else {
    process.stdout.write(serialized);
  }
}

function spawnCapture(command, args, { input, cwd, timeoutMs = 180000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const detached = process.platform !== "win32";
    const child = spawn(command, args, { cwd, detached, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (detached && child.pid) process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr.trim() || stdout.trim()}`));
    });
    child.stdin.end(input ?? "");
  });
}

async function runCodex(prompt, model, timeoutMs, schemaPath) {
  const temporary = await mkdtemp(resolve(tmpdir(), "okf-external-codex-"));
  const answerPath = resolve(temporary, "answer.txt");
  try {
    const args = [
      "exec", "-", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules",
      "--sandbox", "read-only", "--color", "never", "--output-last-message", answerPath,
    ];
    if (schemaPath) args.push("--output-schema", schemaPath);
    if (model) args.push("--model", model);
    const captured = await spawnCapture("codex", args, { input: prompt, cwd: temporary, timeoutMs });
    return { raw: await readFile(answerPath, "utf8"), stderr: captured.stderr };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function mockResult(item, benchmark, citationStyle, documentOrder) {
  if (benchmark === "conflicts") {
    return JSON.stringify({
      conflict_type: item.conflict_type,
      answer: item.correct_answer,
      evidence_source_ids: citationStyle === "okf-stable-id" ? documentOrder.slice(0, 1) : [],
      reason: "Deterministic harness check.",
    });
  }
  const firstAnswer = item.raw.answers?.[0]?.[0] ?? "No answer";
  const citation = citationStyle === "okf-stable-id" ? `[^${documentOrder[0]}]` : "[1]";
  return `${firstAnswer} ${citation}`;
}

async function repositoryState() {
  const revision = (await spawnCapture("git", ["rev-parse", "HEAD"], { cwd: ROOT, timeoutMs: 10000 })).stdout.trim();
  const status = (await spawnCapture("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ROOT, timeoutMs: 10000 })).stdout.trim();
  return { revision, dirty: Boolean(status) };
}

async function formalConfiguration(options, benchmark, items, arms, profile, repetitions, ndoc, runner, model, repository) {
  if (!options.formal) return null;
  const preregistrationText = await readFile(PREREGISTRATION_PATH, "utf8");
  const preregistration = JSON.parse(preregistrationText);
  const violations = [];
  if (benchmark !== preregistration.benchmark) violations.push(`benchmark must be ${preregistration.benchmark}`);
  if (items.length !== preregistration.expected_items) violations.push(`item count must be ${preregistration.expected_items}`);
  if (profile !== preregistration.arm_profile) violations.push(`arm profile must be ${preregistration.arm_profile}`);
  if (JSON.stringify(arms) !== JSON.stringify(preregistration.primary_arms)) violations.push(`arms must be ${preregistration.primary_arms.join(",")}`);
  if (repetitions !== preregistration.repetitions) violations.push(`repetitions must be ${preregistration.repetitions}`);
  if (ndoc !== preregistration.ndoc) violations.push(`ndoc must be ${preregistration.ndoc}`);
  if (runner !== preregistration.runner) violations.push(`runner must be ${preregistration.runner}`);
  if (model !== preregistration.model) violations.push(`model must be ${preregistration.model}`);
  if (options.sample_size !== undefined || options.per_label !== undefined || options.limit !== undefined || options.offset !== undefined) violations.push("formal run must use the full split without sampling, offset, or limit");
  if (options.allow_unlocked_input) violations.push("formal run cannot use unlocked input");
  if (String(options.sample_seed ?? preregistration.sample_seed) !== preregistration.sample_seed) violations.push(`sample seed must be ${preregistration.sample_seed}`);
  if (repository.dirty) violations.push("repository must be clean so the adapter and preregistration are bound to an immutable commit");
  if (violations.length) throw new Error(`Formal preregistration violation:\n- ${violations.join("\n- ")}`);
  return {
    id: preregistration.id,
    sha256: sha256(preregistrationText),
    analysis_version: preregistration.analysis_version,
    code_revision: repository.revision,
  };
}

async function validateFormal(options) {
  const configured = {
    ...options,
    formal: true,
    benchmark: String(options.benchmark ?? "conflicts"),
    runner: String(options.runner ?? "codex"),
    model: String(options.model ?? "gpt-5.6-sol"),
    arms: String(options.arms ?? "s,p"),
  };
  const { benchmark, items, ndoc } = await loadBenchmarkItems(configured);
  const { profile, arms: profileArms } = armProfile(configured);
  const arms = configured.arms.split(",");
  for (const arm of arms) if (!profileArms.includes(arm)) throw new Error(`Arm ${arm} is not in profile ${profile}`);
  const repetitions = numericOption(configured.reps, 1);
  const repository = await repositoryState();
  const binding = await formalConfiguration(configured, benchmark, items, arms, profile, repetitions, ndoc, configured.runner, configured.model, repository);
  process.stdout.write(`${JSON.stringify({
    valid: true,
    preregistration: binding,
    items: items.length,
    arms,
    repetitions,
    planned_calls: items.length * arms.length * repetitions,
  }, null, 2)}\n`);
}

async function run(options) {
  const { benchmark, items, ndoc } = await loadBenchmarkItems(options);
  const runner = String(options.runner ?? "mock");
  if (!["mock", "codex"].includes(runner)) throw new Error("External tracks currently support --runner mock|codex");
  const model = String(options.model ?? (runner === "mock" ? "deterministic-mock" : "default"));
  const repetitions = numericOption(options.reps, 1);
  const timeoutMs = numericOption(options.timeout_ms, 180000);
  const concurrency = numericOption(options.concurrency, 1);
  if (concurrency < 1 || concurrency > 8) throw new Error("--concurrency must be between 1 and 8");
  const { profile, arms: profileArms } = armProfile(options);
  const arms = options.arms ? String(options.arms).split(",") : options.formal ? ["s", "p"] : profileArms;
  for (const arm of arms) if (!profileArms.includes(arm)) throw new Error(`Arm ${arm} is not in profile ${profile}`);
  const output = resolve(options.out ?? resolve(ROOT, `runs/${benchmark}-${runner}-${Date.now()}.jsonl`));
  await ensureParent(output);
  const lock = (await loadJson(LOCK_PATH)).sources[benchmark];
  const benchmarkRevision = lock.commit ?? lock.dataset_commit;
  const sampleSeed = String(options.sample_seed ?? (options.formal ? "okf-conflicts-fair-v1" : "okf-external-v1"));
  const repository = await repositoryState();
  const preregistration = await formalConfiguration(options, benchmark, items, arms, profile, repetitions, ndoc, runner, model, repository);
  if (options.retry_errors && !options.resume) throw new Error("--retry-errors requires --resume so prior attempts remain auditable");
  let existing = [];
  if (options.resume) {
    try {
      existing = await loadRows(output);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const row of existing) {
      if (row.benchmark !== benchmark || row.benchmark_revision !== benchmarkRevision || row.runner !== runner || row.model !== model || row.ndoc !== ndoc || row.sample_seed !== sampleSeed || row.arm_profile !== profile || row.preregistration?.sha256 !== preregistration?.sha256) {
        throw new Error(`Cannot resume ${output}: existing rows use different benchmark, revision, runner, model, ndoc, sample seed, arm profile, or preregistration`);
      }
    }
    if (!existing.length) {
      await writeFile(output, "", "utf8");
    }
  } else {
    await writeFile(output, "", "utf8");
  }
  const jobKey = ({ item_id, arm, repetition }) => `${item_id}\u0000${arm}\u0000${repetition}`;
  const latestByKey = new Map();
  for (const row of existing) {
    const key = jobKey(row);
    const previous = latestByKey.get(key);
    const attempt = Number.isInteger(row.attempt) ? row.attempt : 0;
    const previousAttempt = Number.isInteger(previous?.attempt) ? previous.attempt : 0;
    if (!previous || attempt >= previousAttempt) latestByKey.set(key, row);
  }
  const retryLimit = preregistration ? 1 : Number.POSITIVE_INFINITY;
  const completedKeys = new Set(
    [...latestByKey.entries()]
      .filter(([, row]) => !options.retry_errors || !row.runner_error || (row.attempt ?? 0) >= retryLimit)
      .map(([key]) => key),
  );
  const jobs = [];
  for (const item of items) {
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      const orderedArms = [...arms].sort((a, b) => sha256(`arm-order-v1:${sampleSeed}:${item.id}:${repetition}:${a}`).localeCompare(sha256(`arm-order-v1:${sampleSeed}:${item.id}:${repetition}:${b}`)));
      for (const [armOrderIndex, arm] of orderedArms.entries()) {
        const job = { item, item_id: item.id, arm, repetition, arm_order_index: armOrderIndex };
        const key = jobKey(job);
        if (!completedKeys.has(key)) {
          const previous = latestByKey.get(key);
          jobs.push({
            ...job,
            attempt: previous ? (previous.attempt ?? 0) + 1 : 0,
            supersedes_attempt: previous?.runner_error ? (previous.attempt ?? 0) : null,
          });
        }
      }
    }
  }
  const total = items.length * arms.length * repetitions;
  let completed = total - jobs.length;
  if (completed) process.stdout.write(`Resuming with ${completed}/${total} item-arm repetitions already recorded\n`);
  let nextJob = 0;
  let appendChain = Promise.resolve();
  let stopAfterRunnerError = null;

  async function worker() {
    while (true) {
      if (stopAfterRunnerError) return;
      const jobIndex = nextJob;
      nextJob += 1;
      if (jobIndex >= jobs.length) return;
      const { item, arm, repetition, arm_order_index, attempt, supersedes_attempt } = jobs[jobIndex];
        const compiled = buildPrompt(item, benchmark, arm, repetition);
        const started = performance.now();
        let response = "";
        let runnerError = null;
        try {
          response = runner === "mock"
            ? mockResult(item, benchmark, compiled.citation_style, compiled.document_order)
            : (await runCodex(compiled.prompt, options.model, timeoutMs, benchmark === "conflicts" ? CONFLICTS_SCHEMA : null)).raw;
        } catch (error) {
          runnerError = error.message;
        }
        const grade = benchmark === "conflicts"
          ? runnerError
            ? { correct: false, outcome: "invalid", predicted: null, gold: item.conflict_type, error: runnerError, parsed: null }
            : gradeConflictsAnswer(item, response)
          : { outcome: runnerError ? "invalid" : "ungraded", correct: null };
        const row = {
          schema_version: 2,
          benchmark,
          benchmark_revision: benchmarkRevision,
          dataset: item.dataset ?? item.source_dataset,
          recorded_at: new Date().toISOString(),
          item_id: item.id,
          source_index: item.source_index,
          arm,
          arm_profile: profile,
          arm_order_index,
          repetition,
          attempt,
          supersedes_attempt,
          ndoc,
          runner,
          model,
          code_revision: repository.revision,
          code_dirty: repository.dirty,
          sample_seed: sampleSeed,
          selection: options.per_label !== undefined
            ? { method: "stable-stratified-sha256", per_label: numericOption(options.per_label) }
            : options.sample_size !== undefined
              ? { method: "stable-sha256", size: numericOption(options.sample_size) }
              : { method: "full-split" },
          prompt_sha256: compiled.prompt_sha256,
          prompt_characters: compiled.prompt.length,
          prompt_utf8_bytes: Buffer.byteLength(compiled.prompt, "utf8"),
          input_tokens: null,
          context_limit_tokens: null,
          truncated: null,
          token_measurement: "unavailable-from-codex-cli-runner-v1",
          canonical_metadata_sha256: compiled.canonical_metadata_sha256,
          metadata_channel: compiled.metadata_channel,
          document_order: compiled.document_order,
          citation_style: compiled.citation_style,
          latency_ms: Math.round(performance.now() - started),
          response,
          grade,
          runner_error: runnerError,
          preregistration,
        };
        appendChain = appendChain.then(() => writeFile(output, `${JSON.stringify(row)}\n`, { encoding: "utf8", flag: "a" }));
        await appendChain;
        completed += 1;
        process.stdout.write(`[${completed}/${total}] ${item.id} ${arm}: ${grade.outcome}\n`);
        if (preregistration && runnerError) {
          stopAfterRunnerError = runnerError;
          return;
        }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length || 1) }, () => worker()));
  if (stopAfterRunnerError) {
    throw new Error(`Formal run stopped after infrastructure error; preserve this output and resume after recovery${options.retry_errors ? " (the registered retry was consumed)" : " with --resume --retry-errors"}: ${stopAfterRunnerError}`);
  }
  process.stdout.write(`Run written to ${output}\n`);
}

async function loadRows(path) {
  return loadJsonl(path);
}

function latestAttemptRows(rows) {
  const latest = new Map();
  for (const row of rows) {
    const key = `${row.item_id}\u0000${row.arm}\u0000${row.repetition}`;
    const previous = latest.get(key);
    const attempt = Number.isInteger(row.attempt) ? row.attempt : 0;
    const previousAttempt = Number.isInteger(previous?.attempt) ? previous.attempt : 0;
    if (!previous || attempt >= previousAttempt) latest.set(key, row);
  }
  return [...latest.values()];
}

async function boundPreregistration(rows) {
  const bindings = rows.map((row) => row.preregistration).filter(Boolean);
  if (!bindings.length) return null;
  const digests = new Set(bindings.map((binding) => binding.sha256));
  const ids = new Set(bindings.map((binding) => binding.id));
  if (digests.size !== 1 || ids.size !== 1 || bindings.length !== rows.length) {
    throw new Error("Run mixes preregistered and unregistered rows, or multiple preregistrations");
  }
  const text = await readFile(PREREGISTRATION_PATH, "utf8");
  const config = JSON.parse(text);
  if (sha256(text) !== bindings[0].sha256 || config.id !== bindings[0].id) {
    throw new Error("Run preregistration does not match the local frozen contract");
  }
  return config;
}

function percentagePoints(value) {
  return value == null ? "—" : `${(value * 100).toFixed(1)}pp`;
}

function pairedMetricBootstrap(records, treatment, control, metric, iterations = 2000) {
  const grouped = new Map();
  for (const record of records) {
    const key = `${record.arm}\u0000${record.item_id}`;
    const values = grouped.get(key) ?? [];
    values.push(record.metrics[metric]);
    grouped.set(key, values);
  }
  const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const ids = [...new Set(records.map((record) => record.item_id))].filter(
    (id) => grouped.has(`${treatment}\u0000${id}`) && grouped.has(`${control}\u0000${id}`),
  );
  if (!ids.length) return null;
  const differences = ids.map((id) => (
    average(grouped.get(`${treatment}\u0000${id}`)) - average(grouped.get(`${control}\u0000${id}`))
  ));
  const point = average(differences);
  let seed = 0x0a1ce026;
  const random = () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const samples = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    for (let index = 0; index < differences.length; index += 1) {
      sum += differences[Math.floor(random() * differences.length)];
    }
    samples.push(sum / differences.length);
  }
  samples.sort((a, b) => a - b);
  return {
    items: ids.length,
    point,
    low: samples[Math.floor(iterations * 0.025)],
    high: samples[Math.floor(iterations * 0.975)],
  };
}

async function analyzeConflicts(options) {
  const input = options.positionals?.[0];
  if (!input) throw new Error("analyze-conflicts requires a run JSONL path");
  const attempts = await loadRows(resolve(input));
  const rows = latestAttemptRows(attempts);
  const { profile, arms, contrasts } = reportArmConfiguration(rows);
  const preregistration = await boundPreregistration(attempts);
  const runnerModels = [...new Set(rows.map((row) => `${row.runner}/${row.model}`))].join(", ");
  const repetitions = [...new Set(rows.map((row) => row.repetition))].sort((a, b) => a - b);
  const selection = [...new Set(rows.map((row) => JSON.stringify(row.selection ?? { method: "legacy-unrecorded" })))]
    .map((value) => JSON.parse(value));
  const lines = [
    "# CONFLICTS × OKF report",
    "",
    `- Source: \`${resolve(input)}\``,
    `- Benchmark revision: \`${[...new Set(rows.map((row) => row.benchmark_revision))].join(", ")}\``,
    `- Runner/model: ${runnerModels}`,
    `- Selection: \`${JSON.stringify(selection)}\``,
    `- Repetitions: ${repetitions.join(", ")}`,
    `- Trials: ${rows.length}`,
    `- Recorded attempts: ${attempts.length} (${attempts.length - rows.length} retries)`,
    `- Items: ${new Set(rows.map((row) => row.item_id)).size}`,
    `- Arm profile: ${profile}`,
    `- Preregistration: ${preregistration?.id ?? "none (exploratory/pilot)"}`,
    "",
    "## Headline metrics",
    "",
    "| Arm | Trials | Accuracy | Macro-F1 | Invalid |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const arm of arms) {
    const metrics = conflictsMetrics(rows.filter((row) => row.arm === arm));
    lines.push(`| ${arm} | ${metrics.trials} | ${formatPercent(metrics.accuracy)} | ${formatPercent(metrics.macro_f1)} | ${metrics.invalid} |`);
  }
  lines.push(
    "",
    "## Paired correctness contrasts",
    "",
    "| Treatment − control | Items | Difference | Bootstrap 95% CI |",
    "| --- | ---: | ---: | ---: |",
  );
  const contrastResults = new Map();
  for (const [treatment, control] of contrasts) {
    const isPrimary = preregistration?.primary_contrast === `${treatment}-${control}`;
    const result = pairedBootstrap(
      rows,
      treatment,
      control,
      "correct",
      isPrimary ? preregistration.interval.iterations : 2000,
      isPrimary ? preregistration.interval.seed : undefined,
    );
    contrastResults.set(`${treatment}-${control}`, result);
    lines.push(`| ${treatment} − ${control} | ${result?.items ?? 0} | ${percentagePoints(result?.point)} | ${result ? `[${percentagePoints(result.low)}, ${percentagePoints(result.high)}]` : "—"} |`);
  }
  if (preregistration) {
    const result = contrastResults.get(preregistration.primary_contrast);
    const complete = result?.items === preregistration.expected_items
      && rows.length === preregistration.expected_items * preregistration.primary_arms.length * preregistration.repetitions;
    const margin = preregistration.hypothesis.margin_percentage_points / 100;
    const decision = !complete
      ? "INCOMPLETE — no confirmatory decision"
      : result.low > margin
        ? "PASS — non-inferiority established under the frozen rule"
        : "NOT ESTABLISHED — lower bound does not exceed the frozen margin";
    lines.push(
      "",
      "## Preregistered primary decision",
      "",
      `- Completeness: ${complete ? "complete" : "incomplete"} (${result?.items ?? 0}/${preregistration.expected_items} paired items; ${rows.length} rows)`,
      `- Frozen margin: ${preregistration.hypothesis.margin_percentage_points}pp`,
      `- Resamples: ${preregistration.interval.iterations}; seed: \`${preregistration.interval.seed}\``,
      `- Decision: **${decision}**`,
    );
  }
  lines.push("", "## Recall by official conflict label", "", "| Label | " + arms.join(" | ") + " |", "| --- | " + arms.map(() => "---:").join(" | ") + " |");
  for (const label of CONFLICT_TYPES) {
    const cells = arms.map((arm) => formatPercent(conflictsMetrics(rows.filter((row) => row.arm === arm)).per_class[label].recall));
    lines.push(`| ${label} | ${cells.join(" | ")} |`);
  }
  const orderGroups = new Map();
  for (const row of rows) {
    const key = `${row.item_id}\u0000${row.repetition}`;
    const orders = orderGroups.get(key) ?? new Set();
    orders.add(JSON.stringify(row.document_order));
    orderGroups.set(key, orders);
  }
  const orderViolations = [...orderGroups.values()].filter((orders) => orders.size > 1).length;
  const pairGroups = new Map();
  for (const row of rows) {
    const key = `${row.item_id}\u0000${row.arm}`;
    const predictions = pairGroups.get(key) ?? [];
    predictions.push(row.grade.predicted ?? "invalid");
    pairGroups.set(key, predictions);
  }
  const repeatedPairs = [...pairGroups.values()].filter((predictions) => predictions.length > 1);
  const disagreeingPairs = repeatedPairs.filter((predictions) => new Set(predictions).size > 1).length;
  lines.push(
    "",
    "## Causal-control diagnostics",
    "",
    `- Item/repetition groups with different document orders across arms: ${orderViolations}/${orderGroups.size}`,
    `- Repeated item/arm pairs with different predictions: ${disagreeingPairs}/${repeatedPairs.length}`,
  );
  lines.push(
    "",
    "## Guardrails",
    "",
    "- Questions, retrieved passages, dates, labels, and gold answers come from the pinned public CONFLICTS release.",
    "- Macro-F1 includes all five official labels, including labels absent from a small pilot sample.",
    "- Generation quality is not scored here because the paper's generation evaluator is LLM-based; classification is the deterministic headline task.",
    "- A mock run validates plumbing only and is not empirical evidence.",
    "",
  );
  const report = lines.join("\n");
  const output = resolve(options.out ?? resolve(input).replace(/\.jsonl$/i, "-report.md"));
  await writeFile(output, report, "utf8");
  process.stdout.write(`${report}\nReport written to ${output}\n`);
}

async function reconstructAlceRows(options) {
  const runPath = options.positionals?.[0];
  if (!runPath) throw new Error("ALCE command requires a run JSONL path");
  const rows = latestAttemptRows(await loadRows(resolve(runPath)));
  const datasetPath = options.input ? resolve(options.input) : null;
  if (!datasetPath) throw new Error("ALCE command requires --input pointing to the original official dataset JSON");
  const raw = await loadJson(datasetPath);
  const arm = String(options.arm ?? "s");
  const repetition = numericOption(options.rep, 0);
  return rows
    .filter((row) => row.arm === arm && row.repetition === repetition && !row.runner_error)
    .map((row) => {
      const item = adaptAlceItem(raw[row.source_index], row.dataset, row.source_index, row.ndoc);
      const byId = new Map(item.documents.map((doc) => [doc.source_id, doc]));
      const documents = row.document_order.map((id) => byId.get(id)).filter(Boolean);
      return {
        row,
        item,
        official: {
          ...item.raw,
          docs: documents.map((doc) => doc.raw),
          output: convertOkfCitationsToAlce(row.response, row.document_order),
        },
      };
    });
}

async function exportAlce(options) {
  const reconstructed = await reconstructAlceRows(options);
  const output = resolve(options.out ?? resolve(ROOT, `runs/alce-${options.arm ?? "s"}-official.json`));
  await ensureParent(output);
  const payload = alceEvaluationPayload(reconstructed.map((entry) => entry.official));
  await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`Exported ${reconstructed.length} rows in ALCE eval.py format to ${output}\n`);
}

async function analyzeAlce(options) {
  const runPath = options.positionals?.[0];
  if (!runPath) throw new Error("analyze-alce requires a run JSONL path");
  const attempts = await loadRows(resolve(runPath));
  const rows = latestAttemptRows(attempts);
  const { profile, arms, contrasts } = reportArmConfiguration(rows);
  const datasetPath = options.input ? resolve(options.input) : null;
  if (!datasetPath) throw new Error("analyze-alce requires --input pointing to the original official dataset JSON");
  const raw = await loadJson(datasetPath);
  const evaluatedRecords = [];
  const lines = [
    "# ALCE × OKF preflight report",
    "",
    "This report reproduces ALCE's deterministic QAMPARI answer metrics. Citation recall and precision must be produced by the pinned ALCE `eval.py` after export.",
    `Arm profile: ${profile}.`,
    "",
    "| Arm | Items | QAMPARI precision | Recall | Recall@5 | F1 | F1@5 | Unresolved OKF citations |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const arm of arms) {
    const selected = rows.filter((row) => row.arm === arm && row.repetition === 0 && !row.runner_error);
    const evaluated = selected.map((row) => {
      const item = adaptAlceItem(raw[row.source_index], row.dataset, row.source_index, row.ndoc);
      const evaluatedItem = { raw: item.raw, output: convertOkfCitationsToAlce(row.response, row.document_order) };
      evaluatedRecords.push({
        arm,
        item_id: row.item_id,
        metrics: qampariItemMetrics(evaluatedItem),
      });
      return evaluatedItem;
    });
    const metrics = qampariMetrics(evaluated);
    const remaining = selected.reduce((sum, row) => sum + (convertOkfCitationsToAlce(row.response, row.document_order).match(/\[\^[^\]]+\]/g)?.length ?? 0), 0);
    lines.push(`| ${arm} | ${metrics.items} | ${formatPercent(metrics.qampari_precision)} | ${formatPercent(metrics.qampari_recall)} | ${formatPercent(metrics.qampari_recall_top5)} | ${formatPercent(metrics.qampari_f1)} | ${formatPercent(metrics.qampari_f1_top5)} | ${remaining} |`);
  }
  lines.push(
    "",
    "## Paired QAMPARI F1@5 contrasts",
    "",
    "| Treatment − control | Items | Difference | Bootstrap 95% CI |",
    "| --- | ---: | ---: | ---: |",
  );
  for (const [treatment, control] of contrasts) {
    const result = pairedMetricBootstrap(evaluatedRecords, treatment, control, "f1_top5");
    lines.push(`| ${treatment} − ${control} | ${result?.items ?? 0} | ${percentagePoints(result?.point)} | ${result ? `[${percentagePoints(result.low)}, ${percentagePoints(result.high)}]` : "—"} |`);
  }
  const runnerErrors = rows.filter((row) => row.runner_error).length;
  lines.push(
    "",
    "## Run diagnostics",
    "",
    `- Recorded rows: ${rows.length}`,
    `- Remaining runner errors: ${runnerErrors}`,
    "",
    "Run `export-alce` for each arm, then evaluate the exported file with ALCE's pinned `eval.py --citations` environment. Do not call this preflight report an official ALCE citation score.",
    "",
  );
  const report = lines.join("\n");
  const output = resolve(options.out ?? resolve(runPath).replace(/\.jsonl$/i, "-preflight.md"));
  await writeFile(output, report, "utf8");
  process.stdout.write(`${report}\nReport written to ${output}\n`);
}

function usage() {
  process.stdout.write(`Usage:
  node src/external-cli.mjs fetch --source conflicts|alce [--out FILE]
  node src/external-cli.mjs audit-conflicts [--input FILE] [--ndoc N] [--arm-profile fair-v1|legacy-v1] [--out FILE]
  node src/external-cli.mjs compile --benchmark conflicts|alce [--arm-profile fair-v1|legacy-v1] [--input FILE] [--dataset qampari] [--sample-size N|--per-label N] [--sample-seed S] [--limit N] [--allow-unlocked-input]
  node src/external-cli.mjs run --benchmark conflicts|alce --runner mock|codex [--formal] [--arm-profile fair-v1|legacy-v1] [--input FILE] [--dataset qampari] [--sample-size N|--per-label N] [--sample-seed S] [--limit N] [--ndoc N] [--arms a,b] [--concurrency 1-8] [--resume] [--retry-errors] [--allow-unlocked-input] --out FILE
  node src/external-cli.mjs analyze-conflicts RUN.jsonl [--out FILE]
  node src/external-cli.mjs analyze-alce RUN.jsonl --input OFFICIAL.json [--out FILE]
  node src/external-cli.mjs export-alce RUN.jsonl --input OFFICIAL.json [--arm ARM] [--rep N] [--out FILE]
  node src/external-cli.mjs validate-formal [--benchmark conflicts] [--runner codex] [--model gpt-5.6-sol] [--arms s,p]
`);
}

const options = parseArgs(process.argv.slice(2));
try {
  if (options.command === "fetch") await fetchSource(options);
  else if (options.command === "audit-conflicts") await auditConflicts(options);
  else if (options.command === "compile") await compile(options);
  else if (options.command === "run") await run(options);
  else if (options.command === "analyze-conflicts") await analyzeConflicts(options);
  else if (options.command === "analyze-alce") await analyzeAlce(options);
  else if (options.command === "export-alce") await exportAlce(options);
  else if (options.command === "validate-formal") await validateFormal(options);
  else usage();
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
