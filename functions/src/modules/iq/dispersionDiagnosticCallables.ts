import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertIqAuthorized } from "./authorization";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

type AnyRecord = Record<string, unknown>;

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function record(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as AnyRecord
    : {};
}

function iso(value: unknown): string | null {
  const candidate = value as { toDate?: () => Date; toMillis?: () => number } | null;
  try {
    if (candidate && typeof candidate.toDate === "function") return candidate.toDate().toISOString();
    if (candidate && typeof candidate.toMillis === "function") return new Date(candidate.toMillis()).toISOString();
    const date = value instanceof Date ? value : new Date(String(value || ""));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

function money(value: unknown): number {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

async function requireSuperadmin(request: { auth?: { uid?: string } | null }) {
  await assertIqAuthorized(request, { allowedRoles: ["superadmin"] });
  const uid = clean(request.auth?.uid);
  if (!uid) throw new HttpsError("unauthenticated", "Sesion requerida.");

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) throw new HttpsError("permission-denied", "Usuario PAY0 no encontrado.");

  const user = record(userSnap.data());
  const role = clean(user.role).toLowerCase();
  if (role !== "superadmin") {
    throw new HttpsError("permission-denied", "Solo Super Admin puede consultar diagnostico IQ.");
  }

  return { uid, rootId: clean(user.rootId) || uid };
}

function iqValue(data: AnyRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = clean(data[key]);
    if (value) return value;
  }
  return null;
}

export const getIqDispersionDiagnostic = onCall(
  { cors: true, timeoutSeconds: 60, memory: "512MiB" },
  async (request) => {
    const auth = await requireSuperadmin(request);
    const requestedLimit = Number(record(request.data).limit || 100);
    const limit = Math.max(1, Math.min(200, Number.isFinite(requestedLimit) ? requestedLimit : 100));

    let snap: admin.firestore.QuerySnapshot;
    try {
      snap = await db.collection("clientDispersions")
        .where("rootId", "==", auth.rootId)
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();
    } catch {
      snap = await db.collection("clientDispersions").limit(limit).get();
    }

    const docsByDispersion = new Map<string, number>();
    const uploadsSnap = await db.collection("uploads")
      .where("rootId", "==", auth.rootId)
      .where("entityType", "==", "clientDispersions")
      .limit(1000)
      .get()
      .catch(() => null);

    uploadsSnap?.docs.forEach((doc) => {
      const data = record(doc.data());
      if (data.active === false || clean(data.status).toUpperCase() === "INACTIVE") return;
      const dispersionId = clean(data.dispersionId || data.entityId);
      if (!dispersionId) return;
      docsByDispersion.set(dispersionId, (docsByDispersion.get(dispersionId) || 0) + 1);
    });

    const rows = snap.docs
      .filter((doc) => {
        const data = record(doc.data());
        const rowRootId = clean(data.rootId);
        return !rowRootId || rowRootId === auth.rootId;
      })
      .map((doc) => {
        const data = record(doc.data());
        const status = clean(data.status || "REGISTRADA").toUpperCase();
        const documentCount = docsByDispersion.get(doc.id) || 0;
        const blockers: string[] = [];
        const beneficiary = clean(data.beneficiaryNombre || data.beneficiaryName);
        const clientName = clean(data.clienteNombre || data.clientName);
        const amount = money(data.amount);
        const destinationKind = clean(data.destinationKind).toUpperCase();
        const destination = clean(data.clabe || data.cardNumber);

        if (!clientName) blockers.push("CLIENTE_SIN_NOMBRE");
        if (!beneficiary) blockers.push("BENEFICIARIO_SIN_NOMBRE");
        if (!(amount > 0)) blockers.push("MONTO_INVALIDO");
        if (!destinationKind) blockers.push("TIPO_DESTINO_FALTANTE");
        if (!destination) blockers.push("DESTINO_FALTANTE");
        if (documentCount === 0) blockers.push("COMPROBANTE_PENDIENTE");
        if (["CANCELADA", "DEVUELTA"].includes(status)) blockers.push("ESTADO_TERMINAL_PAY0");

        const iqFolio = iqValue(data,
          "iqDispersionId", "iqDispersionFolio", "iqFolio", "iqId",
        );
        const iqStatus = iqValue(data,
          "iqDispersionStatus", "iqStatus", "iqReconciliationStatus",
        );

        return {
          id: doc.id,
          folio: clean(data.folio || data.dispersionFolio || doc.id),
          status,
          clientId: clean(data.clienteId || data.clientId) || null,
          clientName: clientName || null,
          beneficiaryId: clean(data.beneficiaryId) || null,
          beneficiaryName: beneficiary || null,
          methodType: clean(data.methodTipo) || null,
          destinationKind: destinationKind || null,
          bankName: clean(data.bankName) || null,
          destinationMasked: destination ? `***${destination.slice(-4)}` : null,
          amount,
          documentCount,
          hasReceipt: documentCount > 0,
          iqFolio,
          iqStatus,
          integrationState: iqFolio ? "LINKED" : blockers.length ? "BLOCKED" : "READY_FOR_IQ_MAPPING",
          blockers,
          createdAt: iso(data.createdAt),
          updatedAt: iso(data.updatedAt),
        };
      });

    const summary = {
      total: rows.length,
      ready: rows.filter((row) => row.integrationState === "READY_FOR_IQ_MAPPING").length,
      linked: rows.filter((row) => row.integrationState === "LINKED").length,
      blocked: rows.filter((row) => row.integrationState === "BLOCKED").length,
      withReceipt: rows.filter((row) => row.hasReceipt).length,
      terminal: rows.filter((row) => row.blockers.includes("ESTADO_TERMINAL_PAY0")).length,
    };

    return {
      ok: true,
      data: {
        version: "H4-D61-A1",
        mode: "READ_ONLY",
        summary,
        rows,
      },
      message: "Diagnostico PAY0 de dispersiones cargado. No se ejecuto ninguna accion en IQ.",
    };
  },
);
