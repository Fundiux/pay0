import { logActivityBatch } from "../../utils/logActivity";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { buildCanonicalFolio, nextSequenceTx } from "../sequences/service";
import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { assertAuthorized } from "../../utils/authGuard";
import { requireClientOperationalAccess } from "../clientDelegations/access";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

type Pay0Role = "superadmin" | "admin" | "operador";
type BeneficiaryTipo = "DEBITO" | "TDC" | "AMEX" | "OTRO" | "EFECTIVO";
type DestinationKind = "CLABE" | "TARJETA" | "EFECTIVO";

interface BeneficiaryMethodInput {
  tipo?: string;
  bankCode?: string;
  bankName?: string;
  clabe?: string;
  cardNumber?: string;
}

function normalizeRole(value: any): Pay0Role | "" {
  const role = String(value || "").trim().toLowerCase();
  if (role === "superadmin" || role === "admin" || role === "operador") return role;
  return "";
}

function requireAuth(request: any): string {
  const uid = String(request.auth?.uid || "").trim();
  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
  }
  return uid;
}

async function getMyUser(uid: string) {
  const a = await db.doc(`users/${uid}`).get();
  if (a.exists) return a.data() as any;

  const b = await db.doc(`usuarios/${uid}`).get();
  if (b.exists) return b.data() as any;

  return null;
}

async function getRootId(uid: string) {
  const user = await getMyUser(uid);
  if (!user) throw new HttpsError("not-found", "Usuario no encontrado.");
  return String(user.rootId || uid).trim();
}

async function getActiveClientDelegationAccess(uid: string, clientId: string) {
  const accessSnap = await db.doc(`userClientAccess/${uid}/clients/${clientId}`).get();
  if (!accessSnap.exists) return null;

  const data: any = accessSnap.data() || {};
  if (data?.active !== true) return null;
  if (data?.permissions?.view === false) return null;

  return {
    id: accessSnap.id,
    path: accessSnap.ref.path,
    data,
  };
}

function getAdminScopeId(user: any, uid: string, rootId: string) {
  const role = normalizeRole(user?.role || user?.supervisorRole);
  if (role === "admin") return uid;
  if (role === "operador") {
    const parentRole = String(user?.parentRole || "").trim().toLowerCase();
    if (parentRole === "admin") {
      return String(user?.parentUserId || "").trim() || rootId;
    }
    return rootId;
  }
  return uid;
}

function onlyDigits(value: any) {
  return String(value || "").replace(/\D+/g, "");
}

function normalizeName(value: any) {
  return String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
}

function ensureNombreCanonico(nombre: string) {
  if (!nombre) {
    throw new HttpsError("invalid-argument", "nombre es obligatorio.");
  }
  if (nombre.length > 180 || !/\p{L}/u.test(nombre)) {
    throw new HttpsError("invalid-argument", "Indica un nombre o razón social válido de hasta 180 caracteres.");
  }
}

function normalizeTipo(value: any): BeneficiaryTipo {
  const tipo = String(value || "").trim().toUpperCase();
  if (tipo === "DEBITO" || tipo === "TDC" || tipo === "AMEX" || tipo === "OTRO" || tipo === "EFECTIVO") {
    return tipo;
  }
  throw new HttpsError("invalid-argument", "tipo invalido.");
}

function hashKey(value: string) {
  return createHash("sha1").update(value).digest("hex");
}

function maskClabe(value: string) {
  return `**************${value.slice(-4)}`;
}

function maskCard(value: string) {
  if (value.length <= 4) return value;
  return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
}

async function resolveClientScope(uid: string, role: Pay0Role, rootId: string, adminScopeId: string, clientId: string) {
  // A read-only delegation must never authorize beneficiary mutations.
  await requireClientOperationalAccess({ uid, role, rootId, clientId, permission: "operateBeneficiarios" });
  const clientRef = db.doc(`clients/${clientId}`);
  const clientSnap = await clientRef.get();

  if (!clientSnap.exists) {
    throw new HttpsError("not-found", "Cliente no existe.");
  }

  const client: any = clientSnap.data() || {};

  if (String(client.rootId || "").trim() !== rootId) {
    throw new HttpsError("permission-denied", "No autorizado para usar este cliente.");
  }

  const clientAdminId = String(client.adminId || "").trim() || null;
  const clientManagedByUserId = String(client.managedByUserId || "").trim() || null;
  const clientOperadorId = String(client.operadorId || "").trim() || null;
  const resolvedOperadorId = clientOperadorId || clientManagedByUserId || null;

  const delegatedClientAccess =
    role === "superadmin" ? null : await getActiveClientDelegationAccess(uid, clientId);
  const hasDelegatedClientAccess = !!delegatedClientAccess;

  if (role === "admin" && !hasDelegatedClientAccess && clientAdminId && clientAdminId !== uid) {
    throw new HttpsError("permission-denied", "No autorizado para usar este cliente.");
  }

  if (role === "operador" && !hasDelegatedClientAccess) {
    if (resolvedOperadorId && resolvedOperadorId !== uid) {
      throw new HttpsError("permission-denied", "No autorizado para usar este cliente.");
    }
    if (clientAdminId && clientAdminId !== adminScopeId) {
      throw new HttpsError("permission-denied", "No autorizado para usar este cliente.");
    }
  }

  return {
    client,
    clientAdminId,
    resolvedOperadorId,
    hasDelegatedClientAccess,
    delegatedClientAccessPath: delegatedClientAccess?.path || null,
    accessSource: hasDelegatedClientAccess ? "DELEGATED" : role === "superadmin" ? "SUPERADMIN" : "DIRECT",
  };
}

