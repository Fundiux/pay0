import {
  resolveFrontendBuildEnvironment,
  validateFrontendBuildEnvironment,
} from "../../scripts/frontend-build-env.mjs";

try {
  const { environment, source } = resolveFrontendBuildEnvironment();
  const result = await validateFrontendBuildEnvironment(environment);
  console.log(`FRONTEND_BUILD_ENV_GUARD_PASS source=${source} required=${result.required}/${result.required}`);
} catch (error) {
  console.error(`FRONTEND_BUILD_ENV_GUARD_FAIL ${error instanceof Error ? error.message : "error desconocido"}`);
  process.exit(1);
}
