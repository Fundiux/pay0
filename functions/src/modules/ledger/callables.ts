import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { resolveClientOperationalAccess } from "../clientDelegations/access";
import { assertAuthorized } from "../../utils/authGuard";
import {
  buildCanonicalBalanceValues,
  readCanonicalBalanceSummary,
  readCanonicalStatement,
  resolveCanonicalAvailableBalance,
} from "./service";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

type Pay0Role = "superadmin" | "admin" | "operador" | "";

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeRole(value: unknown): Pay0Role {
  const role = cleanText(value).toLowerCase();
  if (role === "superadmin") return "superadmin";
  if (role === "admin") return "admin";
  if (role === "operador" || role === "operator") return "operador";
  return "";
}

function assertUid(request: any) {
  const uid = cleanText(request?.auth?.uid);
  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
  }
  return uid;
}

async function getProfile(uid: string) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) {
    throw new HttpsError("permission-denied", "Perfil de usuario no encontrado.");
  }

  const profile = snap.data() || {};
  const role = normalizeRole((profile as any).role ?? (profile as any).supervisorRole);
  const rootId = cleanText((profile as any).rootId || uid);

  return { role, rootId, profile };
}

function assertDirectFinancialClientAccess(access: Awaited<ReturnType<typeof resolveClientOperationalAccess>>) {
  if (!access.allowed) {
    throw new HttpsError("permission-denied", "No autorizado para consultar este cliente.");
  }

  if (access.source === "DELEGATED") {
    throw new HttpsError(
      "permission-denied",
      "Delegacion operativa no incluye estado de cuenta del cliente.",
    );
  }
}

function normalizeLimit(value: unknown) {
  const n = Number(value || 100);
  if (!Number.isFinite(n)) return 100;
  return Math.min(Math.max(Math.trunc(n), 1), 250);
}

export const getClientBalanceSummary = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = assertUid(request);
    const { role, rootId, profile } = await getProfile(uid);
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "estadoCuentaCliente" });
    const clienteId = cleanText((request.data || {}).clienteId || (request.data || {}).clientId);

    if (!clienteId) {
      throw new HttpsError("invalid-argument", "clienteId requerido.");
    }

    const access = await resolveClientOperationalAccess({ uid, role, rootId, clientId: clienteId });
    assertDirectFinancialClientAccess(access);

    const summary = await readCanonicalBalanceSummary(db, "CLIENT", clienteId);
    return { ok: true, summary };
  },
);

export const getClientStatement = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = assertUid(request);
    const { role, rootId, profile } = await getProfile(uid);
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "estadoCuentaCliente" });
    const clienteId = cleanText((request.data || {}).clienteId || (request.data || {}).clientId);

    if (!clienteId) {
      throw new HttpsError("invalid-argument", "clienteId requerido.");
    }

    const access = await resolveClientOperationalAccess({ uid, role, rootId, clientId: clienteId });
    assertDirectFinancialClientAccess(access);

    return readCanonicalStatement(db, "CLIENT", clienteId, normalizeLimit((request.data || {}).limit));
  },
);

export const getUserBalanceSummary = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = assertUid(request);
    const { role, profile } = await getProfile(uid);
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "estadoCuentaUsuario" });
    const targetUid = cleanText((request.data || {}).uid || (request.data || {}).userId || uid);

    if (targetUid !== uid && role !== "superadmin") {
      throw new HttpsError("permission-denied", "No autorizado para consultar este usuario.");
    }

    const summary = await readCanonicalBalanceSummary(db, "USER", targetUid);
    return { ok: true, summary };
  },
);

export const getUserStatement = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = assertUid(request);
    const { role, profile } = await getProfile(uid);
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "estadoCuentaUsuario" });
    const targetUid = cleanText((request.data || {}).uid || (request.data || {}).userId || uid);

    if (targetUid !== uid && role !== "superadmin") {
      throw new HttpsError("permission-denied", "No autorizado para consultar este usuario.");
    }

    return readCanonicalStatement(db, "USER", targetUid, normalizeLimit((request.data || {}).limit));
  },
);

