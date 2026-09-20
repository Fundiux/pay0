import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { logActivity } from "../../utils/logActivity";
import { assertAuthorized, getUserRole } from "../../utils/authGuard";
import { nextSequenceTx } from "../sequences/service";
import { db, getActivityAdminId, getMyUser, requireAuth, requireRole } from "../sharedCallables/helpers";
import { assertValidCompanyIdentity, normalizeCompanyIdentity } from "./domain";
import { buildCompanyActivePatch } from "./service";

export const createCompany = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin"], requiredModule: "empresas", requiredAction: "view" });
    requireRole(caller, ["superadmin"]);

    const despachoId = String(request.data?.despachoId || "").trim();
    const { nombre, rfc } = normalizeCompanyIdentity(request.data);

    if (!despachoId) throw new HttpsError("invalid-argument", "despachoId requerido.");
    try { assertValidCompanyIdentity({ nombre, rfc }); } catch (error: any) { throw new HttpsError("invalid-argument", String(error?.message || "empresa invalida.")); }

    const callerRootId = String((caller as any)?.rootId || callerUid);

    const despachoRef = db.doc(`despachos/${despachoId}`);
    const despachoSnap = await despachoRef.get();
    if (!despachoSnap.exists) {
      throw new HttpsError("not-found", "Despacho no existe.");
    }

    const despachoData: any = despachoSnap.data() || {};
    if (despachoData?.rootId && String(despachoData.rootId) !== callerRootId) {
      throw new HttpsError("permission-denied", "Despacho fuera de tu root.");
    }
    if (despachoData?.active === false) {
      throw new HttpsError("failed-precondition", "Despacho inactivo.");
    }

    const companyRef = db.collection("companies").doc();
    const now = FieldValue.serverTimestamp();
    let companyNumber = 0;
    let companySequenceCounterPath = "";

    await db.runTransaction(async (tx) => {
      const seq = await nextSequenceTx({
        db,
        tx,
        rootId: callerRootId,
        scope: "companies",
        scopeKey: "global",
      });

      companyNumber = seq.sequenceNumber;
      companySequenceCounterPath = seq.counterPath;

      tx.set(companyRef, {
        rootId: callerRootId,
        despachoId,
        nombre,
        rfc,
        active: true,
        companyNumber,
        numeroEmpresa: companyNumber,
        sequenceNumber: companyNumber,
        sequenceScope: `companies:${callerRootId}`,
        sequenceCounterPath: companySequenceCounterPath,
        createdAt: now,
        updatedAt: now,
        createdBy: callerUid,
        updatedBy: callerUid,
      });
    });

    await logActivity({
      event: "COMPANY_CREATE",
      rootId: callerRootId,
      adminId: getActivityAdminId(caller, callerUid, callerRootId),
      actorUid: callerUid,
      actorName: String((caller as any)?.email || callerUid),
      actorUsername: String((caller as any)?.username || ""),
      actorRole: String(getUserRole(caller) || ""),
      referenceId: companyRef.id,
      referenceType: "company",
      relatedEntityId: despachoId,
      relatedEntityType: "despacho",
      description: `Empresa ${companyRef.id} creada en despacho ${despachoId}`,
    });

    return { ok: true, companyId: companyRef.id };
  }
);

export const toggleCompanyActive = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin"], requiredModule: "empresas", requiredAction: "view" });
    requireRole(caller, ["superadmin"]);

    const companyId = String(request.data?.companyId || "").trim();
    const nextActive = Boolean(request.data?.nextActive);

    if (!companyId) throw new HttpsError("invalid-argument", "companyId requerido.");

    const callerRootId = String((caller as any)?.rootId || callerUid);
    const companyRef = db.doc(`companies/${companyId}`);
    const companySnap = await companyRef.get();

    if (!companySnap.exists) {
      throw new HttpsError("not-found", "Empresa no existe.");
    }

    const companyData: any = companySnap.data() || {};
    const despachoId = String(companyData?.despachoId || "");

    if (companyData?.rootId && String(companyData.rootId) !== callerRootId) {
      throw new HttpsError("permission-denied", "Empresa fuera de tu root.");
    }

    if (nextActive && despachoId) {
      const despachoSnap = await db.doc(`despachos/${despachoId}`).get();
      if (!despachoSnap.exists) {
        throw new HttpsError("failed-precondition", "Despacho de la empresa no existe.");
      }
      const despachoData: any = despachoSnap.data() || {};
      if (despachoData?.active === false) {
        throw new HttpsError("failed-precondition", "Despacho inactivo.");
      }
    }

    await companyRef.set(
      buildCompanyActivePatch({ nextActive, updatedBy: callerUid, updatedAt: FieldValue.serverTimestamp() }),
      { merge: true }
    );

    await logActivity({
      event: "COMPANY_TOGGLE",
      rootId: callerRootId,
      adminId: getActivityAdminId(caller, callerUid, callerRootId),
      actorUid: callerUid,
      actorName: String((caller as any)?.email || callerUid),
      actorUsername: String((caller as any)?.username || ""),
      actorRole: String(getUserRole(caller) || ""),
      referenceId: companyId,
      referenceType: "company",
      relatedEntityId: despachoId,
      relatedEntityType: "despacho",
      description: `Empresa ${companyId} ${nextActive ? "activada" : "desactivada"}`,
    });

    return { ok: true, companyId, active: nextActive };
  }
);

