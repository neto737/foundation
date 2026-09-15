import { execFile } from "node:child_process";
import { access, readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_REQUIRED_VARIABLES = [
  "AUTH_SECRET",
  "BASE_URL",
  "EMAIL_FROM",
  "RESEND_API_KEY",
] as const;

export type Severity = "info" | "warning" | "error";
export type CheckName =
  | "project"
  | "node"
  | "manifest"
  | "wrangler"
  | "variables"
  | "migrations"
  | "secrets";

export interface DoctorResult {
  check: CheckName;
  severity: Severity;
  message: string;
  path?: string;
}

export interface DoctorReport {
  projectPath: string;
  results: DoctorResult[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
}

export interface DoctorOptions {
  nodeVersion?: string;
  requiredVariables?: readonly string[];
}

interface Manifest {
  engines?: { node?: unknown };
  name?: unknown;
  version?: unknown;
}

interface D1Database {
  binding?: unknown;
  migrations_dir?: unknown;
}

interface WranglerConfig {
  compatibility_date?: unknown;
  d1_databases?: unknown;
  env?: unknown;
  main?: unknown;
  name?: unknown;
}

function result(
  check: CheckName,
  severity: Severity,
  message: string,
  path?: string,
): DoctorResult {
  return { check, severity, message, ...(path ? { path } : {}) };
}

function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^(?:v)?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version.trim());
  if (!match?.[1]) return undefined;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compareVersions(
  left: [number, number, number],
  right: [number, number, number],
): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function comparatorMatches(
  version: [number, number, number],
  input: string,
): boolean {
  const comparator =
    /^(>=|<=|>|<|=|\^|~)?\s*v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(
      input,
    );
  if (!comparator?.[2]) return false;
  const operator = comparator[1] ?? "=";
  const wanted: [number, number, number] = [
    Number(comparator[2]),
    Number(comparator[3]?.match(/^\d+$/) ? comparator[3] : 0),
    Number(comparator[4]?.match(/^\d+$/) ? comparator[4] : 0),
  ];
  const comparison = compareVersions(version, wanted);

  if (operator === ">=") return comparison >= 0;
  if (operator === "<=") return comparison <= 0;
  if (operator === ">") return comparison > 0;
  if (operator === "<") return comparison < 0;
  if (operator === "^") {
    const upper: [number, number, number] = [wanted[0] + 1, 0, 0];
    return comparison >= 0 && compareVersions(version, upper) < 0;
  }
  if (operator === "~") {
    const upper: [number, number, number] = [wanted[0], wanted[1] + 1, 0];
    return comparison >= 0 && compareVersions(version, upper) < 0;
  }
  if (
    comparator[3] === "x" ||
    comparator[3] === "*" ||
    comparator[3] === undefined
  ) {
    return version[0] === wanted[0];
  }
  if (
    comparator[4] === "x" ||
    comparator[4] === "*" ||
    comparator[4] === undefined
  ) {
    return version[0] === wanted[0] && version[1] === wanted[1];
  }
  return comparison === 0;
}

function versionMatches(
  versionText: string,
  range: string,
): boolean | undefined {
  const version = parseVersion(versionText);
  if (!version) return undefined;
  let understood = false;
  for (const alternative of range.split("||")) {
    const comparators = alternative.trim().split(/\s+/).filter(Boolean);
    if (
      comparators.length === 0 ||
      comparators.some((item) => !/^[<>=^~v\d]/.test(item))
    ) {
      continue;
    }
    understood = true;
    if (comparators.every((item) => comparatorMatches(version, item)))
      return true;
  }
  return understood ? false : undefined;
}

function stripJsonComments(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
      output += character;
    } else if (character === "/" && next === "/") {
      while (index < input.length && input[index] !== "\n") index += 1;
      output += "\n";
    } else if (character === "/" && next === "*") {
      index += 2;
      while (
        index < input.length - 1 &&
        !(input[index] === "*" && input[index + 1] === "/")
      ) {
        if (input[index] === "\n") output += "\n";
        index += 1;
      }
      index += 1;
    } else {
      output += character;
    }
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}

function parseWranglerToml(input: string): WranglerConfig {
  const config: WranglerConfig = {};
  const databases: D1Database[] = [];
  let currentDatabase: D1Database | undefined;
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (/^\[\[(?:env\.[^.]+\.)?d1_databases\]\]$/.test(line)) {
      currentDatabase = {};
      databases.push(currentDatabase);
      continue;
    }
    if (/^\[/.test(line)) {
      currentDatabase = undefined;
      continue;
    }
    const assignment = /^(\w+)\s*=\s*"([^"]*)"/.exec(line);
    if (!assignment?.[1]) continue;
    if (currentDatabase)
      currentDatabase[assignment[1] as keyof D1Database] = assignment[2];
    else if (["name", "main", "compatibility_date"].includes(assignment[1])) {
      config[assignment[1] as "name"] = assignment[2];
    }
  }
  if (databases.length > 0) config.d1_databases = databases;
  return config;
}

