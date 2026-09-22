import { readFileSync, writeFileSync } from "node:fs";
import { cases } from "./cases.mjs";
import { evaluate, compare } from "./framework.mjs";

const [command = "baseline", first, second] = process.argv.slice(2);
const read = file => JSON.parse(readFileSync(file, "utf8"));
if (command === "baseline") {
  const result = evaluate(cases, { "read-reconciles": { primary: false } });
  const output = JSON.stringify(result, null, 2);
  if (first) writeFileSync(first, output + "\n"); else console.log(output);
} else if (command === "evaluate" && first) {
  const result = evaluate(cases, read(first));
  if (second) writeFileSync(second, JSON.stringify(result, null, 2) + "\n"); else console.log(JSON.stringify(result, null, 2));
} else if (command === "compare" && first && second) {
  console.log(JSON.stringify(compare(read(first), read(second)), null, 2));
} else throw Error("Usage: node evals/hugo/run.mjs baseline [out] | evaluate observations.json [out] | compare before.json after.json");
