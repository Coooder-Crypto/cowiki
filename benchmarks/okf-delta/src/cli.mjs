#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARMS,
  buildPrompt,
  formatPercent,
  gradeAnswer,
  loadFixtures,
  mockAnswer,
  pairedBootstrap,
  promptHash,
  summarize,
} from "./core.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = resolve(ROOT, "fixtures/lifecycle.jsonl");
const ANSWER_SCHEMA = resolve(ROOT, "schema/answer.schema.json");

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      (options.positionals ??= []).push(arg);
      continue;
    }
    const key = arg.slice(2).replaceAll("-", "_");
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) options[key] = true;
    else {
      options[key] = next;
      i += 1;
    }
  }
  return options;
}

async function ensureParent(path) {
  await mkdir(dirname(path), { recursive: true });
}

async function compile(options) {
  const fixtures = await loadFixtures(options.fixtures ? resolve(options.fixtures) : FIXTURES);
  const output = resolve(options.out ?? resolve(ROOT, "generated/lifecycle"));
  await mkdir(output, { recursive: true });
  const manifest = [];
  for (const item of fixtures) {
    for (const arm of ARMS) {
      const { prompt, documents } = buildPrompt(item, arm, 0);
      const path = resolve(output, item.id, `${arm}.txt`);
      await ensureParent(path);
      await writeFile(path, prompt, "utf8");
      manifest.push({ item_id: item.id, family: item.family, stratum: item.stratum, expected_outcome: item.expected_outcome ?? "fresh", arm, documents, prompt_sha256: promptHash(prompt) });
    }
  }
  await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`Compiled ${fixtures.length} fixtures × ${ARMS.length} arms to ${output}\n`);
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