export const getClientOperationalBalanceSummary = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = assertUid(request);
    const { role, rootId, profile } = await getProfile(uid);
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "dispersiones" });
    const clienteId = cleanText((request.data || {}).clienteId || (request.data || {}).clientId);

    if (!clienteId) {
      throw new HttpsError("invalid-argument", "clienteId requerido.");
    }

    const access = await resolveClientOperationalAccess({ uid, role, rootId, clientId: clienteId });

    if (!access.allowed || access.permissions.viewBalanceInDispersion !== true) {
      throw new HttpsError("permission-denied", "No autorizado para consultar saldo operativo del cliente.");
    }

    const summary = await readCanonicalBalanceSummary(db, "CLIENT", clienteId);

    // H4_D87_A58_A43_DISPERSION_OPERATIONAL_DISPATCH_BALANCES
    // El frontend no lee dispatchBalanceAccounts directamente.
    // Este mismo callable autorizado entrega el desglose operativo.
    const dispatchAccountsSnap = await db
      .collection("dispatchBalanceAccounts")
      .where("holderId", "==", clienteId)
      .get();

    const dispatchBalances = dispatchAccountsSnap.docs
      .map((doc) => {
        const data: any = doc.data() || {};

        const money2 = (value: unknown) => {
          const amount = Number(value ?? 0);
          return Number.isFinite(amount)
            ? Math.round(amount * 100) / 100
            : 0;
        };

        return {
          id: doc.id,
          rootId: cleanText(data.rootId),
          holderType: cleanText(data.holderType).toUpperCase(),
          despachoId: cleanText(data.despachoId),
          despachoName: cleanText(data.despachoName) || null,
          channel: cleanText(data.channel).toUpperCase() || null,
          currency: cleanText(data.currency).toUpperCase() || "MXN",
          availableBalance: money2(
            data.availableBalance ??
              data.executableBalance ??
              0,
          ),
          executableBalance: money2(
            data.executableBalance ??
              data.availableBalance ??
              0,
          ),
          reservedBalance: money2(
            data.reservedBalance ?? 0,
          ),
          status:
            cleanText(data.status).toUpperCase() ||
            "ACTIVE",
        };
      })
      .filter(
        (row) =>
          row.holderType === "CLIENT" &&
          Boolean(row.despachoId) &&
          row.status !== "BLOCKED" &&
          (
            !summary.rootId ||
            row.rootId === cleanText(summary.rootId)
          ),
      )
      .map(({ rootId: _rootId, holderType: _holderType, ...row }) => row)
      .sort((a, b) => {
        const left =
          String(
            a.despachoName ||
              a.channel ||
              a.despachoId,
          );

        const right =
          String(
            b.despachoName ||
              b.channel ||
              b.despachoId,
          );

        return left.localeCompare(right, "es");
      });

    return {
      ok: true,
      summary: {
        holderType: summary.holderType,
        holderId: summary.holderId,
        availableBalance: summary.availableBalance,
        pendingAdvance: summary.pendingAdvance,
        netBalance: summary.netBalance,
        lastMovementAtMillis: summary.lastMovementAtMillis,
        updatedAtMillis: summary.updatedAtMillis,
        dispatchBalances,
      },
      access: {
        source: access.source,
        viewBalanceInDispersion: access.permissions.viewBalanceInDispersion === true,
      },
    };
  },
);

type LedgerScope = {
  field: "rootId" | "adminId" | "operadorId";
  value: string;
};

function resolveLedgerScope(uid: string, role: Pay0Role, rootId: string): LedgerScope {
  if (role === "superadmin") {
    return { field: "rootId", value: rootId || uid };
  }

  if (role === "admin") {
    return { field: "adminId", value: uid };
  }

  return { field: "operadorId", value: uid };
}

