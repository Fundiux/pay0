import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { mexicoDate, mexicoDayRange, parseCalendarDay } from "../agent007/hugoReadTools/search";
import { getEarningsByClientReportHandler } from "../reports/callables";
import { getMyUser, getRootId, requireAuth } from "../sharedCallables/helpers";
import { computeBusinessIndicators } from "./domain";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/** Rows read per collection; above it the answer says the period is incomplete. */
const READ_LIMIT = 5000;
const MAX_PERIOD_DAYS = 366;

function resolvePeriod(data: Record<string, any>): { desde: string; hasta: string } {
  const today = mexicoDate(new Date()) as string;
  const desde = String(data.desde || "").trim() || `${today.slice(0, 7)}-01`;
  const hasta = String(data.hasta || "").trim() || today;
  const from = parseCalendarDay(desde), to = parseCalendarDay(hasta);
  if (!from || !to || desde > hasta) throw new HttpsError("invalid-argument", "Periodo inválido.");
  if ((Date.UTC(to.y, to.m - 1, to.d) - Date.UTC(from.y, from.m - 1, from.d)) / 86_400_000 > MAX_PERIOD_DAYS) throw new HttpsError("invalid-argument", "El periodo no puede ser mayor a un año.");
  return { desde, hasta };
}

const rowsOf = (snapshot: FirebaseFirestore.QuerySnapshot, rootId: string) => snapshot.docs.slice(0, READ_LIMIT).map(doc => {
  const row = doc.data();
  if (row.rootId !== rootId) throw new HttpsError("permission-denied", "Consulta bloqueada por alcance de datos.");
  return { ...row, id: doc.id };
});

/**
 * Business indicators for the owner. Superadmin only; every read is scoped by the server-resolved rootId.
 * Read-only: it never writes. Utilidad comes from the canonical earnings report (gross profit of conciliated pagos).
 */
export const getBusinessIndicators = onCall({ cors: true, timeoutSeconds: 120, memory: "512MiB" }, async request => {
  const uid = requireAuth(request);
  const user = await getMyUser(uid);
  assertAuthorized(request.auth, user, { allowedRoles: ["superadmin"], requiredModule: "dashboard", requiredAction: "view" });
  const rootId = await getRootId(uid);
  const period = resolvePeriod(request.data || {});
  const { fromMs, toMs } = mexicoDayRange(period.desde, period.hasta);
  const from = admin.firestore.Timestamp.fromMillis(fromMs as number), to = admin.firestore.Timestamp.fromMillis(toMs as number);
  const inPeriod = (collection: string) => db.collection(collection).where("rootId", "==", rootId).where("createdAt", ">=", from).where("createdAt", "<", to).orderBy("createdAt", "desc").limit(READ_LIMIT + 1).get();

  const [pagos, solicitudes, facturas, earnings] = await Promise.all([
    inPeriod("pagos"), inPeriod("solicitudes"),
    db.collection("facturamaInvoices").where("rootId", "==", rootId).where("createdAt", ">=", from).orderBy("createdAt", "desc").limit(READ_LIMIT + 1).get(),
    getEarningsByClientReportHandler({ ...request, data: { dateFrom: new Date(fromMs as number).toISOString(), dateTo: new Date((toMs as number) - 1).toISOString(), limit: READ_LIMIT } } as any),
  ]);

  const indicators = computeBusinessIndicators({ pagos: rowsOf(pagos, rootId), solicitudes: rowsOf(solicitudes, rootId), facturas: rowsOf(facturas, rootId) });
  const incomplete = [pagos, solicitudes, facturas].some(snapshot => snapshot.size > READ_LIMIT) || earnings.docsScanned >= READ_LIMIT;
  const best = earnings.rows.find(row => row.totalEarningsAmount > 0) || null;
  return {
    ok: true, periodo: period, ...indicators,
    mejorClientePorUtilidad: best ? { clienteId: best.clienteId, cliente: best.clienteNombre || "Cliente sin nombre", utilidad: best.totalEarningsAmount, operaciones: best.operationsCount } : null,
    advertencias: [...indicators.advertencias, ...(incomplete ? [`Se leyeron como máximo ${READ_LIMIT} registros por consulta; el periodo puede estar incompleto.`] : [])],
  };
});
