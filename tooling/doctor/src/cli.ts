import { diagnoseProject, type DoctorReport } from "./index.js";

const VERSION = "0.1.0";
const HELP = `Usage: doctor [project-path] [options]

Check a Node and Cloudflare D1 project without exposing secret values.

Options:
  --required <NAME>  Required name in .dev.vars.example (repeatable)
  --json             Print the structured report as JSON
  -h, --help         Show this help
  -v, --version      Show the package version`;

interface CliIo {
  error(message: string): void;
  log(message: string): void;
}

function renderReport(report: DoctorReport): string {
  const lines = report.results.map((result) => {
    const location = result.path ? ` (${result.path})` : "";
    return `[${result.severity.toUpperCase()}] ${result.check}: ${result.message}${location}`;
  });
  lines.push(
    `Summary: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.info} info`,
  );
  return lines.join("\n");
}

export async function runCli(
  args: string[],
  io: CliIo = console,
): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    io.log(HELP);
    return 0;
  }
  if (args.includes("--version") || args.includes("-v")) {
    io.log(VERSION);
    return 0;
  }

  let projectPath = ".";
  let pathProvided = false;
  let json = false;
  const requiredVariables: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      json = true;
    } else if (argument === "--required") {
      const name = args[index + 1];
      if (!name || name.startsWith("-")) {
        io.error(`--required needs a variable name.\n\n${HELP}`);
        return 2;
      }
      requiredVariables.push(name);
      index += 1;
    } else if (argument?.startsWith("--required=")) {
      const name = argument.slice("--required=".length);
      if (!name) {
        io.error(`--required needs a variable name.\n\n${HELP}`);
        return 2;
      }
      requiredVariables.push(name);
    } else if (argument?.startsWith("-")) {
      io.error(`Unknown option: ${argument}\n\n${HELP}`);
      return 2;
    } else if (!pathProvided && argument !== undefined) {
      projectPath = argument;
      pathProvided = true;
    } else {
      io.error(`Only one project path may be provided.\n\n${HELP}`);
      return 2;
    }
  }

  if (requiredVariables.some((name) => !/^[A-Z_][A-Z0-9_]*$/.test(name))) {
    io.error(
      "Required variable names must use uppercase letters, numbers, and underscores.",
    );
    return 2;
  }

  const report = await diagnoseProject(projectPath, {
    ...(requiredVariables.length > 0 ? { requiredVariables } : {}),
  });
  io.log(json ? JSON.stringify(report, null, 2) : renderReport(report));
  return report.summary.errors > 0 ? 1 : 0;
}
