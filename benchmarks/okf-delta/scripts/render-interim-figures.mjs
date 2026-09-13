#!/usr/bin/env node

// Rebuild the static figures for docs/okf-v0.2-interim-results.md from the
// retained aggregate snapshot. No model calls are made.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const resultPath = path.join(project, "benchmarks/okf-delta/results/interim-aggregate-2026-09-13.json");
const figureDir = path.join(project, "docs/assets");
const result = JSON.parse(await readFile(resultPath, "utf8"));
await mkdir(figureDir, { recursive: true });

assert.equal(result.snapshot.paired_items * 2, result.snapshot.effective_calls);
assert.equal(Object.values(result.paired_outcomes).reduce((sum, n) => sum + n, 0), result.snapshot.paired_items);
assert.equal(result.arms.p.n, result.arms.s.n);
assert.equal(result.arms.p.correct, result.arms.s.correct);
assert.equal(result.labels.reduce((sum, label) => sum + label.interim_n, 0), result.snapshot.paired_items);
assert.equal(result.labels.reduce((sum, label) => sum + label.full_n, 0), result.snapshot.planned_items);

const C = {
  ink: "#17212b", muted: "#526171", grid: "#d9e0e6", pale: "#f4f7f8",
  teal: "#087f75", blue: "#497db3", orange: "#c16b27", gray: "#9ba8b2",
  white: "#ffffff", red: "#a54848",
};
const escapeXml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const text = (x, y, value, options = {}) => `<text x="${x}" y="${y}" fill="${options.fill ?? C.ink}" font-size="${options.size ?? 15}" font-weight="${options.weight ?? 400}" text-anchor="${options.anchor ?? "start"}">${escapeXml(value)}</text>`;
const rect = (x, y, width, height, fill, extra = "") => `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" ${extra}/>`;
const line = (x1, y1, x2, y2, stroke = C.grid, width = 1, extra = "") => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" ${extra}/>`;
const circle = (x, y, radius, fill) => `<circle cx="${x}" cy="${y}" r="${radius}" fill="${fill}"/>`;
const title = (label, subtitle) => text(28, 38, label, { size: 21, weight: 600 }) + text(28, 64, subtitle, { size: 13, fill: C.muted });
const svg = (width, height, name, description, body) => `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="figure-title figure-desc"><title id="figure-title">${escapeXml(name)}</title><desc id="figure-desc">${escapeXml(description)}</desc>${rect(0, 0, width, height, C.white)}<g font-family="-apple-system, BlinkMacSystemFont, 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif">${body}</g></svg>\n`;
const save = (name, content) => writeFile(path.join(figureDir, name), content, "utf8");
const pct = (value, digits = 1) => `${(100 * value).toFixed(digits)}%`;
const pp = (value) => `${value > 0 ? "+" : ""}${value.toFixed(1)}pp`;

