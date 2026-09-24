import fs from "node:fs";

const policyPath = "config/authorization-policy.json";
const generatedPath = "functions/src/modules/users/authorizationPolicy.generated.ts";
const rulesPath = "firestore.rules";
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));

function formatRoleDefaults(defaults) {
  const roleBlocks = Object.entries(defaults).map(([role, modules]) => {
    const moduleLines = Object.entries(modules).map(([moduleKey, actions]) => {
      const formattedActions = JSON.stringify(actions)
        .replace(/:/g, ": ")
        .replace(/,/g, ", ")
        .replace(/^\{/, "{ ")
        .replace(/\}$/, " }");
      return `    ${JSON.stringify(moduleKey)}: ${formattedActions}`;
    });
    return `  ${JSON.stringify(role)}: {\n${moduleLines.join(",\n")}\n  }`;
  });
  return `{\n${roleBlocks.join(",\n")}\n}`;
}

const generated = `// GENERATED FROM config/authorization-policy.json. DO NOT EDIT BY HAND.\n` +
  `export const AUTHORIZATION_POLICY_SCHEMA_VERSION = ${policy.schemaVersion};\n` +
  `export const AUTHORIZATION_POLICY_ID = ${JSON.stringify(policy.policyId)};\n\n` +
  `export const ROLE_DEFAULT_MODULES = ${formatRoleDefaults(policy.roleDefaults)} as const;\n`;
fs.writeFileSync(generatedPath, generated, "utf8");

function conditionForRole(roleName) {
  const entries = [];
  for (const [moduleKey, actions] of Object.entries(policy.roleDefaults[roleName])) {
    const enabled = Object.entries(actions).filter(([, value]) => value === true).map(([key]) => key);
    if (!enabled.length) continue;
    const action = enabled.length === 1
      ? `actionKey == ${JSON.stringify(enabled[0])}`
      : `actionKey in [${enabled.map((item) => JSON.stringify(item)).join(", ")}]`;
    entries.push(`(moduleKey == ${JSON.stringify(moduleKey)} && ${action})`);
  }
  return `          ${entries.join("\n          || ")}`;
}

const marker = `${policy.policyId}@${policy.schemaVersion}`;
const block = `    // AUTHORIZATION_POLICY_GENERATED_START ${marker}\n` +
`    function roleDefaultAllows(moduleKey, actionKey) {\n` +
`      return isSuperadmin()\n` +
`        || (isAdmin() && (\n${conditionForRole("admin")}\n` +
`        ))\n` +
`        || (isOperador() && (\n${conditionForRole("operador")}\n` +
`        ));\n` +
`    }\n` +
`    // AUTHORIZATION_POLICY_GENERATED_END`;

const rules = fs.readFileSync(rulesPath, "utf8");
const pattern = /    \/\/ AUTHORIZATION_POLICY_GENERATED_START[^\n]*\n[\s\S]*?    \/\/ AUTHORIZATION_POLICY_GENERATED_END/;
if (!pattern.test(rules)) throw new Error("No se encontro el bloque generado de autorizacion.");
fs.writeFileSync(rulesPath, rules.replace(pattern, block), "utf8");
console.log(`Generated ${generatedPath} and ${rulesPath} from ${policyPath}`);
