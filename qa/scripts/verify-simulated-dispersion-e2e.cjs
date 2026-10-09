const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { decideUserAuthorization } = require("../../functions/lib/modules/users/authorization.js");
const { resolveDispersionDespachoIdForRole } = require("../../functions/lib/modules/financing/dispersionDispatchResolver.js");
const { decideIqDispersionExecutionAccess } = require("../../functions/lib/modules/iq/dispersionExecutionAccess.js");
const { assertDispersionDestination } = require("../../functions/lib/modules/iq/dispersionDestinationGuard.js");

const rootId = "rootA";
const clientId = "clientA";
const beneficiaryId = "beneficiaryA";
const methodId = "methodA";
const dispersionId = "dispersionA";
const dispatch = { id: "iqA", rootId, active: true, automationMode: "ERP", erpProvider: "IQ" };
const iqAccess = { rootId, active: true, iqEnabled: true, allowedModules: { dispersiones: true } };
const destination = {
  rootId,
  clientId,
  beneficiaryId,
  dispersionId,
  client: { rootId, clientId, active: true },
  beneficiary: { rootId, clientId, active: true },
  method: { rootId, clientId, beneficiaryId, methodId, active: true, destinationKind: "CLABE", clabe: "012000000000000001" },
  legs: [{ rootId, clientId, principalDispersionId: dispersionId, amount: 1250 }],
};

function profile(role, modules = undefined) {
  return { role, rootId, active: true, ...(modules ? { modules } : {}) };
}

async function runSimulatedFlow({ role, user = profile(role), delegation = { active: true }, despacho = dispatch, access = iqAccess, target = destination }) {
  const uid = `${role}A`;
  const auth = decideUserAuthorization({
    authenticatedUid: uid,
    user,
    requirement: { allowedRoles: ["superadmin", "admin", "operador"], module: "wallet", action: "dispersiones" },
  });
  if (!auth.allowed) throw new Error(`AUTH_${auth.reason}`);
  if (role !== "superadmin" && (delegation.active !== true || delegation.revokedAt)) throw new Error("CLIENT_DELEGATION_REVOKED");

  const despachoId = resolveDispersionDespachoIdForRole({ role, dispatches: [despacho], requestedDespachoId: despacho.id });
  const iqDecision = decideIqDispersionExecutionAccess({ uid, role, rootId, despacho, iqAccess: access });
  if (!iqDecision.allowed) throw new Error(iqDecision.code);
  assert.equal(despachoId, dispatch.id);

  assertDispersionDestination(target);

  const journal = new Map();
  journal.set(dispersionId, { status: "IQ_ENVIANDO", despachoId, methodId, beneficiaryId });
  const iqResponse = { outcome: "CREATED", iqId: "IQ-SIM-1001", postAccepted: true, externalActions: 0 };
  const receipt = Buffer.from(`COMPROBANTE SIMULADO ${iqResponse.iqId}`);
  const receiptSha256 = crypto.createHash("sha256").update(receipt).digest("hex");
  journal.set(dispersionId, {
    ...journal.get(dispersionId),
    status: "COMPLETADA",
    iqGenerationStatus: "IQ_GENERADA",
    iqId: iqResponse.iqId,
    comprobante: { storagePath: `simulated/${rootId}/${dispersionId}.pdf`, sha256: receiptSha256, size: receipt.length },
    persisted: true,
  });
  return { row: journal.get(dispersionId), iqResponse };
}

(async () => {
  for (const role of ["superadmin", "admin", "operador"]) {
    const result = await runSimulatedFlow({ role });
    assert.equal(result.row.status, "COMPLETADA");
    assert.equal(result.row.iqGenerationStatus, "IQ_GENERADA");
    assert.equal(result.row.persisted, true);
    assert.equal(result.iqResponse.externalActions, 0);
    assert.match(result.row.comprobante.sha256, /^[a-f0-9]{64}$/);
  }

  await assert.rejects(runSimulatedFlow({ role: "admin", user: profile("admin", { wallet: { view: false, dispersiones: false } }) }), /AUTH_MODULE_NOT_ALLOWED/);
  await assert.rejects(runSimulatedFlow({ role: "operador", delegation: { active: true, revokedAt: new Date() } }), /CLIENT_DELEGATION_REVOKED/);
  await assert.rejects(runSimulatedFlow({ role: "admin", despacho: { ...dispatch, rootId: "rootB" } }), /DISPATCH_OUT_OF_ROOT/);
  await assert.rejects(runSimulatedFlow({ role: "admin", access: { ...iqAccess, active: false } }), /IQ_ACCESS_INACTIVE/);
  await assert.rejects(runSimulatedFlow({ role: "admin", despacho: { ...dispatch, active: false } }), /No hay un despacho IQ activo/);
  await assert.rejects(runSimulatedFlow({ role: "admin", target: { ...destination, beneficiary: { ...destination.beneficiary, rootId: "rootB" } } }), /fuera de alcance/);
  await assert.rejects(runSimulatedFlow({ role: "admin", target: { ...destination, method: { ...destination.method, rootId: "rootB" } } }), /fuera de alcance/);

  console.log(JSON.stringify({
    ok: true,
    authorizedRoles: ["superadmin", "admin", "operador"],
    terminalStatus: "COMPLETADA",
    iqStatus: "IQ_GENERADA",
    receiptPersisted: true,
    rejectionCases: 7,
    externalActions: 0,
  }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
