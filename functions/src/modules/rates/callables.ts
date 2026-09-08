import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  assertAssignedCost,
  assertBaseCost,
  assertCalculationBaseType,
  assertDespachoId,
  assertOperationTypeKey,
  assertOperationTypeName,
  assertUserId,
  normalizePricingMode,
} from "./validators";
import { buildOperationTypeAliases, normalizeOperationTypeKey } from "../operation-types/canonical";
import { logActivity } from "../../utils/logActivity";
import { assertAuthorized } from "../../utils/authGuard";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

async function getSuperadminContext(request: any) {
  const uid = String(request.auth?.uid || "").trim();
  if (!uid) {
    throw new HttpsError("unauthenticated", "Usuario no autenticado.");
  }

  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");
  }

  const profile = userSnap.data() || {};
  const role = String(profile.role || "").trim().toLowerCase();
  if (role !== "superadmin") {
    throw new HttpsError("permission-denied", "Solo superadmin puede ejecutar esta accion.");
  }

  const rootId = String(profile.rootId || uid).trim();
  const actorUsername = String(
    profile.username ||
    profile.actorUsername ||
    profile.displayName ||
    request.auth?.token?.email ||
    uid
  ).trim();

  return { uid, rootId, role, actorUsername, profile };
}

async function getRatesManagerContext(request: any) {
  const uid = String(request.auth?.uid || "").trim();
  if (!uid) {
    throw new HttpsError("unauthenticated", "Usuario no autenticado.");
  }

  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");
  }

  const profile = userSnap.data() || {};
  const role = String(profile.role || "").trim().toLowerCase();

  if (role !== "superadmin" && role !== "admin") {
    throw new HttpsError("permission-denied", "Solo admin o superadmin puede ejecutar esta accion.");
  }

  const rootId = String(profile.rootId || uid).trim();
  const actorUsername = String(
    profile.username ||
    profile.actorUsername ||
    profile.displayName ||
    request.auth?.token?.email ||
    uid
  ).trim();

  return { uid, rootId, role, actorUsername, profile };
}

export const createOperationType = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const { uid, rootId, role, actorUsername, profile } = await getSuperadminContext(request);
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin"], requiredModule: "wallet", requiredAction: "configuracion" });

    const data = request.data || {};
    const key = normalizeOperationTypeKey(assertOperationTypeKey(data.key));
    const name = assertOperationTypeName(data.name);
    const aliases = buildOperationTypeAliases({ key, name });
    const calculationBaseType = assertCalculationBaseType(data.calculationBaseType);
    const pricingMode = normalizePricingMode(data.pricingMode);
    const rawCategory = String(data.category || "OPERACION").trim().toUpperCase();
    const category = rawCategory === "DISPERSION" ? "DISPERSION" : "OPERACION";

    const active = typeof data.active === "boolean" ? data.active : true;
    const requiresConciliation =
      typeof data.requiresConciliation === "boolean" ? data.requiresConciliation : true;
    const generatesClientBalance =
      typeof data.generatesClientBalance === "boolean" ? data.generatesClientBalance : true;
    const generatesUserEarnings =
      typeof data.generatesUserEarnings === "boolean" ? data.generatesUserEarnings : true;
    const allowsDispersion =
      typeof data.allowsDispersion === "boolean" ? data.allowsDispersion : true;
    const allowsReturn =
      typeof data.allowsReturn === "boolean" ? data.allowsReturn : true;
    const notes = String(data.notes || "").trim() || null;

    const ref = db.collection("operationTypes").doc(key);
    const existing = await ref.get();
    if (existing.exists) {
      throw new HttpsError("already-exists", "Ya existe un tipo de operacion con esa clave.");
    }

    await ref.set({
      rootId,
      key,
      name,
      aliases,
      category,
      active,
      calculationBaseType,
      requiresConciliation,
      generatesClientBalance,
      generatesUserEarnings,
      allowsDispersion,
      allowsReturn,
      pricingMode,
      notes,
      createdBy: uid,
      actorUsername,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await logActivity({
      event: "OPERATION_TYPE_CREATED",
      rootId,
      actorUid: uid,
      actorUsername,
      actorRole: role,
      entityType: "operationType",
      entityId: key,
      referenceId: key,
      referenceType: "operationType",
      description: `Tipo de operacion ${key} creado con base ${calculationBaseType}.`,
      createdBy: uid,
    });

    return {
      ok: true,
      key,
      name,
      aliases,
      category,
      calculationBaseType,
      pricingMode,
    };
  }
);