function buildMethodPayload(input: BeneficiaryMethodInput) {
  const tipo = normalizeTipo(input?.tipo);
  const bankCode = onlyDigits(input?.bankCode);
  const bankName = normalizeName(input?.bankName || "");
  const clabe = onlyDigits(input?.clabe);
  const cardNumber = onlyDigits(input?.cardNumber);

  if (tipo === "EFECTIVO") {
    if (bankCode || bankName || clabe || cardNumber) {
      throw new HttpsError("invalid-argument", "EFECTIVO no debe capturar banco, clabe o tarjeta.");
    }

    return {
      tipo,
      destinationKind: "EFECTIVO" as DestinationKind,
      bankCode: null,
      bankName: null,
      clabe: null,
      cardNumber: null,
      last4: null,
      masked: null,
      dedupeKey: null,
    };
  }

  if (!bankCode || bankCode.length !== 3) {
    throw new HttpsError("invalid-argument", "bankCode es obligatorio y debe tener 3 digitos.");
  }

  if (!bankName) {
    throw new HttpsError("invalid-argument", "bankName es obligatorio.");
  }

  if (clabe && cardNumber) {
    throw new HttpsError("invalid-argument", "Captura un solo metodo por registro: CLABE o tarjeta.");
  }

  if (tipo === "AMEX") {
    if (clabe) {
      throw new HttpsError("invalid-argument", "AMEX no permite clabe.");
    }
    if (!cardNumber) {
      throw new HttpsError("invalid-argument", "AMEX requiere numero de tarjeta.");
    }
    if (cardNumber.length !== 15) {
      throw new HttpsError("invalid-argument", "AMEX debe tener 15 digitos.");
    }

    return {
      tipo,
      destinationKind: "TARJETA" as DestinationKind,
      bankCode,
      bankName,
      clabe: null,
      cardNumber,
      last4: cardNumber.slice(-4),
      masked: maskCard(cardNumber),
      dedupeKey: `CARD|${cardNumber}`,
    };
  }

  if (!clabe && !cardNumber) {
    throw new HttpsError("invalid-argument", "Debes capturar CLABE o numero de tarjeta.");
  }

  if (clabe) {
    if (clabe.length !== 18) {
      throw new HttpsError("invalid-argument", "La CLABE debe tener 18 digitos.");
    }
    if (clabe.slice(0, 3) !== bankCode) {
      throw new HttpsError("invalid-argument", "La CLABE no coincide con el banco seleccionado.");
    }

    return {
      tipo,
      destinationKind: "CLABE" as DestinationKind,
      bankCode,
      bankName,
      clabe,
      cardNumber: null,
      last4: clabe.slice(-4),
      masked: maskClabe(clabe),
      dedupeKey: `CLABE|${clabe}`,
    };
  }

  if (!cardNumber) {
    throw new HttpsError("invalid-argument", "Numero de tarjeta obligatorio.");
  }

  if (cardNumber.length !== 16) {
    throw new HttpsError("invalid-argument", "La tarjeta debe tener 16 digitos.");
  }

  return {
    tipo,
    destinationKind: "TARJETA" as DestinationKind,
    bankCode,
    bankName,
    clabe: null,
    cardNumber,
    last4: cardNumber.slice(-4),
    masked: maskCard(cardNumber),
    dedupeKey: `CARD|${cardNumber}`,
  };
}

async function assertMethodDoesNotExistForClient(clientId: string, dedupeKey: string | null) {
  if (!dedupeKey) {
    return { ref: db.collection("clientBeneficiaryMethods").doc(), existing: null as any };
  }

  const methodId = `cbm_${hashKey(`${clientId}|${dedupeKey}`)}`;
  const ref = db.doc(`clientBeneficiaryMethods/${methodId}`);
  const snap = await ref.get();

  if (!snap.exists) {
    return { ref, existing: null as any };
  }

  const existing: any = snap.data() || {};

  if (existing.active === false) {
    throw new HttpsError(
      "failed-precondition",
      "Ya existe un metodo igual para este cliente pero esta inactivo. Reactivalo en lugar de duplicarlo."
    );
  }

  throw new HttpsError("already-exists", "Ya existe un metodo igual para este cliente.");
}

