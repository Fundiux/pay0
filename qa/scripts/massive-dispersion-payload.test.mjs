import assert from "node:assert/strict";
import { parsePay0MassiveLayoutRows, toPay0MassiveDispersionItem } from "../../src/lib/pay0MassiveLayout.ts";

const rows = [
  { NOMBRE: "PRUEBA CLABE", MONTO: 20000, BANCO: "BBVA", CLABE: "012345678901234567" },
  { NOMBRE: "PRUEBA TARJETA", MONTO: 5400, BANCO: "BBVA", "NUMERO DE TARJETA": "1234567890123456" },
];
const parsed = parsePay0MassiveLayoutRows(rows, "DISPERSIONES", { methodTipo: "DEBITO" });
assert.equal(parsed.validRows.length, 2);

const payload = parsed.validRows.map(toPay0MassiveDispersionItem);
assert.deepEqual(payload.map((row) => row.destinationKind), ["CLABE", "TARJETA"]);
assert.equal(payload[0].clabe, "012345678901234567");
assert.equal(payload[0].numeroTarjeta, "");
assert.equal(payload[1].clabe, "");
assert.equal(payload[1].numeroTarjeta, "1234567890123456");
assert.equal(payload[1].amount, 5400);
assert.equal(payload[1].bankCode, "012");

console.log("PASS mixed CLABE/card dispersion payload preserves both destinations");
