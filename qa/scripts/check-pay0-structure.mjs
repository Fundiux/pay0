import fs from "node:fs";

const required = [
  "package.json",
  "tsconfig.json",
  "firebase.json",
  "firestore.rules",
  "storage.rules",
  "src",
  "src/app",
  "src/components",
  "src/lib",
  "src/services",
  "functions",
  "functions/package.json",
  "functions/tsconfig.json",
  "functions/src",
  "functions/src/index.ts"
];

const missing = required.filter((p) => !fs.existsSync(p));

if (missing.length) {
  console.error("Missing PAY0 structure:");
  for (const item of missing) console.error("- " + item);
  process.exit(1);
}
console.log("PAY0 structure: OK");