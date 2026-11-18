// SAT rule: a PPD invoice must carry FormaPago 99; PUE keeps its form (default 03).
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { satPaymentForm } = require(path.resolve(__dirname, "../../functions/lib/modules/facturama/paymentTerms.js"));
assert.equal(satPaymentForm("PPD", "03"), "99");
assert.equal(satPaymentForm("ppd", ""), "99");
assert.equal(satPaymentForm(" PPD ", "28"), "99");
assert.equal(satPaymentForm("PUE", "03"), "03");
assert.equal(satPaymentForm("PUE", "28"), "28");
assert.equal(satPaymentForm("PUE", ""), "03");
assert.equal(satPaymentForm(undefined, undefined), "03");
// Every CFDI payload builder must route PaymentForm through the rule.
const src = fs.readFileSync(path.resolve(__dirname, "../../functions/src/modules/facturama/sandboxCallables.ts"), "utf8");
assert.ok(src.includes("PaymentForm: satPaymentForm(invoice.paymentMethod, invoice.paymentForm)"), "issue payload must apply satPaymentForm");
assert.ok(!/PaymentForm: invoice\.paymentForm[,}]/.test(src), "issue payload must not send the raw form");
console.log("facturama-ppd-payment-form: 9 checks passed");
