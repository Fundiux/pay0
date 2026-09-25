import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { deleteApp, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

export const REQUIRED_FRONTEND_FIREBASE_VARIABLES = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
];

const PLACEHOLDER_VALUE = /^(?:undefined|null|todo|changeme|replace(?:[-_ ]?me)?|example|your[-_ ].*|<.*>)$/i;

function readEnvironmentFile(filePath) {
  try {
    return parseEnv(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "INVALID_ENV_FILE";
    throw new Error(`No se pudo leer PAY0_BUILD_ENV_FILE (${code}).`);
  }
}
function expectedFirebaseProjectId(cwd) {
  const firebaseRcPath = path.join(cwd, ".firebaserc");
  if (!fs.existsSync(firebaseRcPath)) return null;

  try {
    const firebaseRc = JSON.parse(fs.readFileSync(firebaseRcPath, "utf8"));
    return String(firebaseRc?.projects?.default || "").trim() || null;
  } catch {
    throw new Error("La configuracion .firebaserc no es JSON valido.");
  }
}

export function resolveFrontendBuildEnvironment({ cwd = process.cwd(), processEnv = process.env } = {}) {
  const explicitFile = String(processEnv.PAY0_BUILD_ENV_FILE || "").trim();
  const localFile = path.join(cwd, ".env.local");
  const selectedFile = explicitFile
    ? path.resolve(cwd, explicitFile)
    : fs.existsSync(localFile)
      ? localFile
      : null;

  if (explicitFile && !fs.existsSync(selectedFile)) {
    throw new Error("PAY0_BUILD_ENV_FILE apunta a un archivo inexistente.");
  }

  const fileEnvironment = selectedFile ? readEnvironmentFile(selectedFile) : {};
  const environment = { ...fileEnvironment, ...processEnv };
  const source = selectedFile
    ? explicitFile
      ? "PAY0_BUILD_ENV_FILE"
      : ".env.local"
    : "process";

  return { environment, source };
}

export async function validateFrontendBuildEnvironment(environment, { cwd = process.cwd() } = {}) {
  const missing = [];
  const invalid = [];

  for (const name of REQUIRED_FRONTEND_FIREBASE_VARIABLES) {
    const value = String(environment[name] || "").trim();
    if (!value) {
      missing.push(name);
    } else if (PLACEHOLDER_VALUE.test(value) || /\s/.test(value)) {
      invalid.push(name);
    }
  }

  const apiKey = String(environment.NEXT_PUBLIC_FIREBASE_API_KEY || "").trim();
  if (apiKey && apiKey.includes(":")) invalid.push("NEXT_PUBLIC_FIREBASE_API_KEY");

  const expectedProjectId = expectedFirebaseProjectId(cwd);
  const configuredProjectId = String(environment.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
  if (expectedProjectId && configuredProjectId && configuredProjectId !== expectedProjectId) {
    invalid.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  }

  const uniqueInvalid = [...new Set(invalid)].filter((name) => !missing.includes(name));
  if (missing.length || uniqueInvalid.length) {
    const details = [
      missing.length ? `faltantes: ${missing.join(", ")}` : "",
      uniqueInvalid.length ? `invalidas: ${uniqueInvalid.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    throw new Error(`Configuracion Firebase frontend no valida (${details}).`);
  }

  const probeName = `pay0-frontend-build-env-${process.pid}-${Date.now()}`;
  let probeApp;
  try {
    probeApp = initializeApp({
      apiKey,
      authDomain: environment.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: configuredProjectId,
      storageBucket: environment.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: environment.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: environment.NEXT_PUBLIC_FIREBASE_APP_ID,
    }, probeName);
    getAuth(probeApp);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "firebase-init-failed";
    throw new Error(`Firebase Auth no acepta la configuracion frontend (${code}); revisa ${REQUIRED_FRONTEND_FIREBASE_VARIABLES.join(", ")}.`);
  } finally {
    if (probeApp) await deleteApp(probeApp);
  }

  return { required: REQUIRED_FRONTEND_FIREBASE_VARIABLES.length };
}
