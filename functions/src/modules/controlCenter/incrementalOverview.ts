import { FieldValue } from "firebase-admin/firestore";
import { db } from "../sharedCallables/helpers";
import { readMetricBucket } from "./projections";

export async function incrementalOverview(rootId: string, actorUid: string) {
  const m = await readMetricBucket(rootId, "all", "all");
  const count = (key: string) => m[key] || 0;
  const health = (count: number, text: string) => ({ status: count ? "WARNING" : "HEALTHY", explanation: text, affectedCount: count });
  const incomplete = Math.max(0, count("files") - count("filesComplete"));
  const definitions = [
    ["facturas-pendientes", "Facturama", "Facturas pendientes", count("invoicesPending"), "/facturacion"],
    ["materialidad-incompleta", "Materialidad", "Expedientes incompletos", incomplete, "/materialidad"],
    ["pagos-pendientes", "Pagos", "Pagos pendientes", count("paymentsPending"), "/pagos"],
    ["recuperacion-pendiente", "Operación", "Operaciones que requieren revisión", count("recoveryBlocked"), "/solicitudes"],
  ] as const;
  const alerts = definitions.filter(([, , , n]) => n > 0).map(([id, module, title, n, href]) => ({ id, module, title, affectedCount: n, href, severity: "WARNING", explanation: `${n} registros requieren atención.` }));
  const integration = (prefix: string) => count(`${prefix}Jobs`) ? health(count(`${prefix}Failed`), `${count(`${prefix}Pending`)} trabajos pendientes y ${count(`${prefix}Failed`)} fallidos. No verifica disponibilidad del proveedor.`) : { status: "UNKNOWN", explanation: "Sin trabajos indexados; no equivale a servicio saludable.", affectedCount: 0 };
  const snapshot = {
    rootId, version: 2, coverage: { complete: true, mode: "INCREMENTAL" },
    summary: { solicitudesActive: count("requestsOpen"), pagosCount: count("payments"), pagosAmount: count("paymentsRegisteredMinor") / 100, pendingPagosAmount: count("paymentsPendingMinor") / 100, invoicesIssued: count("invoicesIssued"), criticalAlerts: 0 },
    pipeline: [
      { key: "SOLICITUD", label: "Solicitudes", count: count("requests"), href: "/solicitudes" },
      { key: "FACTURA", label: "CFDI vigentes", count: count("invoicesIssued"), href: "/facturacion" },
      { key: "PAGO", label: "Pagos", count: count("payments"), href: "/pagos" },
      { key: "MATERIALIDAD", label: "Expedientes", count: count("files"), href: "/materialidad" },
      { key: "CIERRE", label: "Completos", count: count("filesComplete"), href: "/materialidad" },
    ],
    health: {
      solicitudes: health(count("requestsOpen"), `${count("requestsOpen")} solicitudes abiertas.`),
      pagos: health(count("paymentsPending"), `${count("paymentsPending")} pagos pendientes.`),
      facturama: health(count("invoicesPending"), `${count("invoicesPending")} borradores pendientes. No es una prueba de conexión con Facturama.`),
      materialidad: health(incomplete, `${incomplete} expedientes incompletos.`),
      wallet: health(count("dispersionsPending"), `${count("dispersionsPending")} dispersiones pendientes; saldo de clientes ${count("clientWalletMinor") / 100} MXN.`),
      hugo: { status: count("hugoRules") ? "HEALTHY" : "UNKNOWN", explanation: `${count("hugoProposals")} propuestas; ${count("hugoRules")} reglas registradas. Memoria observada no implica aprendizaje.`, affectedCount: count("hugoPending") },
      iq: integration("iq"), whatsapp: integration("whatsapp"), telegram: integration("telegram"),
    }, alerts, daily: {}, refreshedBy: actorUid, refreshedAt: FieldValue.serverTimestamp(),
  };
  await db.doc(`controlCenterSnapshots/${rootId}`).set(snapshot);
  return snapshot;
}
