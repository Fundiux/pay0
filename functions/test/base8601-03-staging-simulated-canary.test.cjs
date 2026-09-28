const assert = require("node:assert/strict");
const test = require("node:test");

const canonical = require("../lib/modules/iq/iqCanonicalAccess");
const {
  assertIqIdentityInvariant,
  resolveEffectiveIqIdentity,
  selectIqOriginProfileReference,
} = require("../lib/modules/iq/originIdentity");

const ROOT = "CANARY_BASE8601_03";
const PROFILE_A = "IQ_A_SIMULATED";
const PROFILE_B = "IQ_B_SIMULATED";

function movement(extra = {}) {
  return {
    originActorUid: "A",
    originRootId: ROOT,
    originIqProfileId: PROFILE_A,
    originIqContext: {
      profileAlias: "A simulated",
      associatedName: "Canary A",
      despachoId: "CANARY_DESPACHO",
      companyId: "CANARY_COMPANY",
    },
    ...extra,
  };
}

test("canario simulado: actor posterior no sustituye el perfil IQ de origen", async () => {
  const originalLoader = canonical.loadIqCanonicalProfileById;
  const reads = [];
  let externalActions = 0;
  canonical.loadIqCanonicalProfileById = async (input) => {
    reads.push({ profileId: input.profileId, rootId: input.rootId });
    assert.equal(input.profileId, PROFILE_A);
    assert.equal(input.rootId, ROOT);
    return {
      profileId: PROFILE_A,
      profileAlias: "A simulated",
      associatedName: "Canary A",
      username: "canary-a",
      active: true,
      hasPassword: false,
    };
  };

  try {
    const cases = [
      ["A crea pago y A aplica", "A"],
      ["A crea pago y B concilia", "B"],
      ["A crea pago y superadmin aplica", "SUPERADMIN_CANARY"],
      ["A crea pago y scheduler ejecuta", "SCHEDULER_CANARY"],
      ["A crea pago y REP se consulta despues", "REP_WORKER_CANARY"],
      ["A cambia a perfil A2", "A"],
      ["A desactivado", "SCHEDULER_CANARY"],
      ["A revocado", "SUPERADMIN_CANARY"],
      ["cliente delegado A a B", "B"],
      ["cliente delegado repetidamente", "SUPERADMIN_CANARY"],
      ["dispersion A revisada por B", "B"],
    ];
    for (const [scenario, authorizedActorUid] of cases) {
      const resolved = await resolveEffectiveIqIdentity({
        movement: movement({ scenario, currentUserIqProfileId: PROFILE_B }),
        rootId: ROOT,
        authorizedActorUid,
        encryptionSecret: "SIMULATED_NOT_A_CREDENTIAL",
        includePassword: false,
      });
      assert.equal(resolved.originIqProfileId, PROFILE_A, scenario);
      assert.equal(resolved.effectiveIqProfileId, PROFILE_A, scenario);
      assert.equal(resolved.authorizedActorUid, authorizedActorUid, scenario);
      assert.equal(resolved.identityResolutionReason, "PERSISTED_ORIGIN", scenario);
      assert.equal(resolved.originIqContext.companyId, "CANARY_COMPANY", scenario);
      assertIqIdentityInvariant(resolved);
    }
    assert.equal(reads.length, cases.length);
    assert.equal(externalActions, 0);
  } finally {
    canonical.loadIqCanonicalProfileById = originalLoader;
  }
});

test("canario simulado: perfil deshabilitado bloquea sin usar B", async () => {
  const originalLoader = canonical.loadIqCanonicalProfileById;
  const reads = [];
  canonical.loadIqCanonicalProfileById = async ({ profileId }) => {
    reads.push(profileId);
    throw Error("IQ_PROFILE_DISABLED");
  };
  try {
    await assert.rejects(
      resolveEffectiveIqIdentity({
        movement: movement({ currentUserIqProfileId: PROFILE_B }),
        rootId: ROOT,
        authorizedActorUid: "SUPERADMIN_CANARY",
        encryptionSecret: "SIMULATED_NOT_A_CREDENTIAL",
      }),
      /IQ_PROFILE_DISABLED/,
    );
    assert.deepEqual(reads, [PROFILE_A]);
  } finally {
    canonical.loadIqCanonicalProfileById = originalLoader;
  }
});

test("canario simulado: legado inequívoco conserva A y ambiguo falla cerrado", () => {
  assert.deepEqual(
    selectIqOriginProfileReference({ iqExecutionProfileId: PROFILE_A }),
    { profileId: PROFILE_A, reason: "LEGACY_EXECUTION_EVIDENCE" },
  );
  assert.throws(
    () => selectIqOriginProfileReference({
      iqExecutionProfileId: PROFILE_A,
      iqDepositSync: { profileId: PROFILE_B },
    }),
    /IDENTITY_ORIGIN_UNRESOLVED/,
  );
});
