const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  resolveStoredIqClientIdForProfile,
} = require("../../functions/lib/modules/iq/iqClientProfileLink.js");
const {
  resolveIqDepositClientCatalogRow,
} = require("../../functions/lib/modules/iq/iqDepositHttpCatalogResolver.js");

const rrAccess = {
  profileId: "profile-rr",
  profileAlias: "RR",
  associatedName: "ASOCIADO RR",
  username: "RR",
};

assert.equal(
  resolveStoredIqClientIdForProfile({
    iqLink: { clientId: "8125", partnerName: "ELIUT" },
    iqLinksByProfile: {
      "profile-rr": { clientId: "712", partnerName: "RR" },
    },
  }, rrAccess),
  "712",
  "El vinculo de la credencial activa debe prevalecer sobre el global legado.",
);

assert.equal(
  resolveStoredIqClientIdForProfile({
    iqLink: { clientId: "712", partnerName: "ASOCIADO RR" },
  }, rrAccess),
  "712",
  "Un vinculo legado solo se acepta cuando pertenece a la credencial activa.",
);

assert.equal(
  resolveStoredIqClientIdForProfile({
    iqLink: { clientId: "8125", partnerName: "ELIUT" },
  }, rrAccess),
  "",
  "Un vinculo legado de otra credencial no debe enviarse a IQ.",
);

const clients = [
  { id: 712, name: "LIMPIEZA PROFUNDA E INTEGRAL DAL" },
  { id: 900, name: "OTRO CLIENTE" },
];

const repaired = resolveIqDepositClientCatalogRow(clients, {
  iqClientId: "8125",
  clientName: "LIMPIEZA PROFUNDA E INTEGRAL DAL",
});
assert.equal(String(repaired.row.id), "712");
assert.equal(repaired.strategy, "HTTP_CATALOG_STALE_ID_EXACT_NAME");

const canonical = resolveIqDepositClientCatalogRow(clients, {
  iqClientId: "712",
  clientName: "LIMPIEZA PROFUNDA E INTEGRAL DAL",
});
assert.equal(String(canonical.row.id), "712");
assert.equal(canonical.strategy, "HTTP_CATALOG_PROFILE_ID");

const renamedInPay0 = resolveIqDepositClientCatalogRow(clients, {
  iqClientId: "712",
  clientName: "NOMBRE ANTERIOR EN PAY0",
});
assert.equal(String(renamedInPay0.row.id), "712");
assert.equal(renamedInPay0.strategy, "HTTP_CATALOG_PROFILE_ID");

assert.throws(() => resolveIqDepositClientCatalogRow([
  { id: 712, name: "CLIENTE A" },
  { id: 712, name: "CLIENTE B" },
], { iqClientId: "712", clientName: "CLIENTE A" }), /IQ_CATALOG_CLIENT_ID_AMBIGUOUS/);

assert.throws(
  () => resolveIqDepositClientCatalogRow([
    { id: 712, name: "LIMPIEZA PROFUNDA E INTEGRAL DAL" },
    { id: 713, name: "LIMPIEZA PROFUNDA E INTEGRAL DAL" },
  ], {
    iqClientId: "8125",
    clientName: "LIMPIEZA PROFUNDA E INTEGRAL DAL",
  }),
  /IQ_CATALOG_CLIENT_STALE_ID_NAME_NOT_UNIQUE/,
  "El fallback debe cerrarse ante nombres duplicados.",
);

const paymentCallablesSource = fs.readFileSync(
  path.join(__dirname, "../../functions/src/modules/iq/pagoDepositCallables.ts"),
  "utf8",
);
const applicationSource = fs.readFileSync(
  path.join(__dirname, "../../functions/src/modules/paymentApplications/iqExecution.ts"),
  "utf8",
);
assert.match(applicationSource, /resolveStoredIqClientIdForProfile\(clientSnap\.data\(\) \|\| \{\}, access\)/);
assert.match(applicationSource, /resolveIqDepositClientCatalogRow\(\s*catalogArray\(partnerCatalog\.client\)/);
assert.match(applicationSource, /clientMatchedByProfile = resolvedClient\.strategy === "HTTP_CATALOG_PROFILE_ID";/);
assert.equal(
  (applicationSource.match(/ok:\s*clientMatchedByProfile \|\|\s*normalizeName\(client\.name\) ===/g) || []).length,
  2,
  "La validacion CLIENTE acepta el cliente identificado por perfil IQ aunque el nombre difiera.",
);
assert.doesNotMatch(
  paymentCallablesSource,
  /"iqDepositSync\.(?:iqClientId|clientMatchStrategy)"\s*:/,
  "Los campos de iqDepositSync deben escribirse como mapa y no como claves literales con punto.",
);

console.log("PASS pagos IQ respetan cliente por credencial y reparan IDs obsoletos sin ambiguedad.");
