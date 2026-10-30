const assert = require("node:assert/strict");
const { isConfirmedFacturamaCancellation } = require("../../functions/lib/modules/facturama/cancellationStatus.js");

assert.equal(isConfirmedFacturamaCancellation("canceled"), true);
for (const state of ["requested", "accepted", "expired", "rejected", ""]) {
  assert.equal(isConfirmedFacturamaCancellation(state), false, state);
}
console.log("FACTURAMA_CANCELLATION_STATUS_PASS");
