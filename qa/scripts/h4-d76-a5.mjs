import assert from "node:assert/strict";
import fs from "node:fs";

const clients = fs.readFileSync("functions/src/modules/clients/callables.ts", "utf8");
const companies = fs.readFileSync("functions/src/modules/companies/callables.ts", "utf8");
const index = fs.readFileSync("functions/src/index.ts", "utf8");
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };
const expectGate = (source, module, action) => assert.match(source, new RegExp(`requiredModule\\s*:\\s*["']${module}["'][\\s\\S]*requiredAction\\s*:\\s*["']${action}["']`));

test("alta Cliente exige clientes.create", () => assert.match(clients, /requiredAction: editingId \? "edit" : "create"/));
test("edicion Cliente exige clientes.edit", () => assert.match(clients, /requiredAction: editingId \? "edit" : "create"/));
test("activar Cliente exige clientes.edit", () => expectGate(clients, "clientes", "edit"));
test("reparar folios Cliente exige clientes.edit", () => assert.ok((clients.match(/requiredModule: "clientes", requiredAction: "edit"/g) || []).length >= 2));
test("lista canonica Cliente exige clientes.view", () => expectGate(clients.slice(clients.indexOf("listClientsCanonical")), "clientes", "view"));
test("detalle canonico Cliente exige clientes.view", () => expectGate(clients.slice(clients.indexOf("getClientCanonical")), "clientes", "view"));
test("lista Empresa exige empresas.view", () => expectGate(companies.slice(companies.indexOf("listCompaniesCanonical")), "empresas", "view"));
test("crear Solicitud exige solicitudes.create", () => expectGate(index.slice(index.indexOf("export const createSolicitud")), "solicitudes", "create"));
test("cambiar o cancelar Solicitud exige solicitudes.cancel", () => expectGate(index.slice(index.indexOf("changeSolicitudStatusHandler")), "solicitudes", "cancel"));
test("crear Pago exige pagos.create", () => expectGate(index.slice(index.indexOf("export const createPago")), "pagos", "create"));
test("conciliar Pago exige pagos.conciliate", () => expectGate(index.slice(index.indexOf("export const changePagoStatus")), "pagos", "conciliate"));
test("todos los gates usan contrato canonico", () => {
  assert.match(clients, /import \{ assertAuthorized, getUserRole \}/);
  assert.match(companies, /import \{ assertAuthorized, getUserRole \}/);
  assert.match(index, /import \{ assertAuthorized, normalizeRole, getUserRole \}/);
});

console.log(`H4-D76-A5 QA: ${passed}/${passed} pruebas OK.`);
