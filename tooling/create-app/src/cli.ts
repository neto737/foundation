#!/usr/bin/env node

import { PRESET, generateApp } from "./index.js";

const HELP = `Usage: create-app <target> [options]

Generate the approved basic D1 app preset without prompts.

Options:
  --preset basic-d1  Select the basic-d1 preset (the default)
  -h, --help         Show this help
  -v, --version      Show the package version`;

interface CliIo {
  error(message: string): void;
  log(message: string): void;
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
    io.log("0.1.0");
    return 0;
  }

  let target: string | undefined;
  let preset = PRESET;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--preset") {
      preset = args[index + 1] ?? "";
      index += 1;
    } else if (argument?.startsWith("--preset=")) {
      preset = argument.slice("--preset=".length);
    } else if (argument?.startsWith("-")) {
      io.error(`Unknown option: ${argument}\n\n${HELP}`);
      return 1;
    } else if (target === undefined && argument !== undefined) {
      target = argument;
    } else {
      io.error(`Only one target directory may be provided.\n\n${HELP}`);
      return 1;
    }
  }

  if (!target) {
    io.error(`A target directory is required.\n\n${HELP}`);
    return 1;
  }
  if (preset !== PRESET) {
    io.error(
      `Unknown preset: ${preset || "(missing)"}. Available preset: ${PRESET}.`,
    );
    return 1;
  }

  try {
    const result = await generateApp(target);
    io.log(`Created ${result.name} in ${result.target}`);
    io.log(`Next: cd ${target} && pnpm install`);
    return 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
