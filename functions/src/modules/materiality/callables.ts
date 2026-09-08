import { onCall } from "firebase-functions/v2/https";
import { assertAuthorized } from "../../utils/authGuard";
import { getMyUser, requireAuth } from "../sharedCallables/helpers";
import {
  ensureMaterialityClientCompanyCore,
  getMaterialityClientCompanyOverviewCore,
  getMaterialityDashboardCore,
  getMaterialityOperationCore,
  linkSolicitudToMaterialityOperationCore,
} from "./service";

export const ensureMaterialityClientCompany = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const caller = await getMyUser(requireAuth(request));
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "materialidad", requiredAction: "sync" });
    return await ensureMaterialityClientCompanyCore(request);
  }
);

export const linkSolicitudToMaterialityOperation = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const caller = await getMyUser(requireAuth(request));
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "materialidad", requiredAction: "sync" });
    return await linkSolicitudToMaterialityOperationCore(request);
  }
);

export const getMaterialityOperation = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const caller = await getMyUser(requireAuth(request));
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "materialidad", requiredAction: "view" });
    return await getMaterialityOperationCore(request);
  }
);

export const getMaterialityClientCompanyOverview = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const caller = await getMyUser(requireAuth(request));
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "materialidad", requiredAction: "view" });
    return await getMaterialityClientCompanyOverviewCore(request);
  }
);

export const getMaterialityDashboard = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const caller = await getMyUser(requireAuth(request));
    assertAuthorized(request.auth, caller, { allowedRoles: ["superadmin", "admin", "operador"], requiredModule: "materialidad", requiredAction: "view" });
    return await getMaterialityDashboardCore(request);
  }
);