async function existingWranglerPath(
  projectPath: string,
): Promise<string | undefined> {
  for (const name of ["wrangler.jsonc", "wrangler.json", "wrangler.toml"]) {
    try {
      await access(resolve(projectPath, name));
      return name;
    } catch {
      // Try the next supported configuration filename.
    }
  }
  return undefined;
}

function collectD1Databases(config: WranglerConfig): D1Database[] {
  const databases: D1Database[] = [];
  if (Array.isArray(config.d1_databases))
    databases.push(...(config.d1_databases as D1Database[]));
  if (config.env && typeof config.env === "object") {
    for (const environment of Object.values(config.env)) {
      if (environment && typeof environment === "object") {
        const envDatabases = (environment as WranglerConfig).d1_databases;
        if (Array.isArray(envDatabases))
          databases.push(...(envDatabases as D1Database[]));
      }
    }
  }
  return databases;
}

function safeRelative(
  projectPath: string,
  candidate: string,
): string | undefined {
  const path = relative(projectPath, candidate);
  if (
    path === "" ||
    path === ".." ||
    path.startsWith(`..${sep}`) ||
    isAbsolute(path)
  )
    return undefined;
  return path;
}

function isForbiddenSecretFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (/^\.dev\.vars(?:\..+)?$/.test(name))
    return !/\.(?:example|sample|template)$/.test(name);
  if (/^\.env(?:\..+)?$/.test(name))
    return !/\.(?:example|sample|template)$/.test(name);
  if (["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"].includes(name))
    return true;
  return /\.(?:key|p12|pfx)$/.test(name);
}

async function checkTrackedSecrets(
  projectPath: string,
): Promise<DoctorResult[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", projectPath, "ls-files", "-z", "--", "."],
      {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    const forbidden = stdout
      .split("\0")
      .filter(Boolean)
      .filter(isForbiddenSecretFile);
    if (forbidden.length === 0) {
      return [
        result(
          "secrets",
          "info",
          "No forbidden secret files are tracked by Git.",
        ),
      ];
    }
    return forbidden.map((path) =>
      result(
        "secrets",
        "error",
        "A forbidden secret file is tracked by Git; remove it from the index and rotate exposed credentials.",
        path,
      ),
    );
  } catch {
    return [
      result(
        "secrets",
        "warning",
        "Git tracking could not be inspected; committed secret files were not checked.",
      ),
    ];
  }
}

