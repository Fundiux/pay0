import assert from "node:assert/strict";
import fs from "node:fs";

const quiet = process.argv.includes("--quiet");
const read = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const policy = JSON.parse(read("config/authorization-policy.json"));

assert.equal(policy.policyId, "PAY0-USERS-PERMISSIONS");
assert.equal(policy.schemaVersion, 1);
assert.deepEqual(Object.keys(policy.roleDefaults), ["superadmin", "admin", "operador"]);

const generatedSource = read(
  "functions/src/modules/users/authorizationPolicy.generated.ts"
);
const generatedMatch = generatedSource.match(
  /export const ROLE_DEFAULT_MODULES = (\{[\s\S]*\}) as const;/
);
assert.ok(generatedMatch, "No se pudo leer ROLE_DEFAULT_MODULES generado.");
const generatedDefaults = JSON.parse(generatedMatch[1]);
assert.deepEqual(
  generatedDefaults,
  policy.roleDefaults,
  "El backend diverge de config/authorization-policy.json."
);

const rules = read("firestore.rules");
const marker = `${policy.policyId}@${policy.schemaVersion}`;
assert.ok(
  rules.includes(`AUTHORIZATION_POLICY_GENERATED_START ${marker}`),
  "Firestore Rules no declara la version canonica."
);

function getRulesRoleSegment(startNeedle, endNeedle) {
  const start = rules.indexOf(startNeedle);
  const end = rules.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0 && end > start, `No se encontro bloque ${startNeedle}.`);
  return rules.slice(start, end);
}

function parseAllowedActions(segment) {
  const result = {};
  const matcher =
    /\(moduleKey == "([^"]+)" && actionKey (?:== "([^"]+)"|in \[([^\]]*)\])\)/g;
  for (const match of segment.matchAll(matcher)) {
    const moduleKey = match[1];
    const actions = match[2]
      ? [match[2]]
      : Array.from(match[3].matchAll(/"([^"]+)"/g), (item) => item[1]);
    result[moduleKey] = Object.fromEntries(actions.map((action) => [action, true]));
  }
  return result;
}

function trueOnly(roleDefaults) {
  const result = {};
  for (const [moduleKey, actions] of Object.entries(roleDefaults)) {
    const allowed = Object.fromEntries(
      Object.entries(actions).filter(([, enabled]) => enabled === true)
    );
    if (Object.keys(allowed).length) result[moduleKey] = allowed;
  }
  return result;
}

const adminSegment = getRulesRoleSegment(
  "|| (isAdmin() && (",
  "|| (isOperador() && ("
);
const operatorSegment = getRulesRoleSegment(
  "|| (isOperador() && (",
  "));\n    }\n    // AUTHORIZATION_POLICY_GENERATED_END"
);

assert.deepEqual(
  parseAllowedActions(adminSegment),
  trueOnly(policy.roleDefaults.admin),
  "Firestore Rules diverge del techo admin."
);
assert.deepEqual(
  parseAllowedActions(operatorSegment),
  trueOnly(policy.roleDefaults.operador),
  "Firestore Rules diverge del techo operador."
);

const frontend = read("src/lib/roles.ts");
assert.match(frontend, /config\/authorization-policy\.json/);
assert.match(frontend, /merged\[moduleKey\]\[actionKey\] === true/);
assert.match(frontend, /stored\[moduleKey\]\[actionKey\] === true/);

if (!quiet) {
  console.log(
    `PASS politica ${policy.policyId}@${policy.schemaVersion}: frontend, Functions y Firestore sincronizados.`
  );
}
