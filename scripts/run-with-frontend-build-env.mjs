import { spawn } from "node:child_process";
import {
  resolveFrontendBuildEnvironment,
  validateFrontendBuildEnvironment,
} from "./frontend-build-env.mjs";

const separator = process.argv.indexOf("--");
const command = separator >= 0 ? process.argv[separator + 1] : null;
const args = separator >= 0 ? process.argv.slice(separator + 2) : [];

if (!command) {
  console.error("Uso: node scripts/run-with-frontend-build-env.mjs -- <comando> [argumentos]");
  process.exit(2);
}
try {
  const { environment, source } = resolveFrontendBuildEnvironment();
  const result = await validateFrontendBuildEnvironment(environment);
  console.log(`FRONTEND_BUILD_ENV_GUARD_PASS source=${source} required=${result.required}/${result.required}`);

  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  child.once("error", (error) => {
    console.error(`No se pudo iniciar el comando protegido (${error.code || "spawn-failed"}).`);
    process.exit(1);
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      console.error(`El comando protegido termino por senal ${signal}.`);
      process.exit(1);
    }
    process.exit(code ?? 1);
  });
} catch (error) {
  console.error(`FRONTEND_BUILD_ENV_GUARD_FAIL ${error instanceof Error ? error.message : "error desconocido"}`);
  process.exit(1);
}
