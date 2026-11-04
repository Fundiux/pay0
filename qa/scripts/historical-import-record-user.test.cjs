// Imported IQ rows must show the canonical PAY0 owner, never a guessed author.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const lib = path.resolve(__dirname, "..", "..", "functions/lib/modules/sharedCallables/recordCreators.js");
const { creatorDisplayFields } = require(lib);

const HISTORICAL = Object.freeze({
  source: "IQ_IMPORT", importRunId: "p4run_0123456789", importVersion: 1,
  originalIqEntityId: "176838", rootId: "root", adminId: "Ab4z0RttIqXbZFT0NuWsDjBkt6J2",
});
const labels = new Map([["admin-x", { uid: "admin-x", displayName: "Admin X", username: "adminx" }]]);

test("ELIUT group resolves to EBASOR for administrators", () => {
  const out = creatorDisplayFields({ ...HISTORICAL, canonicalIqGroupId: "iq-group-pay0", canonicalIqProfileId: "bEGPMuplqNHMZ3lvYkeb" }, labels, "superadmin");
  assert.equal(out.createdByDisplayName, "EBASOR");
  assert.equal(out.recordUserUid, "Ab4z0RttIqXbZFT0NuWsDjBkt6J2");
  assert.equal(out.iqUsername, "ELIUT");
});

test("RR group resolves to BETELL from the IQ username alone", () => {
  const out = creatorDisplayFields({ ...HISTORICAL, iqUsername: "RR" }, labels, "admin");
  assert.equal(out.createdByDisplayName, "BETELL");
  assert.equal(out.recordUserUid, "lcOz4nO5DTbksM3Lbz3hJcCpCdu1");
});

test("unknown IQ identity falls back to the row adminId label, never createdBy guesses", () => {
  const out = creatorDisplayFields({ ...HISTORICAL, adminId: "admin-x", createdByDisplayName: "Somebody" }, labels, "superadmin");
  assert.equal(out.createdByDisplayName, "Admin X");
  assert.equal(out.recordUserUid, "admin-x");
  const none = creatorDisplayFields({ ...HISTORICAL, adminId: "ghost" }, labels, "superadmin");
  assert.equal(none.createdByDisplayName, null);
});

test("operators receive no creator fields and ordinary rows are untouched", () => {
  assert.deepEqual(creatorDisplayFields({ ...HISTORICAL, iqUsername: "RR" }, labels, "operador"), {});
  const ordinary = creatorDisplayFields({ createdBy: "admin-x", rootId: "root" }, labels, "superadmin");
  assert.equal(ordinary.createdByDisplayName, "Admin X");
  assert.equal("recordUserUid" in ordinary, false);
});