async function commitBeneficiaryBatch(batch: FirebaseFirestore.WriteBatch) {
  try { await batch.commit(); }
  catch (error: any) {
    if (error?.code === 6 || error?.code === "already-exists") throw new HttpsError("already-exists", "La cuenta ya fue registrada. Actualiza la lista antes de volver a intentar.");
    throw error;
  }
}

export const createClientBeneficiary = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const me = await getMyUser(uid);
    if (!me) throw new HttpsError("not-found", "Usuario no encontrado.");
    assertAuthorized(request.auth, me, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "beneficiarios" });

    const role = normalizeRole(me?.role || me?.supervisorRole);
    if (!["superadmin", "admin", "operador"].includes(role)) {
      throw new HttpsError("permission-denied", "No autorizado.");
    }

    const rootId = await getRootId(uid);
    const adminScopeId = getAdminScopeId(me, uid, rootId);

    const data = request.data || {};
    const clientId = String(data.clientId || data.clienteId || "").trim();
    const nombre = normalizeName(data.nombre || "");
    const methodsInput = Array.isArray(data.methods) ? data.methods : [];

    if (!clientId) {
      throw new HttpsError("invalid-argument", "clientId es obligatorio.");
    }

    ensureNombreCanonico(nombre);

    if (methodsInput.length === 0) {
      throw new HttpsError("invalid-argument", "Debes capturar al menos un metodo.");
    }

    const scope = await resolveClientScope(uid, role as Pay0Role, rootId, adminScopeId, clientId);
    const adminId = scope.clientAdminId || adminScopeId;
    const operadorId = scope.resolvedOperadorId || null;

    const preparedMethods = methodsInput.map((item: any) => buildMethodPayload(item));

    const localKeys = new Set<string>();
    for (const item of preparedMethods) {
      if (item.dedupeKey && localKeys.has(item.dedupeKey)) {
        throw new HttpsError("already-exists", "Estas intentando guardar dos veces el mismo metodo en la misma captura.");
      }
      if (item.dedupeKey) {
        localKeys.add(item.dedupeKey);
      }
    }

    const beneficiaryRef = db.collection("clientBeneficiaries").doc();

    const beneficiaryClientSnap = await db.doc(`clients/${clientId}`).get();
    const beneficiaryClientData: any = beneficiaryClientSnap.exists ? beneficiaryClientSnap.data() || {} : {};
    const clientNumber = Number(
      beneficiaryClientData.clientNumber ??
      beneficiaryClientData.numeroCliente ??
      beneficiaryClientData.sequenceNumber ??
      0
    );
    const userNumber = Number(
      (me as any)?.userNumber ??
      (me as any)?.numeroUsuario ??
      (me as any)?.sequenceNumber ??
      0
    );

    if (!Number.isFinite(clientNumber) || clientNumber <= 0) {
      throw new HttpsError("failed-precondition", "Numero canonico de cliente faltante. Repara numeracion de clientes antes de crear beneficiarios.");
    }

    if (!Number.isFinite(userNumber) || userNumber <= 0) {
      throw new HttpsError("failed-precondition", "Numero canonico de usuario faltante. Repara numeracion de usuarios antes de crear beneficiarios.");
    }

    const beneficiarySeq = await db.runTransaction(async (tx) => {
      return nextSequenceTx({
        db,
        tx,
        rootId,
        scope: "beneficiaries",
        scopeKey: `cliente_${clientId}__usuario_${uid}`,
      });
    });

    const beneficiaryFolio = buildCanonicalFolio("B", beneficiarySeq.sequenceNumber, [
      { label: "C", value: clientNumber },
      { label: "U", value: userNumber },
    ]);

    const actorUsername = String(
      (me as any)?.username ||
      (me as any)?.displayName ||
      (me as any)?.email ||
      uid
    ).trim();

    const methodTargets: Array<{ ref: FirebaseFirestore.DocumentReference; payload: any }> = [];

    for (const item of preparedMethods) {
      const { ref } = await assertMethodDoesNotExistForClient(clientId, item.dedupeKey);
      methodTargets.push({
        ref,
        payload: item,
      });
    }

    const batch = db.batch();

    batch.set(beneficiaryRef, {
      rootId,
      adminId,
      operadorId,
      actorUid: uid,
      actorRole: role,
      accessSource: scope.accessSource,
      delegatedClientAccessPath: scope.delegatedClientAccessPath,
      createdBy: uid,
      updatedBy: uid,
      clientId,
      clienteId: clientId,
      nombre,
      nombreNormalizado: nombre,
      beneficiaryNumber: beneficiarySeq.sequenceNumber,
      numeroBeneficiario: beneficiarySeq.sequenceNumber,
      sequenceNumber: beneficiarySeq.sequenceNumber,
      beneficiaryFolio,
      folio: beneficiaryFolio,
      sequenceScope: `beneficiaries:${rootId}:C${clientNumber}:U${userNumber}`,
      sequenceCounterPath: beneficiarySeq.counterPath,
      createdUsername: actorUsername,
      active: true,
      methodCount: preparedMethods.length,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    logActivityBatch(batch, db, {
      event: "BENEFICIARIO_CREADO",
      rootId,
      adminId,
      actorUid: uid,
      actorUsername,
      actorRole: role,
      entityType: "CLIENT",
      entityId: clientId,
      relatedEntityType: "beneficiary",
      relatedEntityId: beneficiaryRef.id,
      referenceId: beneficiaryRef.id,
      referenceFolio: beneficiaryFolio,
      referenceType: "beneficiary",
      description: `Beneficiario ${beneficiaryFolio} creado: ${nombre}.`,
      createdBy: uid,
      extra: {
        operadorId,
      },
    });

    for (const item of methodTargets) {
      batch.create(item.ref, {
        rootId,
        adminId,
        operadorId,
        actorUid: uid,
        actorRole: role,
        accessSource: scope.accessSource,
        delegatedClientAccessPath: scope.delegatedClientAccessPath,
        createdBy: uid,
        updatedBy: uid,
        beneficiaryId: beneficiaryRef.id,
        beneficiarioId: beneficiaryRef.id,
        beneficiaryFolio,
        beneficiaryNumber: beneficiarySeq.sequenceNumber,
        numeroBeneficiario: beneficiarySeq.sequenceNumber,
        clientId,
        clienteId: clientId,
        tipo: item.payload.tipo,
        destinationKind: item.payload.destinationKind,
        bankCode: item.payload.bankCode,
        bankName: item.payload.bankName,
        clabe: item.payload.clabe,
        cardNumber: item.payload.cardNumber,
        last4: item.payload.last4,
        masked: item.payload.masked,
        dedupeKey: item.payload.dedupeKey,
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await commitBeneficiaryBatch(batch);

    return {
      ok: true,
      beneficiaryId: beneficiaryRef.id,
      methodsCreated: preparedMethods.length,
    };
  }
);

export const addClientBeneficiaryMethod = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const me = await getMyUser(uid);
    if (!me) throw new HttpsError("not-found", "Usuario no encontrado.");
    assertAuthorized(request.auth, me, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "beneficiarios" });

    const role = normalizeRole(me?.role || me?.supervisorRole);
    if (!["superadmin", "admin", "operador"].includes(role)) {
      throw new HttpsError("permission-denied", "No autorizado.");
    }

    const rootId = await getRootId(uid);
    const adminScopeId = getAdminScopeId(me, uid, rootId);

    const beneficiaryId = String(request.data?.beneficiaryId || "").trim();
    if (!beneficiaryId) {
      throw new HttpsError("invalid-argument", "beneficiaryId es obligatorio.");
    }

    const beneficiaryRef = db.doc(`clientBeneficiaries/${beneficiaryId}`);
    const beneficiarySnap = await beneficiaryRef.get();
    if (!beneficiarySnap.exists) {
      throw new HttpsError("not-found", "Beneficiario no existe.");
    }

    const beneficiary: any = beneficiarySnap.data() || {};
    const clientId = String(beneficiary.clientId || beneficiary.clienteId || "").trim();

    if (!clientId) {
      throw new HttpsError("failed-precondition", "Beneficiario sin clientId.");
    }

    const scope = await resolveClientScope(uid, role as Pay0Role, rootId, adminScopeId, clientId);
    const adminId = scope.clientAdminId || adminScopeId;
    const operadorId = scope.resolvedOperadorId || null;

    if (String(beneficiary.rootId || "").trim() !== rootId) {
      throw new HttpsError("permission-denied", "No autorizado.");
    }

    const prepared = buildMethodPayload(request.data || {});
    const { ref } = await assertMethodDoesNotExistForClient(clientId, prepared.dedupeKey);

    const batch = db.batch();

    batch.create(ref, {
      rootId,
      adminId,
      operadorId,
      actorUid: uid,
      actorRole: role,
      accessSource: scope.accessSource,
      delegatedClientAccessPath: scope.delegatedClientAccessPath,
      createdBy: uid,
      updatedBy: uid,
      beneficiaryId,
      clientId,
      clienteId: clientId,
      tipo: prepared.tipo,
      destinationKind: prepared.destinationKind,
      bankCode: prepared.bankCode,
      bankName: prepared.bankName,
      clabe: prepared.clabe,
      cardNumber: prepared.cardNumber,
      last4: prepared.last4,
      masked: prepared.masked,
      dedupeKey: prepared.dedupeKey,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    batch.update(beneficiaryRef, {
      updatedBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
      methodCount: FieldValue.increment(1),
    });

    const actorUsername = String(
      (me as any)?.username ||
      (me as any)?.displayName ||
      (me as any)?.email ||
      uid
    ).trim();

    const beneficiaryFolio = String(
      beneficiary.beneficiaryFolio ||
      beneficiary.folio ||
      ""
    ).trim();

    logActivityBatch(batch, db, {
      event: "BENEFICIARIO_METODO_CREADO",
      rootId,
      adminId,
      actorUid: uid,
      actorUsername,
      actorRole: role,
      entityType: "CLIENT",
      entityId: clientId,
      relatedEntityType: "beneficiary",
      relatedEntityId: beneficiaryId,
      referenceId: ref.id,
      referenceFolio: beneficiaryFolio || beneficiaryId,
      referenceType: "beneficiaryMethod",
      description: `Metodo ${prepared.tipo}/${prepared.destinationKind} creado para beneficiario ${beneficiaryFolio || beneficiaryId}.`,
      createdBy: uid,
      extra: {
        operadorId,
      },
    });

    await commitBeneficiaryBatch(batch);

    return {
      ok: true,
      beneficiaryId,
      methodId: ref.id,
    };
  }
);

export const toggleClientBeneficiaryActive = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const me = await getMyUser(uid);
    if (!me) throw new HttpsError("not-found", "Usuario no encontrado.");
    assertAuthorized(request.auth, me, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "beneficiarios" });

    const role = normalizeRole(me?.role || me?.supervisorRole);
    if (!["superadmin", "admin", "operador"].includes(role)) {
      throw new HttpsError("permission-denied", "No autorizado.");
    }

    const rootId = await getRootId(uid);
    const adminScopeId = getAdminScopeId(me, uid, rootId);

    const beneficiaryId = String(request.data?.beneficiaryId || "").trim();
    const active = Boolean(request.data?.active);

    if (!beneficiaryId) {
      throw new HttpsError("invalid-argument", "beneficiaryId es obligatorio.");
    }

    const ref = db.doc(`clientBeneficiaries/${beneficiaryId}`);
    const snap = await ref.get();

    if (!snap.exists) {
      throw new HttpsError("not-found", "Beneficiario no existe.");
    }

    const data: any = snap.data() || {};
    const clientId = String(data.clientId || data.clienteId || "").trim();
    await resolveClientScope(uid, role as Pay0Role, rootId, adminScopeId, clientId);

    if (String(data.rootId || "").trim() !== rootId) {
      throw new HttpsError("permission-denied", "No autorizado.");
    }

    await ref.update({
      active,
      updatedBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      beneficiaryId,
      active,
    };
  }
);

