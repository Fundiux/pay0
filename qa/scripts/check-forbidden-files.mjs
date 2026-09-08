import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const skipDirs = new Set(["node_modules", ".next", ".firebase", ".git", "audit"]);
const forbiddenNames = new Set(["serviceAccountKey.json", "firebase-adminsdk.json"]);
const forbiddenExts = new Set([".pem", ".p12", ".key"]);
const bad = [];

function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (!skipDirs.has(item.name)) walk(full);
      continue;
    }
    const ext = path.extname(item.name).toLowerCase();
    if (forbiddenNames.has(item.name) || forbiddenExts.has(ext) || item.name.endsWith(".zip")) {
      bad.push(path.relative(root, full));
    }
  }
}

walk(root);

if (bad.length) {
  console.error("Forbidden files found:");
  for (const file of bad) console.error("- " + file);
  process.exit(1);
}
console.log("Forbidden files: OK");