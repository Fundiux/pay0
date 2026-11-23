import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";
import { resolveFrontendBuildEnvironment, validateFrontendBuildEnvironment } from "../../scripts/frontend-build-env.mjs";

const { environment } = resolveFrontendBuildEnvironment();
await validateFrontendBuildEnvironment(environment);
const expected = environment.NEXT_PUBLIC_HUGO_VOICE_GATEWAY_URL;
// Next.js 16 Turbopack no longer writes app-build-manifest.json.
// Accept either the legacy App Router manifest or the actual page reference
// and emitted chunks from the current production bundler; never silently skip
// compiled-browser checks when a manifest is absent.
const manifestPath = ".next/app-build-manifest.json";
let assets;
let pageAsset;
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assets = [...new Set([...manifest.pages["/hugo/page"], ...manifest.pages["/layout"]])];
  pageAsset = assets.find(file => file.startsWith("static/chunks/app/hugo/page-"));
} else {
  const referencePath = ".next/server/app/hugo/page_client-reference-manifest.js";
  assert.ok(fs.existsSync(referencePath), "Next16 Hugo client reference manifest missing");
  const reference = fs.readFileSync(referencePath, "utf8");
  assert.ok(reference.includes('["/hugo/page"]'), "Hugo page not present in Next16 client reference manifest");
  const chunks = fs.readdirSync(".next/static/chunks", { recursive: true })
    .map(String).filter(name => name.endsWith(".js"))
    .map(name => path.posix.join("static/chunks", name.replaceAll("\\\\", "/")));
  assert.ok(chunks.length > 0, "No emitted browser JavaScript chunks");
  const matching = chunks.filter(file => {
    const source = fs.readFileSync(path.join(".next", file), "utf8");
    return source.includes(expected) && source.includes("new WebSocket(") &&
      source.includes("El gateway de voz");
  });
  assert.equal(matching.length, 1, "Hugo must have exactly one compiled canonical voice gateway chunk");
  [pageAsset] = matching;
  assets = chunks;
}
assert.ok(pageAsset, "No compiled Hugo page chunk in Next build");
const compiled = fs.readFileSync(path.join(".next", pageAsset), "utf8");
const tree = ts.createSourceFile(pageAsset, compiled, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const bindings = new Map();
const sockets = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    const values = bindings.get(node.name.text) || [];
    values.push(node.initializer);
    bindings.set(node.name.text, values);
  }
  if (ts.isNewExpression(node) && node.expression.getText(tree) === "WebSocket") sockets.push(node);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(sockets.length, 1, "Hugo debe tener una sola salida WebSocket");
function referencesExpectedGateway(expr, visited = new Set(), depth = 0) {
  if (!expr || depth > 8) return false;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text === expected;
  if (ts.isIdentifier(expr)) {
    const name = expr.text;
    if (visited.has(name)) return false;
    const next = new Set(visited);
    next.add(name);
    return (bindings.get(name) || []).some(initializer => referencesExpectedGateway(initializer, next, depth + 1));
  }
  let matched = false;
  ts.forEachChild(expr, node => { if (!matched) matched = referencesExpectedGateway(node, visited, depth + 1); });
  return matched;
}
const argument = sockets[0].arguments?.[0];
assert.ok(referencesExpectedGateway(argument),
  "WebSocket no usa el gateway canonico incorporado al build");
assert.ok(!compiled.includes("NEXT_PUBLIC_HUGO_VOICE_GATEWAY_URL"), "Gateway sigue sin resolverse durante build");
for (const asset of assets) {
  const text = fs.readFileSync(path.join(".next", asset), "utf8");
  assert.ok(!text.includes("createHugoRealtimeSession"), "Reaparecio el callable legacy en frontend");
  assert.ok(!text.includes("api.openai.com/v1/realtime"), "Reaparecio OpenAI Realtime directo en frontend");
}
const source = fs.readFileSync("src/components/hugo/HugoRealtimeVoice.tsx", "utf8");
const guard = source.indexOf("if (!gatewayUrl) throw new Error(");
const microphone = source.indexOf("() => navigator.mediaDevices.getUserMedia(");
assert.ok(guard >= 0 && microphone > guard, "Fuente sin fail-closed antes del microfono");
assert.ok(guard < source.indexOf("new WebSocket(gatewayUrl"), "Fuente sin fail-closed antes de conectar");
console.log(JSON.stringify({ ok: true, manifestAssets: assets.length, pageAsset, sha256: crypto.createHash("sha256").update(compiled).digest("hex"), canonicalGatewayEmbedded: true, webSocketRoutes: sockets.length, legacyAbsent: true, sourceFailsClosed: true, externalActions: 0 }));