// Figure 1: completion and paired outcome composition.
{
  const width = 960;
  const x0 = 170;
  const span = 650;
  const completion = result.snapshot.paired_items / result.snapshot.planned_items;
  let body = title("中期样本：完成度与配对结果", `有效配对 ${result.snapshot.paired_items}/${result.snapshot.planned_items}；${result.snapshot.effective_calls}/${result.snapshot.planned_calls} 次有效调用`);
  body += text(28, 124, "实验完成度", { size: 15, weight: 600 });
  body += rect(x0, 100, span, 34, C.pale);
  body += rect(x0, 100, span * completion, 34, C.teal);
  body += text(x0 + span * completion - 8, 123, `${result.snapshot.paired_items}（${pct(completion)}）`, { size: 13, weight: 600, anchor: "end", fill: C.white });
  body += text(x0 + span + 10, 123, `${result.snapshot.planned_items - result.snapshot.paired_items} 未运行`, { size: 13, fill: C.muted });

  const parts = [
    [result.paired_outcomes.both_correct, "双方正确", C.teal],
    [result.paired_outcomes.both_wrong, "双方错误", C.gray],
    [result.paired_outcomes.s_only_correct, "仅 S 正确", C.blue],
    [result.paired_outcomes.p_only_correct, "仅 P 正确", C.orange],
  ];
  body += text(28, 211, `${result.snapshot.paired_items} 个配对`, { size: 15, weight: 600 });
  let cursor = x0;
  for (const [count, , color] of parts) {
    const segment = span * count / result.snapshot.paired_items;
    body += rect(cursor, 184, segment, 40, color);
    if (segment >= 54) body += text(cursor + segment / 2, 210, String(count), { size: 13, weight: 600, anchor: "middle", fill: C.white });
    cursor += segment;
  }
  parts.forEach(([count, label, color], index) => {
    const x = 170 + (index % 2) * 300;
    const y = 273 + Math.floor(index / 2) * 42;
    body += rect(x, y - 14, 14, 14, color);
    body += text(x + 22, y, `${label}：${count}（${pct(count / result.snapshot.paired_items)}）`, { size: 13 });
  });
  body += text(28, 370, "S-only 与 P-only 均为 8；中期净差为 0，但预注册完成条件尚未满足。", { size: 13, fill: C.muted });
  await save(
    "okf-conflicts-interim-paired-outcomes.svg",
    svg(width, 394, "OKF 中期实验完成度与配对结果", "实验完成 223/458 个配对。126 个双方正确，81 个双方错误，8 个仅结构化 S 正确，8 个仅 prose P 正确。", body),
  );
}

// Figure 2: arm accuracy and the preregistered paired contrast.
{
  const width = 960;
  let body = title("中期效应：点估计相同，正式判定仍未完成", "点为估计值，横线为 95% 区间；S − P 使用预注册配对 bootstrap");
  const accX0 = 255;
  const accX1 = 815;
  const accScale = (value) => accX0 + (value - 0.45) / 0.30 * (accX1 - accX0);
  for (const tick of [0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75]) {
    const x = accScale(tick);
    body += line(x, 104, x, 225) + text(x, 94, pct(tick, 0), { size: 12, anchor: "middle", fill: C.muted });
  }
  const arms = [
    ["P：等价 prose", result.arms.p, C.orange, 138],
    ["S：结构化 OKF", result.arms.s, C.teal, 198],
  ];
  for (const [label, arm, color, y] of arms) {
    const [low, high] = arm.accuracy_wilson_95;
    body += text(28, y + 5, label, { size: 14 });
    body += line(accScale(low), y, accScale(high), y, color, 3);
    body += line(accScale(low), y - 8, accScale(low), y + 8, color, 2);
    body += line(accScale(high), y - 8, accScale(high), y + 8, color, 2);
    body += circle(accScale(arm.accuracy), y, 6, color);
    body += text(936, y + 5, `${pct(arm.accuracy)} [${pct(low)}, ${pct(high)}]`, { size: 12, anchor: "end" });
  }
  body += text(535, 247, "准确率（Wilson 95% 区间）", { size: 12, anchor: "middle", fill: C.muted });

  const deltaX0 = 255;
  const deltaX1 = 815;
  const deltaScale = (value) => deltaX0 + (value + 8) / 16 * (deltaX1 - deltaX0);
  for (const tick of [-8, -5, 0, 5, 8]) {
    const x = deltaScale(tick);
    const isMargin = tick === -5;
    body += line(x, 292, x, 382, isMargin ? C.red : tick === 0 ? C.ink : C.grid, tick === 0 ? 1.8 : 1, isMargin ? 'stroke-dasharray="5 4"' : "");
    body += text(x, 282, `${tick > 0 ? "+" : ""}${tick}pp`, { size: 12, anchor: "middle", fill: isMargin ? C.red : C.muted });
  }
  const [low, high] = result.descriptive_contrast.paired_bootstrap_95_pp;
  body += text(28, 342, "S − P 配对差值", { size: 14 });
  body += line(deltaScale(low), 337, deltaScale(high), 337, C.teal, 3);
  body += line(deltaScale(low), 329, deltaScale(low), 345, C.teal, 2);
  body += line(deltaScale(high), 329, deltaScale(high), 345, C.teal, 2);
  body += circle(deltaScale(result.descriptive_contrast.s_minus_p_accuracy_pp), 337, 6, C.teal);
  body += text(936, 342, `${pp(0)} [${pp(low)}, ${pp(high)}]`, { size: 12, anchor: "end" });
  body += text(535, 404, "准确率差值（右侧有利于 S；红线为 −5pp 非劣界值）", { size: 12, anchor: "middle", fill: C.muted });
  body += text(28, 444, "区间暂高于 −5pp，但只完成 48.7%，不能据此触发预注册 PASS。", { size: 13, fill: C.red });
  await save(
    "okf-conflicts-interim-effect.svg",
    svg(width, 468, "OKF 中期准确率与配对效应", "P 与 S 的准确率均为 60.1%，Wilson 95% 区间均为 53.5% 到 66.3%。S 减 P 为 0.0 个百分点，配对 bootstrap 95% 区间为负 3.6 到正 3.6 个百分点。正式实验未完成。", body),
  );
}