export const setDespachoOperationCost = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const { uid, rootId, role, actorUsername, profile } = await getSuperadminContext(request);
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin"], requiredModule: "despachos", requiredAction: "costs" });

    const data = request.data || {};
    const despachoId = assertDespachoId(data.despachoId);
    const operationTypeKey = normalizeOperationTypeKey(assertOperationTypeKey(data.operationTypeKey));
    const baseCost = assertBaseCost(data.baseCost);
    const active = typeof data.active === "boolean" ? data.active : true;
    const notes = String(data.notes || "").trim() || null;

    const despachoRef = db.doc(`despachos/${despachoId}`);
    const operationTypeRef = db.collection("operationTypes").doc(operationTypeKey);

    const [despachoSnap, operationTypeSnap] = await Promise.all([
      despachoRef.get(),
      operationTypeRef.get(),
    ]);

    if (!despachoSnap.exists) {
      throw new HttpsError("not-found", "Despacho no encontrado.");
    }

    if (!operationTypeSnap.exists) {
      throw new HttpsError("not-found", "Tipo de operacion no encontrado.");
    }

    const despacho = despachoSnap.data() || {};
    if (despacho.rootId && String(despacho.rootId).trim() !== rootId) {
      throw new HttpsError("permission-denied", "Despacho fuera de alcance.");
    }

    const operationType = operationTypeSnap.data() || {};
    const ref = despachoRef.collection("costos").doc(operationTypeKey);

    await ref.set(
      {
        rootId,
        despachoId,
        operationTypeKey,
        operationTypeName: String(operationType.name || operationTypeKey),
        calculationBaseType: String(operationType.calculationBaseType || "TOTAL"),
        pricingMode: String(operationType.pricingMode || "PERCENT"),
        active,
        baseCost,
        notes,
        createdBy: uid,
        actorUsername,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await logActivity({
      event: "DESPACHO_OPERATION_COST_SET",
      rootId,
      actorUid: uid,
      actorUsername,
      actorRole: role,
      entityType: "despacho",
      entityId: despachoId,
      relatedEntityId: operationTypeKey,
      relatedEntityType: "operationType",
      referenceId: `${despachoId}:${operationTypeKey}`,
      referenceType: "despachoCost",
      amount: baseCost,
      description: `Despacho ${despachoId} configurado con costo ${baseCost} para ${operationTypeKey}.`,
      createdBy: uid,
    });

    return {
      ok: true,
      despachoId,
      operationTypeKey,
      baseCost,
      active,
    };
  }
);

