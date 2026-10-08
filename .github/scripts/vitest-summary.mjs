import { basename } from "node:path";
import { performance } from "node:perf_hooks";
import { GithubActionsReporter } from "vitest/node";
import { testSummary, writeSummary } from "./test-summary.mjs";

export default class VitestSummary extends GithubActionsReporter {
  constructor() {
    // Keep native failure annotations without a second, duplicate summary.
    super({ jobSummary: { enabled: false } });
  }

  onInit(ctx) {
    super.onInit(ctx);
    this.started = performance.now();
  }

  onTestRunEnd(modules, errors, reason) {
    super.onTestRunEnd(modules, errors);
    try {
      const counts = { Passed: 0, Failed: 0, Skipped: 0, Flaky: 0 };
      const failures = [];
      let pending = 0;
      for (const module of modules) {
        for (const test of module.children.allTests()) {
          const state = test.result().state;
          if (state === "passed") counts.Passed++;
          else if (state === "failed") {
            counts.Failed++;
            failures.push(test.fullName);
          } else if (state === "skipped") counts.Skipped++;
          else pending++;
          if (test.diagnostic()?.flaky) counts.Flaky++;
        }
      }
      const notes = ["Flaky é um subconjunto de Passed; Skipped inclui todo."];
      if (errors.length) notes.push(`❌ Erros não tratados: ${errors.length}.`);
      const failedModules = modules.filter(
        (module) => module.state() === "failed",
      );
      if (failedModules.length)
        notes.push(
          `❌ Arquivos com falha: ${failedModules.length}. Veja o diagnóstico nativo nos logs/annotations.`,
        );
      if (pending) notes.push(`Testes sem resultado final: ${pending}.`);
      if (reason !== "passed") notes.push(`Conclusão do Vitest: ${reason}.`);
      writeSummary(
        testSummary(
          `${process.env.GITHUB_TEST_SUITE || "Vitest"} · ${basename(this.ctx.config.root)}`,
          counts,
          performance.now() - this.started,
          { failures, notes },
        ),
      );
    } catch (error) {
      console.warn(`Vitest summary unavailable: ${error.message}`);
    }
  }
}
