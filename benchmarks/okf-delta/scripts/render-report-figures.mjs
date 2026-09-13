#!/usr/bin/env node

// Rebuild the static figures in docs/okf-v0.2-scientific-assessment.md from
// the locked dataset audit and the pilot reports. No model calls are made.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const runDir = path.join(project, "benchmarks/okf-delta/runs");
const figureDir = path.join(project, "docs/assets");
const audit = JSON.parse(await readFile(path.join(runDir, "conflicts-dataset-audit.json"), "utf8"));
const conflicts = await readFile(path.join(runDir, "conflicts-codex-balanced-pilot-report.md"), "utf8");
const alce = await readFile(path.join(runDir, "alce-qampari-codex-pilot-preflight.md"), "utf8");
await mkdir(figureDir, { recursive: true });
assert.equal(Object.values(audit.label_counts).reduce((sum, count) => sum + count, 0), audit.items);
assert(audit.dated_documents <= audit.documents);
assert(audit.items_with_all_dates <= audit.items_with_any_date);
assert(audit.items_with_any_date <= audit.items);

const C = {
  ink: "#17212b", muted: "#526171", grid: "#d9e0e6", pale: "#f4f7f8",
  teal: "#087f75", blue: "#497db3", orange: "#c16b27", gray: "#9ba8b2",
  white: "#ffffff", red: "#a54848",
};
const escapeXml = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const num = (n, d = 0) => Number(n).toFixed(d);
const pct = (n, total) => `${num(100 * n / total, 1)}%`;
const text = (x, y, value, opts = {}) => `<text x="${x}" y="${y}" fill="${opts.fill ?? C.ink}" font-size="${opts.size ?? 15}" font-weight="${opts.weight ?? 400}" text-anchor="${opts.anchor ?? "start"}"${opts.extra ?? ""}>${escapeXml(value)}</text>`;
const rect = (x, y, w, h, fill, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
const line = (x1, y1, x2, y2, stroke = C.grid, width = 1, extra = "") => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" ${extra}/>`;
const circle = (x, y, r, fill, extra = "") => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${extra}/>`;
const title = (label, subtitle) => text(28, 38, label, { size: 21, weight: 600 }) + text(28, 64, subtitle, { size: 13, fill: C.muted });
const svg = (w, h, name, description, content) => `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="figure-title figure-desc"><title id="figure-title">${escapeXml(name)}</title><desc id="figure-desc">${escapeXml(description)}</desc>${rect(0, 0, w, h, C.white)}<g font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif">${content}</g></svg>\n`;
const save = async (name, content) => writeFile(path.join(figureDir, name), content, "utf8");

function tableRows(markdown, heading) {
  const start = markdown.indexOf(heading);
  assert(start >= 0, `Missing report section: ${heading}`);
  const tail = markdown.slice(start + heading.length);
  const next = tail.search(/\n## /);
  const section = next < 0 ? tail : tail.slice(0, next);
  return section.split("\n")
    .filter((row) => row.startsWith("| ") && !/^\|\s*-/.test(row))
    .slice(1)
    .map((row) => row.split("|").slice(1, -1).map((v) => v.trim()));
}

function pairedRows(markdown, heading) {
  return tableRows(markdown, heading).map(([label, items, difference, interval]) => {
    const match = interval.match(/\[([+-]?[\d.]+)pp,\s*([+-]?[\d.]+)pp\]/);
    assert(match, `Unrecognized CI: ${interval}`);
    const result = { label, items: Number(items), delta: Number.parseFloat(difference), lo: Number(match[1]), hi: Number(match[2]) };
    assert(result.lo <= result.delta && result.delta <= result.hi, `Point estimate outside CI: ${label}`);
    return result;
  });
}

// Figure 1: Natural population and intentionally balanced pilot have different estimands.
{
  const labels = [
    ["No conflict", "无冲突"], ["Complementary information", "互补信息"],
    ["Conflicting opinions and research outcomes", "观点或研究冲突"],
    ["Conflict due to outdated information", "信息过时"],
    ["Conflict due to misinformation", "错误信息"],
  ];
  const pilotMatch = conflicts.match(/"per_label":(\d+)/);
  assert(pilotMatch, "Pilot selection rule not recorded");
  const pilotPerLabel = Number(pilotMatch[1]);
  const pilotN = labels.length * pilotPerLabel;
  const x0 = 292, span = 560, max = 40;
  let body = title("CONFLICTS 类别分布：正式数据 vs 平衡 pilot", `正式数据 n=${audit.items} 题；pilot n=${pilotN} 题，每类 ${pilotPerLabel} 题`);
  for (const tick of [0, 10, 20, 30, 40]) {
    const x = x0 + span * tick / max;
    body += line(x, 105, x, 395) + text(x, 92, `${tick}%`, { anchor: "middle", size: 12, fill: C.muted });
  }
  labels.forEach(([key, label], i) => {
    const y = 116 + i * 57;
    const natural = 100 * audit.label_counts[key] / audit.items;
    const pilot = 100 * pilotPerLabel / pilotN;
    body += text(28, y + 21, label, { size: 14 });
    body += rect(x0, y + 2, span * natural / max, 16, C.blue);
    body += rect(x0, y + 24, span * pilot / max, 16, C.teal);
    body += text(x0 + span * natural / max + 7, y + 15, `${num(natural, 1)}%`, { size: 12, fill: C.muted });
    body += text(x0 + span * pilot / max + 7, y + 37, `${num(pilot, 1)}%`, { size: 12, fill: C.muted });
  });
  body += rect(294, 420, 14, 14, C.blue) + text(315, 432, "正式数据", { size: 13 });
  body += rect(420, 420, 14, 14, C.teal) + text(441, 432, "平衡 pilot", { size: 13 });
  body += text(28, 467, "平衡 pilot 的 accuracy 不能外推为正式分布上的 accuracy。", { size: 13, fill: C.muted });
  await save("okf-conflicts-label-distribution.svg", svg(960, 485, "CONFLICTS 正式数据与平衡 pilot 的类别分布", "458 题正式数据中五类分别为 35.2%、25.1%、25.1%、13.5%、1.1%；10 题平衡 pilot 每类 20%。", body));
}

// Figure 2: Different denominators are deliberately shown in separate rows.
{
  const docsUndated = audit.documents - audit.dated_documents;
  const itemAll = audit.items_with_all_dates;
  const itemSome = audit.items_with_any_date - itemAll;
  const itemNone = audit.items - audit.items_with_any_date;
  const x0 = 190, span = 650;
  let body = title("来源日期的缺失", "文档与题目采用不同分母；题目分组互斥");
  body += text(28, 137, `文档 n=${audit.documents.toLocaleString()}`, { size: 15 });
  body += rect(x0, 112, span * audit.dated_documents / audit.documents, 42, C.teal);
  body += rect(x0 + span * audit.dated_documents / audit.documents, 112, span * docsUndated / audit.documents, 42, C.gray);
  body += text(x0 + span * audit.dated_documents / audit.documents / 2, 138, `有日期 ${pct(audit.dated_documents, audit.documents)}`, { anchor: "middle", size: 14, fill: C.white, weight: 600 });
  body += text(x0 + span * (audit.dated_documents + docsUndated / 2) / audit.documents, 138, `无日期 ${pct(docsUndated, audit.documents)}`, { anchor: "middle", size: 14, fill: C.ink });
  body += text(28, 224, `题目 n=${audit.items}`, { size: 15 });
  let cursor = x0;
  for (const [n, label, color, foreground] of [
    [itemAll, "全部有日期", C.teal, C.white],
    [itemSome, "部分有日期", C.blue, C.white],
    [itemNone, "均无日期", C.gray, C.ink],
  ]) {
    const width = span * n / audit.items;
    body += rect(cursor, 199, width, 42, color);
    body += text(cursor + width / 2, 225, `${label} ${pct(n, audit.items)}`, { anchor: "middle", size: 13, fill: foreground, weight: 600 });
    cursor += width;
  }
  body += text(28, 292, `只有 ${itemAll} 题的所有输入文档均带日期；正式实验需要按日期可见性分层。`, { size: 13, fill: C.muted });
  await save("okf-conflicts-date-coverage.svg", svg(960, 310, "CONFLICTS 输入来源日期覆盖率", `4052 篇文档中 1959 篇有日期。458 题中 114 题全部有日期，176 题部分有日期，168 题均无日期。`, body));
}

// Figure 3: Mean and p95 are separate descriptive statistics, not a confidence interval.
{
  const arms = [
    ["v1_native", "v0.1 原生"], ["v1_rich", "v0.1 富 prose"],
    ["v2_native", "v0.2 结构化"], ["v2_ablated", "无 metadata"],
  ];
  const x0 = 224, span = 640, max = 30000;
  let body = title("四组输入长度并不相等", `CONFLICTS 全量 ${audit.items} 题；字符数，不是 tokenizer token 数`);
  for (const tick of [0, 10000, 20000, 30000]) {
    const x = x0 + span * tick / max;
    body += line(x, 107, x, 367) + text(x, 97, `${tick / 1000}k`, { anchor: "middle", size: 12, fill: C.muted });
  }
  arms.forEach(([key, label], i) => {
    const y = 123 + i * 62;
    const { mean, p95 } = audit.prompt_characters[key];
    const meanX = x0 + span * mean / max, p95X = x0 + span * p95 / max;
    body += text(28, y + 20, label, { size: 15 });
    body += rect(x0, y, meanX - x0, 31, key === "v2_native" ? C.teal : C.blue);
    body += text(meanX + 7, y + 22, `${num(mean / 1000, 1)}k`, { size: 13 });
    body += circle(p95X, y + 15.5, 6, C.orange);
    body += text(p95X + 9, y + 20, `p95 ${num(p95 / 1000, 1)}k`, { size: 12, fill: C.muted });
  });
  body += rect(253, 402, 14, 14, C.blue) + text(274, 414, "平均值（横条）", { size: 13 });
  body += circle(472, 409, 6, C.orange) + text(488, 414, "第 95 百分位（点）", { size: 13 });
  body += text(28, 458, "v0.2 结构化组平均比富 prose 对照长约 8.0%；正式实验应记录实际 token 与截断。", { size: 13, fill: C.muted });
  await save("okf-conflicts-prompt-length.svg", svg(960, 475, "CONFLICTS 四组 prompt 字符数", "v0.1 原生平均 17.1k 字符，富 prose 17.5k，v0.2 结构化 18.9k，无 metadata 15.6k；圆点表示各组第 95 百分位。", body));
}

function forestFigure({ rows, heading, subtitle, filename, min, max, ticks, note, description, margin = null }) {
  assert(rows.length === 3);
  assert(rows.every((row) => row.items === 10));
  const x0 = 303, x1 = 797, span = x1 - x0;
  const x = (v) => x0 + span * (v - min) / (max - min);
  let body = title(heading, subtitle);
  for (const tick of ticks) {
    body += line(x(tick), 118, x(tick), 348, tick === 0 ? C.ink : C.grid, tick === 0 ? 1.8 : 1);
    body += text(x(tick), 103, `${tick > 0 ? "+" : ""}${tick}`, { size: 12, anchor: "middle", fill: C.muted });
  }
  if (margin !== null) {
    body += line(x(margin), 118, x(margin), 348, C.red, 1.5, 'stroke-dasharray="5 4"');
    body += text(x(margin) - 5, 374, `非劣界值 ${margin}pp`, { size: 12, anchor: "end", fill: C.red });
  }
  rows.forEach((row, i) => {
    const y = 154 + i * 74;
    const label = row.label.replaceAll("v2_native", "v0.2 结构化").replaceAll("v1_rich", "富 prose").replaceAll("v2_ablated", "无 metadata").replaceAll("v1_native", "v0.1 原生");
    body += text(28, y + 5, label, { size: 14, weight: i === 0 ? 600 : 400 });
    body += line(x(row.lo), y, x(row.hi), y, i === 0 ? C.teal : C.blue, 3);
    body += line(x(row.lo), y - 9, x(row.lo), y + 9, i === 0 ? C.teal : C.blue, 2);
    body += line(x(row.hi), y - 9, x(row.hi), y + 9, i === 0 ? C.teal : C.blue, 2);
    body += circle(x(row.delta), y, 6, i === 0 ? C.teal : C.blue);
    const sign = (v) => `${v > 0 ? "+" : ""}${num(v, 1)}`;
    body += text(815, y + 5, `${sign(row.delta)}pp [${sign(row.lo)}, ${sign(row.hi)}]`, { size: 13 });
  });
  body += text(565, 374, "差值（百分点；右侧有利于 v0.2）", { anchor: "middle", size: 12, fill: C.muted });
  body += text(28, 426, note, { size: 13, fill: C.muted });
  return save(filename, svg(1060, 443, heading, description, body));
}

await forestFigure({
  rows: pairedRows(conflicts, "## Paired correctness contrasts"),
  heading: "CONFLICTS：配对正确率差值与 95% 区间",
  subtitle: "10 个独立 item，每 item 2 次生成；按 item 配对 bootstrap（描述性）",
  filename: "okf-conflicts-paired-effects.svg",
  min: -20, max: 45, ticks: [-20, -10, 0, 10, 20, 30, 40], margin: -5,
  note: "主比较的区间跨越 0 与 −5pp：既不能证明优效，也不能证明 5pp 非劣。",
  description: "v0.2 结构化减富 prose：0pp，95% 区间负 15 到正 15pp。减无 metadata：正 15pp，区间 0 到正 40pp。减 v0.1 原生：正 10pp，区间 0 到正 25pp。",
});

await forestFigure({
  rows: pairedRows(alce, "## Paired QAMPARI F1@5 contrasts"),
  heading: "ALCE QAMPARI：配对 F1@5 差值与 95% 区间",
  subtitle: "10 个独立 item，每 item 仅 1 次生成；区间未包含生成与 prompt 变异",
  filename: "okf-alce-paired-effects.svg",
  min: -1, max: 5, ticks: [-1, 0, 1, 2, 3, 4, 5],
  note: "仅为答案级描述统计；官方 AutoAIS citation evaluator 尚未运行。",
  description: "v0.2 结构化减富 prose：正 1.5pp，描述性区间 0 到正 4.0pp。减无 metadata：正 1.1pp，区间 0 到正 3.3pp。减 v0.1 原生：正 0.4pp，区间 0 到正 1.3pp。",
});

console.log("Rendered five OKF report figures from locked local audit and pilot reports.");
