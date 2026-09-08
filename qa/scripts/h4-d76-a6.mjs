import assert from "node:assert/strict";
import fs from "node:fs";
const read = (p) => fs.readFileSync(p, "utf8");
const ledger=read("functions/src/modules/ledger/callables.ts"),balances=read("functions/src/modules/balances/callables.ts"),beneficiaries=read("functions/src/modules/beneficiaries/callables.ts"),financing=read("functions/src/modules/financing/callables.ts"),docs=read("functions/src/modules/dispersionDocuments/service.ts");
let passed=0;const test=(n,f)=>{f();passed++;console.log(`PASS ${n}`)};const count=(s,r)=>(s.match(r)||[]).length;
test("estado de cuenta Cliente protegido",()=>assert.ok(count(ledger,/requiredAction: "estadoCuentaCliente"/g)>=4));
test("estado de cuenta Usuario protegido",()=>assert.equal(count(ledger,/requiredAction: "estadoCuentaUsuario"/g),2));
test("saldos globales protegidos",()=>assert.equal(count(ledger,/requiredAction: "saldos"/g),2));
test("saldo operativo exige dispersiones",()=>assert.match(ledger,/requiredAction: "dispersiones"/));
test("ajuste manual exige configuracion",()=>assert.match(balances,/requiredAction: "configuracion"/));
test("nueve mutaciones de beneficiarios protegidas",()=>assert.equal(count(beneficiaries,/requiredAction: "beneficiarios"/g),9));
test("adelanto exige permiso adelantos",()=>assert.match(financing,/requiredAction: "adelantos"/));
test("dispersion individual y masiva protegidas",()=>assert.ok(count(financing,/requiredAction: "dispersiones"/g)>=5));
test("incidentes y notas de dispersion protegidos",()=>{
 for(const name of ["requestClientDispersionIncident","resolveClientDispersionIncident","addClientDispersionNota"]){const part=financing.slice(financing.indexOf(`export const ${name}`));assert.match(part,/requiredAction: "dispersiones"/)}
});
test("documentos de dispersion respetan permiso efectivo",()=>{
 assert.match(docs,/getEffectiveUserModules/);assert.match(docs,/isCanonicalUserActive/);assert.doesNotMatch(docs,/role === "superadmin" \|\| role === "admin"/);
});
console.log(`H4-D76-A6 QA: ${passed}/${passed} pruebas OK.`);