function toMillis(value: any): number | null {
  if (!value) return null;

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value?.toMillis === "function") {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    const millis = Number(date?.getTime?.());
    return Number.isFinite(millis) ? millis : null;
  }

  const seconds = Number(value?.seconds ?? value?._seconds);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.round(seconds * 1000);
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function money2(value: unknown) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function mapScopedMovement(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = doc.data() || {};

  return {
    id: doc.id,
    holderType: cleanText((data as any).holderType),
    holderId: cleanText((data as any).holderId),
    holderName: cleanText((data as any).holderName),
    holderRole: cleanText((data as any).holderRole) || null,
    movementType: cleanText((data as any).movementType) || "MOVIMIENTO",
    movementSubType: cleanText((data as any).movementSubType) || null,
    direction: cleanText((data as any).direction).toUpperCase(),
    amount: money2((data as any).amount),
    note: cleanText((data as any).note) || null,
    clienteId: cleanText((data as any).clienteId) || null,
    empresaId: cleanText((data as any).empresaId) || null,
    empresaNombre: cleanText((data as any).empresaNombre) || null,
    referenceId: cleanText((data as any).referenceId) || null,
    referenceFolio: cleanText((data as any).referenceFolio) || null,
    folio: cleanText((data as any).folio) || null,
    pagoFolio: cleanText((data as any).pagoFolio) || null,
    solicitudFolio: cleanText((data as any).solicitudFolio) || null,
    dispersionFolio: cleanText((data as any).dispersionFolio) || null,
    sourceFolio: cleanText((data as any).sourceFolio) || null,
    referenceType: cleanText((data as any).referenceType) || null,
    sourceModule: cleanText((data as any).sourceModule) || null,
    actorUsername: cleanText((data as any).actorUsername) || null,
    createdAtMillis: toMillis((data as any).createdAt),
  };
}

async function readScopedWalletOverview(holderType: "CLIENT" | "USER", scope: LedgerScope) {
  const accountsSnap = await db
    .collection("balanceAccounts")
    .where("holderType", "==", holderType)
    .where(scope.field, "==", scope.value)
    .limit(500)
    .get();

  let totalBalance = 0;
  accountsSnap.forEach((doc) => {
    const data = doc.data() || {};
    totalBalance += money2((data as any).availableBalance ?? (data as any).balance ?? (data as any).currentBalance);
  });

  const movementsSnap = await db
    .collection("balanceMovements")
    .where("holderType", "==", holderType)
    .where(scope.field, "==", scope.value)
    .orderBy("createdAt", "desc")
    .limit(100)
    .get();

  return {
    totalBalance: money2(totalBalance),
    accountsCount: accountsSnap.size,
    movements: movementsSnap.docs.map(mapScopedMovement),
  };
}

export const getClientWalletOverview = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = assertUid(request);
    const { role, rootId, profile } = await getProfile(uid);
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "saldos" });
    const scope = resolveLedgerScope(uid, role, rootId);

    const overview = await readScopedWalletOverview("CLIENT", scope);

    return {
      ok: true,
      scope,
      ...overview,
    };
  },
);

export const getUserWalletOverview = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = assertUid(request);
    const { role, rootId, profile } = await getProfile(uid);
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "saldos" });
    const scope = resolveLedgerScope(uid, role, rootId);

    const overview = await readScopedWalletOverview("USER", scope);

    return {
      ok: true,
      scope,
      ...overview,
    };
  },
);

async function readScopedClientWalletAccounts(scope: LedgerScope) {
  const accountsSnap = await db
    .collection("balanceAccounts")
    .where("holderType", "==", "CLIENT")
    .where(scope.field, "==", scope.value)
    .limit(500)
    .get();

  const advanceMap = new Map<string, { totalGranted: number; pendingAmount: number }>();

  const advancesSnap = await db
    .collection("clientAdvances")
    .where(scope.field, "==", scope.value)
    .limit(1000)
    .get();

  advancesSnap.forEach((doc) => {
    const data = doc.data() || {};
    const clienteId = cleanText((data as any).clienteId || (data as any).clientId);

    if (!clienteId) return;

    const current = advanceMap.get(clienteId) || {
      totalGranted: 0,
      pendingAmount: 0,
    };

    current.totalGranted += money2((data as any).amount);
    current.pendingAmount += money2((data as any).pendingAmount);

    advanceMap.set(clienteId, current);
  });

  const accounts = accountsSnap.docs.map((doc) => {
    const data = doc.data() || {};
    const holderId = cleanText((data as any).holderId);
    const advance = advanceMap.get(holderId) || {
      totalGranted: 0,
      pendingAmount: 0,
    };

    const pendingAmount = money2(advance.pendingAmount);
    const totalGranted = money2(advance.totalGranted);
    const canonicalValues = buildCanonicalBalanceValues(data as any, pendingAmount);

    return {
      id: doc.id,
      holderId,
      holderName: cleanText((data as any).holderName) || null,
      holderType: cleanText((data as any).holderType) || "CLIENT",
      availableBalance: canonicalValues.availableBalance,
      pendingAmount,
      totalGranted,
      netBalance: canonicalValues.netBalance,
      lastMovementAtMillis: toMillis((data as any).lastMovementAt),
      updatedAtMillis: toMillis((data as any).updatedAt),
    };
  });

  accounts.sort((a, b) => {
    const netDiff = Number(b.netBalance || 0) - Number(a.netBalance || 0);
    if (netDiff !== 0) return netDiff;
    return String(a.holderName || "").localeCompare(String(b.holderName || ""));
  });

  return accounts;
}

