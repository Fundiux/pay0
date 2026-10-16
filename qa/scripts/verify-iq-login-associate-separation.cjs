const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const associated = require(path.join(root, "functions/lib/modules/iq/associatedName.js"));

assert.equal(associated.normalizeIqAssociatedName("  RR  "), "RR");
assert.equal(associated.normalizeIqAssociatedName("RR"), "RR");
assert.equal(associated.normalizeIqAssociatedName(""), "");
assert.equal(associated.resolveIqAssociatedName, undefined);
assert.throws(
  () => associated.requireIqAssociatedName(""),
  /no tiene configurado el Asociado IQ/,
);

const callables = read("functions/src/modules/iq/callables.ts");
const canonical = read("functions/src/modules/iq/iqCanonicalAccess.ts");
const queue = read("functions/src/modules/iq/solicitudCreateQueueCallables.ts");
const manual = read("functions/src/modules/iq/solicitudCreationCallables.ts");
const clientLink = read("functions/src/modules/clients/iqLinkCallable.ts");
const ui = read("src/app/integraciones/iq/page.tsx");

assert.match(callables, /associatedName: String\(data\.associatedName \?\? ""\)/);
assert.match(callables, /patch\.associatedName = associatedName/);
assert.match(callables, /if \(password\)[\s\S]*Object\.assign\(patch, encrypted\)/);
assert.match(callables, /active: false,[\s\S]*updatedAt:/);
assert.doesNotMatch(callables, /active: false,[\s\S]{0,160}associatedName:/);

assert.match(canonical, /credentials: \{[\s\S]*username: input\.access\.username,[\s\S]*password: input\.access\.password/);
assert.match(canonical, /requireAssociatedName/);
assert.doesNotMatch(canonical, /associatedName:[^\n]*username/);

assert.match(queue, /associatedName: requireIqAssociatedName\(profile\.associatedName\)/);
assert.match(queue, /iqAssociatedName: input\.prepared\.associatedName/);
assert.match(queue, /associatedName: requireIqAssociatedName\(job\.associatedName\)/);
assert.match(manual, /associatedName = requireIqAssociatedName\(profile\.associatedName\)/);
assert.match(manual, /iqAssociatedName: associatedName/);
assert.match(clientLink, /const partner = exactPartner\(access\.associatedName\)/);
assert.doesNotMatch(clientLink, /exactPartner\(access\.associatedName\)\s*\|\|\s*exactPartner\(access\.profileAlias\)/);

assert.match(ui, />Asociado IQ</);
assert.match(ui, /profile\.associatedName \|\|/);
assert.match(ui, /password: editPassword\.trim\(\) \|\| undefined/);

console.log(JSON.stringify({
  ok: true,
  cases: 10,
  canonicalField: "associatedName",
  loginIdentity: "username + encrypted password",
  operationalIdentity: "associatedName",
  legacyFallbackToUsername: false,
  externalActions: 0,
}));
