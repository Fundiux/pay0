export type IqDispersionExecutionAccessInput = {
  uid: string;
  role: string;
  rootId: string;
  despacho: Record<string, unknown>;
  iqAccess: Record<string, unknown> | null;
};

export type IqDispersionExecutionAccessDecision =
  | { allowed: true }
  | { allowed: false; code: string; message: string };

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * IQ is an automatic execution channel. A non-superadmin does not need a
 * second, manual userDespachoAccess grant for the dispatch selected by PAY0.
 * Authority comes from the current PAY0 role/module guard, the resource root,
 * and the dedicated IQ access document checked here.
 */
export function decideIqDispersionExecutionAccess(
  input: IqDispersionExecutionAccessInput,
): IqDispersionExecutionAccessDecision {
  const role = clean(input.role).toLowerCase() === "operator"
    ? "operador"
    : clean(input.role).toLowerCase();
  const despacho = record(input.despacho);
  const iqAccess = record(input.iqAccess);

  if (!clean(input.uid) || !["superadmin", "admin", "operador"].includes(role)) {
    return { allowed: false, code: "ROLE_DENIED", message: "El rol no puede ejecutar dispersiones IQ." };
  }

  const despachoRootId = clean(despacho.rootId);
  if (despachoRootId && despachoRootId !== clean(input.rootId)) {
    return { allowed: false, code: "DISPATCH_OUT_OF_ROOT", message: "El despacho esta fuera de scope." };
  }

  if (despacho.active === false || despacho.activo === false) {
    return { allowed: false, code: "DISPATCH_INACTIVE", message: "El despacho esta inactivo." };
  }

  if (iqAccess.active !== true || iqAccess.iqEnabled !== true) {
    return { allowed: false, code: "IQ_ACCESS_INACTIVE", message: "El usuario no tiene acceso IQ activo." };
  }

  const accessRootId = clean(iqAccess.rootId);
  if (accessRootId && accessRootId !== clean(input.rootId)) {
    return { allowed: false, code: "IQ_ACCESS_OUT_OF_ROOT", message: "El acceso IQ esta fuera de scope." };
  }

  if (role !== "superadmin") {
    const modules = record(iqAccess.allowedModules);
    if (
      modules.dispersiones !== true &&
      modules.dispersions !== true &&
      modules.walletDispersiones !== true &&
      modules.wallet !== true
    ) {
      return { allowed: false, code: "IQ_MODULE_DENIED", message: "El usuario no tiene habilitado el modulo IQ Dispersiones." };
    }
  }

  return { allowed: true };
}