export const setUserOperationCost = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const { uid, rootId, role, actorUsername, profile } = await getRatesManagerContext(request);
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin", "admin"], requiredModule: "usuarios", requiredAction: "costs" });

    const data = request.data || {};
    const userId = assertUserId(data.userId);
    const despachoId = assertDespachoId(data.despachoId);
    const operationTypeKey = normalizeOperationTypeKey(assertOperationTypeKey(data.operationTypeKey));
    const costId = `${despachoId}__${operationTypeKey}`;
    const assignedCost = assertAssignedCost(data.assignedCost);
    const active = typeof data.active === "boolean" ? data.active : true;
    const notes = String(data.notes || "").trim() || null;

    const userRef = db.doc(`users/${userId}`);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      throw new HttpsError("not-found", "Usuario no encontrado.");
    }

    const userDoc = userSnap.data() || {};
    if (userDoc.rootId && String(userDoc.rootId).trim() !== rootId) {
      throw new HttpsError("permission-denied", "Usuario fuera de alcance.");
    }

    const targetRole = String(userDoc.role || "").trim().toLowerCase();
    const targetParentUserId = String(userDoc.parentUserId || "").trim();

    if (role === "admin") {
      if (targetRole !== "operador" || targetParentUserId !== uid) {
        throw new HttpsError(
          "permission-denied",
          "Admin solo puede configurar costos de sus operadores directos."
        );
      }
    }

    const inheritedFromUserIdRaw = String(
      userDoc.parentUserId || userDoc.rootId || ""
    ).trim();

    const inheritedFromUserId =
      inheritedFromUserIdRaw && inheritedFromUserIdRaw !== userId
        ? inheritedFromUserIdRaw
        : null;

    let inheritedFromType: "user" | "despacho" = "user";
    let sourceDespachoId: string | null = null;
    let baseInheritedCost = 0;
    let inheritedCostResolved = false;
    let operationTypeName = operationTypeKey;
    let calculationBaseType: "TOTAL" | "SUBTOTAL" = "TOTAL";
    let pricingMode: "PERCENT" | "FIXED" = "PERCENT";

    let inheritedUserDoc: any = null;

    if (inheritedFromUserId) {
      const inheritedUserSnap = await db.doc(`users/${inheritedFromUserId}`).get();

      if (inheritedUserSnap.exists) {
        inheritedUserDoc = inheritedUserSnap.data() || {};

        if (
          inheritedUserDoc.rootId &&
          String(inheritedUserDoc.rootId).trim() !== rootId
        ) {
          throw new HttpsError("permission-denied", "Usuario superior fuera de alcance.");
        }

        const inheritedUserRole = String(inheritedUserDoc.role || "").trim().toLowerCase();

        if (inheritedUserRole !== "superadmin") {
          const inheritedCostSnap = await db
            .doc(`users/${inheritedFromUserId}/costos/${costId}`)
            .get();

          const inheritedLegacyCostSnap = inheritedCostSnap.exists
            ? null
            : await db.doc(`users/${inheritedFromUserId}/costos/${operationTypeKey}`).get();

          const inheritedSourceSnap = inheritedCostSnap.exists
            ? inheritedCostSnap
            : inheritedLegacyCostSnap;

          if (inheritedSourceSnap?.exists) {
            const inheritedCostDoc = inheritedSourceSnap.data() || {};

            inheritedFromType = "user";
            sourceDespachoId = despachoId;
            inheritedCostResolved = true;

            baseInheritedCost = Number(inheritedCostDoc.assignedCost || 0);
            operationTypeName = String(inheritedCostDoc.operationTypeName || operationTypeKey);

            calculationBaseType =
              String(inheritedCostDoc.calculationBaseType || "TOTAL").trim().toUpperCase() === "SUBTOTAL"
                ? "SUBTOTAL"
                : "TOTAL";

            pricingMode =
              String(inheritedCostDoc.pricingMode || "PERCENT").trim().toUpperCase() === "FIXED"
                ? "FIXED"
                : "PERCENT";
          }
        }
      }
    }

    if (!inheritedCostResolved) {
      inheritedFromType = "despacho";

      sourceDespachoId = despachoId;

      const despachoCostSnap = await db
        .doc(`despachos/${despachoId}/costos/${operationTypeKey}`)
        .get();

      if (!despachoCostSnap.exists) {
        throw new HttpsError("not-found", "Costo base de despacho no encontrado.");
      }

      const despachoCost = despachoCostSnap.data() || {};
      sourceDespachoId = despachoId;
      inheritedCostResolved = true;
      baseInheritedCost = Number(despachoCost.baseCost || 0);
      operationTypeName = String(despachoCost.operationTypeName || operationTypeKey);

      calculationBaseType =
        String(despachoCost.calculationBaseType || "TOTAL").trim().toUpperCase() === "SUBTOTAL"
          ? "SUBTOTAL"
          : "TOTAL";

      pricingMode =
        String(despachoCost.pricingMode || "PERCENT").trim().toUpperCase() === "FIXED"
          ? "FIXED"
          : "PERCENT";
    }

    const clientRequestedCalculationBaseType: "TOTAL" | "SUBTOTAL" =
    String(data.calculationBaseType || calculationBaseType || "TOTAL").trim().toUpperCase() === "SUBTOTAL"
      ? "SUBTOTAL"
      : "TOTAL";

  calculationBaseType = clientRequestedCalculationBaseType;
  if (assignedCost < baseInheritedCost) {
      throw new HttpsError(
        "failed-precondition",
        inheritedFromType === "user"
          ? `El costo del usuario no puede ser menor al costo heredado del usuario superior (${baseInheritedCost}).`
          : `El costo del usuario no puede ser menor al costo base del despacho (${baseInheritedCost}).`
      );
    }

    const ref = userRef.collection("costos").doc(costId);

    await ref.set(
      {
        rootId,
        userId,
        costId,
        despachoId: sourceDespachoId,
        inheritedFromUserId,
        inheritedFromType,
        sourceDespachoId,
        operationTypeKey,
        operationTypeName,
        calculationBaseType,
        pricingMode,
        active,
        baseInheritedCost,
        assignedCost,
        notes,
        createdBy: uid,
        actorUsername,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await logActivity({
      event: "USER_OPERATION_COST_SET",
      rootId,
      actorUid: uid,
      actorUsername,
      actorRole: role,
      entityType: "user",
      entityId: userId,
      relatedEntityId: `${despachoId}:${operationTypeKey}`,
      relatedEntityType: "operationType",
      referenceId: `${userId}:${despachoId}:${operationTypeKey}`,
      referenceType: "userCost",
      amount: assignedCost,
      description:
        inheritedFromType === "user"
          ? `Usuario ${userId} configurado con costo ${assignedCost} para ${operationTypeKey} en despacho ${despachoId} (base heredada de usuario ${baseInheritedCost}).`
          : `Usuario ${userId} configurado con costo ${assignedCost} para ${operationTypeKey} en despacho ${despachoId} (base despacho ${baseInheritedCost}, calculo cliente ${calculationBaseType}).`,
      createdBy: uid,
    });

    return {
      ok: true,
      userId,
      costId,
      despachoId,
      inheritedFromUserId,
      inheritedFromType,
      sourceDespachoId,
      operationTypeKey,
      baseInheritedCost,
      assignedCost,
      active,
    };
  }
);

