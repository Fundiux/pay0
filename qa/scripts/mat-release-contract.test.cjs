"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { verifyFiles } = require("./verify-mat-release-contract.cjs");

const root = mkdtempSync(join(tmpdir(), "pay0-mat-contract-"));
const file = join(root, "mat.txt");
try {
  writeFileSync(file, "version aprobada");
  const contract = {
    version: 1,
    files: [{ path: "mat.txt", sha256: createHash("sha256").update("version aprobada").digest("hex") }],
  };
  assert.deepEqual(verifyFiles(root, contract), []);
  writeFileSync(file, "version anterior");
  assert.deepEqual(verifyFiles(root, contract), ["Cambió mat.txt"]);
  unlinkSync(file);
  assert.deepEqual(verifyFiles(root, contract), ["Falta mat.txt"]);
  assert.match(verifyFiles(root, { ...contract, files: [{ ...contract.files[0], path: "../mat.txt" }] })[0], /fuera del proyecto/);
  console.log("MAT_RELEASE_CONTRACT_TEST_PASS approved, changed, missing, traversal");
} finally {
  try { unlinkSync(file); } catch { /* Already removed by the test. */ }
  rmdirSync(root);
}
