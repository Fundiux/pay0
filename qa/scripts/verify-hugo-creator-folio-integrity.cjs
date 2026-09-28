const assert = require("node:assert/strict");
const fs = require("node:fs");
const { resolveUserReference, mexicoCityPeriodRange } = require("../../functions/lib/modules/agent007/platformReadConnector.js");

const users = [
  { id: "u-maria", displayName: "María López", values: ["u-maria", "María López", "MARIA", "maria@pay0.test"] },
  { id: "u-hugo", displayName: "Hugo Pérez", values: ["u-hugo", "Hugo Pérez", "HUGO", "hugo@pay0.test"] },
];

assert.deepEqual(resolveUserReference("MARIA", "u-hugo", users).ids, ["u-maria"], "A: el username canónico debe resolver a María");
assert.equal(resolveUserReference("usuario inexistente", "u-hugo", users).matchStatus, "NOT_FOUND", "B: usuario inexistente debe ser estructurado");
assert.equal(resolveUserReference("mi usuario", "u-hugo", users).matchStatus, "CURRENT_USER", "C: usuario actual debe conservar identidad");

const previousWeek = mexicoCityPeriodRange("PREVIOUS_WEEK", new Date("2026-09-28T18:00:00Z"));
assert.deepEqual(previousWeek, { fromMs: Date.parse("2026-09-21T06:00:00.000Z"), toMs: Date.parse("2026-09-28T06:00:00.000Z") }, "D: semana anterior usa lunes y America/Mexico_City");

const platform = fs.readFileSync("functions/src/modules/agent007/platformReadConnector.ts", "utf8");
const pay0 = fs.readFileSync("functions/src/modules/agent007/pay0Connector.ts", "utf8");
const voice = fs.readFileSync("functions/src/modules/agent007/voiceDelegation.ts", "utf8");
assert.match(platform, /String\(row\.createdBy \|\| ""\) === target\.id/, "E: creador se filtra por createdBy");
assert.match(platform, /where\("rootId", "==", this\.identity\.rootId\)/, "E: creador se intersecta con el root autorizado");
assert.match(pay0, /where\("folio", "==", paymentId\)/, "F: el folio operativo resuelve a ID interno");
assert.match(pay0, /where\("folioIq", "==", paymentId\)/, "F: el folio IQ también resuelve de forma exacta");
assert.match(voice, /No encontré .* creadas por .* con ese filtro/, "G: cero resultados no se atribuye a permisos");

console.log("PASS casos A-G de creador, rango temporal, folio y resultado vacío");