export const toggleClientBeneficiaryMethodActive = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const me = await getMyUser(uid);
    if (!me) throw new HttpsError("not-found", "Usuario no encontrado.");
    assertAuthorized(request.auth, me, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "beneficiarios" });

    const role = normalizeRole(me?.role || me?.supervisorRole);
    if (!["superadmin", "admin", "operador"].includes(role)) {
      throw new HttpsError("permission-denied", "No autorizado.");
    }

    const rootId = await getRootId(uid);
    const adminScopeId = getAdminScopeId(me, uid, rootId);

    const methodId = String(request.data?.methodId || "").trim();
    const active = Boolean(request.data?.active);

    if (!methodId) {
      throw new HttpsError("invalid-argument", "methodId es obligatorio.");
    }

    const ref = db.doc(`clientBeneficiaryMethods/${methodId}`);
    const snap = await ref.get();

    if (!snap.exists) {
      throw new HttpsError("not-found", "Metodo no existe.");
    }

    const data: any = snap.data() || {};
    const clientId = String(data.clientId || data.clienteId || "").trim();

    await resolveClientScope(uid, role as Pay0Role, rootId, adminScopeId, clientId);

    if (String(data.rootId || "").trim() !== rootId) {
      throw new HttpsError("permission-denied", "No autorizado.");
    }

    await ref.update({
      active,
      updatedBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      methodId,
      active,
    };
  }
);

