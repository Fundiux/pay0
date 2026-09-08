import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { money2 } from "../shared/money";
import { postCanonicalPagoFinancials, type PostCanonicalPagoFinancialsResult } from "./financial";

type AnyDoc = Record<string, any>;
type BaseType = "TOTAL" | "SUBTOTAL";
type PricingMode = "PERCENT" | "FIXED";

type ResolvedRateSource =
  | "CLIENT_COST"
  | "OPERADOR_COST"
  | "ADMIN_COST"
  | "SUPERADMIN_COST"
  | "DESPACHO_BASE"
  | null;

export interface ResolvePagoOperationPreviewParams {
  db: Firestore;
  rootId: string;
  pagoId: string;
  operationTypeKey: string;
}

export interface PagoOperationPreview {
  ok: boolean;
  status: string;
  canPost: boolean;
  missing: string[];
  pagoStatus: string;
  financialPostingStatus: string;
  clienteId: string | null;
  companyId: string | null;
  despachoId: string | null;
  operationTypeKey: string;
  operationTypeName: string;
  finalClientRate: number | null;
  calculationBaseType: BaseType;
  pricingMode: PricingMode;
  rateSource: ResolvedRateSource;
}

export interface PreparePagoFinancialPostingParams {
  db: Firestore;
  rootId: string;
  pagoId: string;
  operationTypeKey: string;
  postNow: boolean;
  actorUid: string;
  actorUsername: string;
  actorRole: string;
}

export interface PreparePagoFinancialPostingResult {
  ok: boolean;
  status: string;
  preview: PagoOperationPreview;
  postResult?: PostCanonicalPagoFinancialsResult | null;
}

function asText(value: unknown) {
  return String(value ?? "").trim();
}

function firstText(doc: AnyDoc | null | undefined, keys: string[]) {
  const source = doc || {};
  for (const key of keys) {
    const value = asText(source[key]);
    if (value) return value;
  }
  return "";
}

function firstMoney(doc: AnyDoc | null | undefined, keys: string[]) {
  const source = doc || {};
  for (const key of keys) {
    const raw = source[key];
    if (raw === null || raw === undefined || raw === "") continue;
    const num = Number(raw);
    if (Number.isFinite(num)) return money2(num);
  }
  return 0;
}

function normalizeBaseType(value: unknown): BaseType {
  return asText(value).toUpperCase() === "SUBTOTAL" ? "SUBTOTAL" : "TOTAL";
}

function normalizePricingMode(value: unknown): PricingMode {
  const mode = asText(value).toUpperCase();
  if (mode === "FIXED") return "FIXED";
  if (mode === ["MI", "XED"].join("")) return "FIXED";
  return "PERCENT";
}

async function readFirstExistingDoc(db: Firestore, paths: string[]) {
  for (const docPath of paths) {
    const snap = await db.doc(docPath).get();
    if (snap.exists) {
      return (snap.data() || {}) as AnyDoc;
    }
  }
  return null;
}

function docRate(doc: AnyDoc | null | undefined) {
  return firstMoney(doc, ["assignedCost", "baseCost"]);
}

function resolveSelectedRateDoc(params: {
  clientCostDoc: AnyDoc | null;
  operadorCostDoc: AnyDoc | null;
  adminCostDoc: AnyDoc | null;
  superadminCostDoc: AnyDoc | null;
  despachoCostDoc: AnyDoc | null;
}) {
  const ordered: Array<{ source: ResolvedRateSource; doc: AnyDoc | null }> = [
    { source: "CLIENT_COST", doc: params.clientCostDoc },
    { source: "OPERADOR_COST", doc: params.operadorCostDoc },
    { source: "ADMIN_COST", doc: params.adminCostDoc },
    { source: "SUPERADMIN_COST", doc: params.superadminCostDoc },
    { source: "DESPACHO_BASE", doc: params.despachoCostDoc },
  ];

  for (const item of ordered) {
    if (docRate(item.doc) > 0) {
      return item;
    }
  }

  return { source: null as ResolvedRateSource, doc: null as AnyDoc | null };
}

