/*
 * QA-only diagnostic. It changes the firebase-functions copy installed in the
 * ephemeral image, immediately before the Functions Emulator starts. The
 * original v7 error remains intact; this only prints the caller's stack.
 */
const fs = require("node:fs");
const path = require("node:path");

const packageRoot = process.argv[2];
if (!packageRoot) throw new Error("QA_CONFIG_TRACE_PACKAGE_ROOT_REQUIRED");

const target = path.join(packageRoot, "lib", "v1", "config.js");
const source = fs.readFileSync(target, "utf8");
const marker = 'throw new Error("functions.config() has been removed in firebase-functions v7. " + "Migrate to environment parameters using the params module. " + "Migration guide: https://firebase.google.com/docs/functions/config-env#migrate-config");';
const trace = 'console.error("QA_FUNCTIONS_CONFIG_ACCESS_STACK\\n" + new Error("firebase-functions.config invocation").stack);';

if (source.includes(trace)) {
  console.log(`QA_CONFIG_TRACE_ALREADY_INSTRUMENTED ${target}`);
  process.exit(0);
}
if (!source.includes(marker)) {
  throw new Error(`QA_CONFIG_TRACE_TARGET_NOT_FOUND ${target}`);
}

fs.writeFileSync(target, source.replace(marker, `${trace}\n\t${marker}`), "utf8");
console.log(`QA_CONFIG_TRACE_INSTRUMENTED ${target}`);