// BEN_EDIT_DELETE_1A: edicion y eliminacion segura de beneficiarios/metodos.
function requireSuperadminOnly(role: Pay0Role | "") {
  if (role !== "superadmin") {
    throw new HttpsError("permission-denied", "Solo superadmin puede editar o eliminar beneficiarios.");
  }
}

async function queryHasAny(collectionName: string, fieldName: string, value: string) {
  if (!value) return false;
  const snap = await db.collection(collectionName).where(fieldName, "==", value).limit(1).get();
  return !snap.empty;
}

async function assertNoBeneficiaryMovements(beneficiaryId: string, methodIds: string[]) {
  const collections = ["clientDispersions", "balanceMovements", "ledgerEvents"];

  for (const collectionName of collections) {
    if (await queryHasAny(collectionName, "beneficiaryId", beneficiaryId)) {
      throw new HttpsError(
        "failed-precondition",
        "Este beneficiario ya tiene movimientos. Solo puede desactivarse."
      );
    }
  }

  for (const methodId of methodIds) {
    for (const collectionName of collections) {
      if (await queryHasAny(collectionName, "methodId", methodId)) {
        throw new HttpsError(
          "failed-precondition",
          "Este beneficiario ya tiene movimientos. Solo puede desactivarse."
        );
      }
    }
  }
}

