import { testSummary, writeSummary } from "./test-summary.mjs";

export default class PlaywrightSummary {
  onBegin(config, suite) {
    this.config = config;
    this.suite = suite;
    this.errors = 0;
  }

  onError() {
    this.errors = (this.errors || 0) + 1;
  }

  onEnd(result) {
    try {
      const counts = { Passed: 0, Failed: 0, Skipped: 0, Flaky: 0 };
      const failures = [];
      for (const test of this.suite?.allTests() || []) {
        switch (test.outcome()) {
          case "expected":
            counts.Passed++;
            break;
          case "unexpected":
            counts.Failed++;
            failures.push(test.titlePath().join(" › "));
            break;
          case "skipped":
            counts.Skipped++;
            break;
          case "flaky":
            counts.Flaky++;
            break;
        }
      }
      const shard = this.config?.shard;
      const notes = [
        "Passed = resultado esperado; Flaky é contado separadamente.",
      ];
      if (result.status !== "passed")
        notes.push(
          `❌ Conclusão do Playwright: ${result.status}. Veja as annotations e logs nativos.`,
        );
      if (!this.suite)
        notes.push(
          "Coleta indisponível; as contagens de testes não estão disponíveis.",
        );
      if (this.errors) notes.push(`❌ Erros fora de testes: ${this.errors}.`);
      writeSummary(
        testSummary(
          `Playwright${shard ? ` · shard ${shard.current}/${shard.total}` : ""}`,
          this.suite ? counts : {},
          result.duration,
          { failures, notes },
        ),
      );
    } catch (error) {
      console.warn(`Playwright summary unavailable: ${error.message}`);
    }
    // No status override: Playwright owns the gate, including retries/failures.
  }

  printsToStdio() {
    return false;
  }
}
