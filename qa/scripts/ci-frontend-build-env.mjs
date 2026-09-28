import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateFrontendBuildEnvironment } from "../../scripts/frontend-build-env.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const mode = process.argv[2] || "--check";
if (!["--check", "--write-github-env"].includes(mode)) {
  throw new Error("Use --check or --write-github-env.");
}

const project = JSON.parse(readFileSync(resolve(root, ".firebaserc"), "utf8"));
const voice = JSON.parse(readFileSync(resolve(root, "config/hugo-voice-build-target.json"), "utf8"));
// These public fixtures are exclusively for a compile check. The two canonical
// identifiers satisfy the unchanged production guard; no service credential is used.
const environment = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "ci-build-only-not-a-service-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "pay0-ci-build.invalid",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: project.projects.default,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "pay0-ci-build.invalid",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:000000000000:web:ci-build-only",
  NEXT_PUBLIC_HUGO_VOICE_GATEWAY_URL: `${voice.origin}${voice.path}`,
  NEXT_PUBLIC_USE_EMULATORS: "true",
  NEXT_PUBLIC_FIREBASE_EMULATOR_HOST: "127.0.0.1",
};

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = () => { throw new Error("CI build fixture validation must not access the network."); };
  const result = await validateFrontendBuildEnvironment(environment, { cwd: root });
  if (mode === "--write-github-env") {
    if (process.env.GITHUB_ACTIONS !== "true" || !process.env.GITHUB_ENV) {
      throw new Error("Writing the build fixture requires the GitHub Actions environment file.");
    }
    appendFileSync(process.env.GITHUB_ENV, Object.entries(environment).map(([key, value]) => `${key}=${value}\n`).join(""));
  }
  console.log(`CI_BUILD_ONLY_ENV_PASS required=${result.required}/${result.required} externalActions=0`);
} finally {
  globalThis.fetch = originalFetch;
}
