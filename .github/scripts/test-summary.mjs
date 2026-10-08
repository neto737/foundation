import { appendFileSync } from "node:fs";

export const escapeMarkdown = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]#|]/g, "\\$&")
    .replace(/[\r\n]+/g, " ");

export function duration(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function testSummary(
  title,
  counts,
  ms,
  { failures = [], notes = [] } = {},
) {
  return [
    `## ${escapeMarkdown(title)}`,
    counts.Failed > 0 ? "**❌ Há testes com falha.**" : "",
    "",
    "| Resultado | Testes |",
    "| :--- | ---: |",
    ...Object.entries(counts).map(([name, count]) => `| ${name} | ${count} |`),
    "",
    `Duração: **${duration(ms)}**.`,
    ...notes.map((note) => `\n${escapeMarkdown(note)}`),
    ...failures.slice(0, 5).map((name) => `\n- ❌ ${escapeMarkdown(name)}`),
    failures.length > 5 ? `\nMais ${failures.length - 5} falhas nos logs.` : "",
    "\n",
  ].join("\n");
}

// Reporting cannot change a test's result or exit code, even on filesystem errors.
export function writeSummary(markdown) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  } catch (error) {
    console.warn(`CI summary unavailable: ${error.message}`);
  }
}