export async function resolvePagoOperationPreview(
  params: ResolvePagoOperationPreviewParams,
): Promise<PagoOperationPreview> {
  const { db, rootId, pagoId, operationTypeKey } = params;

  const pagoSnap = await db.doc(`pagos/${pagoId}`).get();
  if (!pagoSnap.exists) {
    return {
      ok: false,
      status: "PAGO_NOT_FOUND",
      canPost: false,
      missing: ["PAGO_NOT_FOUND"],
      pagoStatus: "",
      financialPostingStatus: "",
      clienteId: null,
      companyId: null,
      despachoId: null,
      operationTypeKey,
      operationTypeName: operationTypeKey,
      finalClientRate: null,
      calculationBaseType: "TOTAL",
      pricingMode: "PERCENT",
      rateSource: null,
    };
  }

  const pago = (pagoSnap.data() || {}) as AnyDoc;
  if (asText(pago.rootId) !== rootId) {
    return {
      ok: false,
      status: "OUT_OF_SCOPE",
      canPost: false,
      missing: ["OUT_OF_SCOPE"],
      pagoStatus: asText(pago.status).toUpperCase(),
      financialPostingStatus: asText(pago.financialPostingStatus).toUpperCase(),
      clienteId: firstText(pago, ["clienteId", "clientId"]) || null,
      companyId: firstText(pago, ["companyId"]) || null,
      despachoId: firstText(pago, ["despachoId"]) || null,
      operationTypeKey,
      operationTypeName: operationTypeKey,
      finalClientRate: null,
      calculationBaseType: "TOTAL",
      pricingMode: "PERCENT",
      rateSource: null,
    };
  }

  const clienteId = firstText(pago, ["clienteId", "clientId"]);
  const companyId = firstText(pago, ["companyId"]);
  const pagoStatus = asText(pago.status).toUpperCase();
  const financialPostingStatus = asText(pago.financialPostingStatus).toUpperCase();

  const missing: string[] = [];
  if (!clienteId) missing.push("MISSING_CLIENT");
  if (!companyId) missing.push("MISSING_COMPANY");

  const clientSnap = clienteId ? await db.doc(`clients/${clienteId}`).get() : null;
  const companySnap = companyId ? await db.doc(`companies/${companyId}`).get() : null;
  const operationTypeSnap = await db.doc(`operationTypes/${operationTypeKey}`).get();

  const clientDoc = clientSnap?.exists ? ((clientSnap.data() || {}) as AnyDoc) : null;
  const companyDoc = companySnap?.exists ? ((companySnap.data() || {}) as AnyDoc) : null;
  const operationTypeDoc = operationTypeSnap.exists ? ((operationTypeSnap.data() || {}) as AnyDoc) : null;

  if (!clientDoc) missing.push("MISSING_CLIENT_DOC");
  if (!companyDoc) missing.push("MISSING_COMPANY_DOC");
  if (!operationTypeDoc) missing.push("MISSING_OPERATION_TYPE");
  if (operationTypeDoc && operationTypeDoc.active === false) missing.push("INACTIVE_OPERATION_TYPE");

  const despachoId =
    firstText(pago, ["despachoId"]) ||
    firstText(companyDoc, ["despachoId"]) ||
    null;

  if (!despachoId) missing.push("MISSING_DESPACHO");

  const adminId =
    firstText(clientDoc, ["adminId"]) ||
    firstText(pago, ["adminId"]) ||
    null;

  const operadorId =
    firstText(clientDoc, ["operadorId"]) ||
    firstText(clientDoc, ["managedByUserId"]) ||
    null;

  const clientCostDoc =
    clienteId && despachoId
      ? await readFirstExistingDoc(db, [
          `clients/${clienteId}/costos/${despachoId}__${operationTypeKey}`,
          `clients/${clienteId}/costos/${operationTypeKey}`,
        ])
      : null;

  const operadorCostDoc =
    operadorId && despachoId
      ? await readFirstExistingDoc(db, [
          `users/${operadorId}/costos/${despachoId}__${operationTypeKey}`,
          `users/${operadorId}/costos/${operationTypeKey}`,
        ])
      : null;

  const adminCostDoc =
    adminId && adminId !== rootId && despachoId
      ? await readFirstExistingDoc(db, [
          `users/${adminId}/costos/${despachoId}__${operationTypeKey}`,
          `users/${adminId}/costos/${operationTypeKey}`,
        ])
      : null;

  const superadminCostDoc =
    rootId && despachoId
      ? await readFirstExistingDoc(db, [
          `users/${rootId}/costos/${despachoId}__${operationTypeKey}`,
          `users/${rootId}/costos/${operationTypeKey}`,
        ])
      : null;

  const despachoCostDoc =
    despachoId
      ? await readFirstExistingDoc(db, [
          `despachos/${despachoId}/costos/${operationTypeKey}`,
        ])
      : null;

  const selected = resolveSelectedRateDoc({
    clientCostDoc,
    operadorCostDoc,
    adminCostDoc,
    superadminCostDoc,
    despachoCostDoc,
  });

  const finalClientRate = selected.doc ? docRate(selected.doc) : null;
  const rateSource = selected.source;

  if (!finalClientRate) {
    missing.push("MISSING_CLIENT_RATE");
  }

  const calculationBaseType = normalizeBaseType(
    firstText(selected.doc, ["calculationBaseType"]) ||
    firstText(operationTypeDoc, ["calculationBaseType"]) ||
    "TOTAL",
  );

  const pricingMode = normalizePricingMode(
    firstText(selected.doc, ["pricingMode"]) ||
    firstText(operationTypeDoc, ["pricingMode"]) ||
    "PERCENT",
  );

  return {
    ok: missing.length === 0,
    status: missing.length === 0 ? "READY" : "INCOMPLETE",
    canPost: missing.length === 0,
    missing,
    pagoStatus,
    financialPostingStatus,
    clienteId: clienteId || null,
    companyId: companyId || null,
    despachoId,
    operationTypeKey,
    operationTypeName:
      firstText(selected.doc, ["operationTypeName"]) ||
      firstText(operationTypeDoc, ["name", "key"]) ||
      operationTypeKey,
    finalClientRate,
    calculationBaseType,
    pricingMode,
    rateSource,
  };
}

