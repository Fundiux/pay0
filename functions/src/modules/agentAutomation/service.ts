import { createHash } from "node:crypto";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { mexicoDayKey } from "../agentOperations/time";
import { incidentCauseLabel } from "../agentOperations/incidentLabels";
import { resolveIncident } from "../agentOperations/incidentResolution";
import {
  AUTOMATABLE_TOOL_LABEL, DEFAULT_DAILY_CAP, RULE_STATUS_LABEL, UNDONE_WINDOW_DAYS, canonicalCause, isAutomatableTool, keywordTool, nextStatus,
  promoteIfDue, ruleCandidates, ruleGate, simulationEndsAtMs, undoneRate, type RuleAction, type RuleStatus,
} from "./domain";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const text = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);
const millis = (value: any): number => value?.toMillis?.() ?? 0;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AutomationDeps = {
  /** Convierte lo que hizo la persona en una herramienta del catálogo, o null. */
  classify(input: { cause: string; actionText: string }): Promise<string | null>;
  /** Ejecuta la herramienta del catálogo; devuelve la referencia que se verificará después. */
  execute(toolId: string, context: { rootId: string; runId: string; incident: Record<string, any> }): Promise<{ ref: string }>;
  verify(toolId: string, ref: string): Promise<"PENDING" | "OK" | "FAILED">;
  now(): number;
};

const ruleIdFor = (rootId: string, causeKey: string, toolId: string) => createHash("sha256").update([rootId, causeKey, toolId].join("|")).digest("hex").slice(0, 32);
const isAlreadyExists = (error: unknown) => { const code = (error as { code?: unknown })?.code; return code === 6 || code === "already-exists"; };

/** 1. Lecciones nuevas: la causa se normaliza sin modelo; la acción solo cuenta si cae en el catálogo. */
export async function normalizeLessons(rootId: string, deps: AutomationDeps): Promise<number> {
  const pending = await db.collection("agentResolutionLessons").where("rootId", "==", rootId).where("state", "==", "PENDING_REVIEW").limit(50).get();
  let normalized = 0;
  for (const doc of pending.docs) {
    const cause = text(doc.get("cause")), action = text(doc.get("actionTaken"));
    let toolId: string | null = null;
    if (text(doc.get("entityType")).toLowerCase().startsWith("solicitud")) {
      const guess = await deps.classify({ cause, actionText: action }).catch(() => null);
      toolId = isAutomatableTool(guess) ? guess : null;
    }
    await doc.ref.update(toolId
      ? { state: "NORMALIZED", causeKey: canonicalCause(cause), toolId, normalizedAt: FieldValue.serverTimestamp() }
      : { state: "NOT_AUTOMATABLE", normalizedAt: FieldValue.serverTimestamp() });
    normalized++;
  }
  return normalized;
}