async function runCodex(prompt, model, timeoutMs) {
  const temporary = await mkdtemp(resolve(tmpdir(), "okf-delta-codex-"));
  const answerPath = resolve(temporary, "answer.json");
  try {
    const args = [
      "exec",
      "-",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "--sandbox",
      "read-only",
      "--color",
      "never",
      "--output-schema",
      ANSWER_SCHEMA,
      "--output-last-message",
      answerPath,
    ];
    if (model) args.push("--model", model);
    const captured = await spawnCapture("codex", args, { input: prompt, cwd: temporary, timeoutMs });
    const raw = await readFile(answerPath, "utf8");
    return { raw, runner_stdout: captured.stdout, runner_stderr: captured.stderr };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function runClaude(prompt, model, timeoutMs) {
  const schema = await readFile(ANSWER_SCHEMA, "utf8");
  const args = [
    "--print",
    "--output-format",
    "json",
    "--no-session-persistence",
    "--safe-mode",
    "--disable-slash-commands",
    "--permission-mode",
    "dontAsk",
    "--tools",
    "",
    "--json-schema",
    schema,
  ];
  if (model) args.push("--model", model);
  const captured = await spawnCapture("claude", args, { input: prompt, cwd: tmpdir(), timeoutMs });
  const envelope = JSON.parse(captured.stdout);
  const raw = envelope.structured_output ?? envelope.result ?? envelope;
  return { raw, runner_stdout: captured.stdout, runner_stderr: captured.stderr };
}

async function runGemini(prompt, model, timeoutMs) {
  const args = ["--output-format", "json", "--approval-mode", "default"];
  if (model && model !== "default") args.push("--model", model);
  args.push(prompt);
  const captured = await spawnCapture("gemini", args, { cwd: tmpdir(), timeoutMs });
  const envelope = JSON.parse(captured.stdout);
  const raw = envelope.response ?? envelope.result ?? envelope;
  return { raw, runner_stdout: captured.stdout, runner_stderr: captured.stderr };
}

async function runOne(item, arm, repetition, runner, model, timeoutMs) {
  const { prompt, documents } = buildPrompt(item, arm, repetition);
  const started = performance.now();
  let result;
  let runnerError = null;
  try {
    if (runner === "mock") result = { raw: mockAnswer(item, arm) };
    else if (runner === "codex") result = await runCodex(prompt, model, timeoutMs);
    else if (runner === "claude") result = await runClaude(prompt, model, timeoutMs);
    else if (runner === "gemini") result = await runGemini(prompt, model, timeoutMs);
    else throw new Error(`Unsupported runner: ${runner}`);
  } catch (error) {
    runnerError = error.message;
    result = { raw: "" };
  }
  const latencyMs = Math.round(performance.now() - started);
  const grade = runnerError
    ? { outcome: "invalid", error: runnerError, parsed: null }
    : gradeAnswer(item, result.raw);
  return {
    schema_version: 1,
    recorded_at: new Date().toISOString(),
    item_id: item.id,
    family: item.family,
    stratum: item.stratum,
    expected_outcome: item.expected_outcome ?? "fresh",
    arm,
    repetition,
    runner,
    model,
    prompt_sha256: promptHash(prompt),
    document_order: documents,
    fresh_document_first: documents[0] === item.fresh.filename,
    latency_ms: latencyMs,
    response: result.raw,
    grade,
    runner_error: runnerError,
  };
}

async function run(options) {
  const runner = options.runner ?? "mock";
  const model = options.model ?? (runner === "mock" ? "deterministic-mock" : "default");
  const repetitions = Number(options.reps ?? 1);
  const timeoutMs = Number(options.timeout_ms ?? 180000);
  const limit = options.limit ? Number(options.limit) : undefined;
  const requestedArms = options.arms ? String(options.arms).split(",") : ARMS;
  for (const arm of requestedArms) {
    if (!ARMS.includes(arm)) throw new Error(`Unknown arm: ${arm}`);
  }
  let fixtures = await loadFixtures(options.fixtures ? resolve(options.fixtures) : FIXTURES);
  if (Number.isFinite(limit)) fixtures = fixtures.slice(0, limit);
  const output = resolve(options.out ?? resolve(ROOT, `runs/${runner}-${Date.now()}.jsonl`));
  await ensureParent(output);
  await writeFile(output, "", "utf8");
  let completed = 0;
  const total = fixtures.length * requestedArms.length * repetitions;
  for (const item of fixtures) {
    for (const arm of requestedArms) {
      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        const row = await runOne(item, arm, repetition, runner, model, timeoutMs);
        await writeFile(output, `${JSON.stringify(row)}\n`, { encoding: "utf8", flag: "a" });
        completed += 1;
        process.stdout.write(`[${completed}/${total}] ${item.id} ${arm}: ${row.grade.outcome}\n`);
      }
    }
  }
  process.stdout.write(`Run written to ${output}\n`);
}

async function loadRows(path) {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function pp(value) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}pp`;
}

function renderReport(rows, sourcePath) {
  const arms = summarize(rows);
  const comparisons = [
    ["v2_native", "v1_rich"],
    ["v2_native", "v2_ablated"],
    ["v2_native", "v1_native"],
  ];
  const contrasts = comparisons.flatMap(([treatment, control]) =>
    ["correct", "stale", "abstain"].map((outcome) => ({
      treatment,
      control,
      outcome,
      result: pairedBootstrap(rows, treatment, control, outcome),
    })),
  );
  const runnerModels = [...new Set(rows.map((row) => `${row.runner}/${row.model}`))].join(", ");
  const lines = [
    "# OKF DeltaBench report",
    "",
    `- Source: \`${sourcePath}\``,
    `- Runner/model: ${runnerModels}`,
    `- Trials: ${rows.length}`,
    `- Fixture items: ${new Set(rows.map((row) => row.item_id)).size}`,
    "",
    "## Outcomes",
    "",
    "| Arm | Trials | Correct | Fresh | Stale | Abstain | Invalid | Raw stale | Conditional stale | Median / p95 latency |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const arm of ARMS) {
    const value = arms[arm];
    lines.push(
      `| ${arm} | ${value.trials} | ${value.correct} (${formatPercent(value.correct_rate)}) | ${value.fresh} | ${value.stale} | ${value.abstain} | ${value.invalid} | ${formatPercent(value.stale_rate)} | ${formatPercent(value.conditional_stale_rate)} | ${value.median_latency_ms ?? "—"} / ${value.p95_latency_ms ?? "—"} ms |`,
    );
  }
  lines.push("", "## Outcomes by stratum", "");
  for (const stratum of [...new Set(rows.map((row) => row.stratum ?? "unspecified"))].sort()) {
    lines.push(`### ${stratum}`, "", "| Arm | Trials | Correct | Fresh | Stale | Abstain | Invalid |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    const stratumSummary = summarize(rows.filter((row) => (row.stratum ?? "unspecified") === stratum));
    for (const arm of ARMS) {
      const value = stratumSummary[arm];
      lines.push(`| ${arm} | ${value.trials} | ${value.correct} (${formatPercent(value.correct_rate)}) | ${value.fresh} | ${value.stale} | ${value.abstain} | ${value.invalid} |`);
    }
    lines.push("");
  }
  lines.push("## Paired contrasts", "", "For `correct`, positive values favor treatment; for `stale` and `abstain`, negative values favor treatment. On ambiguous items, abstention is the expected correct outcome, so read the `correct` contrast first.", "");
  lines.push("| Treatment − control | Outcome | Items | Rate difference | Bootstrap 95% CI |", "| --- | --- | ---: | ---: | ---: |");
  for (const contrast of contrasts) {
    const value = contrast.result;
    lines.push(
      `| ${contrast.treatment} − ${contrast.control} | ${contrast.outcome} | ${value?.items ?? 0} | ${pp(value?.point ?? null)} | ${value ? `[${pp(value.low)}, ${pp(value.high)}]` : "—"} |`,
    );
  }
  const pairGroups = new Map();
  for (const row of rows) {
    const key = `${row.item_id}\u0000${row.arm}`;
    const values = pairGroups.get(key) ?? [];
    values.push(row.grade.outcome);
    pairGroups.set(key, values);
  }
  const repeatedPairs = [...pairGroups.values()].filter((values) => values.length > 1);
  const disagreeingPairs = repeatedPairs.filter((values) => new Set(values).size > 1).length;
  lines.push(
    "",
    "## Repetition and order diagnostics",
    "",
    `- Repeated item-arm pairs: ${repeatedPairs.length}`,
    `- Pairs with different outcomes across repetitions: ${disagreeingPairs} (${formatPercent(repeatedPairs.length ? disagreeingPairs / repeatedPairs.length : null)})`,
    "",
    "| Arm | Current document first | Current document second |",
    "| --- | ---: | ---: |",
  );
  for (const arm of ARMS) {
    const formatOrderCell = (freshFirst) => {
      const selected = rows.filter((row) => row.arm === arm && row.fresh_document_first === freshFirst);
      const correct = selected.filter((row) => row.grade.correct === true).length;
      return `${correct}/${selected.length} (${formatPercent(selected.length ? correct / selected.length : null)})`;
    };
    lines.push(`| ${arm} | ${formatOrderCell(true)} | ${formatOrderCell(false)} |`);
  }
  lines.push(
    "",
    "## Interpretation guardrails",
    "",
    "- This is an oracle-context lifecycle experiment, not a retrieval or full CoWiki benchmark.",
    "- Refusals and invalid rows remain visible; do not quote conditional stale rate alone.",
    "- A mock run verifies the harness only and is not empirical evidence.",
    "- Pilot confidence intervals do not define a product threshold or formal sample size.",
    "",
  );
  return lines.join("\n");
}

