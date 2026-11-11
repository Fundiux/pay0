const assert = require("node:assert/strict");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") || !/^demo-/.test(process.env.GCLOUD_PROJECT || "")) throw Error("ISOLATED_FIRESTORE_EMULATOR_REQUIRED");
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const labels = require("../../functions/lib/modules/agentOperations/incidentLabels.js");
const { buildDailyAlertMessage } = require("../../functions/lib/modules/agentOperations/dailyAlert.js");

const cases = [];
const test = async (name, fn) => { await fn(); cases.push(name); };

(async () => {
  await db.doc("despachos/d1").set({ rootId: "root-a", nombre: "Despacho Norte" });
  await db.doc("despachos/d-other").set({ rootId: "root-b", nombre: "Despacho Ajeno" });
  await db.doc("solicitudes/sol-1").set({ rootId: "root-a", folio: "S-100", clienteNombre: "Terra Labor", monto: 25363.64, moneda: "MXN", despachoId: "d1", empresaNombre: "Empresa X", createdBy: "uid-secret" });
  await db.doc("solicitudes/sol-2").set({ rootId: "root-b", folio: "S-200", clienteNombre: "Cliente Ajeno", monto: 99, despachoId: "d-other" });
  await db.doc("solicitudes/sol-3").set({ rootId: "root-a", folio: "S-300", clienteNombre: "Otro", monto: 10, despachoId: "d-other", empresaNombre: "Empresa Y" });
  await db.doc("pagos/pago-1").set({ rootId: "root-a", folio: "P-1", clienteNombre: "Terra Labor", montoTotal: 500, empresaNombre: "Empresa X" });
  await db.doc("clientDispersions/disp-1").set({ rootId: "root-a", folio: "D-1", clienteNombre: "Terra Labor", amount: 120, beneficiaryName: "Juan Pérez" });

  const incidents = [
    { id: "i1", status: "OPEN", cause: "INTEGRITY_MISMATCH: BLOCKED", entityType: "solicitud", entityId: "sol-1" },
    { id: "i2", status: "OPEN", cause: "BLOCKED", entityType: "solicitud", entityId: "sol-1" },
    { id: "i3", status: "OPEN", cause: "Sin cotización", entityType: "pago", entityId: "pago-1" },
    { id: "i4", status: "OPEN", cause: "REPEATED_FAILURE: SUSPICIOUS", entityType: "dispersion", entityId: "disp-1" },
    { id: "i5", status: "OPEN", cause: "BLOCKED", entityType: "solicitud", entityId: "sol-2" },
    { id: "i6", status: "OPEN", cause: "BLOCKED", entityType: "solicitud", entityId: "no-existe" },
    { id: "i7", status: "OPEN", cause: "BLOCKED", entityType: "solicitud", entityId: "a/b" },
  ];

  await test("enriches-solicitud-pago-and-dispersion-in-the-root", async () => {
    const subjects = await labels.loadIncidentSubjects("root-a", incidents);
    assert.deepEqual(subjects.get("solicitud/sol-1"), { kind: "SOLICITUD", entityId: "sol-1", folio: "S-100", clientName: "Terra Labor", amount: 25363.64, currency: "MXN", providerName: "Despacho Norte" });
    assert.equal(subjects.get("pago/pago-1").providerName, "Empresa X");
    assert.equal(subjects.get("pago/pago-1").amount, 500);
    assert.equal(subjects.get("dispersion/disp-1").providerName, "Juan Pérez");
    assert.equal(subjects.get("dispersion/disp-1").folio, "D-1");
  });
  await test("never-crosses-roots-nor-invents-missing-documents", async () => {
    const subjects = await labels.loadIncidentSubjects("root-a", incidents);
    assert.equal(subjects.has("solicitud/sol-2"), false);
    assert.equal(subjects.has("solicitud/no-existe"), false);
    assert.equal(subjects.has("solicitud/a/b"), false);
    const other = await labels.loadIncidentSubjects("root-b", incidents);
    assert.equal(other.has("solicitud/sol-1"), false);
    assert.equal(other.get("solicitud/sol-2").providerName, "Despacho Ajeno");
  });
  await test("despacho-from-another-root-is-not-shown", async () => {
    const subjects = await labels.loadIncidentSubjects("root-a", [{ id: "x", entityType: "solicitud", entityId: "sol-3", status: "OPEN" }]);
    assert.equal(subjects.get("solicitud/sol-3").providerName, "Empresa Y");
  });
  await test("subject-carries-no-uid-or-internal-fields", async () => {
    const subjects = await labels.loadIncidentSubjects("root-a", incidents);
    assert(!JSON.stringify([...subjects.values()]).includes("uid-secret"));
  });
  await test("duplicates-of-the-same-entity-share-one-card", async () => {
    const subjects = await labels.loadIncidentSubjects("root-a", incidents);
    const groups = labels.groupIncidents(incidents, subjects);
    const card = groups.find(row => row.entityId === "sol-1");
    assert.equal(groups.filter(row => row.entityId === "sol-1").length, 1);
    assert.equal(card.count, 2);
    assert.deepEqual(card.causes, ["Datos que no cuadran; bloqueado para revisión", "Bloqueada"]);
    assert.equal(labels.incidentSubjectLine(card.subject), "Solicitud S-100 · Terra Labor · $25,363.64 · Despacho Norte");
  });
  await test("daily-summary-uses-folio-client-amount-and-plain-reason", async () => {
    const subjects = await labels.loadIncidentSubjects("root-a", incidents);
    const text = buildDailyAlertMessage({ killSwitch: false, incidents, incidentGroups: labels.groupIncidents(incidents, subjects), report: { day: "2026-11-11", reviewed: 1, detected: 1, corrected: 0, escalated: 0, retryable: 0, causes: [] } });
    assert(text.includes("Solicitud S-100 · Terra Labor · $25,363.64 · Despacho Norte — Datos que no cuadran; bloqueado para revisión; Bloqueada"), text);
    assert(!text.includes("INTEGRITY_MISMATCH") && !text.includes("[solicitud]"));
  });
  const { resolveIncident } = require("../../functions/lib/modules/agentOperations/incidentResolution.js");
  const { isZeroLinesFailure } = require("../../functions/lib/modules/cotizaciones/queueCallables.js");
  const stamp = () => admin.firestore.FieldValue.serverTimestamp();
  const seed = (id, extra) => db.doc(`agentIncidents/${id}`).set({ rootId: "root-a", status: "OPEN", cause: "INTEGRITY_MISMATCH: BLOCKED", entityType: "solicitud", entityId: "sol-1", createdAt: stamp(), ...extra });
  await test("resolution-ladder-records-tier-resolution-and-action", async () => {
    await seed("r-sys", {}); await seed("r-hugo", {}); await seed("r-person", {});
    assert(await resolveIncident("r-sys", { rootId: "root-a", resolvedBy: "AGENTE", note: "Cotización generada", resolution: "COTIZACION_GENERADA" }));
    assert(await resolveIncident("r-hugo", { rootId: "root-a", resolvedBy: "ORQUESTADOR", note: "Hugo corrigió" }));
    assert(await resolveIncident("r-person", { rootId: "root-a", resolvedBy: "PERSONA", actorUid: "uid-secret", note: "Cambié la OC por la correcta", actionTaken: "Cambié la OC por la correcta" }));
    const [a, b, c] = await Promise.all(["r-sys", "r-hugo", "r-person"].map(id => db.doc(`agentIncidents/${id}`).get()));
    assert.deepEqual([a.get("resolverTier"), b.get("resolverTier"), c.get("resolverTier")], ["SYSTEM", "HUGO", "PERSON"]);
    assert.equal(a.get("resolution"), "COTIZACION_GENERADA");
    assert.equal(c.get("actionTaken"), "Cambié la OC por la correcta");
    assert.equal((await db.doc("agentResolutionLessons/r-person").get()).get("state"), "PENDING_REVIEW");
    assert.equal((await db.doc("agentResolutionLessons/r-sys").get()).exists, false);
    assert.equal(await resolveIncident("r-person", { rootId: "root-a", resolvedBy: "PERSONA", note: "otra vez" }), false);
    assert.equal(await resolveIncident("r-sys", { rootId: "root-b", resolvedBy: "PERSONA", note: "otro root" }), false);
  });
  await test("day-list-has-open-and-resolved-today-with-who-and-why-and-no-uid", async () => {
    const rows = (await db.collection("agentIncidents").where("rootId", "==", "root-a").get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const subjects = await labels.loadIncidentSubjects("root-a", rows);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
    const groups = labels.incidentsOfTheDay(labels.groupIncidents(rows, subjects), day);
    assert(!JSON.stringify(groups).includes("uid-secret"));
    const resolved = groups.filter(group => group.status === "RESOLVED");
    assert.deepEqual(resolved.map(group => group.resolverTier).sort(), ["HUGO", "PERSON", "SYSTEM"].sort());
    assert.equal(labels.incidentsOfTheDay(labels.groupIncidents(rows, subjects), "2020-01-01").filter(group => group.status === "RESOLVED").length, 0);
    const text = buildDailyAlertMessage({ killSwitch: false, incidents: rows, incidentGroups: groups, report: { day, reviewed: 1, detected: 1, corrected: 0, escalated: 0, retryable: 0, causes: [] } });
    assert(text.includes("Incidencias:") && text.includes("Resuelta automáticamente: Sí · Resolvió: Sistema · Cotización generada"), text);
    assert(text.includes("Resuelta automáticamente: No · Resolvió: Persona · Cambié la OC por la correcta"), text);
  });
  await test("only-the-zero-sum-failure-triggers-the-system-reread", async () => {
    assert(isZeroLinesFailure("Las partidas de la OC suman $0.00 y no cuadran con el subtotal $25,363.64; la cotizacion queda pendiente."));
    assert(!isZeroLinesFailure("Las partidas de la OC suman $100.00 y no cuadran con el subtotal $25,363.64"));
    assert(!isZeroLinesFailure("La OC no trae precio e importe en todas sus partidas"));
  });
  console.log(JSON.stringify({ status: "PASS", checks: cases.length, cases }));
})().catch(error => { console.error(error); process.exit(1); });
