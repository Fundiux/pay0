const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  assertIqIdentityInvariant,
  selectIqOriginProfileReference,
} = require("../lib/modules/iq/originIdentity");

test("el perfil de origen A prevalece aunque el actor posterior sea A, B o superadmin", () => {
  const movement = {
    originActorUid: "operator-a",
    originIqProfileId: "profile-a",
  };

  for (const authorizedActorUid of ["operator-a", "operator-b", "superadmin"]) {
    const selected = selectIqOriginProfileReference({
      ...movement,
      authorizedActorUid,
      currentUserIqProfileId: "profile-b",
    });
    assert.deepEqual(selected, {
      profileId: "profile-a",
      reason: "PERSISTED_ORIGIN",
    });
  }
});

test("matriz A/B conserva A en todos los actores y momentos posteriores", () => {
  const cases = [
    ["A crea pago y A aplica", "operator-a"],
    ["A crea pago y superadmin aplica", "superadmin"],
    ["B concilia y superadmin aplica", "superadmin"],
    ["scheduler procesa", "scheduler"],
    ["REP se recupera despues", "rep-worker"],
    ["B procesa dispersion", "operator-b"],
    ["B opera cliente delegado", "operator-b"],
    ["superadmin interviene", "superadmin"],
    ["A cambio a perfil A2", "operator-a"],
    ["A fue desactivado", "scheduler"],
    ["acceso humano A fue revocado", "scheduler"],
  ];

  for (const [name, authorizedBy] of cases) {
    const selected = selectIqOriginProfileReference({
      originActorUid: "operator-a",
      originIqProfileId: "profile-a",
      authorizedBy,
      currentUserIqProfileId: "profile-b",
      scenario: name,
    });
    assert.equal(selected.profileId, "profile-a", name);
    assert.equal(selected.reason, "PERSISTED_ORIGIN", name);
  }
});

test("cambiar o revocar el acceso actual del creador no sustituye el perfil persistido", () => {
  const selected = selectIqOriginProfileReference({
    originActorUid: "operator-a",
    originIqProfileId: "profile-a",
    creatorActive: false,
    currentUserIqProfileId: "profile-b",
  });

  assert.equal(selected.profileId, "profile-a");
});

test("un legado con una sola evidencia conserva ese perfil", () => {
  assert.deepEqual(
    selectIqOriginProfileReference({ iqCredentialProfileId: "profile-a" }),
    { profileId: "profile-a", reason: "LEGACY_DISPERSION_EVIDENCE" },
  );
});

test("dos evidencias legacy iguales no son una contradiccion", () => {
  assert.deepEqual(
    selectIqOriginProfileReference({
      iqExecutionProfileId: "profile-a",
      iqDepositSync: { profileId: "profile-a" },
    }),
    { profileId: "profile-a", reason: "LEGACY_EXECUTION_EVIDENCE" },
  );
});

test("un unico iqLinksByProfile legacy es evidencia demostrable", () => {
  assert.deepEqual(
    selectIqOriginProfileReference({
      iqLinksByProfile: {
        "profile-a": { clientId: "client-iq-a" },
      },
    }),
    { profileId: "profile-a", reason: "LEGACY_CLIENT_LINK_EVIDENCE" },
  );
});

test("varios iqLinksByProfile legacy sin origen son ambiguos", () => {
  assert.throws(
    () => selectIqOriginProfileReference({
      iqLinksByProfile: {
        "profile-a": { clientId: "client-iq-a" },
        "profile-b": { clientId: "client-iq-b" },
      },
    }),
    /IDENTITY_ORIGIN_UNRESOLVED/,
  );
});

test("un legado sin evidencia queda sin resolver", () => {
  assert.throws(
    () => selectIqOriginProfileReference({ createdBy: "operator-a" }),
    /IDENTITY_ORIGIN_UNRESOLVED/,
  );
});

test("un legado con perfiles contradictorios queda sin resolver", () => {
  assert.throws(
    () => selectIqOriginProfileReference({
      iqExecutionProfileId: "profile-a",
      iqDepositSync: { profileId: "profile-b" },
    }),
    /IDENTITY_ORIGIN_UNRESOLVED/,
  );
});

