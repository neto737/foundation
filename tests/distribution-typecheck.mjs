import { createRequire } from "node:module";
import { join } from "node:path";

const [directory, file, profile, emit] = process.argv.slice(2);
// Resolve the compiler and its standard libraries from the isolated consumer.
const require = createRequire(join(directory, "package.json"));
const ts = require("typescript");
const profiles = {
  "node": { lib: ["lib.es2023.d.ts", "lib.dom.d.ts"], types: ["node"] },
  "workers": { lib: ["lib.es2023.d.ts"], types: [] },
  // A native Workers consumer of Drizzle must supply its runtime types.
  // This is an explicit supported-runtime control, NOT the pure upstream one.
  "workers-runtime": {
    lib: ["lib.es2023.d.ts"],
    types: ["@cloudflare/workers-types"],
  },
};
if (!Object.hasOwn(profiles, profile)) throw new Error("Unknown type profile");
const options = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  ...profiles[profile],
  strict: true,
  skipLibCheck: false,
  noEmit: emit !== "emit",
  outDir: join(directory, "dist"),
};
const host = ts.createCompilerHost(options);
host.getCurrentDirectory = () => directory;
const program = ts.createProgram([join(directory, file)], options, host);
const errors = ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
  file: diagnostic.file?.fileName,
  start: diagnostic.start,
  length: diagnostic.length,
  code: diagnostic.code,
  message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
}));
const source = program.getSourceFile(join(directory, file));
const checker = program.getTypeChecker();
let processEnvType;
for (const statement of source.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    if (declaration.name.getText() === "processEnv")
      processEnvType = checker.typeToString(
        checker.getTypeAtLocation(declaration),
      );
  }
}
if (emit === "emit" && program.emit().emitSkipped)
  throw new Error("Build emit skipped");
console.log(
  JSON.stringify({
    errors,
    processEnvType,
    sourceFiles: program.getSourceFiles().map((source) => source.fileName),
    compilerVersion: ts.version,
  }),
);