export const getClientWalletAccountsOverview = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = assertUid(request);
    const { role, rootId, profile } = await getProfile(uid);
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "estadoCuentaCliente" });
    const scope = resolveLedgerScope(uid, role, rootId);

    const accounts = await readScopedClientWalletAccounts(scope);

    return {
      ok: true,
      scope,
      accounts,
    };
  },
);

function mapClientDetailMovement(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = doc.data() || {};
  const base = mapScopedMovement(doc);

  return {
    ...base,
    companyName: cleanText((data as any).companyName) || null,
    depositId: cleanText((data as any).depositId) || null,
    dispersionId: cleanText((data as any).dispersionId) || null,
    transferId: cleanText((data as any).transferId) || null,
    operationalReference: cleanText((data as any).operationalReference) || null,
    displayConcept: cleanText((data as any).displayConcept) || null,
    currency: cleanText((data as any).currency) || null,
    actorDisplayName: cleanText((data as any).actorDisplayName) || null,
    isSystemGenerated: Boolean((data as any).isSystemGenerated || false),
    beforeBalance: Object.prototype.hasOwnProperty.call(data, "beforeBalance")
      ? money2((data as any).beforeBalance)
      : null,
    afterBalance: Object.prototype.hasOwnProperty.call(data, "afterBalance")
      ? money2((data as any).afterBalance)
      : null,
  };
}

function mapClientDetailAdvance(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = doc.data() || {};

  return {
    id: doc.id,
    amount: money2((data as any).amount),
    pendingAmount: money2((data as any).pendingAmount),
    status: cleanText((data as any).status) || null,
    reason: cleanText((data as any).reason) || null,
    note: cleanText((data as any).note) || null,
    reference: cleanText((data as any).reference) || null,
    createdAtMillis: toMillis((data as any).createdAt),
    lastLiquidatedAtMillis: toMillis((data as any).lastLiquidatedAt),
  };
}

function mapClientDetailDispersion(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = doc.data() || {};

  return {
    id: doc.id,
    clienteId: cleanText((data as any).clienteId) || null,
    clientId: cleanText((data as any).clientId) || null,
    folio: cleanText((data as any).folio) || null,
    beneficiaryId: cleanText((data as any).beneficiaryId) || null,
    beneficiaryNombre: cleanText((data as any).beneficiaryNombre) || null,
    methodTipo: cleanText((data as any).methodTipo) || null,
    destinationKind: cleanText((data as any).destinationKind) || null,
    bankName: cleanText((data as any).bankName) || null,
    clabe: cleanText((data as any).clabe) || null,
    cardNumber: cleanText((data as any).cardNumber) || null,
    displayConcept: cleanText((data as any).displayConcept) || null,
    operationalReference: cleanText((data as any).operationalReference) || null,
    referenceFolio: cleanText((data as any).referenceFolio) || null,
    dispersionFolio: cleanText((data as any).dispersionFolio) || null,
    sourceFolio: cleanText((data as any).sourceFolio) || null,
    empresaId: cleanText((data as any).empresaId) || null,
    note: cleanText((data as any).note) || null,
    reference: cleanText((data as any).reference) || null,
  };
}

