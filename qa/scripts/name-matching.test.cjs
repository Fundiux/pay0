// Tolerant client/company name matching for purchase orders and invoices (owner request 2026-11-24).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};
const { coreName, matchOptionByName } = require("../../src/lib/nameMatching.ts");

let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };

const terra = "terra labor consulting group";
for (const spelling of [
  "TERRA LABOR CONSULTING GROUP SA DE CV",
  "TERRA LABOR CONSULTING GROUP S.A DE C.V",
  "Terra Labor Consulting Group, S.A. de C.V.",
  "TERRA  LABOR CONSULTING GROUP S A DE C V",
  "Terra Labor Consulting Group SA de CV.",
]) eq(coreName(spelling), terra, `legal form and punctuation ignored: ${spelling}`);
eq(coreName("CONSULTORÍA OMVENIX S. de R.L. de C.V."), "consultoria omvenix", "accents and S. de R.L. de C.V.");
eq(coreName("BALZAC SAPI DE CV"), "balzac", "SAPI de CV");
eq(coreName("Grupo SA Construcciones"), "grupo sa construcciones", "a legal form in the middle stays");

const clients = [
  { value: "c9", label: "TERRA LABOR CONSULTING GROUP S.A DE C.V" },
  { value: "c30", label: "TERRA LABOR SERVICIOS SA DE CV" },
  { value: "c4", label: "BALZAC SAPI DE CV" },
];
eq(matchOptionByName(clients, "TERRA LABOR CONSULTING GROUP SA DE CV")?.value, "c9", "the reported case matches C09");
eq(matchOptionByName(clients, "Balzac, S.A.P.I. de C.V.")?.value, "c4", "dotted SAPI matches");
eq(matchOptionByName(clients, "TERRA LABOR"), null, "two clients contain the name: no guess");
eq(matchOptionByName(clients, "Otro Cliente SA de CV"), null, "an unknown client is not matched");
eq(matchOptionByName(clients, "SA de CV"), null, "only a legal form never matches");
eq(matchOptionByName(clients, ""), null, "empty name");
eq(matchOptionByName([{ value: "x", label: "Terra Labor Consulting Group" }], "TERRA LABOR CONSULTING GROUP SA DE CV")?.value, "x", "client stored without legal form");

// Two active clients with the same name (Terra Labor C09 and its duplicate C26): the canonical one gets new work (owner rule 2026-11-10).
const dup = [
  { value: "c26", label: "TERRA LABOR CONSULTING GROUP SA DE CV", iqLinked: true, clientNumber: 26 },
  { value: "c9", label: "TERRA LABOR CONSULTING GROUP S.A DE C.V", iqLinked: true, clientNumber: 9 },
];
eq(matchOptionByName(dup, "TERRA LABOR CONSULTING GROUP SA DE CV")?.value, "c9", "same name: the lowest client number wins");
eq(matchOptionByName([{ ...dup[0], iqLinked: false }, dup[1]], "Terra Labor Consulting Group")?.value, "c9", "same name: the one linked in IQ wins");
eq(matchOptionByName([{ ...dup[0], iqLinked: true, clientNumber: 9 }, { ...dup[1], iqLinked: true, clientNumber: 9 }], "TERRA LABOR CONSULTING GROUP"), null, "no way to break the tie: nothing chosen");
eq(matchOptionByName([dup[0], { value: "c30", label: "TERRA LABOR CONSULTING GROUP SERVICIOS", iqLinked: true, clientNumber: 1 }], "TERRA LABOR CONSULTING"), null, "different companies that only share words are never resolved by number");

console.log(`name-matching: ${checks} checks passed`);
