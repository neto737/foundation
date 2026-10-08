import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { duration } from "./test-summary.mjs";

const phases = ["expand", "backfill", "contract", "verify", "recover"];
const states = {
  "success": "Succeeded",
  "succeeded": "Succeeded",
  "failure": "Failed",
  "failed": "Failed",
  "cancelled": "Cancelled",
  "skipped": "Skipped",
  "applied": "Succeeded — executed",
  "already-applied": "Already applied",
  "ineligible": "Skipped — ineligible",
  "dirty": "Failed — dirty; effects uncertain",
};
const state = (value) =>
  Object.hasOwn(states, value) ? states[value] : "Unknown / interrupted";
const hash = (value, length) =>
  typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value)
    ? value
    : undefined;
const number = (value) =>
  /^[1-9]\d{0,19}$/.test(String(value)) ? String(value) : undefined;
const row = (label, value) => (value ? `| ${label} | ${value} |` : "");
const table = (rows) =>
  ["| Campo | Resultado |", "| :--- | :--- |", ...rows.filter(Boolean)].join(
    "\n",
  );

function identity(data) {
  const sha = hash(data.sha, 40);
  const run = number(data.runId);
  const attempt = number(data.attempt);
  const url = run
    ? `https://github.com/t00ls-dev/foundation/actions/runs/${run}${attempt ? `/attempts/${attempt}` : ""}`
    : undefined;
  return [
    row("Ambiente", "DEV"),
    row(
      "SHA",
      sha
        ? `[${sha.slice(0, 12)}](https://github.com/t00ls-dev/foundation/commit/${sha})`
        : undefined,
    ),
    row(
      "Run / tentativa",
      run ? `${run} / ${attempt ?? "indisponível"}` : undefined,
    ),
    row(
      "Evidências",
      url
        ? `[Steps e logs](${url}) · [Artifacts](${url}#artifacts)`
        : undefined,
    ),
  ];
}

function timing(data) {
  const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
  if (!pattern.test(data.startedAt) || !pattern.test(data.finishedAt))
    return "";
  const ms = Date.parse(data.finishedAt) - Date.parse(data.startedAt);
  return Number.isFinite(ms) && ms >= 0
    ? row("Duração da operação", duration(ms))
    : "";
}

// Only bounded identifiers and enumerated values reach Markdown. Never render
// arbitrary errors, actor, SQL, URLs, nested evidence or environment variables.
export function migrationSummary(
  report,
  { phase, jobStatus, runId, attempt } = {},
) {
  phase = phases.includes(phase) ? phase : "unknown";
  const valid =
    report?.format === 1 &&
    report.environment === "dev" &&
    report.phase === phase &&
    ["succeeded", "failed"].includes(report.result) &&
    Array.isArray(report.operations) &&
    report.operations.every(
      (op) =>
        op &&
        op.phase === phase &&
        ["applied", "already-applied", "ineligible", "dirty"].includes(
          op.result,
        ),
    );
  const data = valid ? report : {};
  const operations = valid ? report.operations : [];
  const count = (result) =>
    operations.filter((op) => op.result === result).length;
  let result = valid ? state(report.result) : "Unknown / interrupted";
  if (valid && report.result === "succeeded") {
    if (
      !operations.length &&
      ["expand", "backfill", "contract"].includes(phase)
    )
      result = "No operations required";
    else if (count("ineligible")) result = "Skipped — operations ineligible";
    else if (
      operations.length &&
      count("already-applied") === operations.length
    )
      result = "Already applied";
  }
  return [
    `## ${phase.toUpperCase()}`,
    "",
    table([
      ...identity({
        ...data,
        runId: data.runId ?? runId,
        attempt: data.attempt ?? attempt,
      }),
      row("Job até o resumo", jobStatus ? state(jobStatus) : undefined),
      row("Operação", result),
      timing(data),
      ...(valid && ["expand", "backfill", "contract"].includes(phase)
        ? [
            row("Consideradas (registradas)", String(operations.length)),
            row("Executadas nesta operação", String(count("applied"))),
            row("Já aplicadas", String(count("already-applied"))),
            row("Ignoradas / inelegíveis", String(count("ineligible"))),
            row("Falhas dirty registradas", String(count("dirty"))),
          ]
        : []),
    ]),
    "",
    valid
      ? "Contagens limitadas ao JSON: uma falha pode interromper a fase antes de registrar todas as migrations."
      : "⚠️ Evidência ausente, inválida ou incompleta. Consulte o resultado nativo e os logs do job.",
    operations.length
      ? `\n<details>\n<summary>Operações registradas</summary>\n\n${table(
          operations.slice(0, 50).map((op, index) => {
            const id = /^([0-9]{4})_[a-z0-9_]+\.sql$/.exec(op.migration)?.[1];
            return row(
              id ? `Migration ${id}` : `Operação ${index + 1}`,
              state(op.result),
            );
          }),
        )}\n\n${operations.length > 50 ? "Demais operações no JSON completo.\n\n" : ""}</details>\n`
      : "",
    hash(data.schemaDigest, 64)
      ? `\n<details>\n<summary>Digest do plano</summary>\n\n${data.schemaDigest.slice(0, 32)}<br>${data.schemaDigest.slice(32)}\n\n</details>\n`
      : "",
    phase === "recover" && data.recoveryResult === "already-reconciled"
      ? "Recuperação: **Already reconciled** — nenhuma nova execução ou reescrita de auditoria.\n"
      : "",
    phase === "recover" && data.recoveryResult === "reconciled"
      ? "Recuperação: **Reconciled** — consulte resolução e auditoria completas no JSON e no banco; não há contagem de SQL no relatório de recovery.\n"
      : "",
    "Resumo informativo; JSON completo nos logs e no artifact existente da fase.\n",
  ].join("\n");
}

