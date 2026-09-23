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
assert.doesNotMatch(
  paymentCallablesSource,
  /"iqDepositSync\.(?:iqClientId|clientMatchStrategy)"\s*:/,
  "Los campos de iqDepositSync deben escribirse como mapa y no como claves literales con punto.",
);

console.log("PASS pagos IQ respetan cliente por credencial y reparan IDs obsoletos sin ambiguedad.");