/** 2. Tres incidencias distintas con la misma causa y acción: se propone una regla; nunca se activa sola. */
export async function proposeRules(rootId: string): Promise<number> {
  const lessons = await db.collection("agentResolutionLessons").where("rootId", "==", rootId).where("state", "==", "NORMALIZED").limit(500).get();
  const rows = lessons.docs.map(doc => ({ incidentId: text(doc.get("incidentId")), causeKey: text(doc.get("causeKey")), toolId: text(doc.get("toolId")), cause: text(doc.get("cause")) }));
  let proposed = 0;
  for (const candidate of ruleCandidates(rows)) {
    const sample = rows.find(row => row.causeKey === candidate.causeKey)?.cause || candidate.causeKey;
    try {
      await db.collection("agentAutomationRules").doc(ruleIdFor(rootId, candidate.causeKey, candidate.toolId)).create({
        rootId, causeKey: candidate.causeKey, causeLabel: incidentCauseLabel(sample), toolId: candidate.toolId, toolLabel: AUTOMATABLE_TOOL_LABEL[candidate.toolId],
        status: "PROPUESTA", paused: false, dailyCap: DEFAULT_DAILY_CAP, evidenceIncidentIds: candidate.incidentIds, evidenceCount: candidate.incidentIds.length,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      proposed++;
    } catch (error) { if (!isAlreadyExists(error)) throw error; }
  }
  return proposed;
}

/** 3. Terminada la simulación la regla pasa a ACTIVA; 4. se evalúan las incidencias abiertas; 5. se verifica lo ejecutado; 6. se marca lo deshecho. */
export async function runRules(rootId: string, deps: AutomationDeps): Promise<{ promoted: number; simulated: number; executed: number; verified: number; failed: number; undone: number }> {
  const out = { promoted: 0, simulated: 0, executed: 0, verified: 0, failed: 0, undone: 0 };
  const now = deps.now(), day = mexicoDayKey(new Date(now));
  const [control, rulesSnap] = await Promise.all([
    db.collection("agentControls").doc(rootId).get(),
    db.collection("agentAutomationRules").where("rootId", "==", rootId).limit(100).get(),
  ]);
  const globalKill = control.get("automationKillSwitch") === true;
  const rules: Array<{ id: string; ref: FirebaseFirestore.DocumentReference; data: Record<string, any>; status: RuleStatus }> = [];
  for (const doc of rulesSnap.docs) {
    const data = doc.data() as Record<string, any>;
    let status = text(data.status) as RuleStatus;
    const promoted = promoteIfDue({ status, simulationEndsAtMs: millis(data.simulationEndsAt) || null }, now);
    if (promoted !== status) { await doc.ref.update({ status: promoted, activatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }); status = promoted; out.promoted++; }
    rules.push({ id: doc.id, ref: doc.ref, data, status });
  }

  const openSnap = await db.collection("agentIncidents").where("rootId", "==", rootId).where("status", "==", "OPEN").limit(200).get();
  const open = openSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Record<string, any>));

  for (const rule of rules.filter(row => row.status === "SIMULACION" || row.status === "ACTIVA")) {
    const todaySnap = await db.collection("agentAutomationRuns").where("ruleId", "==", rule.id).where("day", "==", day).count().get();
    let runsToday = todaySnap.data().count;
    for (const incident of open) {
      if (text(incident.entityType).toLowerCase() !== "solicitud" || canonicalCause(incident.cause) !== rule.data.causeKey) continue;
      const gate = ruleGate({ status: rule.status, paused: rule.data.paused === true, globalKill, runsToday, dailyCap: Number(rule.data.dailyCap) || DEFAULT_DAILY_CAP });
      if (!gate.allowed) break;
      const runRef = db.collection("agentAutomationRuns").doc(`${rule.id}__${gate.mode}__${incident.id}`);
      const base = { rootId, ruleId: rule.id, incidentId: incident.id, entityId: text(incident.entityId, 128), toolId: rule.data.toolId, day, mode: gate.mode, createdAt: FieldValue.serverTimestamp() };
      try { await runRef.create({ ...base, status: gate.mode === "SIMULACION" ? "SIMULADA" : "EJECUTANDO" }); }
      catch (error) { if (isAlreadyExists(error)) continue; throw error; }
      runsToday++;
      if (gate.mode === "SIMULACION") { out.simulated++; continue; }
      try { const { ref } = await deps.execute(rule.data.toolId, { rootId, runId: runRef.id, incident }); await runRef.update({ ref }); out.executed++; }
      catch (error) { await runRef.update({ status: "FALLIDA", error: text((error as Error)?.message || error, 300), finishedAt: FieldValue.serverTimestamp() }); out.failed++; }
    }
  }

  const executing = await db.collection("agentAutomationRuns").where("rootId", "==", rootId).where("status", "==", "EJECUTANDO").limit(50).get();
  for (const doc of executing.docs) {
    const ref = text(doc.get("ref"));
    if (!ref) continue;
    const verdict = await deps.verify(text(doc.get("toolId")), ref).catch(() => "PENDING" as const);
    if (verdict === "PENDING") continue;
    const rule = rules.find(row => row.id === doc.get("ruleId"));
    if (verdict === "OK") {
      await resolveIncident(text(doc.get("incidentId")), { rootId, resolvedBy: "ORQUESTADOR", resolution: "REGLA_HUGO", ruleId: text(doc.get("ruleId")),
        actionTaken: text(rule?.data.toolLabel) || "Acción de una regla aprobada",
        note: `Hugo aplicó la regla aprobada "${text(rule?.data.causeLabel)}": ${text(rule?.data.toolLabel).toLowerCase()}, y se verificó el resultado.` });
      await doc.ref.update({ status: "VERIFICADA", verifiedAt: FieldValue.serverTimestamp() });
      out.verified++;
    } else { await doc.ref.update({ status: "FALLIDA", error: "La verificación no confirmó el resultado.", finishedAt: FieldValue.serverTimestamp() }); out.failed++; }
  }

  const verifiedRuns = await db.collection("agentAutomationRuns").where("rootId", "==", rootId).where("status", "==", "VERIFICADA").limit(200).get();
  for (const doc of verifiedRuns.docs) {
    const verifiedAt = millis(doc.get("verifiedAt"));
    if (!verifiedAt || now - verifiedAt > UNDONE_WINDOW_DAYS * DAY_MS) continue;
    const rule = rules.find(row => row.id === doc.get("ruleId"));
    const again = open.some(incident => incident.id !== doc.get("incidentId") && text(incident.entityId) === text(doc.get("entityId")) && canonicalCause(incident.cause) === rule?.data.causeKey && millis(incident.createdAt) > verifiedAt);
    if (again) { await doc.ref.update({ status: "DESHECHA", undoneAt: FieldValue.serverTimestamp() }); out.undone++; }
  }
  return out;
}