export async function preparePagoFinancialPosting(
  params: PreparePagoFinancialPostingParams,
): Promise<PreparePagoFinancialPostingResult> {
  const {
    db,
    rootId,
    pagoId,
    operationTypeKey,
    postNow,
    actorUid,
    actorUsername,
    actorRole,
  } = params;

  const preview = await resolvePagoOperationPreview({
    db,
    rootId,
    pagoId,
    operationTypeKey,
  });

  const pagoRef = db.doc(`pagos/${pagoId}`);

  await pagoRef.set(
    {
      operationTypeKey,
      saleTypeKey: preview.calculationBaseType,
      pricingMode: preview.pricingMode,
      calculationBaseType: preview.calculationBaseType,
      finalClientRate: preview.finalClientRate,
      despachoId: preview.despachoId || null,
      operationPreview: {
        operationTypeKey: preview.operationTypeKey,
        operationTypeName: preview.operationTypeName,
        finalClientRate: preview.finalClientRate,
        calculationBaseType: preview.calculationBaseType,
        pricingMode: preview.pricingMode,
        rateSource: preview.rateSource,
        missing: preview.missing,
        resolvedAt: FieldValue.serverTimestamp(),
        resolvedBy: actorUid,
      },
      financialPostingStatus: preview.canPost ? "PENDING" : "PENDING_CONFIGURATION",
      financialPostingError: preview.canPost
        ? null
        : `Faltantes: ${preview.missing.join(", ")}`,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  let postResult: PostCanonicalPagoFinancialsResult | null = null;

  if (
    postNow &&
    preview.canPost &&
    preview.pagoStatus === "CONCILIADO" &&
    preview.financialPostingStatus !== "POSTED"
  ) {
    postResult = await postCanonicalPagoFinancials({
      db,
      rootId,
      pagoId,
      actorUid,
      actorUsername,
      actorRole,
    });
  }

  return {
    ok: true,
    status: postResult?.status || preview.status,
    preview,
    postResult,
  };
}

type DebugDoc = {
  id: string;
  path: string;
  data: AnyDoc;
};

async function listDocs(db: Firestore, collectionPath: string, limit = 100): Promise<DebugDoc[]> {
  const snap = await db.collection(collectionPath).limit(limit).get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    path: doc.ref.path,
    data: (doc.data() || {}) as AnyDoc,
  }));
}

