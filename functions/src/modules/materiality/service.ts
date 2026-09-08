import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  MATERIALITY_REQUIRED_TYPES,
  buildMaterialityClientCompanyId,
  cleanText,
  getMaterialityDocumentLabel,
  normalizeMaterialityDocumentType,
} from "./domain";

const db = getFirestore();

function requireUid(request: any): string {
  const uid = cleanText(request?.auth?.uid);
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sesion requerida.");
  }
  return uid;
}

async function getUser(uid: string): Promise<any> {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) {
    throw new HttpsError("permission-denied", "Usuario no encontrado.");
  }
  return { id: uid, ...(snap.data() || {}) };
}

function getRole(user: any): string {
  return cleanText(user?.role || user?.rol).toLowerCase();
}

function getRootId(user: any, uid: string): string {
  return cleanText(user?.rootId || uid);
}

function getUsername(user: any, uid: string): string {
  return cleanText(
    user?.username ||
    user?.displayName ||
    user?.name ||
    user?.nombre ||
    user?.email ||
    uid
  );
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isTerminalSolicitudStatus(status: unknown): boolean {
  const raw = cleanText(status).toUpperCase();
  return raw === "CANCELADA" || raw === "CANCELADO" || raw === "ELIMINADA" || raw === "RECHAZADA";
}

async function hasDelegatedClientAccess(uid: string, clienteId: string): Promise<boolean> {
  if (!uid || !clienteId) return false;
  const snap = await db.doc(`userClientAccess/${uid}/clients/${clienteId}`).get();
  return snap.exists && snap.data()?.active === true;
}

async function assertCanAccessClient(user: any, uid: string, rootId: string, client: any, clienteId: string): Promise<void> {
  if (cleanText(client?.rootId) && cleanText(client.rootId) !== rootId) {
    throw new HttpsError("permission-denied", "Cliente fuera del root.");
  }

  const role = getRole(user);
  if (role === "superadmin" || role === "super_admin") return;

  if (cleanText(client?.adminId) === uid) return;
  if (cleanText(client?.createdBy) === uid) return;
  if (cleanText(client?.ownerId) === uid) return;
  if (await hasDelegatedClientAccess(uid, clienteId)) return;

  if (role === "admin" && cleanText(client?.adminId) === cleanText(user?.adminId)) return;

  throw new HttpsError("permission-denied", "No autorizado para este cliente.");
}

function assertSameRoot(row: any, rootId: string, label: string): void {
  const rowRoot = cleanText(row?.rootId);
  if (rowRoot && rowRoot !== rootId) {
    throw new HttpsError("permission-denied", `${label} fuera del root.`);
  }
}

async function loadClientAndCompany(user: any, uid: string, rootId: string, clienteId: string, companyId: string) {
  if (!clienteId || !companyId) {
    throw new HttpsError("invalid-argument", "clienteId y companyId son obligatorios.");
  }

  const [clientSnap, companySnap] = await Promise.all([
    db.collection("clients").doc(clienteId).get(),
    db.collection("companies").doc(companyId).get(),
  ]);

  if (!clientSnap.exists) {
    throw new HttpsError("not-found", "Cliente no encontrado.");
  }

  if (!companySnap.exists) {
    throw new HttpsError("not-found", "Empresa no encontrada.");
  }

  const client = clientSnap.data() || {};
  const company = companySnap.data() || {};

  assertSameRoot(client, rootId, "Cliente");
  assertSameRoot(company, rootId, "Empresa");

  if (client.active === false) {
    throw new HttpsError("failed-precondition", "Cliente inactivo.");
  }

  if (company.active === false) {
    throw new HttpsError("failed-precondition", "Empresa inactiva.");
  }

  await assertCanAccessClient(user, uid, rootId, client, clienteId);

  return { client, company };
}

function pickClientName(client: any, fallback: string): string {
  return cleanText(
    client?.clienteNombre ||
    client?.clientName ||
    client?.razonSocial ||
    client?.name ||
    fallback
  );
}

function pickCompanyName(company: any, fallback: string): string {
  return cleanText(
    company?.empresaNombre ||
    company?.companyName ||
    company?.razonSocial ||
    company?.nombre ||
    company?.name ||
    fallback
  );
}

function pickSolicitudClientName(solicitud: any, client: any, fallback: string): string {
  return cleanText(
    solicitud?.clienteNombre ||
    solicitud?.clientName ||
    pickClientName(client, fallback)
  );
}

function pickSolicitudCompanyName(solicitud: any, company: any, fallback: string): string {
  return cleanText(
    solicitud?.empresaNombre ||
    solicitud?.companyName ||
    pickCompanyName(company, fallback)
  );
}

async function ensureMaterialityClientCompanyTx(tx: any, params: {
  rootId: string;
  uid: string;
  username: string;
  clienteId: string;
  companyId: string;
  clienteNombre: string;
  companyName: string;
}) {
  const id = buildMaterialityClientCompanyId(params.rootId, params.clienteId, params.companyId);
  const ref = db.collection("materialityClientCompanies").doc(id);
  const snap = await tx.get(ref);

  const base = {
    rootId: params.rootId,
    clienteId: params.clienteId,
    clienteNombre: params.clienteNombre || null,
    companyId: params.companyId,
    companyName: params.companyName || null,
    status: "ACTIVE",
    publicEnabled: false,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: params.uid,
    updatedByUsername: params.username,
  };

  if (!snap.exists) {
    tx.set(ref, {
      ...base,
      primaryContractId: null,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: params.uid,
      createdByUsername: params.username,
    });
  } else {
    tx.set(ref, base, { merge: true });
  }

  return { id, ref };
}

function isReadyActiveUpload(row: any, rootId: string): boolean {
  return (
    cleanText(row?.rootId) === rootId &&
    row?.active === true &&
    cleanText(row?.status).toUpperCase() === "READY"
  );
}

function putLatestUploadByType(byType: Record<string, any>, row: any): void {
  const type = normalizeMaterialityDocumentType(row?.documentType);
  if (!type) return;

  const current = byType[type];
  const currentVersion = Number(current?.version || 0);
  const rowVersion = Number(row?.version || 0);

  if (!current || rowVersion >= currentVersion) {
    byType[type] = row;
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function getActiveUploadsBySolicitud(rootId: string, solicitudId: string): Promise<Record<string, any>> {
  const snap = await db
    .collection("uploads")
    .where("solicitudId", "==", solicitudId)
    .limit(150)
    .get();

  const byType: Record<string, any> = {};

  snap.docs.forEach((doc) => {
    const row = { id: doc.id, ...(doc.data() || {}) } as any;
    if (!isReadyActiveUpload(row, rootId)) return;
    if (cleanText(row.entityType) !== "solicitudes") return;

    putLatestUploadByType(byType, row);
  });

  return byType;
}

async function getActivePagoUploadsBySolicitud(rootId: string, solicitudId: string): Promise<Record<string, any>> {
  const aplicacionesSnap = await db
    .collection("pagoAplicaciones")
    .where("solicitudId", "==", solicitudId)
    .limit(100)
    .get();

  const pagoIds = Array.from(new Set(
    aplicacionesSnap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() || {}) } as any))
      .filter((row) => cleanText(row.rootId) === rootId)
      .filter((row) => !cleanText(row.status) || cleanText(row.status).toUpperCase() === "APLICADA")
      .map((row) => cleanText(row.pagoId))
      .filter(Boolean)
  ));

  const byType: Record<string, any> = {};
  if (pagoIds.length === 0) return byType;

  for (const chunk of chunkArray(pagoIds, 10)) {
    const uploadsSnap = await db
      .collection("uploads")
      .where("pagoId", "in", chunk)
      .limit(150)
      .get();

    uploadsSnap.docs.forEach((doc) => {
      const row = { id: doc.id, ...(doc.data() || {}) } as any;
      if (!isReadyActiveUpload(row, rootId)) return;
      if (cleanText(row.entityType) !== "pagos") return;
      if (cleanText(row.documentType).toUpperCase() !== "COMPROBANTE_PAGO") return;

      putLatestUploadByType(byType, row);
    });
  }

  return byType;
}

