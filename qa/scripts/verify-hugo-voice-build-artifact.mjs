import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";
import { resolveFrontendBuildEnvironment, validateFrontendBuildEnvironment } from "../../scripts/frontend-build-env.mjs";

const { environment } = resolveFrontendBuildEnvironment();
await validateFrontendBuildEnvironment(environment);
const expected = environment.NEXT_PUBLIC_HUGO_VOICE_GATEWAY_URL;
const manifest = JSON.parse(fs.readFileSync(".next/app-build-manifest.json", "utf8"));
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
assert.ok(guard >= 0 && guard < source.indexOf("const stream = await navigator.mediaDevices.getUserMedia("), "Fuente sin fail-closed antes del microfono");
assert.ok(guard < source.indexOf("new WebSocket(gatewayUrl"), "Fuente sin fail-closed antes de conectar");
console.log(JSON.stringify({ ok: true, manifestAssets: assets.length, pageAsset, sha256: crypto.createHash("sha256").update(compiled).digest("hex"), canonicalGatewayEmbedded: true, webSocketRoutes: sockets.length, legacyAbsent: true, sourceFailsClosed: true, externalActions: 0 }));
