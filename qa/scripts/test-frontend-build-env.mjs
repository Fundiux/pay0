import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  REQUIRED_FRONTEND_BUILD_VARIABLES,
  resolveFrontendBuildEnvironment,
  validateFrontendBuildEnvironment,
} from "../../scripts/frontend-build-env.mjs";

const cwd = fileURLToPath(new URL("../../", import.meta.url));
const target = JSON.parse(fs.readFileSync(path.join(cwd, "config/hugo-voice-build-target.json"), "utf8"));
const gatewayName = "NEXT_PUBLIC_HUGO_VOICE_GATEWAY_URL";
const validEnvironment = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "synthetic-public-firebase-test-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "pay-0-system.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "pay-0-system",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "pay-0-system.appspot.com",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "1234567890",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:1234567890:web:synthetic",
  [gatewayName]: `${target.origin}${target.path}`,
};

test("requires all seven frontend variables and accepts the canonical stable gateway", async () => {
  assert.equal(REQUIRED_FRONTEND_BUILD_VARIABLES.length, 7);
  assert.deepEqual(await validateFrontendBuildEnvironment(validEnvironment, { cwd }), { required: 7 });
});

for (const name of REQUIRED_FRONTEND_BUILD_VARIABLES) {
  test(`rejects missing ${name} without exposing configured values`, async () => {
    const environment = { ...validEnvironment };
    delete environment[name];
    await assert.rejects(validateFrontendBuildEnvironment(environment, { cwd }), (error) => {
      assert.ok(error.message.includes(name));
      for (const value of Object.values(environment)) assert.ok(!error.message.includes(value));
      return true;
    });
  });
}

const invalidGateways = [
  ["empty", ""],
  ["whitespace", "   "],
  ["surrounding whitespace", ` ${validEnvironment[gatewayName]} `],
  ["HTTP", validEnvironment[gatewayName].replace("https:", "http:")],
  ["WebSocket scheme", validEnvironment[gatewayName].replace("https:", "wss:")],
  ["missing endpoint", target.origin],
  ["different endpoint", `${target.origin}/other`],
  ["trailing slash", `${target.origin}/voice/`],
  ["placeholder", "your-gateway-url"],
  ["credentials", target.origin.replace("https://", "https://secret-user:secret-password@") + "/voice"],
  ["query", `${target.origin}/voice?token=secret-query-token`],
  ["fragment", `${target.origin}/voice#secret-fragment`],
  ["other origin", "https://another-service.example/voice"],
  ["revision or tagged URL", target.origin.replace("https://", "https://candidate---") + "/voice"],
  ["explicit port", `${target.origin}:443/voice`],
  ["encoded path", `${target.origin}/%76oice`],
];

for (const [label, value] of invalidGateways) {
  test(`rejects gateway ${label} with a sanitized error`, async () => {
    await assert.rejects(validateFrontendBuildEnvironment({ ...validEnvironment, [gatewayName]: value }, { cwd }), (error) => {
      assert.ok(error.message.includes(gatewayName));
      assert.ok(!error.message.includes(target.origin));
      if (value.trim()) assert.ok(!error.message.includes(value));
      assert.ok(!/secret-user|secret-password|secret-query-token|secret-fragment/.test(error.message));
      return true;
    });
  });
}

test("external protected environment supplies the seventh variable; process override is still validated", async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pay0-build-env-test-"));
  try {
    const fixture = path.join(temporaryDirectory, "build.env");
    fs.writeFileSync(fixture, Object.entries(validEnvironment).map(([name, value]) => `${name}=${value}`).join("\n"));
    const resolved = resolveFrontendBuildEnvironment({ cwd, processEnv: { PAY0_BUILD_ENV_FILE: fixture } });
    assert.equal(resolved.source, "PAY0_BUILD_ENV_FILE");
    assert.deepEqual(await validateFrontendBuildEnvironment(resolved.environment, { cwd }), { required: 7 });
    const overridden = resolveFrontendBuildEnvironment({ cwd, processEnv: { PAY0_BUILD_ENV_FILE: fixture, [gatewayName]: "https://unexpected.example/voice" } });
    await assert.rejects(validateFrontendBuildEnvironment(overridden.environment, { cwd }), /NEXT_PUBLIC_HUGO_VOICE_GATEWAY_URL/);
    const guardedCommand = spawnSync(process.execPath, [
      path.join(cwd, "scripts/run-with-frontend-build-env.mjs"),
      "--", process.execPath, "-e", "console.log('COMMAND_MUST_NOT_START')",
    ], {
      cwd,
      env: { ...process.env, ...validEnvironment, PAY0_BUILD_ENV_FILE: fixture, [gatewayName]: "https://unexpected.example/voice" },
      encoding: "utf8",
    });
    const output = `${guardedCommand.stdout || ""}${guardedCommand.stderr || ""}`;
    assert.equal(guardedCommand.status, 1);
    assert.ok(output.includes("FRONTEND_BUILD_ENV_GUARD_FAIL"));
    assert.ok(!output.includes("COMMAND_MUST_NOT_START"));
    assert.ok(!output.includes("https://unexpected.example/voice"));
    assert.ok(!output.includes(validEnvironment.NEXT_PUBLIC_FIREBASE_API_KEY));
  } finally {
    fs.unlinkSync(path.join(temporaryDirectory, "build.env"));
    fs.rmdirSync(temporaryDirectory);
  }
});

test("build and Hosting commands both retain the validating environment wrapper", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
  assert.ok(manifest.scripts.build.startsWith("node scripts/run-with-frontend-build-env.mjs -- "));
  assert.ok(manifest.scripts["firebase:deploy:hosting"].startsWith("node scripts/run-with-frontend-build-env.mjs -- "));
  const wrapper = fs.readFileSync(path.join(cwd, "scripts/run-with-frontend-build-env.mjs"), "utf8");
  assert.ok(wrapper.indexOf("await validateFrontendBuildEnvironment(environment)") < wrapper.indexOf("const child = spawn("));
});