async function getPrimaryContract(materialityClientCompanyId: string): Promise<any | null> {
  const snap = await db
    .collection("materialityContracts")
    .where("materialityClientCompanyId", "==", materialityClientCompanyId)
    .limit(25)
    .get();

  const active = snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) } as any))
    .filter((row) => cleanText(row.status).toUpperCase() === "ACTIVE");

  active.sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
  return active[0] || null;
}

function buildCompletedTypes(activeUploadsByType: Record<string, any>, contract: any | null): string[] {
  const completed = new Set<string>();

  if (contract?.id || contract?.uploadId) {
    completed.add("CONTRATO_MARCO");
  }

  Object.keys(activeUploadsByType).forEach((type) => {
    if (type) completed.add(type);
  });

  return Array.from(completed);
}

function buildOperationStatus(solicitud: any, missingTypes: string[]): string {
  if (isTerminalSolicitudStatus(solicitud?.status)) return "CANCELLED";
  return missingTypes.length === 0 ? "COMPLETE" : "INCOMPLETE";
}

export async function ensureMaterialityClientCompanyCore(request: any) {
  const uid = requireUid(request);
  const user = await getUser(uid);
  const rootId = getRootId(user, uid);
  const username = getUsername(user, uid);

  const clienteId = cleanText(request?.data?.clienteId || request?.data?.clientId);
  const companyId = cleanText(request?.data?.companyId);

  const { client, company } = await loadClientAndCompany(user, uid, rootId, clienteId, companyId);

  const clienteNombre = pickClientName(client, clienteId);
  const companyName = pickCompanyName(company, companyId);

  const result = await db.runTransaction(async (tx) => {
    const ensured = await ensureMaterialityClientCompanyTx(tx, {
      rootId,
      uid,
      username,
      clienteId,
      companyId,
      clienteNombre,
      companyName,
    });

    return {
      ok: true,
      materialityClientCompanyId: ensured.id,
      clienteId,
      clienteNombre,
      companyId,
      companyName,
    };
  });

  return result;
}