function debugMatchDocs(
  docs: DebugDoc[],
  operationTypeKey: string,
  despachoId?: string | null,
) {
  const op = asText(operationTypeKey).toUpperCase();
  const despacho = asText(despachoId);

  return docs.filter((item) => {
    const data = item.data || {};
    const opKey = asText(data.operationTypeKey).toUpperCase();
    const opName = asText(data.operationTypeName).toUpperCase();
    const key = asText(data.key).toUpperCase();
    const name = asText(data.name).toUpperCase();
    const itemDespachoId = asText(data.despachoId);

    const opMatch =
      opKey === op ||
      opName === op ||
      key === op ||
      name === op ||
      asText(item.id).toUpperCase() === op;

    const despachoMatch =
      !despacho ||
      !itemDespachoId ||
      itemDespachoId === despacho ||
      asText(item.id).includes(despacho);

    return opMatch && despachoMatch;
  });
}

export async function resolvePagoOperationPreviewDebug(
  params: ResolvePagoOperationPreviewParams,
) {
  const preview = await resolvePagoOperationPreview(params);

  const pagoSnap = await params.db.doc(`pagos/${params.pagoId}`).get();
  const pago = (pagoSnap.data() || {}) as AnyDoc;

  const clienteId = firstText(pago, ["clienteId", "clientId"]);
  const companyId = firstText(pago, ["companyId"]);

  const clientSnap = clienteId ? await params.db.doc(`clients/${clienteId}`).get() : null;
  const companySnap = companyId ? await params.db.doc(`companies/${companyId}`).get() : null;

  const client = clientSnap?.exists ? ((clientSnap.data() || {}) as AnyDoc) : null;
  const company = companySnap?.exists ? ((companySnap.data() || {}) as AnyDoc) : null;

  const despachoId =
    firstText(pago, ["despachoId"]) ||
    firstText(company, ["despachoId"]) ||
    null;

  const adminId =
    firstText(client, ["adminId"]) ||
    firstText(pago, ["adminId"]) ||
    null;

  const operadorId =
    firstText(client, ["operadorId"]) ||
    firstText(client, ["managedByUserId"]) ||
    null;

  const operationTypes = await listDocs(params.db, "operationTypes", 50);
  const clientCosts = clienteId ? await listDocs(params.db, `clients/${clienteId}/costos`, 100) : [];
  const operadorCosts = operadorId ? await listDocs(params.db, `users/${operadorId}/costos`, 100) : [];
  const adminCosts = adminId ? await listDocs(params.db, `users/${adminId}/costos`, 100) : [];
  const rootCosts = await listDocs(params.db, `users/${params.rootId}/costos`, 100);
  const despachoCosts = despachoId ? await listDocs(params.db, `despachos/${despachoId}/costos`, 100) : [];

  return {
    ...preview,
    debug: {
      pago: {
        rootId: pago.rootId || null,
        status: pago.status || null,
        clienteId,
        companyId,
        despachoId,
        operationTypeKey: pago.operationTypeKey || null,
        saleTypeKey: pago.saleTypeKey || null,
        pricingMode: pago.pricingMode || null,
        calculationBaseType: pago.calculationBaseType || null,
        finalClientRate: pago.finalClientRate ?? null,
        financialPostingStatus: pago.financialPostingStatus || null,
        financialPostingError: pago.financialPostingError || null,
        operationPreview: pago.operationPreview || null,
      },
      client: client
        ? {
            id: clienteId,
            nombre: client.nombre || client.clienteNombre || client.name || null,
            adminId: client.adminId || null,
            operadorId: client.operadorId || null,
            managedByUserId: client.managedByUserId || null,
            rootId: client.rootId || null,
          }
        : null,
      company: company
        ? {
            id: companyId,
            nombre: company.nombre || company.name || null,
            despachoId: company.despachoId || null,
            rootId: company.rootId || null,
          }
        : null,
      operationTypes,
      clientCosts,
      operadorCosts,
      adminCosts,
      rootCosts,
      despachoCosts,
      matches: {
        operationTypes: debugMatchDocs(operationTypes, params.operationTypeKey, despachoId),
        clientCosts: debugMatchDocs(clientCosts, params.operationTypeKey, despachoId),
        operadorCosts: debugMatchDocs(operadorCosts, params.operationTypeKey, despachoId),
        adminCosts: debugMatchDocs(adminCosts, params.operationTypeKey, despachoId),
        rootCosts: debugMatchDocs(rootCosts, params.operationTypeKey, despachoId),
        despachoCosts: debugMatchDocs(despachoCosts, params.operationTypeKey, despachoId),
      },
    },
  };
}
