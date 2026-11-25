const assert = require("node:assert/strict");
const admin = require("../../functions/node_modules/firebase-admin");
admin.initializeApp({ projectId: "demo-no-window" });
const m = require("../../functions/lib/modules/iq/solicitudInvoiceImportCallables.js");
let n = 0; const check = (name, fn) => { fn(); n++; };
check("recovered marker", () => { assert.equal(m.isRecoveredInvoiceMarker("IQ_IMPORT:12345"), true); });
check("own markers keep the window", () => {
  for (const v of ["", null, undefined, "PAY0:abc", "xIQ_IMPORT:1", "iq_import:1"]) assert.equal(m.isRecoveredInvoiceMarker(v), false);
});
console.log(`${n} checks passed`);