export async function linkSolicitudToMaterialityOperationCore(request: any) {
  const uid = requireUid(request);
  const user = await getUser(uid);
  const rootId = getRootId(user, uid);
  const username = getUsername(user, uid);

  const solicitudId = cleanText(request?.data?.solicitudId || request?.data?.materialityOperationId);
  if (!solicitudId) {
    throw new HttpsError("invalid-argument", "solicitudId es obligatorio.");
  }

  const solicitudSnap = await db.collection("solicitudes").doc(solicitudId).get();
  if (!solicitudSnap.exists) {
    throw new HttpsError("not-found", "Solicitud no encontrada.");
  }

  const solicitud = solicitudSnap.data() || {};
  assertSameRoot(solicitud, rootId, "Solicitud");

  const clienteId = cleanText(solicitud?.clienteId || solicitud?.clientId);
  const companyId = cleanText(solicitud?.companyId);

  const { client, company } = await loadClientAndCompany(user, uid, rootId, clienteId, companyId);

  const clienteNombre = pickSolicitudClientName(solicitud, client, clienteId);
  const companyName = pickSolicitudCompanyName(solicitud, company, companyId);
  const materialityClientCompanyId = buildMaterialityClientCompanyId(rootId, clienteId, companyId);

  const [activeSolicitudUploadsByType, activePagoUploadsByType, contract] = await Promise.all([
    getActiveUploadsBySolicitud(rootId, solicitudId),
    getActivePagoUploadsBySolicitud(rootId, solicitudId),
    getPrimaryContract(materialityClientCompanyId),
  ]);

  const activeUploadsByType = {
    ...activeSolicitudUploadsByType,
    ...activePagoUploadsByType,
  };

  const completedTypes = buildCompletedTypes(activeUploadsByType, contract);
  const missingTypes = MATERIALITY_REQUIRED_TYPES.filter((type) => !completedTypes.includes(type));
  const operationStatus = buildOperationStatus(solicitud, missingTypes);
  const contractId = cleanText(contract?.id || "");
  const now = FieldValue.serverTimestamp();

  const operationRef = db.collection("materialityOperations").doc(solicitudId);
  const solicitudRef = db.collection("solicitudes").doc(solicitudId);

  await db.runTransaction(async (tx) => {
    await ensureMaterialityClientCompanyTx(tx, {
      rootId,
      uid,
      username,
      clienteId,
      companyId,
      clienteNombre,
      companyName,
    });

    tx.set(operationRef, {
      rootId,
      clienteId,
      clienteNombre,
      companyId,
      companyName,
      materialityClientCompanyId,
      solicitudId,
      solicitudFolio: cleanText(solicitud?.folio || solicitudId),
      monto: toNumber(solicitud?.monto),
      moneda: cleanText(solicitud?.moneda || "MXN") || "MXN",
      concepto: cleanText(solicitud?.concepto || solicitud?.comentario || solicitud?.folio || solicitudId),
      solicitudStatus: cleanText(solicitud?.status || ""),
      status: operationStatus,
      contractId: contractId || null,
      ordenCompraUploadId: cleanText(activeUploadsByType.ORDEN_COMPRA?.id) || null,
      presupuestoUploadId: cleanText(activeUploadsByType.PRESUPUESTO?.id) || null,
      facturaXmlUploadId: cleanText(activeUploadsByType.FACTURA_XML?.id) || null,
      facturaPdfUploadId: cleanText(activeUploadsByType.FACTURA_PDF?.id) || null,
      comprobantePagoUploadId: cleanText(activeUploadsByType.COMPROBANTE_PAGO?.id) || null,
      comprobantePagoSourceEntityType: cleanText(activeUploadsByType.COMPROBANTE_PAGO?.entityType) || null,
      comprobantePagoSourcePagoId: cleanText(activeUploadsByType.COMPROBANTE_PAGO?.pagoId) || null,
      comprobanteDispersionUploadIds: FieldValue.delete(),
      evidenciaUploadIds: activeUploadsByType.EVIDENCIA_OPERATIVA?.id
        ? [cleanText(activeUploadsByType.EVIDENCIA_OPERATIVA.id)]
        : [],
      requiredTypes: MATERIALITY_REQUIRED_TYPES,
      completedTypes,
      missingTypes,
      missingTypeLabels: missingTypes.map(getMaterialityDocumentLabel),
      publicTokenId: null,
      updatedAt: now,
      updatedBy: uid,
      updatedByUsername: username,
      createdAt: now,
      createdBy: uid,
      createdByUsername: username,
    }, { merge: true });

    tx.set(solicitudRef, {
      materialityClientCompanyId,
      materialityOperationId: solicitudId,
      materialityStatus: operationStatus,
      materialityMissingTypes: missingTypes,
      materialityUpdatedAt: now,
    }, { merge: true });
  });

  return {
    ok: true,
    materialityOperationId: solicitudId,
    materialityClientCompanyId,
    status: operationStatus,
    completedTypes,
    missingTypes,
  };
}

