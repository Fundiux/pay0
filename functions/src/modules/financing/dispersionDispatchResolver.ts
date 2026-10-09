import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { canRunIqAutomationForDispatch } from "../dispatches/domain";

type DispatchRow = Record<string, unknown> & { id?: string };

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function resolveDispersionDespachoIdForRole(input: {
  role: string;
  requestedDespachoId?: unknown;
  dispatches: DispatchRow[];
}): string {
  const role = clean(input.role).toLowerCase();
  const requested = clean(input.requestedDespachoId);

  if (role === "superadmin") {
    if (!requested) {
      throw new HttpsError(
        "invalid-argument",
        "Selecciona el despacho para la dispersion.",
      );
    }
    return requested;
  }

  const iqDispatches = input.dispatches.filter((row) =>
    Boolean(clean(row.id)) && canRunIqAutomationForDispatch(row),
  );

  if (iqDispatches.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      "No hay un despacho IQ activo configurado para esta cuenta.",
    );
  }

  if (iqDispatches.length > 1) {
    throw new HttpsError(
      "failed-precondition",
      "Hay mas de un despacho IQ activo. Super Admin debe corregir la configuracion.",
    );
  }

  return clean(iqDispatches[0].id);
}

export async function resolveDispersionDespachoId(input: {
  db: Firestore;
  rootId: string;
  role: string;
  requestedDespachoId?: unknown;
}): Promise<string> {
  if (clean(input.role).toLowerCase() === "superadmin") {
    return resolveDispersionDespachoIdForRole({
      role: input.role,
      requestedDespachoId: input.requestedDespachoId,
      dispatches: [],
    });
  }

  const snap = await input.db.collection("despachos")
    .where("rootId", "==", clean(input.rootId))
    .get();

  return resolveDispersionDespachoIdForRole({
    role: input.role,
    requestedDespachoId: input.requestedDespachoId,
    dispatches: snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
  });
}
