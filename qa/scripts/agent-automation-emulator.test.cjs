const assert = require("node:assert/strict");
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "") || !/^demo-/.test(process.env.GCLOUD_PROJECT || "")) throw Error("ISOLATED_FIRESTORE_EMULATOR_REQUIRED");
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const domain = require("../../functions/lib/modules/agentAutomation/domain.js");
const service = require("../../functions/lib/modules/agentAutomation/service.js");
const { resolveIncident } = require("../../functions/lib/modules/agentOperations/incidentResolution.js");
const { autonomyReport } = require("../../functions/lib/modules/agentOperations/callables.js");

const cases = [];
const test = async (name, fn) => { await fn(); cases.push(name); };
const TS = () => admin.firestore.FieldValue.serverTimestamp();
const DAY = 24 * 60 * 60 * 1000;
const cause = amount => `Las partidas de la OC suman $0.00 y no cuadran con el subtotal $${amount}; la cotizacion queda pendiente.`;
const seedIncident = (id, root, entityId, text = cause("1,000.00")) => db.doc(`agentIncidents/${id}`).set({ rootId: root, status: "OPEN", cause: text, entityType: "solicitud", entityId, createdAt: TS() });

(async () => {
  let clock = Date.now();
  const calls = [];
  let verdict = "PENDING";
  const deps = {
    classify: async ({ actionText }) => domain.keywordTool(actionText),
    execute: async (toolId, context) => { calls.push({ toolId, incidentId: context.incident.id, runId: context.runId }); return { ref: `job-${context.incident.id}` }; },
    verify: async () => verdict,
    now: () => clock,
  };

  await test("canonical-cause-ignores-amounts-and-folios", async () => {
    assert.equal(domain.canonicalCause(cause("1,000.00")), domain.canonicalCause(cause("25,363.64")));
    assert.notEqual(domain.canonicalCause("Kill switch de agentes activo."), domain.canonicalCause(cause("1.00")));
  });

  // Three people resolved three different solicitudes the same way; a fourth lesson is unrelated.
  for (const n of [1, 2, 3, 4]) await seedIncident(`les-${n}`, "root-a", `sol-${n}`, cause(`${n},000.00`));
  await seedIncident("les-other", "root-a", "sol-9", "Kill switch de agentes activo.");
  for (const n of [1, 2, 3]) assert(await resolveIncident(`les-${n}`, { rootId: "root-a", resolvedBy: "PERSONA", actorUid: "uid-secret", note: "Volví a generar la cotización", actionTaken: "Volví a generar la cotización" }));
  assert(await resolveIncident("les-other", { rootId: "root-a", resolvedBy: "PERSONA", actorUid: "uid-secret", note: "Revisé a mano y llamé al cliente", actionTaken: "Revisé a mano y llamé al cliente" }));

  await test("two-concordant-lessons-do-not-propose-a-rule", async () => {
    await db.doc("agentResolutionLessons/les-3").update({ state: "HOLD" });
    await service.normalizeLessons("root-a", deps);
    assert.equal(await service.proposeRules("root-a"), 0);
    await db.doc("agentResolutionLessons/les-3").update({ state: "PENDING_REVIEW" });
  });
  await test("only-catalog-actions-are-normalized-and-three-lessons-propose-one-rule", async () => {
    assert.equal(await service.normalizeLessons("root-a", deps), 1, "the three others were normalized in the previous check");
    assert.equal((await db.doc("agentResolutionLessons/les-other").get()).get("state"), "NOT_AUTOMATABLE");
    assert.equal((await db.doc("agentResolutionLessons/les-1").get()).get("toolId"), "quotation-recovery");
    assert.equal(await service.proposeRules("root-a"), 1);
    assert.equal(await service.proposeRules("root-a"), 0, "proposing twice must not duplicate");
    const rules = await db.collection("agentAutomationRules").where("rootId", "==", "root-a").get();
    assert.equal(rules.size, 1);
    assert.equal(rules.docs[0].get("status"), "PROPUESTA");
    assert.equal(rules.docs[0].get("evidenceCount"), 3);
    assert.equal(rules.docs[0].get("toolLabel"), "Volver a generar la cotización");
  });
  const ruleId = (await db.collection("agentAutomationRules").where("rootId", "==", "root-a").get()).docs[0].id;

  await seedIncident("open-1", "root-a", "sol-20", cause("500.00"));
  await seedIncident("open-2", "root-a", "sol-21", cause("600.00"));
  await seedIncident("open-3", "root-a", "sol-22", cause("700.00"));
  await seedIncident("open-foreign", "root-b", "sol-30", cause("500.00"));
  await db.doc("solicitudes/sol-20").set({ rootId: "root-a", iqFolio: "IQ-1", createdBy: "u" });

  await test("a-proposed-rule-never-runs-without-owner-approval", async () => {
    const out = await service.runRules("root-a", deps);
    assert.deepEqual([out.simulated, out.executed], [0, 0]);
    assert.equal(calls.length, 0);
  });
  await test("approving-starts-a-seven-day-simulation-that-only-records", async () => {
    const result = await service.reviewAutomationRule({ rootId: "root-a", ruleId, action: "APPROVE", actorUid: "owner", nowMs: clock });
    assert.equal(result.status, "SIMULACION");
    const rule = await db.doc(`agentAutomationRules/${ruleId}`).get();
    assert(Math.abs(rule.get("simulationEndsAt").toMillis() - (clock + 7 * DAY)) < 1000);
    await assert.rejects(() => service.reviewAutomationRule({ rootId: "root-a", ruleId, action: "APPROVE", actorUid: "owner" }), /RULE_TRANSITION_INVALID/);
    const out = await service.runRules("root-a", deps);
    assert.equal(out.simulated, 4, "les-4 is still open and has the same cause");
    assert.equal(calls.length, 0, "simulation must not execute");
    assert.equal((await service.runRules("root-a", deps)).simulated, 0, "idempotent per incident");
    assert.equal((await db.doc("agentIncidents/open-1").get()).get("status"), "OPEN");
  });
  await test("rules-never-touch-another-root", async () => {
    const runs = await db.collection("agentAutomationRuns").get();
    assert(runs.docs.every(doc => doc.get("rootId") === "root-a" && doc.get("incidentId") !== "open-foreign"));
    await assert.rejects(() => service.reviewAutomationRule({ rootId: "root-b", ruleId, action: "REVOKE", actorUid: "x" }), /RULE_NOT_FOUND/);
  });
  await test("global-kill-and-per-rule-pause-stop-everything", async () => {
    clock += 8 * DAY;
    await service.reviewAutomationRule({ rootId: "root-a", ruleId: "", action: "KILL_ON", actorUid: "owner" });
    let out = await service.runRules("root-a", deps);
    assert.equal(out.promoted, 1, "the window ended, so the rule is promoted even while stopped");
    assert.equal(out.executed, 0);
    await service.reviewAutomationRule({ rootId: "root-a", ruleId: "", action: "KILL_OFF", actorUid: "owner" });
    await service.reviewAutomationRule({ rootId: "root-a", ruleId, action: "PAUSE", actorUid: "owner" });
    out = await service.runRules("root-a", deps);
    assert.equal(out.executed, 0);
    await service.reviewAutomationRule({ rootId: "root-a", ruleId, action: "RESUME", actorUid: "owner" });
  });
  await test("daily-cap-limits-live-runs", async () => {
    await db.doc(`agentAutomationRules/${ruleId}`).update({ dailyCap: 2 });
    const out = await service.runRules("root-a", deps);
    assert.equal(out.executed, 2);
    assert.equal(calls.length, 2);
    assert.equal((await service.runRules("root-a", deps)).executed, 0, "cap reached for today");
  });
  await test("verified-result-closes-the-incident-as-hugo-citing-the-rule", async () => {
    verdict = "PENDING";
    assert.equal((await service.runRules("root-a", deps)).verified, 0);
    verdict = "OK";
    const out = await service.runRules("root-a", deps);
    assert.equal(out.verified, 2);
    const closed = await db.doc(`agentIncidents/${calls[0].incidentId}`).get();
    assert.equal(closed.get("status"), "RESOLVED");
    assert.equal(closed.get("resolverTier"), "HUGO");
    assert.equal(closed.get("resolvedByRuleId"), ruleId);
    assert(closed.get("resolutionNote").includes("regla aprobada"));
    assert.equal((await db.doc(`agentResolutionLessons/${calls[0].incidentId}`).get()).exists, false, "a rule closure is not a human lesson");
  });
  await test("failed-verification-keeps-the-incident-open", async () => {
    clock += DAY;
    verdict = "FAILED";
    const before = calls.length;
    const out = await service.runRules("root-a", deps);
    assert.equal(calls.length, before + 2, "the two incidents left open run on the new day");
    assert.equal(out.failed, 2);
    const run = (await db.collection("agentAutomationRuns").where("status", "==", "FALLIDA").get()).docs[0];
    assert.equal((await db.doc(`agentIncidents/${run.get("incidentId")}`).get()).get("status"), "OPEN");
  });
  await test("recurrence-marks-the-action-as-undone-and-the-report-shows-the-rate", async () => {
    const verifiedRun = (await db.collection("agentAutomationRuns").where("status", "==", "VERIFICADA").get()).docs[0];
    const entityId = verifiedRun.get("entityId");
    await new Promise(resolve => setTimeout(resolve, 50));
    await seedIncident("again-1", "root-a", entityId, cause("9,999.00"));
    const out = await service.runRules("root-a", { ...deps, now: () => Date.now() });
    assert.equal(out.undone, 1);
    const report = await service.loadAutomationReport("root-a");
    assert.equal(report.undoneActions, 1);
    assert.equal(report.undoneRate, 50);
    assert(report.rules[0].statusLabel && !JSON.stringify(report).includes("uid-secret"));
  });
  await test("revoked-rules-stop-and-cannot-be-revived", async () => {
    await service.reviewAutomationRule({ rootId: "root-a", ruleId, action: "REVOKE", actorUid: "owner" });
    const before = calls.length;
    await seedIncident("after-revoke", "root-a", "sol-40", cause("1.00"));
    await service.runRules("root-a", deps);
    assert.equal(calls.length, before);
    await assert.rejects(() => service.reviewAutomationRule({ rootId: "root-a", ruleId, action: "APPROVE", actorUid: "owner" }), /RULE_TRANSITION_INVALID/);
  });
  await test("autonomy-report-separates-system-hugo-and-person", async () => {
    const rows = [{ status: "RESOLVED", resolvedBy: "AGENTE" }, { status: "RESOLVED", resolverTier: "HUGO", resolvedBy: "ORQUESTADOR" }, { status: "RESOLVED", resolvedBy: "PERSONA" }, { status: "OPEN" }];
    const report = autonomyReport([], rows, 0);
    assert.deepEqual([report.resolvedBySystem, report.resolvedByHugo, report.resolvedByPerson], [1, 1, 1]);
    assert.equal(report.resolvedByAgent, 2);
  });
  console.log(JSON.stringify({ status: "PASS", checks: cases.length, cases }));
})().catch(error => { console.error(error); process.exit(1); });