export async function getMaterialityOperationCore(request: any) {
  const uid = requireUid(request);
  const user = await getUser(uid);
  const rootId = getRootId(user, uid);

  const operationId = cleanText(request?.data?.materialityOperationId || request?.data?.solicitudId);
  if (!operationId) {
    throw new HttpsError("invalid-argument", "materialityOperationId o solicitudId es obligatorio.");
  }

  const snap = await db.collection("materialityOperations").doc(operationId).get();
  if (!snap.exists) {
    return { ok: true, exists: false, operation: null };
  }

  const row = snap.data() || {};
  assertSameRoot(row, rootId, "Operacion de materialidad");

  return {
    ok: true,
    exists: true,
    operation: { id: snap.id, ...row },
  };
}

export async function getMaterialityClientCompanyOverviewCore(request: any) {
  const uid = requireUid(request);
  const user = await getUser(uid);
  const rootId = getRootId(user, uid);

  if (!canViewMaterialityDashboard(user)) {
    throw new HttpsError("permission-denied", "No autorizado para ver Materialidad.");
  }

  let materialityClientCompanyId = cleanText(
    request?.data?.materialityClientCompanyId ||
    request?.data?.folderId ||
    request?.data?.id
  );

  let clienteId = cleanText(request?.data?.clienteId || request?.data?.clientId);
  let companyId = cleanText(request?.data?.companyId);
  let seedFolder: any | null = null;

  if (materialityClientCompanyId) {
    const folderSnapRaw = await db.collection("materialityClientCompanies").doc(materialityClientCompanyId).get();
    if (!folderSnapRaw.exists) {
      return {
        ok: true,
        exists: false,
        materialityClientCompanyId,
        folder: null,
        operations: [],
        contracts: [],
      };
    }

    seedFolder = { id: folderSnapRaw.id, ...(folderSnapRaw.data() || {}) };
    assertSameRoot(seedFolder, rootId, "Carpeta de materialidad");

    clienteId = clienteId || cleanText(seedFolder.clienteId);
    companyId = companyId || cleanText(seedFolder.companyId);
  }

  if (!materialityClientCompanyId) {
    if (!clienteId || !companyId) {
      throw new HttpsError("invalid-argument", "materialityClientCompanyId o clienteId/companyId es obligatorio.");
    }

    materialityClientCompanyId = buildMaterialityClientCompanyId(rootId, clienteId, companyId);
  }

  const [folderSnap, operationsSnap, contractsSnap] = await Promise.all([
    db.collection("materialityClientCompanies").doc(materialityClientCompanyId).get(),
    db.collection("materialityOperations").where("materialityClientCompanyId", "==", materialityClientCompanyId).limit(300).get(),
    db.collection("materialityContracts").where("materialityClientCompanyId", "==", materialityClientCompanyId).limit(50).get(),
  ]);

  const folder = seedFolder || (folderSnap.exists ? { id: folderSnap.id, ...(folderSnap.data() || {}) } : null);

  if (folder) {
    assertSameRoot(folder, rootId, "Carpeta de materialidad");
  }

  const operations = operationsSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) } as any))
    .filter((row) => cleanText(row.rootId) === rootId)
    .sort((a, b) => toMillis(b.updatedAt || b.createdAt) - toMillis(a.updatedAt || a.createdAt));

  const contracts = contractsSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) } as any))
    .filter((row) => cleanText(row.rootId) === rootId)
    .sort((a, b) => Number(b.version || 0) - Number(a.version || 0));

  const requiredSet = new Set<string>();
  const completedSet = new Set<string>();
  const missingSet = new Set<string>();

  operations.forEach((operation: any) => {
    if (Array.isArray(operation.requiredTypes)) {
      operation.requiredTypes.forEach((type: any) => {
        const normalized = cleanText(type).toUpperCase();
        if (normalized) requiredSet.add(normalized);
      });
    }

    if (Array.isArray(operation.completedTypes)) {
      operation.completedTypes.forEach((type: any) => {
        const normalized = cleanText(type).toUpperCase();
        if (normalized) completedSet.add(normalized);
      });
    }

    normalizeMissingTypesFromOperation(operation).forEach((type) => missingSet.add(type));
  });

  const requiredTypes = Array.from(requiredSet);
  const completedTypes = Array.from(completedSet);
  const missingTypes = Array.from(missingSet);

  const activeOperations = operations.filter((row) => !isCancelledMaterialityOperation(row));
  const totalAmount = activeOperations.reduce((sum, row) => sum + toNumber(row?.monto), 0);

  return {
    ok: true,
    exists: !!folder || operations.length > 0 || contracts.length > 0,
    materialityClientCompanyId,
    folder,
    operations,
    contracts,
    summary: {
      operationCount: operations.length,
      activeOperationCount: activeOperations.length,
      contractCount: contracts.length,
      totalAmount,
      requiredTypes,
      completedTypes,
      missingTypes,
      missingTypeLabels: missingTypes.map(getMaterialityDocumentLabel),
      status: missingTypes.length > 0 ? "INCOMPLETE" : activeOperations.length > 0 ? "COMPLETE" : "NO_OPERATIONS",
      updatedAt: folder?.updatedAt || operations[0]?.updatedAt || operations[0]?.createdAt || null,
    },
  };
}

