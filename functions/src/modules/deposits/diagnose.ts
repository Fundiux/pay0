
import type { Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";

type AnyDoc = Record<string, any>;

export interface DiagnosePagoFinancialContextParams {
  db: Firestore;
  rootId: string;
  pagoId: string;
  operationTypeKey: string;
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

function simplifyDoc(snap: QueryDocumentSnapshot) {
  return {
    id: snap.id,
    path: snap.ref.path,
    data: snap.data() || {},
  };
}

async function listDocs(db: Firestore, collectionPath: string, limit = 50) {
  const snap = await db.collection(collectionPath).limit(limit).get();
  return snap.docs.map(simplifyDoc);
}

function findMatches(docs: Array<{ id: string; path: string; data: AnyDoc }>, operationTypeKey: string, despachoId?: string | null) {
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

export async function diagnosePagoFinancialContext(
  params: DiagnosePagoFinancialContextParams,
) {
  const { db, rootId, pagoId, operationTypeKey } = params;

  const pagoSnap = await db.doc(`pagos/${pagoId}`).get();
  if (!pagoSnap.exists) {
    return {
      ok: false,
      status: "PAGO_NOT_FOUND",
      pago: null,
    };
  }

  const pago = (pagoSnap.data() || {}) as AnyDoc;
  if (asText(pago.rootId) !== rootId) {
    return {
      ok: false,
      status: "OUT_OF_SCOPE",
      pago,
    };
  }

  const clienteId = firstText(pago, ["clienteId", "clientId"]);
  const companyId = firstText(pago, ["companyId"]);

  const clientSnap = clienteId ? await db.doc(`clients/${clienteId}`).get() : null;
  const companySnap = companyId ? await db.doc(`companies/${companyId}`).get() : null;

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

  const operationTypes = await listDocs(db, "operationTypes", 50);
  const clientCosts = clienteId ? await listDocs(db, `clients/${clienteId}/costos`, 100) : [];
  const operadorCosts = operadorId ? await listDocs(db, `users/${operadorId}/costos`, 100) : [];
  const adminCosts = adminId ? await listDocs(db, `users/${adminId}/costos`, 100) : [];
  const rootCosts = await listDocs(db, `users/${rootId}/costos`, 100);
  const despachoCosts = despachoId ? await listDocs(db, `despachos/${despachoId}/costos`, 100) : [];

  return {
    ok: true,
    status: "OK",
    pago: {
      id: pagoId,
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
          nombre:
            client.nombre ||
            client.clienteNombre ||
            client.name ||
            null,
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
      operationTypes: findMatches(operationTypes, operationTypeKey, despachoId),
      clientCosts: findMatches(clientCosts, operationTypeKey, despachoId),
      operadorCosts: findMatches(operadorCosts, operationTypeKey, despachoId),
      adminCosts: findMatches(adminCosts, operationTypeKey, despachoId),
      rootCosts: findMatches(rootCosts, operationTypeKey, despachoId),
      despachoCosts: findMatches(despachoCosts, operationTypeKey, despachoId),
    },
  };
}
