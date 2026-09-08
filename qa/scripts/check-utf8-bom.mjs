import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const skipDirs = new Set(["node_modules", ".next", ".firebase", ".git", "audit", "lib"]);
const exts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".css", ".html", ".rules"]);
const bad = [];

function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory()) {
      if (!skipDirs.has(item.name)) walk(path.join(dir, item.name));
      continue;
    }
    const file = path.join(dir, item.name);
    if (!exts.has(path.extname(file))) continue;
    const buf = fs.readFileSync(file);
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) bad.push(path.relative(root, file));
  }
}

walk(root);

if (bad.length) {
  console.error("UTF8 BOM found:");
  for (const file of bad) console.error("- " + file);
  process.exit(1);
}
console.log("UTF8 without BOM: OK");