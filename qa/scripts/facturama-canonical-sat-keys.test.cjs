const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const root = resolve(__dirname, "../..");
const source = readFileSync(resolve(root, "src/canonicos/formatos/catalogos SAT/catalogs.db.bz2"));
const generated = require(resolve(root, "functions/lib/modules/facturama/canonicalSatKeys.generated.js"));
const keys = require(resolve(root, "functions/lib/modules/facturama/canonicalSatKeys.js"));
assert.equal(createHash("sha256").update(source).digest("hex"), generated.CANONICAL_SAT_SOURCE_SHA256);
assert.equal(keys.canonicalSatPairExists("72141003", "E48"), true);
assert.equal(keys.canonicalSatPairExists("72141702", "E48"), true);
assert.equal(keys.canonicalSatPairExists("00000000", "E48"), false);
assert.equal(keys.canonicalSatPairExists("72141702", "ZZZ"), false);
console.log("FACTURAMA_CANONICAL_SAT_KEYS_PASS");