// Figure 3: per-label recall and uneven coverage of the stopped prefix.
{
  const translations = {
    "No conflict": "无冲突",
    "Complementary information": "互补信息",
    "Conflicting opinions and research outcomes": "观点/研究冲突",
    "Conflict due to outdated information": "信息过时",
    "Conflict due to misinformation": "错误信息",
  };
  const width = 960;
  const x0 = 260;
  const x1 = 790;
  const scale = (value) => x0 + value * (x1 - x0);
  let body = title("中期分类别召回率", "圆点为 P，菱形为 S；n 是当前配对数，括号内为完整语料类别数");
  for (const tick of [0, 0.25, 0.50, 0.75, 1]) {
    const x = scale(tick);
    body += line(x, 105, x, 397) + text(x, 94, pct(tick, 0), { size: 12, anchor: "middle", fill: C.muted });
  }
  result.labels.forEach((label, index) => {
    const pRecall = label.p_correct / label.interim_n;
    const sRecall = label.s_correct / label.interim_n;
    const px = scale(pRecall);
    const sx = scale(sRecall);
    const y = 132 + index * 56;
    body += text(28, y + 4, translations[label.name], { size: 14 });
    body += text(200, y + 4, `n=${label.interim_n} (${label.full_n})`, { size: 12, anchor: "end", fill: C.muted });
    body += line(px, y, sx, y, C.grid, 3);
    body += circle(px, y, 6, C.orange);
    body += `<polygon points="${sx},${y - 7} ${sx + 7},${y} ${sx},${y + 7} ${sx - 7},${y}" fill="${C.teal}"/>`;
    body += text(936, y + 4, `P ${pct(pRecall)} · S ${pct(sRecall)}`, { size: 12, anchor: "end" });
  });
  body += circle(287, 436, 6, C.orange) + text(301, 441, "P：等价 prose", { size: 13 });
  body += `<polygon points="470,429 477,436 470,443 463,436" fill="${C.teal}"/>` + text(485, 441, "S：结构化 OKF", { size: 13 });
  body += text(28, 482, "错误信息仅覆盖 2/5 题；观点/研究冲突仅覆盖 39/115 题，分类别结果不能外推。", { size: 13, fill: C.muted });
  await save(
    "okf-conflicts-interim-label-recall.svg",
    svg(width, 506, "OKF 中期分类别召回率", "在 223 个中期配对中，互补信息召回率 P 为 65.2%、S 为 68.2%；观点研究冲突均为 82.1%；无冲突为 48.8% 和 47.7%；信息过时为 56.7% 和 53.3%；错误信息均为 0%，但仅有两题。", body),
  );
}

console.log("Rendered three interim OKF figures from the retained aggregate snapshot.");
