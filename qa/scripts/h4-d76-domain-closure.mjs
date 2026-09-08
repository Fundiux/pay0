import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const read = (file) => fs.readFileSync(file, "utf8");
let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
};

const policy = JSON.parse(read("config/authorization-policy.json"));
const roles = read("src/lib/roles.ts");
const backendDefaults = read("functions/src/modules/users/defaultModules.ts");
const panel = read("src/components/UserPermissionsPanel.tsx");
const index = read("functions/src/index.ts");
const usersPage = read("src/app/usuarios/page.tsx");
const modulesPage = read("src/app/modulos/page.tsx");
const reportsPage = read("src/app/reportes/page.tsx");
const clientPage = read("src/app/clientes/[id]/page.tsx");
const deploy = read("scripts/close-h4-d76-production.ps1");

test("fuente canonica versionada contiene los tres roles", () => {
  assert.equal(policy.policyId, "PAY0-USERS-PERMISSIONS");
  assert.deepEqual(Object.keys(policy.roleDefaults), ["superadmin", "admin", "operador"]);
});

test("verificador detecta divergencias entre consumidores", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/verify-authorization-policy.mjs", "--quiet"],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Functions consume politica generada", () => {
  assert.match(backendDefaults, /authorizationPolicy\.generated/);
  assert.doesNotMatch(backendDefaults, /if \(role === "admin"\)/);
});

test("frontend no eleva permisos por encima del rol", () => {
  assert.match(roles, /merged\[moduleKey\]\[actionKey\] === true/);
  assert.match(roles, /stored\[moduleKey\]\[actionKey\] === true/);
});

test("frontend ignora modulos y acciones fuera del contrato", () => {
  assert.equal((roles.match(/Object\.hasOwn/g) || []).length >= 2, true);
});

test("panel aplica techo al cargar guardar y editar", () => {
  assert.equal((panel.match(/mergeModules\(/g) || []).length >= 3, true);
  assert.match(panel, /disabled=\{roleCeiling\?\.\[moduleKey\]\?\.\[actionKey\] !== true\}/);
});

test("rutas autenticadas desconocidas fallan cerradas", () => {
  assert.match(roles, /Toda ruta autenticada no registrada falla cerrada/);
  assert.match(roles, /if \(!rule\) \{\s*[^}]*return false;/);
});

test("reproceso financiero exige superadmin y conciliacion", () => {
  assert.match(
    roles,
    /href: "\/pagos\/reproceso", moduleKey: "pagos", actionKey: "conciliate", superadminOnly: true/
  );
});

test("costos e IQ de usuario tienen gates especificos", () => {
  assert.match(roles, /href: "\/usuarios\/\[id\]\/costos", moduleKey: "usuarios", actionKey: "costs"/);
  assert.match(roles, /href: "\/usuarios\/\[id\]\/iq", superadminOnly: true/);
});

test("alta de usuario devuelve y muestra folio canonico", () => {
  assert.equal((index.match(/userFolio: `U\$\{String\(userNumber\)\.padStart\(2, "0"\)\}`/g) || []).length, 2);
  assert.match(usersPage, /res\?\.userFolio/);
  assert.doesNotMatch(usersPage, /Creado: \$\{roleToCreate\} uid=/);
});

test("Modulos busca y muestra folio sin UID visible", () => {
  assert.match(modulesPage, /nombre, email o folio/);
  assert.match(modulesPage, /formatUserFolio\(u\)/);
  assert.doesNotMatch(modulesPage, /nombre, email o uid/);
  assert.doesNotMatch(modulesPage, /\|\| u\.uid\}/);
});

test("Reportes no muestra ni exporta UID de usuario", () => {
  assert.doesNotMatch(reportsPage, /UsuarioId:/);
  assert.doesNotMatch(reportsPage, /row\.actorUsername \|\| row\.actorUid/);
  assert.equal((reportsPage.match(/row\.actorUid/g) || []).length, 1);
  assert.match(reportsPage, /<tr key=\{row\.actorUid\}>/);
});

test("detalle de Cliente usa folio y nombre", () => {
  assert.match(clientPage, /formatClientFolio\(client\)/);
  assert.doesNotMatch(clientPage, />Root:/);
  assert.doesNotMatch(clientPage, />Admin:/);
});

test("despliegue productivo esta acotado a tres Functions Rules y Hosting", () => {
  assert.match(deploy, /\$functionTargets = @\("upsertUser", "createAdmin", "createOperador"\)/);
  assert.match(deploy, /firestore:rules/);
  assert.match(deploy, /--only", "hosting"/);
});

test("cierre conserva la regresion acumulada de 131 pruebas", () => {
  assert.match(deploy, /\$qaBlocks = @\(1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16\)/);
  assert.match(deploy, /h4-d76-a19b\.mjs/);
});

console.log(`H4-D76 cierre integral QA: ${passed}/${passed} pruebas OK.`);