export function deploySummary({
  phase,
  jobStatus,
  steps = {},
  runId,
  attempt,
  sha,
  schema,
}) {
  const ci = steps.ci?.outcome;
  const approvedSha =
    ci === "success" ? hash(steps.ci?.outputs?.sha, 40) : undefined;
  const validate = phase === "validate";
  return [
    `## ${validate ? "VALIDATE" : "DEPLOY / VERIFY"}`,
    "",
    table([
      ...identity({ runId, attempt, sha: validate ? approvedSha : sha }),
      row("Job até o resumo", state(jobStatus)),
      row("Identidade e autorização", state(ci)),
      row(
        "Evidência CI",
        ci === "success" ? "Validated — exact SHA / attempt" : "Not validated",
      ),
      ...(validate
        ? [row("Plano / artifacts de migrations", "Não avaliado neste job")]
        : [
            row("Schema read-only", state(steps.schema?.outcome)),
            row("Deploy", state(steps.publish?.outcome)),
            row("Saúde SHA / D1", state(steps.health?.outcome)),
            row(
              "SHA implantado",
              steps.publish?.outcome === "success" && hash(sha, 40)
                ? "SHA acima; saúde confirmada somente se Succeeded"
                : "Não comprovado",
            ),
          ]),
    ]),
    !validate &&
    schema?.format === 1 &&
    schema.phase === "verify" &&
    hash(schema.schemaDigest, 64)
      ? `\n<details>\n<summary>Digest do plano (schema read-only)</summary>\n\nDigest: ${schema.schemaDigest.slice(0, 32)}<br>${schema.schemaDigest.slice(32)}\n\nJSON completo de verify nos logs do step de schema; digest não comprova sucesso da verificação.\n\n</details>\n`
      : "",
    "\nResumo informativo do job até este step; o resultado nativo final é autoritativo. Não representa o sucesso das fases posteriores.\n",
  ].join("\n");
}

export function writeDeploySummary(
  render,
  { path = process.env.GITHUB_STEP_SUMMARY, warn = console.warn } = {},
) {
  if (!path) return;
  try {
    appendFileSync(path, render());
  } catch {
    // Do not leak filesystem paths, input data or exception messages.
    warn(
      "::warning::Deploy summary unavailable; inspect native job results and existing evidence.",
    );
  }
}

function readReport(phase) {
  try {
    return JSON.parse(
      readFileSync(
        join(process.env.RUNNER_TEMP, `migration-${phase}.json`),
        "utf8",
      ),
    );
  } catch {
    return undefined;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  writeDeploySummary(() => {
    const phase = process.env.SUMMARY_PHASE;
    const report = phases.includes(phase) ? readReport(phase) : undefined;
    if (phases.includes(phase))
      return migrationSummary(report, {
        phase,
        jobStatus: process.env.SUMMARY_STATUS,
        runId: process.env.GITHUB_RUN_ID,
        attempt: process.env.GITHUB_RUN_ATTEMPT,
      });
    const steps = JSON.parse(process.env.SUMMARY_STEPS ?? "{}");
    return deploySummary({
      phase,
      jobStatus: process.env.SUMMARY_STATUS,
      steps,
      runId: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
      sha: process.env.EXPECTED_SHA,
      schema: phase === "deploy" ? readReport("verify") : undefined,
    });
  });
}
