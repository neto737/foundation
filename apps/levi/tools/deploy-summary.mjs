import console from "node:console";
import { appendFileSync } from "node:fs";
import process from "node:process";

// Mesmo padrão de resumo em melhor esforço do Foundation, sem evidência D1.
try {
  const states = new Set(["success", "failure", "cancelled", "skipped"]);
  const status = states.has(process.env.SUMMARY_STATUS)
    ? process.env.SUMMARY_STATUS
    : "indisponível";
  const sha = /^[a-f0-9]{40}$/.test(process.env.LEVI_DEPLOY_SHA ?? "")
    ? process.env.LEVI_DEPLOY_SHA
    : "indisponível";
  const steps = JSON.parse(process.env.SUMMARY_STEPS ?? "{}");
  const rows = ["install", "build", "publish"].map((name) => {
    const result = steps[name]?.conclusion;
    return `| ${name} | ${states.has(result) ? result : "não concluído"} |`;
  });
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Deploy DEV\n\nSHA: ${sha}\n\nJob: ${status}\n\n| Etapa | Resultado |\n| --- | --- |\n${rows.join("\n")}\n\nDetalhes sanitizados de versão, binding e smokes no log da etapa publish. Falha após upload pode ter deixado versão ativa; conferir antes de repetir.\n`,
    );
} catch {
  console.error("Resumo do deploy indisponível; consulte os logs sanitizados.");
}
