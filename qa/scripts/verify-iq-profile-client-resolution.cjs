const assert = require("node:assert/strict");

const {
  resolveIqClientForInvoiceA53,
  resolveIqPartnerForInvoiceA53,
} = require("../../functions/lib/modules/iq/solicitudHttpCreateA53.js");

const partner = resolveIqPartnerForInvoiceA53(
  [{ id: 95, name: "RR" }],
  "ASOCIADO RR",
);
assert.equal(String(partner.id), "95");

const clients = [
  { id: 712, name: "LIMPIEZA PROFUNDA E INTEGRAL DAL" },
  { id: 900, name: "OTRO CLIENTE" },
];

const repaired = resolveIqClientForInvoiceA53(clients, {
  iqClientId: "8125",
  clientName: "LIMPIEZA PROFUNDA E INTEGRAL DAL",
});
assert.equal(String(repaired.row.id), "712");
assert.equal(repaired.strategy, "HTTP_CATALOG_STALE_ID_EXACT_NAME");

const canonical = resolveIqClientForInvoiceA53(clients, {
  iqClientId: "712",
  clientName: "LIMPIEZA PROFUNDA E INTEGRAL DAL",
});
assert.equal(String(canonical.row.id), "712");
assert.equal(canonical.strategy, "HTTP_CATALOG_PROFILE_ID");

assert.throws(
  () => resolveIqClientForInvoiceA53(
    [
      { id: 712, name: "LIMPIEZA PROFUNDA E INTEGRAL DAL" },
      { id: 713, name: "LIMPIEZA PROFUNDA E INTEGRAL DAL" },
    ],
    {
      iqClientId: "8125",
      clientName: "LIMPIEZA PROFUNDA E INTEGRAL DAL",
    },
  ),
  /IQ_CLIENT_NO_UNICO/,
);

console.log("PASS cliente IQ resuelto por perfil y fallback exacto unico.");