export const setDispatchCompanies = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin"], requiredModule: "empresas", requiredAction: "view" });
    requireRole(caller, ["superadmin"]);

    const despachoId = String(request.data?.despachoId || "").trim();
    const companyIds = Array.isArray(request.data?.companyIds)
      ? request.data.companyIds.map((x: any) => String(x).trim()).filter(Boolean)
      : [];

    if (!despachoId) {
      throw new HttpsError("invalid-argument", "despachoId requerido.");
    }

    const callerRootId = String(caller?.rootId || callerUid);

    const despachoSnap = await db.doc(`despachos/${despachoId}`).get();
    if (!despachoSnap.exists) {
      throw new HttpsError("not-found", "Despacho no existe.");
    }

    const despacho: any = despachoSnap.data() || {};
    const despachoRootId = String(despacho?.rootId || "");

    if (despachoRootId && despachoRootId !== callerRootId) {
      throw new HttpsError("permission-denied", "Despacho fuera de tu root.");
    }

    const now = FieldValue.serverTimestamp();
    const accessCol = db.collection(`dispatchCompanyAccess/${despachoId}/companies`);
    const currentSnap = await accessCol.get();

    const batch = db.batch();

    currentSnap.docs.forEach((d) => {
      batch.set(
        d.ref,
        {
          active: false,
          updatedAt: now,
          updatedBy: callerUid,
        },
        { merge: true }
      );
    });

    for (const companyId of companyIds) {
      const companySnap = await db.doc(`companies/${companyId}`).get();
      if (!companySnap.exists) {
        continue;
      }

      const company: any = companySnap.data() || {};
      const companyRootId = String(company?.rootId || "");
      const companyDespachoId = String(company?.despachoId || "");

      if (companyRootId && companyRootId !== callerRootId) {
        throw new HttpsError("permission-denied", `Empresa fuera de tu root: ${companyId}`);
      }

      if (companyDespachoId && companyDespachoId !== despachoId) {
        throw new HttpsError("invalid-argument", `Empresa no pertenece al despacho: ${companyId}`);
      }

      batch.set(
        db.doc(`dispatchCompanyAccess/${despachoId}/companies/${companyId}`),
        {
          active: true,
          updatedAt: now,
          updatedBy: callerUid,
          createdAt: now,
          createdBy: callerUid,
        },
        { merge: true }
      );
    }

    await batch.commit();

    return { ok: true, despachoId, companyIds };
  }
);

export const listCompaniesCanonical = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);
    const callerRole = String(getUserRole(caller) || "").trim().toLowerCase();
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "empresas", requiredAction: "view" });
    const callerRootId = String((caller as any)?.rootId || callerUid);
    const requestedDispatchId = String(request.data?.despachoId || "").trim();
    let companyDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];

    if (callerRole === "superadmin") {
      let query: FirebaseFirestore.Query = db.collection("companies");
      if (requestedDispatchId) query = query.where("despachoId", "==", requestedDispatchId);
      companyDocs = (await query.get()).docs;
    } else {
      const [directSnap, dispatchSnap] = await Promise.all([
        db.collection(`userCompanyAccess/${callerUid}/companies`).where("active", "==", true).get(),
        db.collection(`userDespachoAccess/${callerUid}/despachos`).where("active", "==", true).get(),
      ]);
      const allowedIds = new Set<string>(directSnap.docs.map((doc) => doc.id));
      for (const dispatchDoc of dispatchSnap.docs) {
        if (requestedDispatchId && dispatchDoc.id !== requestedDispatchId) continue;
        const inherited = await db.collection(`dispatchCompanyAccess/${dispatchDoc.id}/companies`).where("active", "==", true).get();
        inherited.docs.forEach((doc) => allowedIds.add(doc.id));
      }
      const refs = [...allowedIds].map((id) => db.doc(`companies/${id}`));
      const snapshots: FirebaseFirestore.DocumentSnapshot[] = [];
      for (let i = 0; i < refs.length; i += 250) snapshots.push(...(await db.getAll(...refs.slice(i, i + 250))));
      companyDocs = snapshots.filter((snap): snap is FirebaseFirestore.QueryDocumentSnapshot => snap.exists) as FirebaseFirestore.QueryDocumentSnapshot[];
    }

    const companies = companyDocs.map((doc) => {
      const data: any = doc.data() || {};
      const depositAccounts = normalizeCompanyDepositAccounts(data.depositAccounts, data.depositClabes);
      return {
        id: doc.id,
        rootId: String(data.rootId || ""),
        despachoId: String(data.despachoId || ""),
        nombre: String(data.nombre || ""),
        rfc: String(data.rfc || ""),
        depositAlias: String(data.depositAlias || ""),
        depositClabes: depositAccounts.filter((row) => row.status === "ACTIVA").map((row) => row.clabe),
        depositAccounts,
        active: data.active !== false,
        companyNumber: Number(data.companyNumber || data.numeroEmpresa || 0) || null,
      };
    }).filter((company) => company.active && (callerRole === "superadmin" || company.rootId === callerRootId) && (!requestedDispatchId || company.despachoId === requestedDispatchId));
    companies.sort((a, b) => a.nombre.localeCompare(b.nombre));
    return { ok: true, companies };
  }
);

