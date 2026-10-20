import type { FirebaseApp } from "firebase/app";

type AppCheckSdk = Pick<typeof import("firebase/app-check"), "initializeAppCheck" | "ReCaptchaEnterpriseProvider">;
export type AppCheckInitialization =
  | "SSR" | "DISABLED" | "EMULATOR" | "INVALID_CONFIGURATION"
  | "EXCLUDED_PUBLIC_DOCUMENT" | "PUBLIC_DOCUMENT_WITH_EXISTING_PROVIDER"
  | "DEBUG_OVERRIDE_BLOCKED" | "INITIALIZED_OBSERVE_ONLY" | "INITIALIZATION_FAILED";

interface RuntimeState {
  publicDocument: boolean;
  initialized: boolean;
  instances: WeakMap<FirebaseApp, Promise<AppCheckInitialization>>;
}
interface BrowserSurface {
  readonly location: { readonly pathname: string };
  __PAY0_APP_CHECK_RUNTIME_V1__?: RuntimeState;
}
export interface AppCheckConfiguration {
  mode?: string;
  siteKey?: string;
  useEmulators: boolean;
}

/** Only pathname is examined. Never read or retain hash/search/href/bearers. */
export function excludesAppCheckForPath(pathname: string): boolean {
  if (typeof pathname !== "string" || pathname.length > 4096 || !pathname.startsWith("/")) return true;
  let path = pathname;
  try {
    // Conservatively cover encoded route prefixes and slash normalization.
    for (let n = 0; n < 2; n++) {
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded;
    }
  } catch { return true; }
  path = path.replace(/\/+/g, "/").replace(/\/+$/, "").toLowerCase();
  return path === "/descarga/documento" || path === "/firma" || path.startsWith("/firma/") ||
    path === "/verificar" || path.startsWith("/verificar/");
}

/** Observation bootstrap. Does not enforce, mint debug tokens, fetch a token for
 * logging, or change authentication/authorization. State lives for this document
 * across HMR and public-document exclusion is sticky even after URL cleanup. */
export function initializeBrowserAppCheck(
  app: FirebaseApp,
  config: AppCheckConfiguration,
  browser: BrowserSurface | null = typeof window === "undefined" ? null : window,
  loadSdk: () => Promise<AppCheckSdk> = () => import("firebase/app-check"),
): Promise<AppCheckInitialization> {
  if (!browser) return Promise.resolve("SSR");
  const state = browser.__PAY0_APP_CHECK_RUNTIME_V1__ ||= {
    publicDocument: false, initialized: false, instances: new WeakMap(),
  };
  const blockedPublicDocument = (): boolean => {
    try { if (excludesAppCheckForPath(browser.location.pathname)) state.publicDocument = true; }
    catch { state.publicDocument = true; }
    return state.publicDocument;
  };
  const publicOutcome = (): AppCheckInitialization => state.initialized
    ? "PUBLIC_DOCUMENT_WITH_EXISTING_PROVIDER" : "EXCLUDED_PUBLIC_DOCUMENT";
  if (blockedPublicDocument()) return Promise.resolve(publicOutcome());
  if (config.useEmulators) return Promise.resolve("EMULATOR");
  if (config.mode !== "OBSERVE_ONLY") return Promise.resolve("DISABLED");
  if (typeof config.siteKey !== "string" || !/^[A-Za-z0-9_-]{20,200}$/.test(config.siteKey)) return Promise.resolve("INVALID_CONFIGURATION");
  // Reject even a debug-property getter without evaluating or logging it. No
  // production/dev debug override is supported by this bootstrap.
  if ("FIREBASE_APPCHECK_DEBUG_TOKEN" in browser) return Promise.resolve("DEBUG_OVERRIDE_BLOCKED");
  const previous = state.instances.get(app);
  if (previous) return previous;
  const promise = (async (): Promise<AppCheckInitialization> => {
    try {
      const sdk = await loadSdk();
      // Navigation/debug configuration can change while the chunk is loading.
      if (blockedPublicDocument()) return publicOutcome();
      if ("FIREBASE_APPCHECK_DEBUG_TOKEN" in browser) return "DEBUG_OVERRIDE_BLOCKED";
      sdk.initializeAppCheck(app, {
        provider: new sdk.ReCaptchaEnterpriseProvider(config.siteKey!),
        isTokenAutoRefreshEnabled: true,
      });
      state.initialized = true;
      return "INITIALIZED_OBSERVE_ONLY";
    } catch {
      // Fixed status only. Provider error messages can contain URLs or tokens.
      return "INITIALIZATION_FAILED";
    }
  })();
  state.instances.set(app, promise);
  return promise;
}
