import ts from "typescript";
import { join } from "node:path";

const [directory, file, emit] = process.argv.slice(2);
const options = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
  types: ["node"],
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
  code: diagnostic.code,
  message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
}));
if (emit === "emit" && program.emit().emitSkipped)
  throw new Error("Build emit skipped");
console.log(JSON.stringify(errors));
