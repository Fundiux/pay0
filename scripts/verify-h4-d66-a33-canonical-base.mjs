import fs from "node:fs";
import crypto from "node:crypto";

const manifestPath = "docs/checkpoints/H4-D66-A33-CANONICAL-BASE.json";
const basePath =
  "functions/src/modules/paymentApplications/iqApplicationBaseFields.ts";
const browserPath =
  "functions/src/modules/paymentApplications/iqBrowser.ts";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function readText(path) {
  if (!fs.existsSync(path)) {
    fail(`Falta archivo: ${path}`);
  }

  return fs.readFileSync(path, "utf8");
}

function extractFunctionBlock(source, name) {
  const candidates = [
    `async function ${name}(`,
    `function ${name}(`,
    `const ${name} =`,
  ];

  let start = -1;

  for (const candidate of candidates) {
    start = source.indexOf(candidate);
    if (start >= 0) break;
  }

  if (start < 0) {
    fail(`No se encontro funcion protegida: ${name}`);
  }

  let braceDepth = 0;
  let opened = false;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1] || "";

    if (lineComment) {
      if (current === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (current === "\\") {
        escaped = true;
        continue;
      }

      if (current === quote) {
        quote = "";
      }
      continue;
    }

    if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (current === '"' || current === "'" || current === "`") {
      quote = current;
      continue;
    }

    if (current === "{") {
      braceDepth += 1;
      opened = true;
      continue;
    }

    if (current === "}") {
      braceDepth -= 1;

      if (opened && braceDepth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  fail(`No se pudo cerrar funcion protegida: ${name}`);
}

const manifest = JSON.parse(readText(manifestPath));
const baseSource = readText(basePath);
const browserSource = readText(browserPath);

const currentBaseHash = sha256(baseSource);

if (currentBaseHash.toLowerCase() !== String(manifest.canonicalBaseSha256 || "").toLowerCase()) {
  fail(
    [
      "BASE CANONICA MODIFICADA.",
      `Esperado: ${manifest.canonicalBaseSha256}`,
      `Actual:   ${currentBaseHash}`,
    ].join("\n"),
  );
}

const adapterStartMarker = "// A33_CANONICAL_BASE_ADAPTER_BEGIN";
const adapterEndMarker = "// A33_CANONICAL_BASE_ADAPTER_END";
const adapterStart = browserSource.indexOf(adapterStartMarker);
const adapterEnd = browserSource.indexOf(adapterEndMarker);

if (adapterStart < 0 || adapterEnd < 0 || adapterEnd <= adapterStart) {
  fail("Falta region adaptadora A33.");
}

const adapterRegion = browserSource.slice(
  adapterStart,
  adapterEnd + adapterEndMarker.length,
);

const currentAdapterHash = sha256(adapterRegion);

if (currentAdapterHash.toLowerCase() !== String(manifest.adapterSha256 || "").toLowerCase()) {
  fail(
    [
      "ADAPTER CANONICO MODIFICADO.",
      `Esperado: ${manifest.adapterSha256}`,
      `Actual:   ${currentAdapterHash}`,
    ].join("\n"),
  );
}

const protectedFunctions = manifest.protectedFunctions || {};

for (const [name, expectedHash] of Object.entries(protectedFunctions)) {
  const block = extractFunctionBlock(browserSource, name);
  const actualHash = sha256(block);

  if (actualHash.toLowerCase() !== String(expectedHash || "").toLowerCase()) {
    fail(
      [
        `FUNCION PROTEGIDA MODIFICADA: ${name}`,
        `Esperado: ${expectedHash}`,
        `Actual:   ${actualHash}`,
      ].join("\n"),
    );
  }
}

console.log("H4-D66-A33 CANONICAL BASE OK");
console.log(`Base:    ${currentBaseHash}`);
console.log(`Adapter: ${currentAdapterHash}`);

for (const [name, expectedHash] of Object.entries(protectedFunctions)) {
  console.log(`${name}: ${expectedHash}`);
}