function normalizeCompanyDepositAlias(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeCompanyDepositClabes(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[\s,;]+/);

  return [...new Set(
    source
      .map((entry) => String(entry ?? "").replace(/\D/g, ""))
      .filter((entry) => entry.length === 18),
  )];
}

function normalizeCompanyDepositAccounts(value: unknown, legacyClabes: unknown = []): Array<{ id: string; clabe: string; status: "ACTIVA" | "INACTIVA"; validFrom: string | null; validTo: string | null }> {
  const source = Array.isArray(value) ? value : [];
  const accounts = source.map((row: any, index) => {
    const clabe = String(row?.clabe || row?.CLABE || "").replace(/\D/g, "");
    if (clabe.length !== 18) return null;
    const status = String(row?.status || "ACTIVA").toUpperCase() === "INACTIVA" ? "INACTIVA" : "ACTIVA";
    return { id: String(row?.id || `deposit_${clabe}_${index}`), clabe, status, validFrom: row?.validFrom ? String(row.validFrom) : null, validTo: row?.validTo ? String(row.validTo) : null };
  }).filter(Boolean) as Array<{ id: string; clabe: string; status: "ACTIVA" | "INACTIVA"; validFrom: string | null; validTo: string | null }>;
  const seen = new Set(accounts.map((row) => row.clabe));
  for (const clabe of normalizeCompanyDepositClabes(legacyClabes)) if (!seen.has(clabe)) accounts.push({ id: `deposit_${clabe}`, clabe, status: "ACTIVA", validFrom: null, validTo: null });
  return accounts;
}

export const updateCompanyDepositIdentity = onCall(
  { cors: true, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const callerUid = requireAuth(request);
    const caller = await getMyUser(callerUid);

    assertAuthorized(request.auth, caller, {
      allowedRoles: ["superadmin"],
      requiredModule: "empresas",
      requiredAction: "view",
    });

    requireRole(caller, ["superadmin"]);

    const companyId = String(request.data?.companyId || "").trim();
    const depositAlias = normalizeCompanyDepositAlias(
      request.data?.depositAlias,
    );
    const depositClabes = normalizeCompanyDepositClabes(
      request.data?.depositClabes,
    );
    const depositAccounts = normalizeCompanyDepositAccounts(request.data?.depositAccounts, depositClabes);

    if (!companyId) {
      throw new HttpsError("invalid-argument", "companyId requerido.");
    }

    const companyRef = db.doc(`companies/${companyId}`);
    const companySnap = await companyRef.get();

    if (!companySnap.exists) {
      throw new HttpsError("not-found", "Empresa no encontrada.");
    }

    const company: any = companySnap.data() || {};
    const callerRootId = String((caller as any)?.rootId || callerUid);
    const companyRootId = String(company?.rootId || "");

    if (companyRootId && companyRootId !== callerRootId) {
      throw new HttpsError("permission-denied", "Empresa fuera de tu root.");
    }

    const allCompanies = await db
      .collection("companies")
      .where("rootId", "==", callerRootId)
      .get();

    for (const row of allCompanies.docs) {
      if (row.id === companyId) continue;

      const data: any = row.data() || {};
      if (data.active === false) continue;

      const otherAlias = normalizeCompanyDepositAlias(data.depositAlias);
      const otherClabes = normalizeCompanyDepositClabes(data.depositClabes);

      if (depositAlias && otherAlias && depositAlias === otherAlias) {
        throw new HttpsError(
          "already-exists",
          `El alias de deposito ya pertenece a ${String(data.nombre || "otra empresa")}.`,
        );
      }

      const duplicated = depositClabes.find((clabe) =>
        otherClabes.includes(clabe),
      );

      if (duplicated) {
        throw new HttpsError(
          "already-exists",
          `La CLABE terminacion ${duplicated.slice(-6)} ya pertenece a ${String(data.nombre || "otra empresa")}.`,
        );
      }
    }

    await companyRef.set(
      {
        depositAlias,
        depositClabes,
        depositAccounts,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: callerUid,
      },
      { merge: true },
    );

    return {
      ok: true,
      companyId,
      companyName: String(company?.nombre || ""),
      depositAlias,
      depositClabes,
    };
  },
);
