"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("../../functions/node_modules/typescript");

const root = path.resolve(__dirname, "../..");
const files = [
  ["functions/src/modules/commissionDistributions/personalAccountCallables.ts", [
    ["createPersonalCommissionAccount", "ACCOUNT_KEY"],
    ["revealPersonalCommissionAccountNumber", "ACCOUNT_KEY"],
  ]],
  ["functions/src/modules/commissionDistributions/personalAccountIqCallables.ts", [
    ["resolvePersonalCommissionAccountIq", "ACCOUNT_KEY", "IQ_CREDENTIALS_KEY"],
  ]],
  ["functions/src/modules/commissionDistributions/execution.ts", [
    ["executeUserCommissionDispersion", "PERSONAL_COMMISSION_ACCOUNT_KEY", "USER_COMMISSION_IQ_SECRET"],
  ]],
  ["functions/src/modules/commissionDistributions/daily.ts", [
    ["runDailyUserCommissionPreflight", "PERSONAL_COMMISSION_ACCOUNT_KEY"],
    ["prepareDailyUserCommissions", "PERSONAL_COMMISSION_ACCOUNT_KEY"],
  ]],
  ["functions/src/modules/iq/dispersionCreationCallables.ts", [
    ["createClientDispersionIq", "PERSONAL_COMMISSION_ACCOUNT_KEY"],
    ["processIqDispersionCreate", "PERSONAL_COMMISSION_ACCOUNT_KEY"],
  ]],
  ["functions/src/modules/iq/dispersionCreateTrigger.ts", [
    ["sendNewDispersionToIq", "PERSONAL_COMMISSION_ACCOUNT_KEY"],
  ]],
];

for (const [relative, callables] of files) {
  const source = ts.createSourceFile(relative,
    fs.readFileSync(path.join(root, relative), "utf8"), ts.ScriptTarget.Latest, true);
  const exported = new Map();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) ||
      !statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) exported.set(declaration.name.text, declaration.initializer);
    }
  }
  for (const [name, ...required] of callables) {
    const initializer = exported.get(name);
    assert.ok(initializer && ts.isCallExpression(initializer),
      relative + ": missing callable " + name);
    const options = initializer.arguments[0];
    assert.ok(options && ts.isObjectLiteralExpression(options),
      relative + ": missing callable options for " + name);
    const secrets = options.properties.find(prop =>
      ts.isPropertyAssignment(prop) && prop.name.getText(source) === "secrets");
    assert.ok(secrets && ts.isPropertyAssignment(secrets) &&
      ts.isArrayLiteralExpression(secrets.initializer),
      relative + ": missing secrets declaration for " + name);
    const actual = secrets.initializer.elements.map(element => element.getText(source));
    for (const bound of required) {
      assert.ok(actual.includes(bound), relative + ": " + name + " must bind " + bound);
    }
  }
}

const source = fs.readFileSync(path.join(root,
  "functions/src/modules/commissionDistributions/privateBankInstrument.ts"), "utf8");
assert.match(source, /defineSecret\("COMMISSION_ACCOUNT_ENCRYPTION_KEY"\)/);
assert.match(source, /decryptCommissionInstrument/);
console.log("PASS commission encrypted instrument secret bindings: " +
  files.reduce((sum, entry) => sum + entry[1].length, 0) +
  " externally callable and scheduled IQ paths");
