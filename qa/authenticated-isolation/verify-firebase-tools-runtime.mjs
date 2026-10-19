import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const globalRoot = execFileSync(npm, ["root", "-g"], {
  encoding: "utf8",
  shell: process.platform === "win32",
}).trim();
const roots = [globalRoot, process.env.APPDATA && join(process.env.APPDATA, "npm", "node_modules")].filter(Boolean);
const toolsRoot = roots.find((root) => existsSync(join(root, "firebase-tools", "package.json")));
if (!toolsRoot) throw new Error(`QA_FIREBASE_TOOLS_NOT_FOUND roots=${roots.join(",")}`);
const packagePath = join(toolsRoot, "firebase-tools", "package.json");
const runtimePath = join(toolsRoot, "firebase-tools", "lib", "emulator", "functionsEmulatorRuntime.js");
const firebaseTools = JSON.parse(readFileSync(packagePath, "utf8"));
const runtime = readFileSync(runtimePath, "utf8");

if (firebaseTools.version !== "15.3.1") {
  throw new Error(`QA_FIREBASE_TOOLS_VERSION_MISMATCH ${firebaseTools.version}`);
}
if (runtime.includes("initializeFunctionsConfigHelper")) {
  throw new Error("QA_FIREBASE_TOOLS_V7_INCOMPATIBLE_CONFIG_HELPER_PRESENT");
}

console.log(`QA_FIREBASE_TOOLS_V7_COMPAT_PASS version=${firebaseTools.version}`);