async function hasMethodMovements(methodId: string) {
  const collections = ["clientDispersions", "balanceMovements", "ledgerEvents"];

  for (const collectionName of collections) {
    if (await queryHasAny(collectionName, "methodId", methodId)) {
      return true;
    }
  }

  return false;
}

async function assertNoMethodMovements(methodId: string) {
  if (await hasMethodMovements(methodId)) {
    throw new HttpsError(
      "failed-precondition",
      "Este metodo ya tiene movimientos. Solo puede desactivarse."
    );
  }
}

async function getBeneficiaryForWrite(beneficiaryId: string, rootId: string) {
  const ref = db.doc(`clientBeneficiaries/${beneficiaryId}`);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Beneficiario no existe.");
  }

  const data: any = snap.data() || {};

  if (String(data.rootId || "").trim() !== rootId) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }

  const clientId = String(data.clientId || data.clienteId || "").trim();
  if (!clientId) {
    throw new HttpsError("failed-precondition", "Beneficiario sin clientId.");
  }

  return { ref, snap, data, clientId };
}

async function getMethodForWrite(methodId: string, rootId: string) {
  const ref = db.doc(`clientBeneficiaryMethods/${methodId}`);
  const snap = await ref.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Metodo no existe.");
  }

  const data: any = snap.data() || {};

  if (String(data.rootId || "").trim() !== rootId) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }

  const beneficiaryId = String(data.beneficiaryId || "").trim();
  if (!beneficiaryId) {
    throw new HttpsError("failed-precondition", "Metodo sin beneficiaryId.");
  }

  const beneficiary = await getBeneficiaryForWrite(beneficiaryId, rootId);
  const methodClientId = String(data.clientId || data.clienteId || "").trim();

  if (!methodClientId) {
    throw new HttpsError("failed-precondition", "Metodo sin clientId.");
  }

  if (methodClientId !== beneficiary.clientId) {
    throw new HttpsError("failed-precondition", "Metodo no coincide con el cliente del beneficiario.");
  }

  return { ref, snap, data, beneficiaryId, beneficiary, clientId: methodClientId };
}

async function listMethodsForBeneficiary(beneficiaryId: string) {
  const snap = await db
    .collection("clientBeneficiaryMethods")
    .where("beneficiaryId", "==", beneficiaryId)
    .get();

  return snap.docs.map((doc) => ({
    id: doc.id,
    ref: doc.ref,
    data: doc.data() as any,
  }));
}

export const updateClientBeneficiary = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const me = await getMyUser(uid);
    if (!me) throw new HttpsError("not-found", "Usuario no encontrado.");
    assertAuthorized(request.auth, me, { allowedRoles: ["superadmin"], requiredModule: "wallet", requiredAction: "beneficiarios" });

    const role = normalizeRole(me?.role || me?.supervisorRole);
    requireSuperadminOnly(role);

    const rootId = await getRootId(uid);
    const beneficiaryId = String(request.data?.beneficiaryId || "").trim();
    const nombre = normalizeName(request.data?.nombre || "");

    if (!beneficiaryId) {
      throw new HttpsError("invalid-argument", "beneficiaryId es obligatorio.");
    }

    ensureNombreCanonico(nombre);

    const beneficiary = await getBeneficiaryForWrite(beneficiaryId, rootId);
    const methods = await listMethodsForBeneficiary(beneficiaryId);

    await assertNoBeneficiaryMovements(
      beneficiaryId,
      methods.map((item) => item.id)
    );

    await beneficiary.ref.update({
      nombre,
      nombreNormalizado: nombre,
      updatedBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      ok: true,
      beneficiaryId,
    };
  }
);

export const deleteClientBeneficiary = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const me = await getMyUser(uid);
    if (!me) throw new HttpsError("not-found", "Usuario no encontrado.");
    assertAuthorized(request.auth, me, { allowedRoles: ["superadmin"], requiredModule: "wallet", requiredAction: "beneficiarios" });

    const role = normalizeRole(me?.role || me?.supervisorRole);
    requireSuperadminOnly(role);

    const rootId = await getRootId(uid);
    const beneficiaryId = String(request.data?.beneficiaryId || "").trim();

    if (!beneficiaryId) {
      throw new HttpsError("invalid-argument", "beneficiaryId es obligatorio.");
    }

    const beneficiary = await getBeneficiaryForWrite(beneficiaryId, rootId);
    const methods = await listMethodsForBeneficiary(beneficiaryId);

    await assertNoBeneficiaryMovements(
      beneficiaryId,
      methods.map((item) => item.id)
    );

    const batch = db.batch();

    for (const method of methods) {
      batch.delete(method.ref);
    }

    batch.delete(beneficiary.ref);

    await batch.commit();

    return {
      ok: true,
      beneficiaryId,
      methodsDeleted: methods.length,
    };
  }
);


