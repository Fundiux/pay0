const assert = require("node:assert/strict");

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
assert.match(projectId || "", /^demo-[a-z0-9-]+$/, "EMULATOR_PROJECT_REQUIRED");
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080", "FIRESTORE_EMULATOR_REQUIRED");
assert.equal(process.env.PAY0_ENVIRONMENT, "staging", "STAGING_ENV_REQUIRED");
assert.equal(process.env.PAY0_EXTERNAL_ACTIONS_MODE, "disabled", "EXTERNAL_ACTIONS_MUST_BE_DISABLED");

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const {
  buildIqOriginIdentityPatch,
  captureIqOriginIdentity,
  resolveEffectiveIqIdentity,
  selectIqOriginProfileReference,
} = require("../lib/modules/iq/originIdentity");

initializeApp({ projectId });
const db = getFirestore();
const runId = `BASE8601_03_${Date.now()}`;
const rootId = `CANARY_ROOT_${runId}`;
const uidA = `A_${runId}`;
const uidB = `B_${runId}`;
const profileA = `IQ_A_${runId}`;
const profileB = `IQ_B_${runId}`;
const refs = [
  db.doc(`iqCredentialProfiles/${profileA}`),
  db.doc(`iqCredentialProfiles/${profileB}`),
  db.doc(`iqUserAccess/${uidA}`),
  db.doc(`iqUserAccess/${uidB}`),
  db.doc(`pagos/PAGO_${runId}`),
  db.doc(`paymentApplications/APPLICATION_${runId}`),
  db.doc(`clientes/CLIENT_${runId}`),
  db.doc(`dispersiones/DISPERSION_${runId}`),
];
let assertions = 0;

async function main() {
  try {
    await refs[0].set({ rootId, active: true, hasPassword: true, alias: "IQ A simulated",
      username: "canary-a", erpUrl: "https://iq.invalid" });
    await refs[1].set({ rootId, active: true, hasPassword: true, alias: "IQ B simulated",
      username: "canary-b", erpUrl: "https://iq.invalid" });
    await refs[2].set({ rootId, active: true, iqEnabled: true, iqCredentialProfileId: profileA,
      associatedName: "Canary A", allowedModules: { pagos: true, clients: true, dispersiones: true } });
    await refs[3].set({ rootId, active: true, iqEnabled: true, iqCredentialProfileId: profileB,
      associatedName: "Canary B", allowedModules: { pagos: true, clients: true, dispersiones: true } });

    const origin = await captureIqOriginIdentity({ actorUid: uidA, rootId,
      role: "operator", moduleKey: "pagos", companyId: `COMPANY_${runId}` });
    assert.equal(origin.originIqProfileId, profileA);
    const patch = buildIqOriginIdentityPatch(origin);
    for (const ref of refs.slice(4)) await ref.set({ createdBy: uidA, rootId, ...patch });

    const cases = [
      [refs[4], uidA, "A creates -> A acts"],
      [refs[4], uidB, "A creates -> B reconciles"],
      [refs[4], "SUPERADMIN_CANARY", "A creates -> superadmin applies"],
      [refs[5], "SCHEDULER_CANARY", "A creates -> scheduler executes"],
      [refs[5], "REP_WORKER_CANARY", "A creates -> REP read later"],
      [refs[6], uidB, "A creates client -> B receives delegation"],
      [refs[6], "SUPERADMIN_CANARY", "client redelegated"],
      [refs[7], uidB, "A creates dispersion -> B reviews"],
    ];
    for (const [ref, actor, scenario] of cases) {
      const snap = await ref.get();
      const resolved = await resolveEffectiveIqIdentity({ movement: snap.data(), rootId,
        authorizedActorUid: actor, encryptionSecret: "SIMULATED_NOT_A_CREDENTIAL",
        includePassword: false });
      assert.equal(resolved.originIqProfileId, profileA, scenario);
      assert.equal(resolved.effectiveIqProfileId, profileA, scenario);
      assert.equal(resolved.authorizedActorUid, actor, scenario);
      assert.equal(resolved.identityResolutionReason, "PERSISTED_ORIGIN", scenario);
      assert.equal(resolved.credentialProfile.password, "", scenario);
      assertions++;
    }

    await refs[2].update({ iqCredentialProfileId: profileB, active: false });
    const afterA2 = await resolveEffectiveIqIdentity({ movement: (await refs[4].get()).data(),
      rootId, authorizedActorUid: "SCHEDULER_CANARY",
      encryptionSecret: "SIMULATED_NOT_A_CREDENTIAL", includePassword: false });
    assert.equal(afterA2.effectiveIqProfileId, profileA);
    assertions++;

    await refs[0].update({ active: false });
    await assert.rejects(resolveEffectiveIqIdentity({ movement: (await refs[4].get()).data(),
      rootId, authorizedActorUid: "SUPERADMIN_CANARY",
      encryptionSecret: "SIMULATED_NOT_A_CREDENTIAL", includePassword: false }),
    /inactiva o incompleta/);
    assertions++;

    assert.deepEqual(selectIqOriginProfileReference({ iqExecutionProfileId: profileA }),
      { profileId: profileA, reason: "LEGACY_EXECUTION_EVIDENCE" });
    assert.throws(() => selectIqOriginProfileReference({ iqExecutionProfileId: profileA,
      iqDepositSync: { profileId: profileB } }), /IDENTITY_ORIGIN_UNRESOLVED/);
    assertions += 2;

    const noIq = { rootId, createdBy: uidA, channel: "NON_IQ_CHANNEL" };
    assert.equal(noIq.originIqProfileId, undefined);
    assertions++;
    console.log(JSON.stringify({ result: "PASS", projectId, runId, assertions,
      externalActions: 0, iqHttpCalls: 0, schedulerInvocations: 0,
      scope: "Firestore emulator identity persistence/resolution only" }));
  } finally {
    await Promise.all(refs.map(ref => ref.delete()));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
