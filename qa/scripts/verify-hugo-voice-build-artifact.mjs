import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";
import { resolveFrontendBuildEnvironment, validateFrontendBuildEnvironment } from "../../scripts/frontend-build-env.mjs";

const { environment } = resolveFrontendBuildEnvironment();
await validateFrontendBuildEnvironment(environment);
const expected = environment.NEXT_PUBLIC_HUGO_VOICE_GATEWAY_URL;
const manifestPath = ".next/app-build-manifest.json";
if (!fs.existsSync(manifestPath)) {
  const files = fs.existsSync(".next") ? fs.readdirSync(".next", { recursive: true }).map(String) : [];
  const relevant = files.filter(name => /hugo|manifest|static[/\\\\]chunks|client-build/i.test(name));
  console.error("NEXT16_BUILD_ARTIFACT_DIAGNOSTIC", JSON.stringify({
    nextRoot: fs.existsSync(".next") ? fs.readdirSync(".next") : [],
    relevant: relevant.slice(0, 75),
    chunks: files.filter(name => /\\.js$/.test(name)).length,
  }));
  const chunksRoot = ".next/static/chunks";
  const chunkFiles = fs.existsSync(chunksRoot)
    ? fs.readdirSync(chunksRoot, { recursive: true }).map(String).filter(name => name.endsWith(".js"))
    : [];
  const matches = { gateway: [], socket: [], voice: [], legacy: [] };
  for (const file of chunkFiles) {
    const source = fs.readFileSync(path.join(chunksRoot, file), "utf8");
    if (source.includes(expected)) matches.gateway.push(file);
    if (source.includes("new WebSocket(")) matches.socket.push(file);
    if (source.includes("El gateway de voz") || source.includes("getUserMedia")) matches.voice.push(file);
    if (source.includes("api.openai.com/v1/realtime")) matches.legacy.push(file);
  }
  const refs = ".next/server/app/hugo/page_client-reference-manifest.js";
  console.error("NEXT16_VOICE_ARTIFACT_DIAGNOSTIC", JSON.stringify({
    totalChunks: chunkFiles.length, matches,
    referencePresent: fs.existsSync(refs),
    referenceSnippet: fs.existsSync(refs) ? fs.readFileSync(refs, "utf8").slice(0, 1800) : "",
  }));
  throw Error("The current Next.js output does not contain the historical app-build-manifest.json.");
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const assets = [...new Set([...manifest.pages["/hugo/page"], ...manifest.pages["/layout"]])];
const pageAsset = assets.find(file => file.startsWith("static/chunks/app/hugo/page-"));
assert.ok(pageAsset, "Manifest sin pagina Hugo");
const compiled = fs.readFileSync(path.join(".next", pageAsset), "utf8");
const tree = ts.createSourceFile(pageAsset, compiled, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const bindings = new Map();
const sockets = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isStringLiteral(node.initializer)) {
    const values = bindings.get(node.name.text) || new Set();
    values.add(node.initializer.text);
    bindings.set(node.name.text, values);
  }
  if (ts.isNewExpression(node) && node.expression.getText(tree) === "WebSocket") sockets.push(node);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(sockets.length, 1, "Hugo debe tener una sola salida WebSocket");
const argument = sockets[0].arguments?.[0];
const values = argument && ts.isStringLiteral(argument) ? new Set([argument.text]) : bindings.get(argument?.getText(tree));
assert.ok(values?.has(expected), "WebSocket no usa el gateway canonico incorporado al build");
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