export const replaceClientBeneficiaryMethod = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const me = await getMyUser(uid);

    if (!me) {
      throw new HttpsError("not-found", "Usuario no encontrado.");
    }
    assertAuthorized(request.auth, me, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "beneficiarios" });

    const role = normalizeRole(me?.role || me?.supervisorRole);
    requireSuperadminOnly(role);

    const rootId = await getRootId(uid);
    const methodId = String(request.data?.methodId || "").trim();
    const replacementReason = String(
      request.data?.replacementReason ||
      request.data?.reason ||
      "CORRECCION_METODO"
    ).trim();

    if (!methodId) {
      throw new HttpsError("invalid-argument", "methodId es obligatorio.");
    }

    if (!replacementReason) {
      throw new HttpsError("invalid-argument", "replacementReason es obligatorio.");
    }

    const method = await getMethodForWrite(methodId, rootId);
    const methodHasMovements = await hasMethodMovements(methodId);

    if (!methodHasMovements) {
      throw new HttpsError(
        "failed-precondition",
        "Este metodo no tiene movimientos. Usa Editar metodo."
      );
    }

    const prepared = buildMethodPayload(request.data || {});
    const clientId = method.beneficiary.clientId;
    const actorUsername = String(me?.username || me?.displayName || me?.email || uid).trim();

    if (prepared.dedupeKey) {
      const duplicateSnap = await db
        .collection("clientBeneficiaryMethods")
        .where("clientId", "==", clientId)
        .where("dedupeKey", "==", prepared.dedupeKey)
        .get();

      const duplicate = duplicateSnap.docs.find((doc) => {
        if (doc.id === methodId) return false;
        const data = doc.data() || {};
        return data.active !== false && data.replaced !== true;
      });

      if (duplicate) {
        throw new HttpsError(
          "already-exists",
          "Ya existe un metodo activo igual para este cliente."
        );
      }
    }

    const newRef = db.collection("clientBeneficiaryMethods").doc();
    const batch = db.batch();
    const now = FieldValue.serverTimestamp();

    batch.update(method.ref, {
      active: false,
      replaced: true,
      replacementStatus: "REPLACED",
      replacedByMethodId: newRef.id,
      replacementReason,
      replacedAt: now,
      replacedBy: uid,
      replacedByUsername: actorUsername,
      updatedBy: uid,
      updatedAt: now,
    });

    batch.set(newRef, {
      rootId,
      adminId: method.data.adminId || method.beneficiary.data.adminId || null,
      operadorId: method.data.operadorId || method.beneficiary.data.operadorId || null,
      beneficiaryId: method.beneficiaryId,
      beneficiarioId: method.beneficiaryId,
      beneficiaryNombre:
        method.data.beneficiaryNombre ||
        method.beneficiary.data.nombre ||
        method.beneficiary.data.nombreNormalizado ||
        null,
      clientId,
      clienteId: clientId,
      clienteNombre:
        method.data.clienteNombre ||
        method.beneficiary.data.clienteNombre ||
        method.beneficiary.data.clientName ||
        null,
      tipo: prepared.tipo,
      methodTipo: prepared.tipo,
      destinationKind: prepared.destinationKind,
      bankCode: prepared.bankCode,
      bankName: prepared.bankName,
      clabe: prepared.clabe,
      cardNumber: prepared.cardNumber,
      last4: prepared.last4,
      masked: prepared.masked,
      dedupeKey: prepared.dedupeKey,
      active: true,
      replacementOfMethodId: methodId,
      correctionOfMethodId: methodId,
      replacementReason,
      createdReason: "CORRECCION_METODO",
      createdBy: uid,
      createdUsername: actorUsername,
      createdAt: now,
      updatedAt: now,
    });

    batch.update(method.beneficiary.ref, {
      methodCount: FieldValue.increment(1),
      updatedBy: uid,
      updatedAt: now,
    });
    const beneficiaryFolioForLog = String(
      method.beneficiary.data.beneficiaryFolio ||
        method.beneficiary.data.folio ||
        method.data.beneficiaryFolio ||
        method.data.folio ||
        method.beneficiaryId ||
        ""
    ).trim();

    const beneficiaryNameForLog = String(
      method.beneficiary.data.nombre ||
        method.beneficiary.data.beneficiaryNombre ||
        method.data.beneficiaryNombre ||
        ""
    ).trim();

    const methodReplacementText = beneficiaryFolioForLog
      ? `Metodo de beneficiario ${beneficiaryFolioForLog} reemplazado. Motivo: ${replacementReason}.`
      : `Metodo de beneficiario reemplazado. Motivo: ${replacementReason}.`;


    logActivityBatch(batch, db, {
      event: "BENEFICIARIO_METODO_REEMPLAZADO",
      rootId,
      adminId: method.data.adminId || method.beneficiary.data.adminId || null,
      actorUid: uid,
      actorUsername,
      actorRole: role,
      entityType: "CLIENT",
      entityId: clientId,
      relatedEntityType: "beneficiaryMethod",
      relatedEntityId: newRef.id,
      referenceId: method.beneficiaryId || newRef.id,
      referenceFolio: beneficiaryFolioForLog || method.beneficiaryId || newRef.id,
      referenceType: "beneficiaryMethod",
      description: methodReplacementText,
      createdBy: uid,
      extra: {
        operadorId: method.data.operadorId || method.beneficiary.data.operadorId || null,
        beneficiaryId: method.beneficiaryId,
        beneficiaryFolio: beneficiaryFolioForLog || null,
        beneficiaryNombre: beneficiaryNameForLog || null,
        oldMethodId: methodId,
        newMethodId: newRef.id,
        replacementReason,
      },
    });

    await batch.commit();

    return {
      ok: true,
      oldMethodId: methodId,
      methodId: newRef.id,
      replacementOfMethodId: methodId,
      replacedDocument: true,
    };
  }
);
export const updateClientBeneficiaryMethod = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const me = await getMyUser(uid);
    if (!me) throw new HttpsError("not-found", "Usuario no encontrado.");
    assertAuthorized(request.auth, me, { allowedRoles: ["superadmin"], requiredModule: "wallet", requiredAction: "beneficiarios" });

    const role = normalizeRole(me?.role || me?.supervisorRole);
    requireSuperadminOnly(role);

    const rootId = await getRootId(uid);
    const methodId = String(request.data?.methodId || "").trim();

    if (!methodId) {
      throw new HttpsError("invalid-argument", "methodId es obligatorio.");
    }

    const method = await getMethodForWrite(methodId, rootId);
    await assertNoMethodMovements(methodId);

    const prepared = buildMethodPayload(request.data || {});
    const clientId = method.beneficiary.clientId;
    const nextId = prepared.dedupeKey
      ? `cbm_${hashKey(`${clientId}|${prepared.dedupeKey}`)}`
      : methodId;

    const nextRef = db.doc(`clientBeneficiaryMethods/${nextId}`);

    if (nextRef.path !== method.ref.path) {
      const existing = await nextRef.get();
      if (existing.exists) {
        throw new HttpsError("already-exists", "Ya existe un metodo igual para este cliente.");
      }
    }

    const payload = {
      ...method.data,
      rootId,
      adminId: method.data.adminId || method.beneficiary.data.adminId || null,
      operadorId: method.data.operadorId || method.beneficiary.data.operadorId || null,
      beneficiaryId: method.beneficiaryId,
      clientId,
      clienteId: clientId,
      tipo: prepared.tipo,
      destinationKind: prepared.destinationKind,
      bankCode: prepared.bankCode,
      bankName: prepared.bankName,
      clabe: prepared.clabe,
      cardNumber: prepared.cardNumber,
      last4: prepared.last4,
      masked: prepared.masked,
      dedupeKey: prepared.dedupeKey,
      updatedBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
    };

    const batch = db.batch();

    if (nextRef.path === method.ref.path) {
      batch.update(method.ref, payload);
    } else {
      batch.set(nextRef, payload);
      batch.delete(method.ref);
    }

    await batch.commit();

    return {
      ok: true,
      oldMethodId: methodId,
      methodId: nextRef.id,
      replacedDocument: nextRef.path !== method.ref.path,
    };
  }
);

export const deleteClientBeneficiaryMethod = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuth(request);
    const me = await getMyUser(uid);
    if (!me) throw new HttpsError("not-found", "Usuario no encontrado.");
    assertAuthorized(request.auth, me, { allowedRoles: ["superadmin"], requiredModule: "wallet", requiredAction: "beneficiarios" });

    const role = normalizeRole(me?.role || me?.supervisorRole);
    requireSuperadminOnly(role);

    const rootId = await getRootId(uid);
    const methodId = String(request.data?.methodId || "").trim();

    if (!methodId) {
      throw new HttpsError("invalid-argument", "methodId es obligatorio.");
    }

    const method = await getMethodForWrite(methodId, rootId);
    await assertNoMethodMovements(methodId);

    const batch = db.batch();

    batch.delete(method.ref);
    batch.update(method.beneficiary.ref, {
      methodCount: FieldValue.increment(-1),
      updatedBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return {
      ok: true,
      methodId,
      beneficiaryId: method.beneficiaryId,
    };
  }
);
