import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const gateModule = require("../../functions/lib/modules/paymentApplications/iqBusinessGate.js");
const evaluate = gateModule.evaluateIqCompanyDespachoGate;
const execution = fs.readFileSync("functions/src/modules/paymentApplications/iqExecution.ts", "utf8");
const deposit = fs.readFileSync("functions/src/modules/iq/pagoDepositCallables.ts", "utf8");
const base = { rootId: "ROOT", despachoId: "D1", companyId: "E1", sourceLabel: "el pago" };

assert.equal(evaluate({ ...base, company: { rootId: "ROOT", despachoId: "D1" } }).ok, true, "1 despachoId valido");
assert.equal(evaluate({ ...base, company: { rootId: "ROOT", firmId: "D1" } }).ok, true, "2 firmId valido");
assert.equal(evaluate({ ...base, company: { rootId: "ROOT", despachoId: "D2" } }).code, "IQ_COMPANY_DESPACHO_MISMATCH", "3 otro despacho bloqueado");
assert.equal(evaluate({ ...base, company: { rootId: "ROOT" } }).code, "IQ_COMPANY_WITHOUT_DESPACHO", "4 sin despacho bloqueada");
assert.equal(evaluate({ ...base, company: { rootId: "OTHER", despachoId: "D1" } }).code, "IQ_COMPANY_OUT_OF_SCOPE", "5 otro root bloqueado");
assert.equal(evaluate({ ...base, despachoId: "", company: { rootId: "ROOT", despachoId: "D1" } }).code, "IQ_DESPACHO_REQUIRED", "6 operacion sin despacho bloqueada");

assert.ok(execution.includes('collection("companies")'), "7 rehidrata empresas canonicas");
assert.ok(execution.includes('collection("solicitudes")'), "8 rehidrata solicitudes canonicas");
assert.ok(execution.includes("if (!gate.ok)"), "9 resultado negativo se inspecciona");
assert.ok(execution.includes('throw new HttpsError("failed-precondition", `[${gate.code}] ${gate.message}`)'), "10 resultado negativo aborta");

const gateAt = execution.indexOf("const gateCompanyUsages");
const attemptAt = execution.indexOf("const attemptNumber =");
const browserAt = execution.indexOf("const browserResult = await runIqPaymentApplication");
assert.ok(gateAt >= 0 && attemptAt > gateAt && browserAt > attemptAt, "11 orden gate -> intento -> navegador");
assert.ok(deposit.includes("evaluateIqCompanyDespachoGate") && !deposit.includes("const companyDespachoId = cleanText(company.despachoId"), "12 deposito reutiliza gate canonico");

console.log("H4-D71-A9 QA determinista: 12/12 OK");