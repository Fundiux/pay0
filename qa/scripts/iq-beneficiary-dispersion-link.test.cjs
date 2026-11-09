const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const { storedIqLink } = require("../../functions/lib/modules/beneficiaries/iqLinkDomain.js");
const { iqAccountKey } = require("../../functions/lib/modules/beneficiaries/iqCatalogDomain.js");
const { dispersionFailureReason, selectStoredIqBeneficiary } = require("../../functions/lib/modules/iq/dispersionFailureReason.js");

const clabe = "012180001234567897";
const method = (entry, extra = {}) => ({ clabe, iqLinksByCatalog: { "iq-group-rr": entry }, ...extra });
const linked = { status: "LINKED", key: iqAccountKey(clabe), iqBeneficiaryId: 900, iqAccountId: 5001 };

test("la dispersión solo usa un vínculo vigente, del mismo catálogo y de la misma cuenta", () => {
  assert.deepEqual(storedIqLink(method(linked), "RR"), { storedLink: { beneficiaryId: "900", accountId: "5001" } });
  assert.deepEqual(storedIqLink(method(linked), "BETELL 1"), { storedLink: { beneficiaryId: "900", accountId: "5001" } }, "BETELL comparte el catálogo de RR");
  assert.deepEqual(storedIqLink(method(linked), "PAY0"), {}, "otro catálogo no se mezcla");
  assert.deepEqual(storedIqLink(method(linked, { clabe: "012180009999999999" }), "RR"), {}, "si la cuenta cambió, el vínculo ya no vale");
  assert.deepEqual(storedIqLink(method({ ...linked, status: "REVIEW_REQUIRED" }), "RR"), {}, "en revisión no se usa");
  assert.deepEqual(storedIqLink(method({ ...linked, status: "NOT_FOUND", iqBeneficiaryId: undefined }), "RR"), {});
  assert.deepEqual(storedIqLink(method({ ...linked, iqAccountId: "abc" }), "RR"), {}, "ids no numéricos se descartan");
  assert.deepEqual(storedIqLink({ clabe }, "RR"), {}, "sin vínculo no hay pista");
  assert.deepEqual(storedIqLink(method(linked), "DESCONOCIDO"), {}, "perfil desconocido");
});

test("el id guardado solo elige entre lo que IQ devuelve ahora", () => {
  const rows = [{ id: 900, name: "Juan" }, { id: 901, name: "Juan" }];
  assert.equal(selectStoredIqBeneficiary(rows, "900", row => row.id), rows[0], "dos Juan iguales por nombre: el id guardado decide");
  assert.equal(selectStoredIqBeneficiary(rows, "999", row => row.id), null, "si IQ ya no lo devuelve, se resuelve por nombre");
  assert.equal(selectStoredIqBeneficiary([{ id: 900 }, { id: 900 }], "900", row => row.id), null, "dos filas con el mismo id no se adivinan");
  assert.equal(selectStoredIqBeneficiary(rows, undefined, row => row.id), null, "sin vínculo no hay pista");
});

test("beneficiario o cuenta inexistente en IQ tiene su razón propia", () => {
  assert.deepEqual(dispersionFailureReason(["IQ_BENEFICIARY_NOT_FOUND"]), { code: "BENEFICIARY_OR_ACCOUNT_MISSING_IN_IQ", message: "El beneficiario o la cuenta no existen en IQ." });
  assert.equal(dispersionFailureReason(["x", "IQ_BENEFICIARY_ACCOUNT_NOT_FOUND"])?.code, "BENEFICIARY_OR_ACCOUNT_MISSING_IN_IQ");
  assert.equal(dispersionFailureReason(["IQ_BENEFICIARY_AMBIGUOUS_EXACT"]), null, "ambiguo no es inexistente");
  assert.equal(dispersionFailureReason([]), null);
});

test("el flujo de dispersión conserva la verificación en vivo y usa el vínculo", () => {
  const core = fs.readFileSync("functions/src/modules/iq/dispersionHttpCreateCore.ts", "utf8");
  const callables = fs.readFileSync("functions/src/modules/iq/dispersionCreationCallables.ts", "utf8");
  assert.match(core, /selectStoredIqBeneficiary\(asRows\(beneficiaryPayload\.beneficiaries\), stored\?\.beneficiaryId, rowId\)/, "el id guardado se busca dentro de lo que IQ devuelve");
  assert.match(core, /const stored = verified \? undefined : input\.item\.storedLink;/, "el instrumento verificado de comisiones conserva su camino");
  assert.match(core, /resolveBeneficiaryAccount\(\s*asRows\(detailPayload\.beneficiary_accounts\)[\s\S]*?storedHit \? stored\?\.accountId : undefined/, "la cuenta sigue verificándose contra el destino");
  assert.match(callables, /\.\.\.storedIqLink\(method, access\.profileAlias\)/, "el tramo pasa el vínculo del perfil que envía");
  assert.match(callables, /iqCreationFailureReason:/, "se guarda la razón específica");
});
