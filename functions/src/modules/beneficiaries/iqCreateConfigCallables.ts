import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { logActivity } from "../../utils/logActivity";
import { assertIqAuthorized } from "../iq/authorization";
import { db } from "../sharedCallables/helpers";
import { DEFAULT_CATALOG_MAX_AGE_HOURS, MAX_DAILY_CREATE_LIMIT } from "./iqLinkDomain";

const text = (value: unknown) => String(value ?? "").trim();
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

// Validates the change; only the fields sent are touched. Exported for tests.
export function parseCreateConfigPatch(data: unknown): Record<string, boolean | number> {
  const input = asRecord(data), patch: Record<string, boolean | number> = {};
  for (const field of ["enabled", "contractVerified"]) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== "boolean") throw new HttpsError("invalid-argument", `${field} debe ser verdadero o falso.`);
    patch[field] = input[field] as boolean;
  }
  if (input.dailyLimit !== undefined) {
    const limit = Number(input.dailyLimit);
    if (!Number.isInteger(limit) || limit < 0 || limit > MAX_DAILY_CREATE_LIMIT) throw new HttpsError("invalid-argument", `dailyLimit debe ser un entero entre 0 y ${MAX_DAILY_CREATE_LIMIT}.`);
    patch.dailyLimit = limit;
  }
  if (input.catalogMaxAgeHours !== undefined) {
    const hours = Number(input.catalogMaxAgeHours);
    if (!Number.isFinite(hours) || hours < 1 || hours > 72) throw new HttpsError("invalid-argument", "catalogMaxAgeHours debe estar entre 1 y 72.");
    patch.catalogMaxAgeHours = hours;
  }
  if (!Object.keys(patch).length) throw new HttpsError("invalid-argument", "Sin cambios: envía enabled, contractVerified, dailyLimit o catalogMaxAgeHours.");
  return patch;
}

// Super Admin only, scoped to the caller's own root: turns automatic beneficiary creation in IQ on or off and
// sets its limits. Called with no fields that change anything it fails; reading the state needs no call.
export const setIqBeneficiaryCreateConfig = onCall({ cors: true, invoker: "public", timeoutSeconds: 30, memory: "256MiB" }, async request => {
  const profile = await assertIqAuthorized(request, { allowedRoles: ["superadmin"] });
  if (text(profile.role).toLowerCase() !== "superadmin") throw new HttpsError("permission-denied", "Solo Super Admin puede cambiar el alta automática en IQ.");
  const uid = text(request.auth?.uid);
  const rootId = text(profile.rootId) || uid;
  const patch = parseCreateConfigPatch(request.data);
  const ref = db.doc(`iqBeneficiaryCreateConfig/${rootId}`);
  const before = (await ref.get()).data() || {};
  await ref.set({ ...patch, rootId, updatedBy: uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const after = { ...before, ...patch };
  await logActivity({ event: "IQ_BENEFICIARIO_ALTA_CONFIGURADA", rootId, actorUid: uid, actorRole: "superadmin", referenceType: "iqBeneficiaryCreateConfig",
    description: `Alta automática de beneficiarios en IQ: ${after.enabled === true ? "encendida" : "apagada"}, contrato ${after.contractVerified === true ? "verificado" : "sin verificar"}, ${Number.isFinite(Number(after.dailyLimit)) ? `límite diario ${Number(after.dailyLimit)}` : "sin límite diario"}.`,
    extra: { changed: Object.keys(patch) } }).catch(() => undefined);
  return {
    enabled: after.enabled === true, contractVerified: after.contractVerified === true,
    // null means no daily cap (Infinity would not survive JSON).
    dailyLimit: Number.isFinite(Number(after.dailyLimit)) ? Number(after.dailyLimit) : null,
    catalogMaxAgeHours: Number.isFinite(Number(after.catalogMaxAgeHours)) ? Number(after.catalogMaxAgeHours) : DEFAULT_CATALOG_MAX_AGE_HOURS,
  };
});
