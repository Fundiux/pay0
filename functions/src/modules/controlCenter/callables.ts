import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { assertAuthorized } from "../../utils/authGuard";
import { db, getMyUser, requireAuth, requireRole, toSafeMoneyNumber } from "../sharedCallables/helpers";
import { incrementalOverview } from "./incrementalOverview";

type Health = "HEALTHY" | "WARNING" | "CRITICAL" | "UNKNOWN";

const clean = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => clean(value).toUpperCase();
const amount = (row: any) => toSafeMoneyNumber(
  row?.montoTotalCanonico ?? row?.montoTotal ?? row?.amount ?? row?.monto ?? row?.total ?? row?.importe ?? 0
);
const dateKey = (value: any): string | null => {
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value || 0);
  return Number.isFinite(date?.getTime?.()) ? date.toISOString().slice(0, 10) : null;
};

function health(status: Health, explanation: string, affectedCount = 0) {
  return { status, explanation, affectedCount };
}

async function readRoot(collection: string, rootId: string, limit = 5000): Promise<any[]> {
  const snap = await db.collection(collection).where("rootId", "==", rootId).limit(limit).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

export async function buildControlCenterSnapshot(rootId: string, actorUid: string) {
  const coverage = await db.doc(`analyticsRoots/${rootId}`).get();
  if (coverage.data()?.bootstrapStatus === "COMPLETE") return incrementalOverview(rootId, actorUid);
  const [solicitudes, pagos, invoices, materiality, dispersions, recommendations] = await Promise.all([
    readRoot("solicitudes", rootId),
    readRoot("pagos", rootId),
    readRoot("facturamaInvoices", rootId),
    readRoot("materialityOperations", rootId),
    readRoot("clientDispersions", rootId),
    readRoot("agent007Recommendations", rootId, 1000),
  ]);

  const activeSolicitud = (row: any) => !["CANCELADA", "CANCELADO", "RECHAZADA", "RECHAZADO", "CERRADA", "CERRADO"].includes(upper(row.status));
  const activeSolicitudes = solicitudes.filter(activeSolicitud);
  const pendingPagos = pagos.filter((row) => !["CONCILIADO", "APLICADO", "CANCELADO", "RECHAZADO"].includes(upper(row.status)));
  const issuedInvoices = invoices.filter((row) => ["ISSUED", "PRODUCTION_ISSUED", "TIMBRADO", "TIMBRADA"].includes(upper(row.status)));
  const pendingInvoices = invoices.filter((row) => !["ISSUED", "PRODUCTION_ISSUED", "TIMBRADO", "TIMBRADA", "CANCELADA", "CANCELED"].includes(upper(row.status)));
  const incompleteMateriality = materiality.filter((row) => upper(row.status) !== "COMPLETE");
  const pendingDispersions = dispersions.filter((row) => !["COMPLETADA", "COMPLETED", "RECHAZADA", "CANCELADA"].includes(upper(row.status)));
  const pendingRecommendations = recommendations.filter((row) => !["ACCEPTED", "REJECTED", "RESOLVED"].includes(upper(row.status)));
  const paidAmount = pagos.reduce((sum, row) => sum + amount(row), 0);
  const pendingAmount = pendingPagos.reduce((sum, row) => sum + amount(row), 0);

  const daily: Record<string, { solicitudes: number; pagos: number; pagosAmount: number; facturas: number }> = {};
  const day = (key: string) => daily[key] || (daily[key] = { solicitudes: 0, pagos: 0, pagosAmount: 0, facturas: 0 });
  solicitudes.forEach((row: any) => { const key = dateKey(row.createdAt || row.fecha); if (key) day(key).solicitudes += 1; });
  pagos.forEach((row: any) => { const key = dateKey(row.reportDateAt || row.fechaPago || row.createdAt); if (key) { day(key).pagos += 1; day(key).pagosAmount += amount(row); } });
  issuedInvoices.forEach((row: any) => { const key = dateKey(row.facturamaIssuedAt || row.updatedAt || row.createdAt); if (key) day(key).facturas += 1; });

  const alerts = [
    ...(pendingInvoices.length ? [{ id: "facturas-pendientes", severity: "CRITICAL", module: "Facturama", title: "Facturas pendientes de timbrar", explanation: `${pendingInvoices.length} operaciones requieren validación o timbrado.`, affectedCount: pendingInvoices.length, href: "/facturacion" }] : []),
    ...(incompleteMateriality.length ? [{ id: "materialidad-incompleta", severity: "WARNING", module: "Materialidad", title: "Expedientes incompletos", explanation: `${incompleteMateriality.length} expedientes todavía tienen documentos o etapas pendientes.`, affectedCount: incompleteMateriality.length, href: "/materialidad" }] : []),
    ...(pendingPagos.length ? [{ id: "pagos-pendientes", severity: "WARNING", module: "Pagos", title: "Pagos pendientes", explanation: `${pendingPagos.length} pagos esperan conciliación o aplicación.`, affectedCount: pendingPagos.length, href: "/pagos" }] : []),
    ...(pendingDispersions.length ? [{ id: "dispersiones-pendientes", severity: "WARNING", module: "Wallet", title: "Dispersiones en proceso", explanation: `${pendingDispersions.length} dispersiones no han llegado a un estado terminal.`, affectedCount: pendingDispersions.length, href: "/wallet" }] : []),
  ].slice(0, 20);

  const snapshot = {
    rootId,
    version: 1,
    coverage: { complete: false, mode: "LEGACY_CAPPED", limitPerSource: 5000 },
    summary: { solicitudesActive: activeSolicitudes.length, pagosCount: pagos.length, pagosAmount: Number(paidAmount.toFixed(2)), pendingPagosAmount: Number(pendingAmount.toFixed(2)), invoicesIssued: issuedInvoices.length, criticalAlerts: alerts.filter((row) => row.severity === "CRITICAL").length },
    pipeline: [
      { key: "SOLICITUD", label: "Solicitud", count: solicitudes.length, href: "/solicitudes" },
      { key: "FACTURA", label: "Factura", count: invoices.length, href: "/facturacion" },
      { key: "PAGO", label: "Pago", count: pagos.length, href: "/pagos" },
      { key: "MATERIALIDAD", label: "Materialidad", count: materiality.length, href: "/materialidad" },
      { key: "CIERRE", label: "Cierre", count: materiality.length - incompleteMateriality.length, href: "/materialidad" },
    ],
    health: {
      solicitudes: health(activeSolicitudes.length ? "WARNING" : "HEALTHY", activeSolicitudes.length ? `${activeSolicitudes.length} solicitudes continúan activas.` : "No hay solicitudes activas pendientes.", activeSolicitudes.length),
      pagos: health(pendingPagos.length ? "WARNING" : "HEALTHY", pendingPagos.length ? `${pendingPagos.length} pagos requieren atención.` : "Pagos sin pendientes detectados.", pendingPagos.length),
      facturama: health(pendingInvoices.length ? "CRITICAL" : "HEALTHY", pendingInvoices.length ? `${pendingInvoices.length} facturas requieren atención.` : "Facturación sin pendientes detectados.", pendingInvoices.length),
      materialidad: health(incompleteMateriality.length ? "WARNING" : "HEALTHY", incompleteMateriality.length ? `${incompleteMateriality.length} expedientes incompletos.` : "Expedientes completos.", incompleteMateriality.length),
      wallet: health(pendingDispersions.length ? "WARNING" : "HEALTHY", pendingDispersions.length ? `${pendingDispersions.length} dispersiones en proceso.` : "Sin dispersiones pendientes.", pendingDispersions.length),
      hugo: health(pendingRecommendations.length ? "WARNING" : "HEALTHY", pendingRecommendations.length ? `${pendingRecommendations.length} recomendaciones esperan decisión.` : "Sin recomendaciones pendientes.", pendingRecommendations.length),
      iq: health("UNKNOWN", "La telemetría de salud de IQ se conectará en la siguiente fase."),
      whatsapp: health("UNKNOWN", "La telemetría de WhatsApp se conectará en la siguiente fase."),
    },
    alerts,
    daily,
    sourceCounts: { solicitudes: solicitudes.length, pagos: pagos.length, invoices: invoices.length, materiality: materiality.length, dispersions: dispersions.length, recommendations: recommendations.length },
    refreshedBy: actorUid,
    refreshedAt: FieldValue.serverTimestamp(),
  };

  await db.collection("controlCenterSnapshots").doc(rootId).set(snapshot);
  return snapshot;
}

export async function context(request: any, superadminOnly = true) {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  if (!user) throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");
  const allowedRoles: Array<"superadmin" | "admin" | "operador"> = superadminOnly ? ["superadmin"] : ["superadmin", "admin", "operador"];
  requireRole(user, allowedRoles);
  assertAuthorized(request.auth, user, { allowedRoles, requiredModule: "reportes", requiredAction: "view" });
  return { uid, rootId: clean(user.rootId || uid) || uid };
}

export const getControlCenterOverview = onCall({ cors: true, timeoutSeconds: 30, memory: "256MiB" }, async (request) => {
  const { rootId } = await context(request);
  const snap = await db.collection("controlCenterSnapshots").doc(rootId).get();
  return { ok: true, configured: snap.exists, snapshot: snap.exists ? { id: snap.id, ...(snap.data() || {}) } : null };
});

export const refreshControlCenterOverview = onCall({ cors: true, timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
  const { uid, rootId } = await context(request, true);
  const snapshot = await buildControlCenterSnapshot(rootId, uid);
  return { ok: true, snapshot };
});
