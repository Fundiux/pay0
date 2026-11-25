// Pure rule check: when is an account white (READY) for a dispersion sent by a given IQ profile?
const assert = require("node:assert/strict");
const { iqLinkReadiness } = require("../../functions/lib/modules/beneficiaries/iqLinkDomain.js");
const { iqAccountKey } = require("../../functions/lib/modules/beneficiaries/iqCatalogDomain.js");

const card = "5579070170517455";
const linked = { status: "LINKED", iqBeneficiaryId: "10", iqAccountId: "20", key: iqAccountKey(card), last4: "7455" };
let n = 0;
const check = (name, fn) => { fn(); n += 1; console.log("ok -", name); };

check("legacy VERIFIED with numeric ids is white (regex keeps its backslash)", () => {
  assert.equal(iqLinkReadiness({ iqLinkStatus: "VERIFIED", iqBeneficiaryId: "123", iqAccountId: "456" }, "PAY0"), "READY");
});
check("legacy VERIFIED without numeric ids is pending", () => {
  assert.equal(iqLinkReadiness({ iqLinkStatus: "VERIFIED", iqBeneficiaryId: "abc", iqAccountId: "456" }, "PAY0"), "PENDING");
  assert.equal(iqLinkReadiness({ iqLinkStatus: "VERIFIED" }, "PAY0"), "PENDING");
});
check("no link at all is pending", () => {
  assert.equal(iqLinkReadiness({}, "PAY0"), "PENDING");
  assert.equal(iqLinkReadiness({ iqLinksByCatalog: { "iq-group-pay0": { status: "NOT_FOUND" } } }, "PAY0", card), "PENDING");
});
check("a LINKED entry whose IQ name differs is pending", () => {
  assert.equal(iqLinkReadiness({ cardNumber: card, numeroTarjeta: card, iqLinksByCatalog: { "iq-group-pay0": { ...linked, nameDiffers: true } } }, "PAY0", card), "PENDING");
});
console.log(`iq-link-readiness: ${n} checks passed`);