function canViewMaterialityDashboard(user: any): boolean {
  const role = getRole(user);
  if (role === "superadmin" || role === "super_admin") return true;
  return user?.modules?.materialidad?.view === true;
}

function normalizeDashboardStatus(value: unknown): string {
  return cleanText(value).toUpperCase();
}

function toMillis(value: any): number {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return Number(value.toMillis()) || 0;
  if (typeof value?.seconds === "number") return Number(value.seconds) * 1000;
  if (typeof value?._seconds === "number") return Number(value._seconds) * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickLatestTimestamp(...values: any[]): any {
  let best: any = null;
  let bestMs = 0;
  values.forEach((value) => {
    const ms = toMillis(value);
    if (ms >= bestMs) {
      bestMs = ms;
      best = value;
    }
  });
  return best || null;
}

function normalizeMissingTypesFromOperation(row: any): string[] {
  if (Array.isArray(row?.missingTypes)) {
    return row.missingTypes.map((item: any) => cleanText(item).toUpperCase()).filter(Boolean);
  }

  const completed = new Set(
    Array.isArray(row?.completedTypes)
      ? row.completedTypes.map((item: any) => cleanText(item).toUpperCase()).filter(Boolean)
      : []
  );

  return MATERIALITY_REQUIRED_TYPES.filter((type) => !completed.has(type));
}

function isCancelledMaterialityOperation(row: any): boolean {
  const status = normalizeDashboardStatus(row?.status || row?.solicitudStatus);
  return status === "CANCELLED" || status === "CANCELADA" || status === "CANCELADO" || status === "ELIMINADA" || status === "RECHAZADA";
}

function isCompleteMaterialityOperation(row: any): boolean {
  const status = normalizeDashboardStatus(row?.status);
  if (status === "COMPLETE") return true;
  if (status === "INCOMPLETE" || status === "OPEN") return false;
  return normalizeMissingTypesFromOperation(row).length === 0;
}

function buildDashboardSearchText(row: any): string {
  return [
    row?.clienteNombre,
    row?.clientName,
    row?.companyName,
    row?.empresaNombre,
    row?.clienteId,
    row?.companyId,
    row?.materialityClientCompanyId,
  ]
    .map((item) => cleanText(item).toLowerCase())
    .filter(Boolean)
    .join(" ");
}

export async function getMaterialityDashboardCore(request: any) {
  const uid = requireUid(request);
  const user = await getUser(uid);
  const rootId = getRootId(user, uid);

  if (!canViewMaterialityDashboard(user)) {
    throw new HttpsError("permission-denied", "No autorizado para ver Materialidad.");
  }

  const rawLimit = Math.floor(toNumber(request?.data?.limit || 200));
  const limit = Math.max(1, Math.min(rawLimit || 200, 500));
  const statusFilter = normalizeDashboardStatus(request?.data?.status || "ALL");
  const search = cleanText(request?.data?.search).toLowerCase();

  const [foldersSnap, operationsSnap, contractsSnap] = await Promise.all([
    db.collection("materialityClientCompanies").where("rootId", "==", rootId).limit(500).get(),
    db.collection("materialityOperations").where("rootId", "==", rootId).limit(1000).get(),
    db.collection("materialityContracts").where("rootId", "==", rootId).limit(500).get(),
  ]);

  const foldersById = new Map<string, any>();
  foldersSnap.docs.forEach((doc) => {
    const row = { id: doc.id, ...(doc.data() || {}) } as any;
    if (cleanText(row.rootId) !== rootId) return;
    foldersById.set(doc.id, row);
  });

  const operations = operationsSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) } as any))
    .filter((row) => cleanText(row.rootId) === rootId);

  const contracts = contractsSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) } as any))
    .filter((row) => cleanText(row.rootId) === rootId);

  const operationsByFolder = new Map<string, any[]>();
  operations.forEach((row) => {
    const key = cleanText(row.materialityClientCompanyId) || buildMaterialityClientCompanyId(rootId, cleanText(row.clienteId), cleanText(row.companyId));
    if (!key) return;
    if (!operationsByFolder.has(key)) operationsByFolder.set(key, []);
    operationsByFolder.get(key)!.push(row);
    if (!foldersById.has(key)) {
      foldersById.set(key, {
        id: key,
        rootId,
        materialityClientCompanyId: key,
        clienteId: cleanText(row.clienteId),
        clienteNombre: cleanText(row.clienteNombre),
        companyId: cleanText(row.companyId),
        companyName: cleanText(row.companyName),
        status: "VIRTUAL",
        updatedAt: row.updatedAt || row.createdAt || null,
      });
    }
  });

  const contractsByFolder = new Map<string, any[]>();
  contracts.forEach((row) => {
    const key = cleanText(row.materialityClientCompanyId);
    if (!key) return;
    if (!contractsByFolder.has(key)) contractsByFolder.set(key, []);
    contractsByFolder.get(key)!.push(row);
  });

  const rows = Array.from(foldersById.values()).map((folder: any) => {
    const id = cleanText(folder.id || folder.materialityClientCompanyId);
    const folderOperations = (operationsByFolder.get(id) || []).sort((a, b) => toMillis(b.updatedAt || b.createdAt) - toMillis(a.updatedAt || a.createdAt));
    const folderContracts = (contractsByFolder.get(id) || []).sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
    const activeContract = folderContracts.find((row) => normalizeDashboardStatus(row.status) === "ACTIVE") || folderContracts[0] || null;

    const activeOperations = folderOperations.filter((row) => !isCancelledMaterialityOperation(row));
    const cancelledOperationCount = folderOperations.length - activeOperations.length;
    const incompleteOperations = activeOperations.filter((row) => normalizeMissingTypesFromOperation(row).length > 0 || normalizeDashboardStatus(row.status) === "INCOMPLETE");
    const completeOperations = activeOperations.filter((row) => isCompleteMaterialityOperation(row) && normalizeMissingTypesFromOperation(row).length === 0);

    const missingSet = new Set<string>();
    incompleteOperations.forEach((row) => {
      normalizeMissingTypesFromOperation(row).forEach((type) => missingSet.add(type));
    });

    const missingTypes = Array.from(missingSet);
    const latestOperation = folderOperations[0] || null;
    const latestOperationAt = latestOperation ? pickLatestTimestamp(latestOperation.updatedAt, latestOperation.createdAt) : null;
    const updatedAt = pickLatestTimestamp(folder.updatedAt, latestOperationAt, activeContract?.updatedAt, activeContract?.createdAt);

    let status = "NO_OPERATIONS";
    if (activeOperations.length > 0 && incompleteOperations.length > 0) status = "INCOMPLETE";
    if (activeOperations.length > 0 && incompleteOperations.length === 0) status = "COMPLETE";

    const totalAmount = activeOperations.reduce((sum, row) => sum + toNumber(row?.monto), 0);
    const alertCount = missingTypes.length;
    const alertLevel = alertCount > 0 ? "HIGH" : activeOperations.length === 0 ? "LOW" : "OK";

    return {
      id,
      materialityClientCompanyId: id,
      rootId,
      clienteId: cleanText(folder.clienteId),
      clienteNombre: cleanText(folder.clienteNombre || folder.clientName || folder.clienteId),
      companyId: cleanText(folder.companyId),
      companyName: cleanText(folder.companyName || folder.empresaNombre || folder.companyId),
      status,
      alertLevel,
      alertCount,
      operationCount: folderOperations.length,
      activeOperationCount: activeOperations.length,
      incompleteOperationCount: incompleteOperations.length,
      completeOperationCount: completeOperations.length,
      cancelledOperationCount,
      totalAmount,
      missingTypes,
      missingTypeLabels: missingTypes.map(getMaterialityDocumentLabel),
      latestOperationAt,
      updatedAt,
      primaryContractId: cleanText(activeContract?.id || folder.primaryContractId || "") || null,
      hasPrimaryContract: !!(activeContract?.id || folder.primaryContractId),
      operations: folderOperations.slice(0, 5),
    };
  });

  rows.sort((a, b) => {
    const rank: Record<string, number> = { INCOMPLETE: 1, NO_OPERATIONS: 2, COMPLETE: 3 };
    const rankDiff = (rank[a.status] || 9) - (rank[b.status] || 9);
    if (rankDiff !== 0) return rankDiff;
    return toMillis(b.updatedAt) - toMillis(a.updatedAt);
  });

  const filtered = rows.filter((row) => {
    if (statusFilter && statusFilter !== "ALL") {
      if (statusFilter === "ALERTS" && row.alertCount <= 0) return false;
      if (statusFilter !== "ALERTS" && row.status !== statusFilter) return false;
    }
    if (search && !buildDashboardSearchText(row).includes(search)) return false;
    return true;
  });

  const statsBase = rows;
  const stats = {
    folderCount: statsBase.length,
    operationCount: operations.length,
    activeOperationCount: statsBase.reduce((sum, row) => sum + Number(row.activeOperationCount || 0), 0),
    incompleteFolderCount: statsBase.filter((row) => row.status === "INCOMPLETE").length,
    completeFolderCount: statsBase.filter((row) => row.status === "COMPLETE").length,
    noOperationFolderCount: statsBase.filter((row) => row.status === "NO_OPERATIONS").length,
    alertCount: statsBase.reduce((sum, row) => sum + Number(row.alertCount || 0), 0),
    totalAmount: statsBase.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0),
  };

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    stats,
    folders: filtered.slice(0, limit),
    alerts: rows.filter((row) => row.alertCount > 0).slice(0, 50),
  };
}

