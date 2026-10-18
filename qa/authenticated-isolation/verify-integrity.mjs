import { execFileSync } from "node:child_process";
const base = "21e45105ccfeeb90c3f90f443884c4499547ebbf";
const protectedPaths = ["src", "functions", "firestore.rules", "storage.rules", "firebase.json", "firebase.emulator-tests.json"];
const names = execFileSync("git", ["diff", "--name-only", `${base}..HEAD`, "--", ...protectedPaths], { encoding: "utf8" }).trim();
if (names) throw new Error(`CANDIDATE_INTEGRITY_FAILED:${names.replace(/\r?\n/g, ",")}`);
for (const path of protectedPaths) {
  const expected = execFileSync("git", ["rev-parse", `${base}:${path}`], { encoding: "utf8" }).trim();
  const actual = execFileSync("git", ["rev-parse", `HEAD:${path}`], { encoding: "utf8" }).trim();
  if (actual !== expected) throw new Error(`CANDIDATE_TREE_MISMATCH:${path}`);
}
console.log("CANDIDATE_FUNCTIONAL_INTEGRITY_PASS");