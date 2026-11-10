import * as admin from "firebase-admin";
import { runServiceId, type WarmCapacityConfig, type WarmService } from "./domain";

const RUN_API = "https://run.googleapis.com/v2";

type Fetch = typeof fetch;

export async function getRunToken(): Promise<string> {
  if (!admin.apps.length) admin.initializeApp();
  const token = await admin.app().options.credential?.getAccessToken();
  if (!token?.access_token) throw new Error("WARM_CAPACITY_NO_TOKEN");
  return token.access_token;
}

const serviceUrl = (config: WarmCapacityConfig, service: WarmService) =>
  `${RUN_API}/projects/${config.project}/locations/${config.region}/services/${runServiceId(service)}`;

/** Service-level scaling.minInstanceCount (not a revision field, so patching it creates no revision). */
export async function readMinInstances(config: WarmCapacityConfig, service: WarmService, token: string, doFetch: Fetch = fetch): Promise<number> {
  const response = await doFetch(serviceUrl(config, service), { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`RUN_GET_${response.status}`);
  const body = (await response.json()) as { scaling?: { minInstanceCount?: number } };
  return Number(body.scaling?.minInstanceCount ?? 0) || 0;
}

export async function patchMinInstances(config: WarmCapacityConfig, service: WarmService, value: number, token: string, doFetch: Fetch = fetch): Promise<void> {
  const response = await doFetch(`${serviceUrl(config, service)}?updateMask=scaling.minInstanceCount`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ scaling: { minInstanceCount: value } }),
  });
  if (!response.ok) throw new Error(`RUN_PATCH_${response.status}`);
}
