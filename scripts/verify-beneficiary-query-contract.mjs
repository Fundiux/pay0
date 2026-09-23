import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/services/beneficiaries.ts", import.meta.url), "utf8");
const watchers = source.slice(source.indexOf("export function watchClientBeneficiaries"));

assert.match(watchers, /collection\(db, "clientBeneficiaries"\)[\s\S]*where\("clientId", "==", clientId\)/);
assert.match(watchers, /collection\(db, "clientBeneficiaryMethods"\)[\s\S]*where\("clientId", "==", clientId\)/);
assert.doesNotMatch(watchers, /orderBy\("createdAt"/);
assert.equal((watchers.match(/sortBeneficiaryRowsNewestFirst\(rows\)/g) || []).length, 2);

console.log("Beneficiary query contract OK: no undeclared composite index is required.");
