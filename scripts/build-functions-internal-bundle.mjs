import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { copyCanonicalAssets } from "./copy-canonical-assets.mjs";
import { preserveModuleContext } from "./lib/functions-bundle-context.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const inside = (root, target) => target.startsWith(root + path.sep);
function assertNoLinks(root, target) {
  if (!inside(root, target)) throw Error("OUTPUT_SCOPE");
  for (let current = target; inside(root, current); current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error("OUTPUT_LINK");
  }
}
function files(root) {
  return fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en")).flatMap(entry => {
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw Error("INPUT_LINK");
    return entry.isDirectory() ? files(target) : [target];
  });
}
function withoutSourceMapComment(ts, code) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, code), edits = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia && scanner.getTokenText().startsWith("//# sourceMappingURL=")) edits.push([scanner.getTokenPos(), scanner.getTextPos()]);
  }
  for (const [start, end] of edits.reverse()) code = code.slice(0, start) + code.slice(end);
  return code;
}
export async function buildCandidate({ repositoryRoot = path.resolve(import.meta.dirname, ".."), output }) {
  const root = fs.realpathSync(repositoryRoot), functionsRoot = path.join(root, "functions"), privateRoot = path.join(root, ".firebase", "internal-bundle-candidates");
  const destination = path.resolve(root, output || ".firebase/internal-bundle-candidates/candidate");
  assertNoLinks(root, destination);
  if (!inside(privateRoot, destination) || fs.existsSync(destination)) throw Error("FRESH_PRIVATE_OUTPUT_REQUIRED");
  const ignored = spawnSync("git", ["-C", root, "check-ignore", "--quiet", destination + "/probe"], { windowsHide: true, stdio: "ignore" });
  if (ignored.status !== 0) throw Error("OUTPUT_NOT_IGNORED");
  const require = createRequire(path.join(functionsRoot, "package.json"));
  const pkg = JSON.parse(fs.readFileSync(path.join(functionsRoot, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(functionsRoot, "package-lock.json"), "utf8"));
  const esbuild = require("esbuild"), ts = require("typescript");
  if (pkg.devDependencies.esbuild !== "0.28.2" || lock.packages["node_modules/esbuild"]?.version !== "0.28.2" || esbuild.version !== "0.28.2") throw Error("ESBUILD_PIN");
  if (ts.version !== lock.packages["node_modules/typescript"]?.version) throw Error("TYPESCRIPT_LOCK_MISMATCH");
  fs.mkdirSync(destination, { recursive: true });
  const raw = path.join(destination, "raw"), artifact = path.join(destination, "artifact"), compiled = path.join(artifact, ".debug", "compiled"), lib = path.join(artifact, "lib");
  fs.mkdirSync(raw); fs.mkdirSync(compiled, { recursive: true }); fs.mkdirSync(lib);
  // Supervised local compilation has no candidate-specific deadline. This does
  // not alter either the discovery guard or the Firebase SDK discovery timeout.
  const compileStarted = performance.now();
  const compile = spawnSync(process.execPath, [require.resolve("typescript/lib/tsc.js"), "-p", path.join(functionsRoot, "tsconfig.json"), "--outDir", raw, "--sourceMap", "false"], { cwd: functionsRoot, windowsHide: true, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  const compileWallMs = Math.round(performance.now() - compileStarted);
  if (compile.status !== 0) throw Error("TSC_FAILED"); // Never print raw paths/provider data.
  const inputs = [], adjusted = [];
  for (const file of files(raw)) {
    const relative = path.relative(raw, file).replaceAll("\\", "/");
    if (!/\.(js|json)$/.test(relative)) throw Error("INPUT_EXTENSION");
    const target = path.join(compiled, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
    const bytes = fs.readFileSync(file); inputs.push({ file: relative, sha256: digest(bytes) });
    if (relative.endsWith(".js")) {
      const result = preserveModuleContext(ts, withoutSourceMapComment(ts, bytes.toString("utf8")), relative);
      fs.writeFileSync(target, result.code.replaceAll("\r\n", "\n")); if (result.adjusted) adjusted.push(relative);
    } else fs.writeFileSync(target, bytes);
  }
  const built = await esbuild.build({ absWorkingDir: compiled, entryPoints: ["index.js"], outfile: path.join(lib, "index.js"), bundle: true, packages: "external", platform: "node", format: "cjs", target: "node22", keepNames: true, minify: false, sourcemap: "external", sourcesContent: false, metafile: true, logLevel: "silent" });
  if (Object.keys(built.metafile.inputs).some(name => path.isAbsolute(name) || name.split(/[\\/]/).includes(".."))) throw Error("BUNDLE_INPUT_SCOPE");
  const map = JSON.parse(fs.readFileSync(path.join(lib, "index.js.map"), "utf8"));
  if (map.sourcesContent || map.sourceRoot || map.sources.some(name => path.isAbsolute(name) || !name.startsWith("../.debug/compiled/"))) throw Error("SOURCE_MAP_SCOPE");
  await copyCanonicalAssets({ repositoryRoot: root, functionsLibRoot: lib, includePublicBrand: false });
  fs.writeFileSync(path.join(artifact, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  const outputHashes = files(artifact).map(file => ({ file: path.relative(artifact, file).replaceAll("\\", "/"), sha256: digest(fs.readFileSync(file)) }));
  const report = { schema: "PAY0-INTERNAL-BUNDLE-CANDIDATE@1", candidateOnly: true, esbuild: esbuild.version, typescript: ts.version, inputs, adjusted, outputs: outputHashes };
  fs.writeFileSync(path.join(destination, "provenance.json"), JSON.stringify(report, null, 2) + "\n");
  return { artifact: path.relative(root, artifact).replaceAll("\\", "/"), compileWallMs, internalInputs: Object.keys(built.metafile.inputs).length, adjusted, bundleSha256: digest(fs.readFileSync(path.join(lib, "index.js"))), sourceMapSha256: digest(fs.readFileSync(path.join(lib, "index.js.map"))), mainUnchanged: true, normalBuildUnchanged: true, candidateOnly: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== "--output") throw Error("EXPLICIT_OUTPUT_REQUIRED");
    console.log(JSON.stringify(await buildCandidate({ output: args[1] })));
  } catch (error) {
    console.error(JSON.stringify({ result: "BUNDLE_CANDIDATE_FAILED", code: /^[A-Z_]+$/.test(error.message) ? error.message : "REDACTED" })); process.exitCode = 1;
  }
}