export async function runAutomationCycle(rootId: string, deps: AutomationDeps) {
  const normalized = await normalizeLessons(rootId, deps);
  const proposed = await proposeRules(rootId);
  return { normalized, proposed, ...await runRules(rootId, deps) };
}

/** Acciones del dueño sobre una regla. Aprobar inicia la simulación; nada se ejecuta sin esa aprobación. */
export async function reviewAutomationRule(input: { rootId: string; ruleId: string; action: RuleAction | "KILL_ON" | "KILL_OFF"; actorUid: string; nowMs?: number }): Promise<{ status?: RuleStatus; killSwitch?: boolean }> {
  if (input.action === "KILL_ON" || input.action === "KILL_OFF") {
    await db.collection("agentControls").doc(input.rootId).set({ automationKillSwitch: input.action === "KILL_ON", automationKillBy: input.actorUid, automationKillAt: FieldValue.serverTimestamp() }, { merge: true });
    return { killSwitch: input.action === "KILL_ON" };
  }
  const ref = db.collection("agentAutomationRules").doc(input.ruleId);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("rootId") !== input.rootId) throw Error("RULE_NOT_FOUND");
    const status = text(snap.get("status")) as RuleStatus;
    if (input.action === "PAUSE" || input.action === "RESUME") {
      if (status !== "SIMULACION" && status !== "ACTIVA") throw Error("RULE_TRANSITION_INVALID");
      tx.update(ref, { paused: input.action === "PAUSE", updatedAt: FieldValue.serverTimestamp() });
      return { status };
    }
    const next = nextStatus(status, input.action as RuleAction);
    if (!next) throw Error("RULE_TRANSITION_INVALID");
    const now = input.nowMs ?? Date.now();
    tx.update(ref, {
      status: next, updatedAt: FieldValue.serverTimestamp(), reviewedByUid: input.actorUid, reviewedAt: FieldValue.serverTimestamp(),
      ...(next === "SIMULACION" ? { approvedAt: FieldValue.serverTimestamp(), simulationEndsAt: Timestamp.fromMillis(simulationEndsAtMs(now)) } : {}),
    });
    return { status: next };
  });
}

/** Bloque para el panel y el reporte: reglas con lo que han hecho, sin identificadores internos salvo el necesario para los botones. */
export async function loadAutomationReport(rootId: string, day = mexicoDayKey()) {
  const [control, rules, runsToday, verified, undone] = await Promise.all([
    db.collection("agentControls").doc(rootId).get(),
    db.collection("agentAutomationRules").where("rootId", "==", rootId).limit(50).get(),
    db.collection("agentAutomationRuns").where("rootId", "==", rootId).where("day", "==", day).limit(500).get(),
    db.collection("agentAutomationRuns").where("rootId", "==", rootId).where("status", "==", "VERIFICADA").count().get(),
    db.collection("agentAutomationRuns").where("rootId", "==", rootId).where("status", "==", "DESHECHA").count().get(),
  ]);
  const todayBy = (ruleId: string, mode: string) => runsToday.docs.filter(doc => doc.get("ruleId") === ruleId && doc.get("mode") === mode).length;
  const verifiedCount = verified.data().count, undoneCount = undone.data().count;
  return {
    killSwitch: control.get("automationKillSwitch") === true,
    undoneRate: undoneRate(verifiedCount + undoneCount, undoneCount), verifiedActions: verifiedCount, undoneActions: undoneCount,
    rules: rules.docs.map(doc => {
      const status = text(doc.get("status")) as RuleStatus;
      return {
        id: doc.id, causeLabel: text(doc.get("causeLabel")), toolLabel: text(doc.get("toolLabel")), status, statusLabel: RULE_STATUS_LABEL[status] || status,
        paused: doc.get("paused") === true, dailyCap: Number(doc.get("dailyCap")) || DEFAULT_DAILY_CAP, evidenceCount: Number(doc.get("evidenceCount")) || 0,
        simulationEndsAtMs: millis(doc.get("simulationEndsAt")) || null, simulatedToday: todayBy(doc.id, "SIMULACION"), executedToday: todayBy(doc.id, "REAL"),
      };
    }),
  };
}

export { keywordTool };