test("el invariante impide sustituir A por B", () => {
  assert.doesNotThrow(() => assertIqIdentityInvariant({
    originIqProfileId: "profile-a",
    effectiveIqProfileId: "profile-a",
  }));
  assert.throws(
    () => assertIqIdentityInvariant({
      originIqProfileId: "profile-a",
      effectiveIqProfileId: "profile-b",
    }),
    /IQ_IDENTITY_PROFILE_SUBSTITUTION_BLOCKED/,
  );
});

test("el contrato propaga identidad por pagos, aplicaciones, REP, clientes y dispersiones", () => {
  const src = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");
  const payment = src("index.ts");
  const application = src("modules", "paymentApplications", "service.ts");
  const plan = src("modules", "paymentApplications", "iqPlan.ts");
  const execution = src("modules", "paymentApplications", "iqExecution.ts");
  const rep = src("modules", "paymentApplications", "complementAutomation.ts");
  const client = src("modules", "clients", "iqLinkCallable.ts");
  const dispersion = src("modules", "iq", "dispersionCreationCallables.ts");

  assert.match(payment, /buildIqOriginIdentityPatch\(iqOriginIdentity\)/);
  assert.match(application, /\.\.\.inheritedIqOrigin\(pago\)/);
  assert.match(plan, /\.\.\.inheritedIqOrigin\(pago, reservation\)/);
  assert.match(execution, /movement: plan/);
  assert.match(execution, /executionMode: cleanUpper\(plan\.iqExecutionDispatchOrigin\)/);
  assert.match(rep, /originIqProfileId: text\(app\.originIqProfileId \|\| profileId\)/);
  assert.match(client, /movement: client/);
  assert.match(client, /iqLinksByProfile/);
  assert.match(dispersion, /\{ \.\.\.leg, \.\.\.principal \}/);
  assert.match(dispersion, /effectiveIqProfileId:/);
});

test("un perfil IQ deshabilitado se bloquea y nunca cae al actor actual", () => {
  const canonical = fs.readFileSync(
    path.join(__dirname, "..", "src", "modules", "iq", "iqCanonicalAccess.ts"),
    "utf8",
  );
  const resolver = fs.readFileSync(
    path.join(__dirname, "..", "src", "modules", "iq", "originIdentity.ts"),
    "utf8",
  );
  assert.match(canonical, /profile\.active !== true/);
  assert.match(canonical, /profile\.hasPassword !== true/);
  const effectiveResolver = resolver.match(
    /export async function resolveEffectiveIqIdentity[\s\S]*?\r?\n}\r?\n\r?\nexport function assertIqIdentityInvariant/,
  )?.[0] || "";
  assert.match(effectiveResolver, /loadIqCanonicalProfileById/);
  assert.doesNotMatch(effectiveResolver, /loadIqCanonicalUserAccess/);
});

test("los documentos de negocio persisten referencias, no secretos", () => {
  const resolver = fs.readFileSync(
    path.join(__dirname, "..", "src", "modules", "iq", "originIdentity.ts"),
    "utf8",
  );
  const patchBody = resolver.match(/export function buildIqOriginIdentityPatch[\s\S]*?\r?\n}\r?\n/)?.[0] || "";
  assert.match(patchBody, /originIqProfileId/);
  assert.doesNotMatch(patchBody, /password|token|cookie|session/i);
});

test("los flujos sin IQ no convierten la identidad IQ en requisito universal", () => {
  const src = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");
  const payment = src("index.ts");
  const clients = src("modules", "clients", "callables.ts");
  const dispersion = src("modules", "iq", "dispersionCreationCallables.ts");

  assert.match(payment, /canRunIqAutomationForDispatch\(despachoSnap\.data\(\)\)[\s\S]*\? await captureIqOriginIdentity/);
  assert.match(clients, /!editingId && iqClientAutomationEnabled[\s\S]*\? await captureIqOriginIdentity/);
  assert.match(dispersion, /status:\s*"NON_IQ_CHANNEL"/);
  assert.match(dispersion, /continue;/);
});

test("clientes usan una capacidad IQ propia y no heredan permisos de pagos", () => {
  const canonical = fs.readFileSync(
    path.join(__dirname, "..", "src", "modules", "iq", "iqCanonicalAccess.ts"),
    "utf8",
  );
  const clients = fs.readFileSync(
    path.join(__dirname, "..", "src", "modules", "clients", "callables.ts"),
    "utf8",
  );
  assert.match(canonical, /moduleKey === "clients"/);
  assert.match(clients, /moduleKey: "clients"/);
});
