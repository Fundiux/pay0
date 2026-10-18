/** Staging never reaches a real IQ/financial provider, including authentication or reads. */
export type ExternalActionsEnvironment = Record<string, string | undefined>;

export function externalActionsDecision(environment: ExternalActionsEnvironment = process.env) {
  const environmentName = String(environment.PAY0_ENVIRONMENT || "").trim().toLowerCase();
  const mode = String(environment.PAY0_EXTERNAL_ACTIONS_MODE || "").trim().toLowerCase();
  const projects = [environment.GCLOUD_PROJECT, environment.GOOGLE_CLOUD_PROJECT, environment.GCP_PROJECT];
  try {
    const config = JSON.parse(environment.FIREBASE_CONFIG || "{}");
    projects.push(config.projectId);
  } catch {
    // A file path is also accepted by the SDK. No file or credential is read here.
  }
  const isolatedProject = projects.some(project => /(?:^|[-_])(?:staging|sandbox)(?:$|[-_])/i.test(String(project || "")));
  const isolatedEnvironment = environmentName !== "" && environmentName !== "production";
  // Real sandbox credentials/hostnames have not been certified. "sandbox" remains closed.
  const explicitMode = mode !== "";
  const allowed = !isolatedProject && !isolatedEnvironment && !explicitMode;
  return { allowed, reason: allowed ? "PRODUCTION_TRANSPORT" : "EXTERNAL_ACTIONS_DISABLED" } as const;
}

export function assertExternalActionsAllowed(environment: ExternalActionsEnvironment = process.env): void {
  if (!externalActionsDecision(environment).allowed) throw new Error("EXTERNAL_ACTIONS_DISABLED");
}

/** No logging of URLs, headers, credentials or provider payloads. */
export async function fetchIqExternal(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  assertExternalActionsAllowed();
  return globalThis.fetch(input, init);
}