async function getClientRatesManagerContext(request: any) {
  const uid = String(request.auth?.uid || "").trim();
  if (!uid) {
    throw new HttpsError("unauthenticated", "Usuario no autenticado.");
  }

  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");
  }

  const profile = userSnap.data() || {};
  const role = String(profile.role || "").trim().toLowerCase();

  if (role !== "superadmin" && role !== "admin" && role !== "operador") {
    throw new HttpsError("permission-denied", "Solo superadmin, admin u operador puede ejecutar esta accion.");
  }

  const rootId = String(profile.rootId || uid).trim();
  const actorUsername = String(
    profile.username ||
    profile.actorUsername ||
    profile.displayName ||
    request.auth?.token?.email ||
    uid
  ).trim();

  return { uid, rootId, role, actorUsername, profile };
}

export const setClientOperationCost = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const { uid, rootId, role, actorUsername, profile } = await getClientRatesManagerContext(request);
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "clientes", requiredAction: "costs" });

    const data = request.data || {};
    const clientId = String(data.clientId || data.clienteId || "").trim();
    if (!clientId) {
      throw new HttpsError("invalid-argument", "clientId es obligatorio.");
    }

    const despachoId = assertDespachoId(data.despachoId);
    const operationTypeKey = normalizeOperationTypeKey(assertOperationTypeKey(data.operationTypeKey));
    const costId = `${despachoId}__${operationTypeKey}`;
    const assignedCost = assertAssignedCost(data.assignedCost);
    const active = typeof data.active === "boolean" ? data.active : true;
    const notes = String(data.notes || "").trim() || null;

    const clientRef = db.doc(`clients/${clientId}`);
    const clientSnap = await clientRef.get();
  const clientNameForLog = String(
    (clientSnap.data() as any)?.name ||
    (clientSnap.data() as any)?.nombreComercial ||
    (clientSnap.data() as any)?.nombre ||
    (clientSnap.data() as any)?.razonSocial ||
    (clientSnap.data() as any)?.clienteNombre ||
    clientId
  ).trim();

    if (!clientSnap.exists) {
      throw new HttpsError("not-found", "Cliente no encontrado.");
    }

    const clientDoc = clientSnap.data() || {};
    if (clientDoc.rootId && String(clientDoc.rootId).trim() !== rootId) {
      throw new HttpsError("permission-denied", "Cliente fuera de alcance.");
    }

    const clientAdminId = String(clientDoc.adminId || "").trim();
    const clientManagedByUserId = String(clientDoc.managedByUserId || "").trim();
    const managerUserId = clientManagedByUserId || clientAdminId || "";

    if (role === "admin" && clientAdminId !== uid) {
      throw new HttpsError(
        "permission-denied",
        "Admin solo puede configurar costos de sus clientes."
      );
    }

    if (role === "operador" && managerUserId !== uid) {
      throw new HttpsError(
        "permission-denied",
        "Operador solo puede configurar costos de sus clientes."
      );
    }

    let inheritedFromType: "user" | "despacho" = "user";
    let inheritedFromUserId: string | null = null;
    let sourceDespachoId: string | null = despachoId;
    let baseInheritedCost = 0;
    let inheritedCostResolved = false;
    let operationTypeName = operationTypeKey;
    let calculationBaseType: "TOTAL" | "SUBTOTAL" = "TOTAL";
    let pricingMode: "PERCENT" | "FIXED" = "PERCENT";

    if (managerUserId) {
      const managerSnap = await db.doc(`users/${managerUserId}`).get();

      if (managerSnap.exists) {
        const managerDoc = managerSnap.data() || {};
        const managerRole = String(managerDoc.role || "").trim().toLowerCase();

        if (managerRole !== "superadmin") {
          const inheritedCostSnap = await db
            .doc(`users/${managerUserId}/costos/${costId}`)
            .get();

          const inheritedLegacyCostSnap = inheritedCostSnap.exists
            ? null
            : await db.doc(`users/${managerUserId}/costos/${operationTypeKey}`).get();

          const inheritedSourceSnap = inheritedCostSnap.exists
            ? inheritedCostSnap
            : inheritedLegacyCostSnap;

          if (inheritedSourceSnap?.exists) {
            const inheritedCostDoc = inheritedSourceSnap.data() || {};

            inheritedFromType = "user";
            inheritedFromUserId = managerUserId;
            sourceDespachoId = despachoId;
            inheritedCostResolved = true;

            baseInheritedCost = Number(inheritedCostDoc.assignedCost || 0);
            operationTypeName = String(inheritedCostDoc.operationTypeName || operationTypeKey);

            calculationBaseType =
              String(inheritedCostDoc.calculationBaseType || "TOTAL").trim().toUpperCase() === "SUBTOTAL"
                ? "SUBTOTAL"
                : "TOTAL";

            pricingMode =
              String(inheritedCostDoc.pricingMode || "PERCENT").trim().toUpperCase() === "FIXED"
                ? "FIXED"
                : "PERCENT";
          }
        }
      }
    }

    if (!inheritedCostResolved) {
      inheritedFromType = "despacho";
      inheritedFromUserId = null;
      sourceDespachoId = despachoId;

      const despachoCostSnap = await db
        .doc(`despachos/${despachoId}/costos/${operationTypeKey}`)
        .get();

      if (!despachoCostSnap.exists) {
        throw new HttpsError("not-found", "Costo base de despacho no encontrado.");
      }

      const despachoCost = despachoCostSnap.data() || {};
      inheritedCostResolved = true;
      baseInheritedCost = Number(despachoCost.baseCost || 0);
      operationTypeName = String(despachoCost.operationTypeName || operationTypeKey);

      calculationBaseType =
        String(despachoCost.calculationBaseType || "TOTAL").trim().toUpperCase() === "SUBTOTAL"
          ? "SUBTOTAL"
          : "TOTAL";

      pricingMode =
        String(despachoCost.pricingMode || "PERCENT").trim().toUpperCase() === "FIXED"
          ? "FIXED"
          : "PERCENT";
    }

    const clientRequestedCalculationBaseType: "TOTAL" | "SUBTOTAL" =
    String(data.calculationBaseType || calculationBaseType || "TOTAL").trim().toUpperCase() === "SUBTOTAL"
      ? "SUBTOTAL"
      : "TOTAL";

  calculationBaseType = clientRequestedCalculationBaseType;
  if (assignedCost < baseInheritedCost) {
      throw new HttpsError(
        "failed-precondition",
        inheritedFromType === "user"
          ? `El costo del cliente no puede ser menor al costo heredado del usuario superior (${baseInheritedCost}).`
          : `El costo del cliente no puede ser menor al costo base del despacho (${baseInheritedCost}).`
      );
    }

    const ref = clientRef.collection("costos").doc(costId);

    await ref.set(
      {
        rootId,
        clientId,
        costId,
        despachoId: sourceDespachoId,
        inheritedFromUserId,
        inheritedFromType,
        sourceDespachoId,
        operationTypeKey,
        operationTypeName,
        calculationBaseType,
        pricingMode,
        active,
        baseInheritedCost,
        assignedCost,
        notes,
        createdBy: uid,
        actorUsername,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await logActivity({
      event: "COSTO_CLIENTE_CONFIGURADO",
      rootId,
      actorUid: uid,
      actorUsername,
      actorRole: role,
      entityType: "client",
      entityId: clientId,
      relatedEntityId: `${despachoId}:${operationTypeKey}`,
      relatedEntityType: "operationType",
      referenceId: `${clientId}:${despachoId}:${operationTypeKey}`,
      referenceType: "clientCost",
      amount: assignedCost,
      description:
        inheritedFromType === "user"
          ? `Cliente ${clientNameForLog} configurado con costo ${assignedCost} para ${operationTypeKey} (base heredada ${baseInheritedCost}, calculo cliente ${calculationBaseType}).`
          : `Cliente ${clientNameForLog} configurado con costo ${assignedCost} para ${operationTypeKey} (base despacho ${baseInheritedCost}, calculo cliente ${calculationBaseType}).`,
      createdBy: uid,
    });

    return {
      ok: true,
      clientId,
      costId,
      despachoId,
      inheritedFromUserId,
      inheritedFromType,
      sourceDespachoId,
      operationTypeKey,
      baseInheritedCost,
      assignedCost,
      active,
    };
  }
);

