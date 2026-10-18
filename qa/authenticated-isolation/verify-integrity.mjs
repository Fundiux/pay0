import { execFileSync } from "node:child_process";
const base = "21e45105ccfeeb90c3f90f443884c4499547ebbf";
const protectedPaths = ["src", "functions", "firestore.rules", "storage.rules", "firebase.json", "firebase.emulator-tests.json"];
const changed = [
  execFileSync("git", ["diff", "--name-only", "--", ...protectedPaths], { encoding: "utf8" }),
  execFileSync("git", ["diff", "--cached", "--name-only", "--", ...protectedPaths], { encoding: "utf8" }),
].join("").trim();
if (changed) throw new Error(`CANDIDATE_WORKTREE_DIRTY:${changed.replace(/\r?\n/g, ",")}`);
for (const path of protectedPaths) {
  const expected = execFileSync("git", ["rev-parse", `${base}:${path}`], { encoding: "utf8" }).trim();
  const actual = execFileSync("git", ["rev-parse", `HEAD:${path}`], { encoding: "utf8" }).trim();
  if (actual !== expected) throw new Error(`CANDIDATE_TREE_MISMATCH:${path}`);
}
console.log("CANDIDATE_FUNCTIONAL_INTEGRITY_PASS");