async function analyze(options) {
  const input = options.positionals?.[0];
  if (!input) throw new Error("analyze requires a JSONL input path");
  const inputPath = resolve(input);
  const rows = await loadRows(inputPath);
  const report = renderReport(rows, inputPath);
  const output = resolve(options.out ?? inputPath.replace(/\.jsonl$/i, "-report.md"));
  await ensureParent(output);
  await writeFile(output, report, "utf8");
  process.stdout.write(`${report}\nReport written to ${output}\n`);
}

async function regrade(options) {
  const input = options.positionals?.[0];
  if (!input) throw new Error("regrade requires a JSONL input path");
  const inputPath = resolve(input);
  const rows = await loadRows(inputPath);
  const fixtures = await loadFixtures(options.fixtures ? resolve(options.fixtures) : FIXTURES);
  const fixtureById = new Map(fixtures.map((item) => [item.id, item]));
  const output = resolve(options.out ?? inputPath.replace(/\.jsonl$/i, "-regraded.jsonl"));
  await ensureParent(output);
  const regraded = rows.map((row) => {
    const item = fixtureById.get(row.item_id);
    if (!item) throw new Error(`No fixture found for row ${row.item_id}`);
    const grade = row.runner_error
      ? { outcome: "invalid", correct: false, grader_version: 2, error: row.runner_error, parsed: null }
      : gradeAnswer(item, row.response);
    return {
      ...row,
      fresh_document_first: row.document_order?.[0] === item.fresh.filename,
      original_grade: row.grade,
      grade,
    };
  });
  await writeFile(output, `${regraded.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  process.stdout.write(`Regraded ${regraded.length} rows with grader v2 to ${output}\n`);
}

function usage() {
  process.stdout.write(`Usage:\n  node src/cli.mjs compile [--out DIR]\n  node src/cli.mjs run --runner mock|codex|claude|gemini [--model MODEL] [--limit N] [--reps N] [--arms a,b] [--timeout-ms N] --out FILE\n  node src/cli.mjs regrade FILE [--out FILE]\n  node src/cli.mjs analyze FILE [--out FILE]\n`);
}

const options = parseArgs(process.argv.slice(2));
try {
  if (options.command === "compile") await compile(options);
  else if (options.command === "run") await run(options);
  else if (options.command === "regrade") await regrade(options);
  else if (options.command === "analyze") await analyze(options);
  else usage();
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
