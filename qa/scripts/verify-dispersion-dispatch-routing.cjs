const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  resolveDispersionDespachoIdForRole,
} = require("../../functions/lib/modules/financing/dispersionDispatchResolver.js");

const rows = [
  {
    id: "dispatch-iq",
    active: true,
    automationMode: "ERP",
    erpProvider: "IQ",
  },
  {
    id: "dispatch-other",
    active: true,
    automationMode: "UNCONFIGURED",
  },
];

for (const role of ["admin", "operador", "operator"]) {
  assert.equal(
    resolveDispersionDespachoIdForRole({
      role,
      requestedDespachoId: "dispatch-other",
      dispatches: rows,
    }),
    "dispatch-iq",
    `${role} debe usar automaticamente el unico despacho IQ activo.`,
  );
}

assert.equal(
  resolveDispersionDespachoIdForRole({
    role: "superadmin",
    requestedDespachoId: "dispatch-other",
    dispatches: rows,
  }),
  "dispatch-other",
  "Super Admin conserva la seleccion manual.",
);

assert.throws(
  () => resolveDispersionDespachoIdForRole({
    role: "admin",
    dispatches: [],
  }),
  /No hay un despacho IQ activo/,
);

assert.throws(
  () => resolveDispersionDespachoIdForRole({
    role: "operador",
    dispatches: [rows[0], { ...rows[0], id: "dispatch-iq-2" }],
  }),
  /mas de un despacho IQ activo/,
);

const pageSource = fs.readFileSync(
  path.join(__dirname, "../../src/app/wallet/dispersiones/page.tsx"),
  "utf8",
);
assert.match(pageSource, /if \(!isSuperadmin\) \{\s*setDespachos\(\[\]\);\s*return;/);
assert.match(pageSource, /\{isSuperadmin \? \(\s*<UiSelect[\s\S]*?value=\{despachoId\}/);
assert.match(pageSource, /\{isSuperadmin \? \(\s*<div>[\s\S]*?value=\{dispersionImportDespachoId\}/);
assert.match(pageSource, /if \(!isSuperadmin\) \{\s*return \[AUTO_IQ_DESPACHO\];/);

console.log("PASS dispersiones asignan IQ a usuarios y reservan selector para Super Admin.");
