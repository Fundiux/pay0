const assert = require("node:assert/strict");
const { parseClientCsfText } = require("../../functions/lib/modules/clients/csfService.js");

const legalEntity = parseClientCsfText(`
GSE180904LG5
Registro Federal de Contribuyentes
GRUPO SELFUX
Nombre, denominación o razón
social
RFC: GSE180904LG5
Denominación/RazónSocial: GRUPOSELFUX
RégimenCapital: SOCIEDADANONIMADECAPITALVARIABLE
NombreComercial:
FechaInicio de operaciones: 04 DE SEPTIEMBRE DE 2018
Estatus en el padrón: ACTIVO
Código Postal: 66267
Regímenes: Régimen Simplificado de Confianza
Obligaciones:
`);

const individual = parseClientCsfText(`
CERA850820EV4
Registro Federal de Contribuyentes
ADRIANA CEBALLOS
RODRIGUEZ
Nombre, denominación o razón social
RFC: CERA850820EV4
CURP: CERA850820MNLBDR00
Nombre(s): ADRIANA
PrimerApellido: CEBALLOS
SegundoApellido: RODRIGUEZ
FechaInicio de operaciones: 30 DE MAYO DE 2024
Estatus en el padrón: ACTIVO
Código Postal: 64000
Regímenes: Régimen Simplificado de Confianza
Obligaciones:
`);

assert.equal(legalEntity.rfc, "GSE180904LG5");
assert.equal(legalEntity.razonSocial, "GRUPO SELFUX");
assert.equal(individual.rfc, "CERA850820EV4");
assert.equal(individual.razonSocial, "ADRIANA CEBALLOS RODRIGUEZ");

console.log("PASS parser CSF: conserva espacios y reconoce personas fisicas.");