export async function diagnoseProject(
  path: string,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const requestedPath = resolve(path);
  const results: DoctorResult[] = [];
  let projectPath = requestedPath;

  try {
    const details = await stat(requestedPath);
    if (!details.isDirectory()) throw new Error("not-directory");
    projectPath = await realpath(requestedPath);
  } catch {
    results.push(
      result(
        "project",
        "error",
        "Project path does not exist or is not a directory.",
      ),
    );
    return makeReport(projectPath, results);
  }

  let manifest: Manifest | undefined;
  try {
    manifest = JSON.parse(
      await readFile(resolve(projectPath, "package.json"), "utf8"),
    ) as Manifest;
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
      throw new Error("invalid");
    const missing = [
      ...(typeof manifest.name === "string" && manifest.name ? [] : ["name"]),
      ...(typeof manifest.version === "string" && manifest.version
        ? []
        : ["version"]),
    ];
    results.push(
      missing.length > 0
        ? result(
            "manifest",
            "error",
            `package.json is missing valid fields: ${missing.join(", ")}.`,
            "package.json",
          )
        : result(
            "manifest",
            "info",
            "Package manifest is valid.",
            "package.json",
          ),
    );
  } catch {
    results.push(
      result(
        "manifest",
        "error",
        "package.json is missing or invalid JSON.",
        "package.json",
      ),
    );
  }

  const nodeRange = manifest?.engines?.node;
  if (typeof nodeRange !== "string" || !nodeRange.trim()) {
    results.push(
      result(
        "node",
        "warning",
        "package.json does not declare engines.node.",
        "package.json",
      ),
    );
  } else {
    const matches = versionMatches(
      options.nodeVersion ?? process.version,
      nodeRange,
    );
    results.push(
      matches === true
        ? result(
            "node",
            "info",
            "The current Node.js version satisfies engines.node.",
            "package.json",
          )
        : matches === false
          ? result(
              "node",
              "error",
              "The current Node.js version does not satisfy engines.node.",
              "package.json",
            )
          : result(
              "node",
              "warning",
              "engines.node uses an unsupported range syntax and could not be verified.",
              "package.json",
            ),
    );
  }

  let config: WranglerConfig | undefined;
  const wranglerPath = await existingWranglerPath(projectPath);
  if (!wranglerPath) {
    results.push(
      result(
        "wrangler",
        "error",
        "No wrangler.jsonc, wrangler.json, or wrangler.toml was found.",
      ),
    );
  } else {
    try {
      const contents = await readFile(
        resolve(projectPath, wranglerPath),
        "utf8",
      );
      config = wranglerPath.endsWith(".toml")
        ? parseWranglerToml(contents)
        : (JSON.parse(stripJsonComments(contents)) as WranglerConfig);
      if (!config || typeof config !== "object" || Array.isArray(config))
        throw new Error("invalid");
      const missing = ["name", "main", "compatibility_date"].filter(
        (key) => typeof config?.[key as keyof WranglerConfig] !== "string",
      );
      results.push(
        missing.length > 0
          ? result(
              "wrangler",
              "error",
              `Wrangler config is missing string fields: ${missing.join(", ")}.`,
              wranglerPath,
            )
          : result(
              "wrangler",
              "info",
              "Wrangler config is valid.",
              wranglerPath,
            ),
      );
    } catch {
      results.push(
        result(
          "wrangler",
          "error",
          "Wrangler config could not be parsed.",
          wranglerPath,
        ),
      );
    }
  }

  const requestedVariables =
    options.requiredVariables ?? DEFAULT_REQUIRED_VARIABLES;
  const requiredVariables = requestedVariables.filter((name) =>
    /^[A-Z_][A-Z0-9_]*$/.test(name),
  );
  if (requiredVariables.length !== requestedVariables.length) {
    results.push(
      result(
        "variables",
        "error",
        "One or more required variable names use an invalid format.",
      ),
    );
  }
  try {
    const contents = await readFile(
      resolve(projectPath, ".dev.vars.example"),
      "utf8",
    );
    const names = new Set<string>();
    for (const line of contents.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (match?.[1]) names.add(match[1]);
    }
    const missing = requiredVariables.filter((name) => !names.has(name));
    results.push(
      missing.length > 0
        ? result(
            "variables",
            "error",
            `Required variable names are missing: ${missing.join(", ")}.`,
            ".dev.vars.example",
          )
        : result(
            "variables",
            "info",
            `All ${requiredVariables.length} required variable names are documented.`,
            ".dev.vars.example",
          ),
    );
  } catch {
    results.push(
      result(
        "variables",
        "error",
        ".dev.vars.example is missing or unreadable.",
        ".dev.vars.example",
      ),
    );
  }

  const databases = config ? collectD1Databases(config) : [];
  if (databases.length === 0) {
    results.push(
      result(
        "migrations",
        "error",
        "Wrangler config has no D1 database bindings.",
      ),
    );
  } else {
    const directories = new Set<string>(
      databases.map((database) =>
        typeof database.migrations_dir === "string" && database.migrations_dir
          ? database.migrations_dir
          : "migrations",
      ),
    );
    for (const directory of directories) {
      const absoluteDirectory = resolve(projectPath, directory);
      const relativeDirectory = safeRelative(projectPath, absoluteDirectory);
      if (!relativeDirectory) {
        results.push(
          result(
            "migrations",
            "error",
            "A D1 migrations directory points outside the project.",
          ),
        );
        continue;
      }
      try {
        const files = (
          await readdir(absoluteDirectory, { withFileTypes: true })
        ).filter((entry) => entry.isFile() && entry.name.endsWith(".sql"));
        results.push(
          files.length > 0
            ? result(
                "migrations",
                "info",
                `${files.length} D1 migration file(s) found.`,
                relativeDirectory,
              )
            : result(
                "migrations",
                "error",
                "The D1 migrations directory contains no .sql files.",
                relativeDirectory,
              ),
        );
      } catch {
        results.push(
          result(
            "migrations",
            "error",
            "The configured D1 migrations directory is missing or unreadable.",
            relativeDirectory,
          ),
        );
      }
    }
  }

  results.push(...(await checkTrackedSecrets(projectPath)));
  return makeReport(projectPath, results);
}

function makeReport(
  projectPath: string,
  results: DoctorResult[],
): DoctorReport {
  return {
    projectPath,
    results,
    summary: {
      errors: results.filter(({ severity }) => severity === "error").length,
      warnings: results.filter(({ severity }) => severity === "warning").length,
      info: results.filter(({ severity }) => severity === "info").length,
    },
  };
}