async function readScopedClientWalletDetail(scope: LedgerScope, clienteId: string) {
  const cleanClienteId = cleanText(clienteId);

  const accountSnap = await db
    .collection("balanceAccounts")
    .where("holderType", "==", "CLIENT")
    .where("holderId", "==", cleanClienteId)
    .where(scope.field, "==", scope.value)
    .limit(1)
    .get();

  const accountDoc = accountSnap.docs[0] || null;
  const accountData = accountDoc?.data() || null;

  const account = accountDoc && accountData
    ? {
        id: accountDoc.id,
        holderId: cleanText((accountData as any).holderId),
        holderName: cleanText((accountData as any).holderName) || null,
        availableBalance: resolveCanonicalAvailableBalance(accountData as any),
        lastMovementAtMillis: toMillis((accountData as any).lastMovementAt),
        updatedAtMillis: toMillis((accountData as any).updatedAt),
      }
    : null;

  const movementsSnap = await db
    .collection("balanceMovements")
    .where("holderType", "==", "CLIENT")
    .where("holderId", "==", cleanClienteId)
    .where(scope.field, "==", scope.value)
    .orderBy("createdAt", "desc")
    .limit(1000)
    .get();

  const filteredMovements = movementsSnap.docs
    .map(mapClientDetailMovement)
    .sort((a, b) => Number(a.createdAtMillis || 0) - Number(b.createdAtMillis || 0));

  let legacyRunningBalance = 0;
  const movements = filteredMovements.map((item) => {
    const amount = money2((item as any).amount);
    legacyRunningBalance = money2(
      legacyRunningBalance + ((item as any).direction === "IN" ? amount : -amount)
    );

    return {
      ...item,
      runningBalance: (item as any).afterBalance ?? legacyRunningBalance,
    };
  });

  const [advancesByClienteIdSnap, advancesByClientIdSnap] = await Promise.all([
    db
      .collection("clientAdvances")
      .where(scope.field, "==", scope.value)
      .where("clienteId", "==", cleanClienteId)
      .limit(1000)
      .get(),
    db
      .collection("clientAdvances")
      .where(scope.field, "==", scope.value)
      .where("clientId", "==", cleanClienteId)
      .limit(1000)
      .get(),
  ]);
  const advanceDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  [...advancesByClienteIdSnap.docs, ...advancesByClientIdSnap.docs].forEach((doc) => {
    advanceDocs.set(doc.id, doc);
  });

  const advances = [...advanceDocs.values()]
    .map(mapClientDetailAdvance)
    .sort((a, b) => Number(a.createdAtMillis || 0) - Number(b.createdAtMillis || 0));

  const pendingAmount = money2(
    advances.reduce((sum, item) => sum + money2((item as any).pendingAmount), 0),
  );
  const canonicalAccount = account && accountData
    ? {
        ...account,
        pendingAmount,
        netBalance: buildCanonicalBalanceValues(accountData as any, pendingAmount).netBalance,
      }
    : null;

  const [dispersionsByClienteIdSnap, dispersionsByClientIdSnap] = await Promise.all([
    db
      .collection("clientDispersions")
      .where(scope.field, "==", scope.value)
      .where("clienteId", "==", cleanClienteId)
      .limit(1000)
      .get(),
    db
      .collection("clientDispersions")
      .where(scope.field, "==", scope.value)
      .where("clientId", "==", cleanClienteId)
      .limit(1000)
      .get(),
  ]);
  const dispersionDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  [...dispersionsByClienteIdSnap.docs, ...dispersionsByClientIdSnap.docs].forEach((doc) => {
    dispersionDocs.set(doc.id, doc);
  });

  const dispersionLookup: Record<string, ReturnType<typeof mapClientDetailDispersion>> = {};

  dispersionDocs.forEach((doc) => {
    const row = mapClientDetailDispersion(doc);
    dispersionLookup[doc.id] = row;
  });

  return {
    account: canonicalAccount,
    movements,
    advances,
    dispersionLookup,
  };
}

export const getClientWalletDetailOverview = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = assertUid(request);
    const { role, rootId, profile } = await getProfile(uid);
    assertAuthorized(request.auth, profile, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "wallet", requiredAction: "estadoCuentaCliente" });
    const scope = resolveLedgerScope(uid, role, rootId);

    const clienteId = cleanText(
      (request.data as any)?.clienteId || (request.data as any)?.clientId
    );

    if (!clienteId) {
      throw new HttpsError("invalid-argument", "clienteId requerido.");
    }

    const detail = await readScopedClientWalletDetail(scope, clienteId);

    return {
      ok: true,
      scope,
      clienteId,
      ...detail,
    };
  },
);
